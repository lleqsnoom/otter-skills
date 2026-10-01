"use strict";

/**
 * A review plan's counts describe the change under review by default, and the plan's Scope line names exactly what
 * was measured. These run the real analyzers in a temp repository, so the counts are the ones a review would see.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SAVE_PLAN = path.join(__dirname, "..", "skills", "x-review", "scripts", "save-plan.mjs");

let repo;

const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
const write = (rel, text) => fs.writeFileSync(path.join(repo, rel), text);

const longFunction = (name) =>
  `export function ${name}(x) {\n${Array.from({ length: 24 }, (_, i) => `  x += ${i};`).join("\n")}\n  return x;\n}\n`;
const shortFunction = (name) => `export function ${name}(x) {\n  return x + 1;\n}\n`;

function plan(...flags) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "xreview-plan-out-"));
  const run = spawnSync(process.execPath, [SAVE_PLAN, "--output", out, ...flags], { cwd: repo, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const text = fs.readFileSync(run.stdout.trim(), "utf8");
  fs.rmSync(out, { recursive: true, force: true });
  return text;
}

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "xreview-scoped-")));
  git("init", "-q", "-b", "main");
  write("old.mjs", longFunction("old"));
  git("add", "-A");
  git("commit", "-qm", "base");
  git("switch", "-qc", "feat");
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("save-plan scope", () => {
  it("measures the change since the merge-base by default, uncommitted files included", () => {
    write("a.mjs", shortFunction("a"));
    git("add", "a.mjs");
    git("commit", "-qm", "a");
    write("b.mjs", shortFunction("b"));

    const text = plan();

    assert.match(text, /\*\*Scope:\*\* 2 files changed vs main@[0-9a-f]{7} \(1 committed, 0 staged, 0 unstaged, 1 untracked\)/);
    assert.match(text, /\*\*Total files analyzed:\*\* 2\b/);
    assert.match(text, /\*\*Functions longer than 20 lines:\*\* 0\b/, "the long function on main is outside the change");
  });

  it("measures the whole repository with --all", () => {
    write("a.mjs", shortFunction("a"));

    const text = plan("--all");

    assert.match(text, /\*\*Scope:\*\* whole repository \(--all\)/);
    assert.match(text, /\*\*Functions longer than 20 lines:\*\* 1\b/, "the long function on main counts");
  });

  it("measures exactly the files named with --files", () => {
    write("a.mjs", shortFunction("a"));

    const text = plan("--files", "old.mjs");

    assert.match(text, /\*\*Scope:\*\* 1 file named with --files/);
    assert.match(text, /\*\*Functions longer than 20 lines:\*\* 1\b/);
  });

  it("says not measured, never zero, when the change holds no source files", () => {
    const text = plan();

    assert.match(text, /\*\*Functions with complexity > 5:\*\* not measured — no changed source files vs main/);
    assert.doesNotMatch(text, /\*\*Functions with complexity > 5:\*\* 0\b/);
  });
});
