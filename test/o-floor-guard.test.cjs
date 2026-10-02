"use strict";

/**
 * The floor guard reports the moves that lower a declared quality bar. These tests pin the two halves of
 * that promise on throwaway repositories: the diff-scoped rules (a silenced checker, work left unfinished,
 * a test made easier, a test deleted, an assertion taken out) and the declaration comparison (a threshold
 * loosened, a rule dropped, an exception added or extended), plus the exit codes — 2 for a tree it cannot
 * read is never allowed to read as 0, clean.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GUARD = path.join(__dirname, "..", "skills", "o-floor", "scripts", "floor-guard.mjs");

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
const guard = (cwd, ...args) => {
  const result = spawnSync(process.execPath, [GUARD, "--root", cwd, "--base", "HEAD", ...args], { encoding: "utf8" });
  return { code: result.status, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
};
const rules = (report) => report.violations.map((violation) => violation.rule).sort();

describe("o-floor floor-guard", () => {
  let repo;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "o-floor-"));
    git(repo, "init", "-q");
    write(repo, "src/a.js", "export const sum = (a, b) => a + b;\n");
    write(repo, "test/sum.test.js", "it('adds', () => {\n  expect(sum(1, 2)).toBe(3);\n});\n");
    commitAll(repo, "base");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("reports a checker silenced on an added line", () => {
    write(repo, "src/a.js", "// eslint-disable-next-line no-console\nexport const log = console.log;\n");
    const { code, json } = guard(repo);
    assert.equal(code, 1);
    assert.deepEqual(rules(json), ["silenced-checker"]);
    assert.equal(json.violations[0].file, "src/a.js");
    assert.equal(json.violations[0].line, 1);
    assert.equal(json.violations[0].detail, "eslint-disable");
  });

  it("reports unfinished work, and leaves a TODO carrying a tracker reference alone", () => {
    write(repo, "src/a.js", "export const sum = (a, b) => a + b;\n// TODO: handle overflow\n// TODO(#12): handle overflow\n");
    const { json } = guard(repo);
    assert.deepEqual(rules(json), ["unfinished-work"]);
    assert.equal(json.violations[0].line, 2);
  });

  it("reads untracked files, which `git diff` alone cannot see", () => {
    write(repo, "src/fresh.js", "// @ts-ignore\nexport const x = 1;\n");
    const { code, json } = guard(repo);
    assert.equal(code, 1);
    assert.deepEqual(rules(json), ["silenced-checker"]);
    assert.equal(json.violations[0].file, "src/fresh.js");
  });

  it("reports a test made easier, an assertion removed, and a test file deleted", () => {
    write(repo, "test/sum.test.js", "it('adds', () => {\n});\n");
    write(repo, "test/new.test.js", "describe.skip('pending', () => {});\n");
    const { json } = guard(repo);
    assert.deepEqual(rules(json), ["assertion-removed", "test-made-easier"]);

    commitAll(repo, "add a test");
    fs.rmSync(path.join(repo, "test", "new.test.js"));
    const after = guard(repo);
    assert.deepEqual(rules(after.json), ["test-deleted"]);
  });

  it("reads code only: documentation and data are not a silenced checker", () => {
    write(repo, "docs/notes.md", "Never add an `// eslint-disable` here.\n");
    commitAll(repo, "docs");
    write(repo, "docs/notes.md", "Never add an `// eslint-disable` or a `TODO` here.\n");
    write(repo, "fixtures/cases.json", '{ "text": "// @ts-ignore" }\n');
    const { code, json } = guard(repo);
    assert.equal(code, 0);
    assert.deepEqual(json.violations, []);
    assert.equal(json.filesTouched, 0);
  });

  it("reports a loosened threshold, and stays quiet when it is tightened", () => {
    const floor = (value) => JSON.stringify({ rules: [{ id: "coverage", direction: "min", value }] }, null, 2);
    write(repo, ".o-skills/config/floor.json", floor(80));
    commitAll(repo, "declare the floor");

    write(repo, ".o-skills/config/floor.json", floor(70));
    const loosened = guard(repo);
    assert.equal(loosened.code, 1);
    assert.deepEqual(rules(loosened.json), ["threshold-loosened"]);
    assert.equal(loosened.json.violations[0].detail, "coverage: 80 → 70");

    write(repo, ".o-skills/config/floor.json", floor(90));
    const tightened = guard(repo);
    assert.equal(tightened.code, 0);
    assert.deepEqual(tightened.json.violations, []);
  });

  it("reports a rule dropped and an exception added, and rates the declaration checks", () => {
    write(repo, ".o-skills/config/floor.json", JSON.stringify({ rules: [{ id: "coverage", direction: "min", value: 80 }], exceptions: [] }));
    commitAll(repo, "declare the floor");

    write(
      repo,
      ".o-skills/config/floor.json",
      JSON.stringify({ rules: [], exceptions: [{ rule: "coverage", owner: "t", expires: "2026-12-31" }] }),
    );
    const { code, json } = guard(repo);
    assert.equal(code, 1);
    assert.deepEqual(rules(json), ["new-exception", "rule-removed"]);
    assert.deepEqual(json.unrated, []);
    assert.ok(json.rated.includes("threshold-loosened"));
  });

  it("names the declaration checks it could not run when there is no floor file", () => {
    const { code, json } = guard(repo);
    assert.equal(code, 0);
    assert.deepEqual(json.unrated, ["threshold-loosened", "threshold-changed", "threshold-removed", "rule-removed", "new-exception", "exception-extended"]);
    assert.deepEqual(json.rated.sort(), ["assertion-removed", "silenced-checker", "test-deleted", "test-made-easier", "unfinished-work"]);
  });

  it("exits 2 when it cannot run, so a tree it cannot read never reads as clean", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "o-floor-nogit-"));
    const result = spawnSync(process.execPath, [GUARD, "--root", outside], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no merge base/);
    assert.equal(result.stdout, "");
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("passes its own fixtures and refuses an unknown option", () => {
    const selfTest = spawnSync(process.execPath, [GUARD, "--self-test"], { encoding: "utf8" });
    assert.equal(selfTest.status, 0);
    assert.equal(JSON.parse(selfTest.stdout).selfTest, "pass");

    const unknown = spawnSync(process.execPath, [GUARD, "--explain"], { encoding: "utf8" });
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown argument/);
  });
});
