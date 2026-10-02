#!/usr/bin/env node
/**
 * x-verify — the verification pass after a fix or implementation.
 *
 * Attacks the change instead of trusting it: property-based tests over the changed functions, a
 * mutation pass over the diff, and a gate that reports every surviving mutant as `file:line` —
 * a mutant the tests did not kill is behavior nothing checks. The gate is survivors-equals-zero-or-
 * explained: a survivor ships only when `.x-skills/config/verify.json` explains it with an owner
 * and a reason.
 *
 * This is a driver, not a framework: per language it picks one property tool and one mutation tool
 * (the choice lives in references/tool-choice.md), runs their documented commands, and reads survivors
 * from where those tools already write them. When a repo has no test runner for a language it
 * changed, it reports that and stops — it never invents one.
 *
 * Usage: node verify.mjs [--root <dir>] [--base <ref>] [--config <path>] [--dry-run] [--self-test] [--help]
 * Exit:  0 clean (or, in --dry-run, nothing to read yet) · 1 violations · 2 the pass could not run
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "evals", "fixtures", "verify-cases.json");

export const DEFAULT_CONFIG = ".x-skills/config/verify.json";
const BASE_CANDIDATES = ["origin/main", "origin/master", "main", "master"];

/**
 * The design call, written down once: for each supported language one property tool and one mutation
 * tool, and the place each leaves its survivors. A repo that wants another tool edits this table and
 * the reference page, rather than the pass growing a plugin system.
 */
export const TOOLING = {
  javascript: {
    extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"],
    propertyTool: "fast-check",
    mutation: {
      tool: "Stryker",
      command: "npx stryker run",
      survivors: { format: "stryker-json", path: "reports/mutation/stryker.json" },
      check: ["npx", "--no-install", "stryker", "--version"],
    },
  },
  python: {
    extensions: [".py"],
    propertyTool: "hypothesis",
    mutation: {
      tool: "mutmut",
      command: "mutmut run",
      survivors: { format: "mutmut-results", command: "mutmut results" },
      check: ["mutmut", "version"],
    },
  },
  rust: {
    extensions: [".rs"],
    propertyTool: "proptest",
    mutation: {
      tool: "cargo-mutants",
      command: "cargo mutants --in-diff <base> --output json",
      survivors: { format: "cargo-mutants-json", path: "mutants.out/outcomes.json" },
      check: ["cargo", "mutants", "--version"],
    },
  },
};

/** A mutant no test killed. `NoCoverage` is one too: uncovered behavior is behavior nothing checks. */
const SURVIVOR_STATUSES = new Set(["Survived", "NoCoverage"]);

const extensionOf = (file) => {
  const name = String(file ?? "");
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
};

export function languageFor(file) {
  const ext = `.${extensionOf(file)}`;
  for (const [language, spec] of Object.entries(TOOLING)) {
    if (spec.extensions.includes(ext)) return language;
  }
  return null;
}

/** A language has a test runner only when its runner is already configured; the pass configures nothing. */
export function detectRunners(root) {
  const runners = [];
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const scripts = JSON.parse(fs.readFileSync(pkgPath, "utf8")).scripts ?? {};
      if (typeof scripts.test === "string" && scripts.test.trim()) {
        runners.push({ language: "javascript", command: "npm test" });
      }
    } catch {
      // an unreadable package.json is not a test runner
    }
  }
  for (const file of ["pyproject.toml", "pytest.ini", "tox.ini", "setup.cfg"]) {
    if (!fs.existsSync(path.join(root, file))) continue;
    if (fs.readFileSync(path.join(root, file), "utf8").includes("pytest")) {
      runners.push({ language: "python", command: "python -m pytest" });
      break;
    }
  }
  if (fs.existsSync(path.join(root, "Cargo.toml"))) {
    runners.push({ language: "rust", command: "cargo test" });
  }
  return runners;
}

function git(args, cwd, { allowDiffExit = false } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (allowDiffExit && err.status === 1 && typeof err.stdout === "string") return err.stdout;
    return null;
  }
}

/** The first candidate base that resolves, or null. A shallow clone resolves none, and that is exit 2. */
export function resolveBase(root, requested) {
  const candidates = requested ? [requested] : BASE_CANDIDATES;
  for (const ref of candidates) {
    if (git(["rev-parse", "--verify", `${ref}^{commit}`], root)) return ref;
  }
  return null;
}

export function changedFiles(root, base) {
  const mergeBase = git(["merge-base", base, "HEAD"], root)?.trim();
  if (!mergeBase) throw new Error(`no merge base between ${base} and HEAD`);
  const tracked = git(["diff", "--name-only", "--no-prefix", mergeBase, "--"], root, { allowDiffExit: true });
  if (tracked === null) throw new Error(`could not diff against ${mergeBase}`);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], root);
  if (untracked === null) throw new Error("could not list untracked files");
  return [...new Set([...tracked.split("\n").filter(Boolean), ...untracked.split("\n").filter(Boolean)])];
}

function spawn(args, cwd) {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  return { ok: result.status === 0 && !result.error, error: result.error?.code ?? null };
}

export function planLanguages(files, runners, { probe = (check) => spawn(check, process.cwd()) } = {}) {
  const byRunner = new Map(runners.map((runner) => [runner.language, runner]));
  const grouped = new Map();
  for (const file of files) {
    const language = languageFor(file);
    if (!language) continue;
    if (!grouped.has(language)) grouped.set(language, []);
    grouped.get(language).push(file);
  }
  const plans = [];
  for (const [language, group] of [...grouped.entries()].sort()) {
    const spec = TOOLING[language];
    const missing = probe(spec.mutation.check).ok ? [] : [spec.mutation.tool];
    plans.push({
      language,
      files: group,
      runner: byRunner.get(language)?.command ?? null,
      propertyTool: spec.propertyTool,
      mutationTool: spec.mutation.tool,
      mutationCommand: spec.mutation.command,
      survivors: spec.mutation.survivors,
      missingTools: missing,
    });
  }
  return plans;
}

export function parseStryker(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error("the Stryker report is not JSON");
  }
  const out = [];
  for (const [file, entry] of Object.entries(report?.files ?? {})) {
    for (const mutant of entry?.mutants ?? []) {
      if (!SURVIVOR_STATUSES.has(mutant?.status)) continue;
      out.push({
        file,
        line: mutant.location?.start?.line ?? null,
        mutator: mutant.mutatorName ?? null,
        status: mutant.status,
      });
    }
  }
  return out;
}

/** `mutmut results` prints one line per mutant; the survivors carry `path:line`. */
export function parseMutmut(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = line.match(/(?:^|\s)survived\s+([^\s:]+):(\d+)/);
    if (m) out.push({ file: m[1], line: Number(m[2]), mutator: null, status: "Survived" });
  }
  return out;
}

/**
 * cargo-mutants outcomes.json: a mutant is a survivor when no run killed or caught it and it was
 * neither a timeout nor unviable.
 */
export function parseCargoMutants(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error("the cargo-mutants outcomes file is not JSON");
  }
  const out = [];
  for (const outcome of report?.outcomes ?? []) {
    const mutant = outcome?.mutant ?? {};
    const decided = [outcome?.killed, outcome?.caught].some(
      (verdict) => verdict !== null && verdict !== undefined && verdict !== false,
    );
    if (decided || outcome?.timeout || outcome?.unviable) continue;
    out.push({
      file: mutant.file ?? null,
      line: mutant.line ?? null,
      mutator: mutant.mutation_type ?? mutant.name ?? null,
      status: "Survived",
    });
  }
  return out;
}

const READERS = {
  "stryker-json": parseStryker,
  "cargo-mutants-json": parseCargoMutants,
};

/**
 * Survivors come from where the tool already wrote them. A file source is read whenever it exists;
 * a command source (`mutmut results`) runs only in a real pass, so a dry run over mutmut stays
 * unrated rather than pretending to have read nothing.
 */
export function readSurvivors(source, root, { exec }) {
  if (source.path) {
    const file = path.join(root, source.path);
    if (!fs.existsSync(file)) return null;
    return READERS[source.format](fs.readFileSync(file, "utf8"));
  }
  if (!exec) return null;
  const result = exec({ command: source.command, cwd: root });
  if (result.status !== 0) throw new Error(`${source.command} failed with exit ${result.status}`);
  return source.format === "mutmut-results" ? parseMutmut(result.stdout ?? "") : [];
}

export function loadConfig(root, configRel) {
  const file = path.join(root, configRel);
  if (!fs.existsSync(file)) return { explained: [], file: null };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`${configRel} is not JSON: ${err.message}`);
  }
  return { ...parsed, file };
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * A survivor is explained when a config entry matches its file (and its line, when the entry names
 * one) and carries an owner and a reason. An entry whose expiry has passed explains nothing.
 */
export function evaluateGate(survivors, config, { at = today() } = {}) {
  const entries = Array.isArray(config?.explained) ? config.explained : [];
  const explained = [];
  const unexplained = [];
  for (const survivor of survivors) {
    const match = entries.find(
      (entry) =>
        entry?.file === survivor.file &&
        (entry.line === undefined || entry.line === null || entry.line === survivor.line) &&
        typeof entry.owner === "string" &&
        entry.owner.trim() &&
        typeof entry.reason === "string" &&
        entry.reason.trim() &&
        !(typeof entry.expires === "string" && entry.expires < at),
    );
    if (match) explained.push({ ...survivor, owner: match.owner, reason: match.reason });
    else unexplained.push(survivor);
  }
  const violations = unexplained.map((survivor) => ({
    rule: "survivor-unexplained",
    file: survivor.file,
    line: survivor.line,
    detail: survivor.mutator ? `${survivor.status} mutant by ${survivor.mutator}` : survivor.status,
  }));
  return { explained, unexplained, violations };
}

/**
 * Run the pass. `exec` runs a shell command and returns { status, stdout, stderr }: main hands in a
 * real spawner, and tests hand in a stub so no tool has to be installed.
 */
export function verify({ root, base, configRel = DEFAULT_CONFIG, dryRun = false, exec, probe }) {
  const resolved = resolveBase(root, base);
  if (!resolved) {
    throw new Error(`no base: none of ${base ? [base] : BASE_CANDIDATES} resolves in ${root}`);
  }
  const files = changedFiles(root, resolved);
  const code = files.filter((file) => languageFor(file));
  const runners = detectRunners(root);
  const plans = planLanguages(code, runners, probe ? { probe } : {});
  const withoutRunner = plans.filter((plan) => !plan.runner);
  if (withoutRunner.length) {
    const names = withoutRunner.map((plan) => plan.language).join(", ");
    throw new Error(
      `no test runner configured for ${names}; x-verify stops rather than inventing one — set it up, then run the pass again`,
    );
  }
  const missingTools = plans.filter((plan) => plan.missingTools.length);
  if (missingTools.length) {
    const detail = missingTools.map((plan) => `${plan.language}: ${plan.missingTools.join(", ")}`).join("; ");
    throw new Error(`mutation tools not installed — ${detail}; install them, then run the pass again`);
  }

  const config = loadConfig(root, configRel);
  const report = {
    root,
    base: resolved,
    config: config.file,
    mode: dryRun ? "dry-run" : "run",
    changedFiles: code,
    languages: plans.map(({ survivors, ...rest }) => rest),
    propertyPass: { status: "not-run" },
    mutationPass: { status: "not-run" },
    rated: [],
    unrated: [],
    survivors: [],
    explained: [],
    unexplained: [],
    violations: [],
  };

  for (const plan of plans) {
    if (!dryRun) {
      const run = exec({ command: plan.runner, cwd: root });
      if (run.status !== 0) {
        report.propertyPass = { status: "failed", command: plan.runner, exitCode: run.status };
        report.violations.push({ rule: "test-failed", file: plan.files.join(", "), line: null, detail: plan.runner });
        return report;
      }
      report.propertyPass = { status: "passed", command: plan.runner };
      const mutants = exec({ command: plan.mutationCommand, cwd: root });
      if (mutants.status !== 0) {
        throw new Error(`${plan.mutationCommand} failed with exit ${mutants.status}`);
      }
      report.mutationPass = { status: "passed", command: plan.mutationCommand };
    } else {
      report.unrated.push(`property-tests:${plan.language}`);
    }

    const survivors = readSurvivors(plan.survivors, root, { exec: dryRun ? null : exec });
    if (survivors === null) {
      report.unrated.push(`survivors:${plan.language}`);
      continue;
    }
    report.rated.push(`survivors:${plan.language}`);
    report.survivors.push(...survivors);
  }

  if (report.survivors.length || report.rated.length) {
    const gate = evaluateGate(report.survivors, config);
    report.explained = gate.explained;
    report.unexplained = gate.unexplained;
    report.violations.push(...gate.violations);
  }
  return report;
}

const selfTest = () => {
  const cases = JSON.parse(fs.readFileSync(FIXTURES, "utf8"));
  const failures = [];
  for (const testCase of cases) {
    try {
      if (testCase.kind === "gate") {
        const gate = evaluateGate(testCase.survivors, testCase.config, { at: testCase.at });
        if (JSON.stringify(gate.unexplained) !== JSON.stringify(testCase.unexplained)) {
          failures.push(`${testCase.name}: unexplained ${JSON.stringify(gate.unexplained)}`);
        }
        continue;
      }
      const survivors =
        testCase.kind === "stryker"
          ? parseStryker(JSON.stringify(testCase.input))
          : testCase.kind === "mutmut"
            ? parseMutmut(testCase.input)
            : parseCargoMutants(JSON.stringify(testCase.input));
      if (JSON.stringify(survivors) !== JSON.stringify(testCase.survivors)) {
        failures.push(`${testCase.name}: survivors ${JSON.stringify(survivors)}`);
      }
    } catch (err) {
      failures.push(`${testCase.name}: ${err.message}`);
    }
  }
  return failures;
};

const usage = () =>
  [
    "x-verify — property-based and mutation-testing pass over a change.",
    "",
    "Usage:",
    "  node verify.mjs [--root <dir>] [--base <ref>] [--config <path>] [--dry-run]",
    "  node verify.mjs --self-test",
    "  node verify.mjs --help",
    "",
    "Exit: 0 clean · 1 violations (unexplained survivors, a failing property pass) · 2 could not run",
    "",
  ].join("\n");

function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    if (index === -1) return fallback;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
    return value;
  };
  try {
    if (args.includes("--help") || args.includes("-h")) {
      process.stdout.write(usage());
      return;
    }
    const known = ["--root", "--base", "--config"];
    const unknown = args.filter(
      (arg, index) => arg.startsWith("--") && !known.includes(arg) && !["--self-test", "--dry-run", "--help", "-h"].includes(arg) && !known.includes(args[index - 1]),
    );
    if (unknown.length) throw new Error(`unknown argument ${unknown[0]}`);

    if (args.includes("--self-test")) {
      const failures = selfTest();
      process.stdout.write(`${JSON.stringify({ selfTest: failures.length === 0 ? "pass" : "fail", failures }, null, 2)}\n`);
      process.exit(failures.length === 0 ? 0 : 1);
    }

    const root = path.resolve(option("--root", process.cwd()));
    const report = verify({
      root,
      base: option("--base", undefined),
      configRel: option("--config", DEFAULT_CONFIG),
      dryRun: args.includes("--dry-run"),
      exec: ({ command, cwd }) => {
        const result = spawnSync(command, { cwd, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
        return { status: result.status, stdout: result.stdout, stderr: result.stderr };
      },
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.violations.length === 0 ? 0 : 1);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
