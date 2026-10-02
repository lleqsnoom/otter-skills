"use strict";

/**
 * o-decompose opens a staging folder for the tasks of one run. It reads the run's layers artifact to say which
 * plan it is working from, and after the merge that artifact is `E00-plan.md` — an epic only exists in run folders
 * written before it. These tests hold both lookups, the fallback that keeps old runs working, and the `--run`
 * selector that two runs of one topic need.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SAVE_TASKS = path.join(__dirname, "..", "skills", "o-decompose", "scripts", "save-tasks.mjs");

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "oskills-save-tasks-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function runFolder(slug, run = "01") {
  const dir = path.join(root, ".o-skills", "runs", `2026-01-01-0900-R${run}-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveTasks(...args) {
  const result = spawnSync(process.execPath, [SAVE_TASKS, ...args], { cwd: root, encoding: "utf8" });
  return { code: result.status, out: result.stdout.trim(), err: result.stderr };
}

describe("save-tasks reads the run's layers artifact", () => {
  it("names the plan of a plan-based run", () => {
    const run = runFolder("demo");
    fs.writeFileSync(path.join(run, "E00-plan.md"), "# Plan\n");

    const result = saveTasks("--epic", "demo");
    assert.equal(result.code, 0, result.err);
    assert.match(result.err, /resolved plan path: .*E00-plan\.md/);
    assert.match(result.out, /E01-tasks$/, "the tasks folder follows the plan");
  });

  it("falls back to an epic in a run written before the merge", () => {
    const run = runFolder("legacy");
    fs.writeFileSync(path.join(run, "E01-epic.md"), "# Epic\n");

    const result = saveTasks("--epic", "legacy");
    assert.equal(result.code, 0, result.err);
    assert.match(result.err, /resolved epic path: .*E01-epic\.md/);
    assert.match(result.out, /E02-tasks$/, "and it is numbered after the epic it read");
  });

  it("prefers the plan when a run holds both", () => {
    const run = runFolder("both");
    fs.writeFileSync(path.join(run, "E00-plan.md"), "# Plan\n");
    fs.writeFileSync(path.join(run, "E01-epic.md"), "# Epic\n");

    const result = saveTasks("--epic", "both");
    assert.match(result.err, /resolved plan path/);
  });

  it("says so when a run holds neither, and still opens the folder", () => {
    runFolder("bare");

    const result = saveTasks("--epic", "bare");
    assert.equal(result.code, 0, result.err);
    assert.match(result.err, /no plan or epic file found/);
    assert.match(result.out, /E00-tasks$/, "a run with no layers artifact can still stage tasks");
  });

  it("picks one run of a slug that has two", () => {
    const first = runFolder("twinned", "01");
    const second = runFolder("twinned", "02");
    fs.writeFileSync(path.join(first, "E00-plan.md"), "# Plan one\n");
    fs.writeFileSync(path.join(second, "E00-plan.md"), "# Plan two\n");

    const ambiguous = saveTasks("--epic", "twinned");
    assert.notEqual(ambiguous.code, 0, "two runs and no selector is a refusal, not a guess");
    assert.match(ambiguous.err, /--run <nn>/);

    const picked = saveTasks("--epic", "twinned", "--run", "02");
    assert.equal(picked.code, 0, picked.err);
    assert.match(picked.out, /R02-twinned/);
  });
});
