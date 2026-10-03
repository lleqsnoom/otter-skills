#!/usr/bin/env node
/**
 * o-floor — the floor guard.
 *
 * Reports the moves that lower a repository's quality bar, as `file:line` with a rule name, by
 * reading the diff between a merge base and the working tree and comparing the declared floor
 * (`.o-skills/config/floor.json`) at the base with the one on disk.
 *
 * It reports the rule and the location, never the matched source text, so a suppression beside a
 * secret cannot leak through the report.
 *
 * Usage: node floor-guard.mjs [--root <dir>] [--base <ref>] [--config <path>] [--self-test] [--help]
 * Exit:  0 clean · 1 at least one floor violation · 2 the guard could not run
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "evals", "fixtures", "floor-cases.json");

export const DEFAULT_CONFIG = ".o-skills/config/floor.json";
const BASE_CANDIDATES = ["origin/main", "origin/master", "main", "master"];

/**
 * The rules are about code constructs, so only code is read: a suppression named in a README or stored in
 * a fixture is prose or data, not a checker someone silenced. A repo can extend the list in its floor file.
 */
const CODE_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "h",
  "cc", "cpp", "hpp", "cs", "php", "scala", "hs", "ex", "exs", "erl", "clj", "fs", "zig", "jl", "pl", "r",
  "lua", "dart", "adb", "sh", "bash", "zsh", "fish", "ps1", "sql", "vue", "svelte", "astro",
]);

/** Every rule this guard can report. `rated` in the output names the ones actually checked. */
export const DIFF_RULES = ["silenced-checker", "unfinished-work", "test-made-easier", "test-deleted", "assertion-removed"];
export const CONFIG_RULES = ["threshold-loosened", "threshold-changed", "threshold-removed", "rule-removed", "new-exception", "exception-extended"];

/**
 * A source line that switches a checker off. The label is what the report shows, so the reader learns
 * which checker went quiet without the guard echoing the line it was found on.
 */
const SUPPRESSIONS = [
  ["ts-ignore", /@ts-ignore|@ts-nocheck|@ts-expect-error/],
  ["eslint-disable", /eslint-disable/],
  ["biome-ignore", /biome-ignore/],
  ["noqa", /# *noqa\b/],
  ["type-ignore", /# *type: *ignore/],
  ["istanbul-ignore", /istanbul ignore/],
  ["nosemgrep", /nosemgrep/],
  ["gitleaks-allow", /gitleaks:allow/],
  ["stryker-disable", /Stryker disable/],
];

/** A line that admits the work is not finished. A bare `TODO` counts; one carrying a tracker reference does not. */
const STUBS = [
  ["not-implemented", /throw new (?:Error|NotImplemented)[^\n]*[Nn]ot implemented|NotImplementedError/],
  ["empty-catch", /catch\s*\(?[\w\s]*\)?\s*\{\s*\}/],
  ["todo", /\bTODO\b/],
];

/** A line that makes a test easier to pass instead of making the code pass it. */
const SKIPS = [
  ["test-skip", /\b(?:it|test|describe|context)\s*\.\s*(?:skip|todo)\s*\(|\bxit\(|\bxdescribe\(|\bxcontext\(/],
  ["python-skip", /@pytest\.mark\.skip|pytest\.skip\(/],
  ["go-skip", /t\.Skip\(/],
  ["rust-ignore", /#\[ignore\]/],
];

const TODO_WITH_REFERENCE = /#\d+|https?:\/\//;

export const isTestFile = (file) => /\.(?:test|spec)\.|_test\.|(?:^|\/)test_|(?:^|\/)tests?\//.test(file);

const extensionOf = (file) => {
  const name = String(file ?? "");
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
};

/** `*` stays inside a path segment; `**` crosses one. Enough for the ignore lists a floor needs. */
export function globToRegExp(glob) {
  const escaped = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** A path the guard reads: a code file, not on an ignore list, and not the guard's own pattern table. */
export function isScannable(file, { extensions = CODE_EXTENSIONS, ignore = [] } = {}) {
  if (!file) return false;
  if (!extensions.has(extensionOf(file))) return false;
  return !ignore.some((glob) => globToRegExp(glob).test(file));
}

/** One added source line to zero or more findings. Pure, so the fixtures can pin it. */
export function classifyAddedLine({ file, line, text }) {
  const out = [];
  for (const [label, pattern] of SUPPRESSIONS) if (pattern.test(text)) out.push({ rule: "silenced-checker", file, line, detail: label });
  for (const [label, pattern] of SKIPS) if (pattern.test(text)) out.push({ rule: "test-made-easier", file, line, detail: label });
  for (const [label, pattern] of STUBS) {
    if (!pattern.test(text)) continue;
    if (label === "todo" && TODO_WITH_REFERENCE.test(text)) continue;
    out.push({ rule: "unfinished-work", file, line, detail: label });
  }
  return out;
}

const ASSERTION = /\b(?:expect|assert|should)\b/;

/**
 * Removed assertions, net of the ones added to the same test file. A test rewritten with as many assertions as
 * it lost — or more — lowered nothing; counting removed lines alone reported every test refactor as a violation.
 * What is left is the net loss, reported on the last removed lines of that file.
 */
export function netAssertions(removedFindings, addedLines) {
  const added = new Map();
  for (const entry of addedLines) {
    if (isTestFile(entry.file) && ASSERTION.test(entry.text)) added.set(entry.file, (added.get(entry.file) ?? 0) + 1);
  }
  const byFile = new Map();
  for (const finding of removedFindings) byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]);
  return [...byFile].flatMap(([file, findings]) => {
    const net = findings.length - (added.get(file) ?? 0);
    return net > 0 ? findings.slice(-net).map((finding) => ({ ...finding, detail: `assertion (net ${net} fewer in this file)` })) : [];
  });
}

/** The findings a removed line carries: an assertion taken out of a test that still exists. */
export function classifyRemovedLine({ file, line, text, deletedFiles = [] }) {
  if (!isTestFile(file) || deletedFiles.includes(file)) return [];
  return ASSERTION.test(text) ? [{ rule: "assertion-removed", file, line, detail: "assertion" }] : [];
}

const ruleIds = (config) => {
  const rules = Array.isArray(config?.rules) ? config.rules : [];
  return new Map(rules.filter((rule) => rule && typeof rule.id === "string").map((rule) => [rule.id, rule]));
};

const exceptions = (config) => (Array.isArray(config?.exceptions) ? config.exceptions.filter(Boolean) : []);

/**
 * Compare the floor declared at the base with the one on disk. Only moves that lower the bar are
 * reported: a threshold raised, a rule added, or an exception dropped is silent on purpose.
 */
export function compareFloors(base, current, configRel = DEFAULT_CONFIG) {
  const out = [];
  if (!base) return out;
  const before = ruleIds(base);
  const after = ruleIds(current);

  for (const [id, was] of before) {
    const now = after.get(id);
    if (!now) {
      out.push({ rule: "rule-removed", file: configRel, line: null, detail: id });
      continue;
    }
    if (typeof now.value === "number" && typeof was.value === "number" && now.value !== was.value) {
      if (was.direction === "min" && now.value < was.value) {
        out.push({ rule: "threshold-loosened", file: configRel, line: null, detail: `${id}: ${was.value} → ${now.value}` });
      } else if (was.direction === "max" && now.value > was.value) {
        out.push({ rule: "threshold-loosened", file: configRel, line: null, detail: `${id}: ${was.value} → ${now.value}` });
      } else if (was.direction !== "min" && was.direction !== "max") {
        out.push({ rule: "threshold-changed", file: configRel, line: null, detail: `${id}: ${was.value} → ${now.value}` });
      }
    } else if (typeof was.value === "number" && typeof now.value !== "number") {
      out.push({ rule: "threshold-removed", file: configRel, line: null, detail: id });
    }
  }

  const had = exceptions(base);
  const has = exceptions(current);
  for (let i = had.length; i < has.length; i++) {
    out.push({ rule: "new-exception", file: configRel, line: null, detail: String(has[i].rule ?? "?") });
  }
  for (const was of had) {
    const now = has.find((entry) => entry.rule === was.rule);
    if (!now) continue;
    if (typeof was.expires === "string" && typeof now.expires === "string" && now.expires > was.expires) {
      out.push({ rule: "exception-extended", file: configRel, line: null, detail: `${was.rule}: ${was.expires} → ${now.expires}` });
    }
  }
  return out;
}

/** Parse a `-U0` unified diff into added and removed lines, both carrying their file and line number. */
export function parseDiff(diff) {
  const added = [];
  const removed = [];
  const deletedFiles = [];
  let file = null;
  let oldFile = null;
  let newLine = 0;
  let oldLine = 0;
  const strip = (value) => value.trim().replace(/^"(.*)"$/, "$1").replace(/^[ab]\//, "");
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- ")) oldFile = strip(line.slice(4));
    else if (line.startsWith("+++ ")) {
      const next = strip(line.slice(4));
      file = next === "/dev/null" ? oldFile : next;
      if (next === "/dev/null" && file) deletedFiles.push(file);
    } else if (line.startsWith("@@")) {
      const at = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (at) {
        oldLine = Number(at[1]);
        newLine = Number(at[2]);
      }
    } else if (line.startsWith("+")) added.push({ file, line: newLine++, text: line.slice(1) });
    else if (line.startsWith("-")) removed.push({ file, line: oldLine++, text: line.slice(1) });
  }
  return { added, removed, deletedFiles };
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

function readWorkingConfig(root, configRel) {
  const file = path.join(root, configRel);
  if (!fs.existsSync(file)) return { config: null, file: null };
  return { config: JSON.parse(fs.readFileSync(file, "utf8")), file };
}

const MEASURE_TIMEOUT_MS = 5 * 60 * 1000;

/** The number a rule's tool printed: `{"value": n}` JSON, or else the last number in its output. */
export function readMeasurement(stdout) {
  const text = String(stdout ?? "").trim();
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "number") return parsed;
    if (typeof parsed?.value === "number") return parsed.value;
  } catch {}
  const numbers = text.match(/-?\d+(?:\.\d+)?/g);
  return numbers ? Number(numbers[numbers.length - 1]) : null;
}

const activeException = (config, id, now) =>
  exceptions(config).some((entry) => entry.rule === id && (!entry.expires || new Date(entry.expires) >= now));

/**
 * Run each declared rule's `tool` and hold its number against `value`: a declaration nobody measures is a promise,
 * and this is the check that keeps it. A rule with an active exception is not held; a tool that fails is unmeasured.
 */
export function measureFloor(config, root, { run = defaultMeasure, now = new Date() } = {}) {
  const violations = [];
  const measured = [];
  const unmeasured = [];
  for (const rule of ruleIds(config).values()) {
    if (typeof rule.tool !== "string" || !rule.tool.trim() || typeof rule.value !== "number") continue;
    if (activeException(config, rule.id, now)) {
      measured.push({ id: rule.id, status: "excepted" });
      continue;
    }
    const result = run(rule.tool, root);
    const value = result.ok ? readMeasurement(result.stdout) : null;
    if (value === null) {
      unmeasured.push({ id: rule.id, reason: result.ok ? "the tool printed no number" : result.reason });
      continue;
    }
    measured.push({ id: rule.id, value, target: rule.value, direction: rule.direction ?? null });
    const unmet = rule.direction === "min" ? value < rule.value : rule.direction === "max" ? value > rule.value : false;
    if (unmet) violations.push({ rule: "threshold-unmet", file: null, line: null, detail: `${rule.id}: measured ${value} vs ${rule.direction} ${rule.value}` });
  }
  return { violations, measured, unmeasured };
}

function defaultMeasure(command, cwd) {
  const result = spawnSync(command, { cwd, shell: true, encoding: "utf8", timeout: MEASURE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) return { ok: false, reason: result.error.message };
  if (result.status !== 0) return { ok: false, reason: `exit ${result.status}` };
  return { ok: true, stdout: result.stdout };
}

export function guard({ root, base, configRel = DEFAULT_CONFIG, ignore: extraIgnore = [], measure = false }) {
  const resolved = resolveBase(root, base);
  if (!resolved) throw new Error(`no merge base: none of ${base ? [base] : BASE_CANDIDATES} resolves in ${root}`);

  const mergeBase = git(["merge-base", resolved, "HEAD"], root)?.trim();
  if (!mergeBase) throw new Error(`no merge base between ${resolved} and HEAD`);

  // `--no-prefix` keeps the path readable whatever `diff.mnemonicPrefix` or `diff.noprefix` is set to
  // on this machine: with a prefix configured, the header is `+++ w/src/a.js` and every path is wrong.
  const tracked = git(["diff", "--no-prefix", "--unified=0", mergeBase, "--"], root, { allowDiffExit: true });
  if (tracked === null) throw new Error(`could not diff against ${mergeBase}`);
  const parsed = parseDiff(tracked);

  const untracked = git(["ls-files", "--others", "--exclude-standard"], root);
  if (untracked === null) throw new Error("could not list untracked files");
  for (const rel of untracked.split("\n").filter(Boolean)) {
    const absolute = path.join(root, rel);
    let text = "";
    try {
      text = fs.readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    text.split("\n").forEach((line, index) => parsed.added.push({ file: rel, line: index + 1, text: line }));
  }

  const working = readWorkingConfig(root, configRel);
  // The guard does not police its own pattern table: when the skill is vendored into the tree it is
  // reading, its own directory is skipped, and nothing else is.
  const selfRel = path.relative(root, path.resolve(__dirname, "..")).split(path.sep).join("/");
  const ignore = [...(working.config?.ignore ?? []), ...extraIgnore, ...(selfRel && !selfRel.startsWith("..") ? [`${selfRel}/**`] : [])];
  const extensions = new Set([...CODE_EXTENSIONS, ...(working.config?.codeExtensions ?? [])]);
  const scannable = (file) => isScannable(file, { extensions, ignore });

  const violations = [];
  for (const entry of parsed.added) {
    if (!scannable(entry.file)) continue;
    violations.push(...classifyAddedLine(entry));
  }
  const removedAssertions = parsed.removed
    .filter((entry) => scannable(entry.file))
    .flatMap((entry) => classifyRemovedLine({ ...entry, deletedFiles: parsed.deletedFiles }));
  violations.push(...netAssertions(removedAssertions, parsed.added.filter((entry) => scannable(entry.file))));
  for (const file of parsed.deletedFiles) {
    if (isTestFile(file) && scannable(file)) violations.push({ rule: "test-deleted", file, line: null, detail: "test file deleted" });
  }

  const baseText = git(["show", `${mergeBase}:${configRel}`], root);
  let baseConfig = null;
  if (baseText !== null) {
    try {
      baseConfig = JSON.parse(baseText);
    } catch {
      throw new Error(`${configRel} at ${mergeBase} is not JSON`);
    }
  }
  violations.push(...compareFloors(baseConfig, working.config, configRel));

  // A repo that uses TODO as a working note can turn the bare-TODO check off; stubs and empty catches still count.
  const allowBareTodo = working.config?.unfinishedWork?.bareTodo === false;
  const kept = allowBareTodo ? violations.filter((v) => !(v.rule === "unfinished-work" && v.detail === "todo")) : violations;
  const measurement = measure ? measureFloor(working.config, root) : null;
  if (measurement) kept.push(...measurement.violations);

  const configRated = baseConfig !== null || working.config !== null;
  const touched = new Set([...parsed.added, ...parsed.removed].map((entry) => entry.file).filter((file) => file && scannable(file)));

  return {
    root,
    base: resolved,
    mergeBase,
    config: working.file,
    ignore,
    filesTouched: touched.size,
    rated: [...DIFF_RULES, ...(configRated ? CONFIG_RULES : []), ...(measurement ? ["threshold-unmet"] : [])],
    unrated: configRated ? [] : CONFIG_RULES,
    ...(measurement ? { measured: measurement.measured, unmeasured: measurement.unmeasured } : {}),
    violations: kept,
  };
}

function selfTest() {
  const cases = JSON.parse(fs.readFileSync(FIXTURES, "utf8"));
  const failures = [];
  for (const testCase of cases) {
    const actual =
      testCase.kind === "removed"
        ? classifyRemovedLine({ ...testCase.input, deletedFiles: testCase.deletedFiles ?? [] })
        : testCase.kind === "config"
          ? compareFloors(testCase.input.base, testCase.input.current)
          : classifyAddedLine(testCase.input);
    const expected = testCase.expect;
    const ok =
      actual.length === expected.length &&
      expected.every((want) => actual.some((got) => got.rule === want.rule && got.file === want.file && got.line === want.line && got.detail === want.detail));
    if (!ok) failures.push({ case: testCase.name, expected, actual });
  }
  return failures;
}

function usage() {
  return [
    "o-floor — the floor guard.",
    "",
    "Usage:",
    "  node floor-guard.mjs                 # guard the repo you are in",
    "  node floor-guard.mjs --root <dir>    # guard another repo",
    "  node floor-guard.mjs --base <ref>    # diff against another base (default: origin/main, main, master)",
    "  node floor-guard.mjs --config <path> # another floor file (default: .o-skills/config/floor.json)",
    "  node floor-guard.mjs --ignore <glob> # skip a path; repeatable, and the config's `ignore` adds to it",
    "  node floor-guard.mjs --measure       # also run each rule's `tool` and hold its number against `value`",
    "  node floor-guard.mjs --self-test",
    "",
    "Exit: 0 clean · 1 floor violation · 2 could not run",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    if (index === -1) return fallback;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
    return value;
  };
  const every = (name) => args.flatMap((arg, index) => (arg === name && args[index + 1] && !args[index + 1].startsWith("--") ? [args[index + 1]] : []));
  try {
    if (args.includes("--help") || args.includes("-h")) {
      process.stdout.write(usage());
      return;
    }
    const known = ["--root", "--base", "--config", "--ignore"];
    const unknown = args.filter((arg, index) => arg.startsWith("--") && !known.includes(arg) && !["--self-test", "--measure", "--help", "-h"].includes(arg) && !known.includes(args[index - 1]));
    if (unknown.length) throw new Error(`unknown argument ${unknown[0]}`);

    if (args.includes("--self-test")) {
      const failures = selfTest();
      process.stdout.write(`${JSON.stringify({ selfTest: failures.length === 0 ? "pass" : "fail", failures }, null, 2)}\n`);
      process.exit(failures.length === 0 ? 0 : 1);
    }

    const root = path.resolve(option("--root", process.cwd()));
    const report = guard({ root, base: option("--base", undefined), configRel: option("--config", DEFAULT_CONFIG), ignore: every("--ignore"), measure: args.includes("--measure") });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    // A rule whose tool could not run was not checked, and that is never a clean result.
    process.exit(report.violations.length ? 1 : report.unmeasured?.length ? 2 : 0);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
