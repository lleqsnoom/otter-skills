"use strict";

/**
 * The verification pass attacks a change with generated inputs and mutants, then gates on
 * survivors-equals-zero-or-explained. These tests pin the three halves of that promise on throwaway
 * repositories and pure inputs: the per-language tool table and runner detection, the survivors
 * parsers, the gate's matching rules, and the blocked runs — a repo with no test runner, or a
 * mutation tool missing, stops with exit 2 and never reads as a clean pass.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "skills", "o-verify", "scripts", "verify.mjs");
const mod = () => import(pathToFileURL(SCRIPT).href);

const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
const write = (cwd, file, text) => {
  const target = path.join(cwd, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};
const commitAll = (cwd, message) => {
  git(cwd, "add", "-A", "-f");
  git(cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", message);
};
const runWith = (tools) => (cwd, ...args) => {
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), "o-verify-shim-"));
  fs.writeFileSync(path.join(shim, "npx"), tools === "present" ? "#!/bin/sh\nexit 0\n" : "#!/bin/sh\n[ \"$1\" = \"--no-install\" ] && exit 1\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(shim, "mutmut"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(shim, "cargo"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const result = spawnSync(process.execPath, [SCRIPT, "--root", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${shim}${path.delimiter}${process.env.PATH}` },
  });
  fs.rmSync(shim, { recursive: true, force: true });
  return { code: result.status, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
};
const run = runWith("present");
const probeAvailable = () => ({ ok: true });

describe("o-verify language mapping and runner detection", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "o-verify-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("maps a changed file to its language and leaves the rest alone", async () => {
    const { languageFor } = await mod();
    assert.equal(languageFor("src/clamp.ts"), "javascript");
    assert.equal(languageFor("src/main.py"), "python");
    assert.equal(languageFor("src/lib.rs"), "rust");
    assert.equal(languageFor("docs/readme.md"), null);
  });

  it("detects the runners a repo already configured", async () => {
    const { detectRunners } = await mod();
    write(root, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    assert.deepEqual(detectRunners(root), [{ language: "javascript", command: "npm test" }]);
    write(root, "pytest.ini", "[pytest]\n");
    assert.deepEqual(detectRunners(root).at(-1), { language: "python", command: "python -m pytest" });
    write(root, "Cargo.toml", "[package]\nname = \"x\"\n");
    assert.deepEqual(detectRunners(root).at(-1), { language: "rust", command: "cargo test" });
  });

  it("detects nothing when nothing is configured, which is what stops the pass", async () => {
    const { detectRunners } = await mod();
    write(root, "package.json", JSON.stringify({ scripts: {} }));
    assert.deepEqual(detectRunners(root), []);
  });

  it("plans one property tool and one mutation tool per changed language", async () => {
    const { planLanguages } = await mod();
    const plans = planLanguages(["src/a.js", "src/b.py", "docs.md"], [{ language: "python", command: "python -m pytest" }], {
      probe: probeAvailable,
    });
    assert.deepEqual(
      plans.map((plan) => [plan.language, plan.runner, plan.propertyTool, plan.mutationTool, plan.missingTools]),
      [
        ["javascript", null, "fast-check", "Stryker", []],
        ["python", "python -m pytest", "hypothesis", "mutmut", []],
      ],
    );
  });

  it("names the mutation tools that are not installed instead of skipping the pass", async () => {
    const { planLanguages } = await mod();
    const plans = planLanguages(["src/a.js"], [{ language: "javascript", command: "npm test" }], { probe: () => false });
    assert.deepEqual(plans[0].missingTools, ["Stryker"]);
  });
});

describe("o-verify survivors parsers", () => {
  it("reads a Stryker report", async () => {
    const { parseStryker } = await mod();
    const survivors = parseStryker(
      JSON.stringify({
        files: {
          "src/a.js": {
            mutants: [
              { mutatorName: "Block", status: "Survived", location: { start: { line: 2 } } },
              { mutatorName: "Block", status: "Killed", location: { start: { line: 3 } } },
            ],
          },
        },
      }),
    );
    assert.deepEqual(survivors, [{ file: "src/a.js", line: 2, mutator: "Block", status: "Survived" }]);
  });

  it("rejects a report that is not JSON, which is not the same as zero survivors", async () => {
    const { parseStryker } = await mod();
    assert.throws(() => parseStryker("<html>proxy error</html>"), /not JSON/);
  });

  it("reads mutmut results text", async () => {
    const { parseMutmut } = await mod();
    assert.deepEqual(parseMutmut("src/a.py\n1. survived  src/a.py:12\n2. killed  src/a.py:14\n"), [
      { file: "src/a.py", line: 12, mutator: null, status: "Survived" },
    ]);
  });
});

describe("o-verify gate", () => {
  it("holds at zero survivors and lets an explained one through", async () => {
    const { evaluateGate } = await mod();
    const config = { explained: [{ file: "src/a.js", line: 2, owner: "tkwiatek", reason: "defensive clamp" }] };
    assert.deepEqual(evaluateGate([], config), { explained: [], unexplained: [], violations: [] });
    const gate = evaluateGate([{ file: "src/a.js", line: 2, mutator: "Block", status: "Survived" }], config);
    assert.equal(gate.unexplained.length, 0);
    assert.equal(gate.violations.length, 0);
  });

  it("reports a survivor with no matching explanation as a violation", async () => {
    const { evaluateGate } = await mod();
    const gate = evaluateGate([{ file: "src/a.js", line: 9, mutator: "Block", status: "Survived" }], {
      explained: [{ file: "src/a.js", line: 2, owner: "tkwiatek", reason: "defensive clamp" }],
    });
    assert.deepEqual(gate.violations, [
      { rule: "survivor-unexplained", file: "src/a.js", line: 9, detail: "Survived mutant by Block" },
    ]);
  });

  it("expired and ownerless explanations explain nothing", async () => {
    const { evaluateGate } = await mod();
    const survivors = [{ file: "src/a.js", line: 2, mutator: "Block", status: "Survived" }];
    const expired = evaluateGate(survivors, { explained: [{ file: "src/a.js", owner: "t", reason: "r", expires: "2020-01-01" }] }, { at: "2026-10-01" });
    assert.equal(expired.unexplained.length, 1);
    const ownerless = evaluateGate(survivors, { explained: [{ file: "src/a.js", reason: "r" }] });
    assert.equal(ownerless.unexplained.length, 1);
  });
});

describe("o-verify end to end", () => {
  let repo;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "o-verify-"));
    git(repo, "init", "-q");
    write(repo, "src/clamp.js", "export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));\n");
    write(repo, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    commitAll(repo, "base");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("blocks on a language with no test runner instead of inventing one", async () => {
    write(repo, "src/util.py", "def clamp(n, lo, hi):\n    return max(lo, min(hi, n))\n");
    const { code, stderr } = run(repo, "--base", "HEAD", "--dry-run");
    assert.equal(code, 2);
    assert.match(stderr, /no test runner configured for python/);
    assert.match(stderr, /rather than inventing one/);
  });

  it("names missing mutation tools and exits 2, never 0", async () => {
    write(repo, "src/other.js", "export const other = 1;\n");
    const { code, stderr } = runWith("absent")(repo, "--base", "HEAD", "--dry-run");
    assert.equal(code, 2);
    assert.match(stderr, /mutation tools not installed/);
    assert.match(stderr, /Stryker/);
  });

  it("dry run rates the plan, gates on an existing report, and stays unrated without one", async () => {
    const { verify } = await mod();
    const dry = (survivors) => {
      write(
        repo,
        ".x-skills/config/verify.json",
        JSON.stringify({ explained: [{ file: "src/clamp.js", owner: "tkwiatek", reason: "defensive clamp" }] }),
      );
      if (survivors) {
        write(
          repo,
          "reports/mutation/stryker.json",
          JSON.stringify({
            files: { "src/clamp.js": { mutants: [{ mutatorName: "Block", status: "Survived", location: { start: { line: 1 } } }] } },
          }),
        );
      }
      return verify({ root: repo, base: "HEAD", dryRun: true, exec: () => ({ status: 0 }), probe: probeAvailable });
    };
    write(repo, "src/extra.js", "export const extra = 2;\n");
    const unrated = dry(false);
    assert.deepEqual(unrated.rated, []);
    assert.deepEqual(unrated.unrated, ["property-tests:javascript", "survivors:javascript"]);
    assert.equal(unrated.violations.length, 0);
    const rated = dry(true);
    assert.deepEqual(rated.rated, ["survivors:javascript"]);
    assert.equal(rated.explained.length, 1);
    assert.equal(rated.violations.length, 0);
  });

  it("gates an unexplained survivor with exit 1 through the script", () => {
    write(repo, "src/extra.js", "export const extra = 2;\n");
    write(
      repo,
      "reports/mutation/stryker.json",
      JSON.stringify({
        files: { "src/clamp.js": { mutants: [{ mutatorName: "Block", status: "Survived", location: { start: { line: 1 } } }] } },
      }),
    );
    const { code, json } = run(repo, "--base", "HEAD", "--dry-run");
    assert.equal(code, 1);
    assert.deepEqual(
      json.violations.map((violation) => violation.rule),
      ["survivor-unexplained"],
    );
  });

  it("runs the property pass and reports a failing suite as a violation", async () => {
    const { verify } = await mod();
    write(repo, "src/extra.js", "export const extra = 2;\n");
    const report = verify({
      root: repo,
      base: "HEAD",
      exec: () => ({ status: 1, stdout: "", stderr: "" }),
      probe: probeAvailable,
    });
    assert.equal(report.propertyPass.status, "failed");
    assert.deepEqual(
      report.violations.map((violation) => violation.rule),
      ["test-failed"],
    );
  });

  it("passes clean when the tools report nothing to explain", async () => {
    const { verify } = await mod();
    write(repo, "src/extra.js", "export const extra = 2;\n");
    const report = verify({
      root: repo,
      base: "HEAD",
      exec: () => ({ status: 0, stdout: "", stderr: "" }),
      probe: probeAvailable,
    });
    assert.equal(report.propertyPass.status, "passed");
    assert.equal(report.mutationPass.status, "passed");
    assert.equal(report.violations.length, 0);
  });
});

describe("o-verify script surface", () => {
  it("self-test passes", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "--self-test"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  it("rejects an unknown argument with exit 2", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "--wat"], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown argument/);
  });
});