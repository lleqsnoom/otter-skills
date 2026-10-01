"use strict";

/**
 * A review measures the change, and x-implement reviews before it commits, so the change is whatever the branch
 * holds since the merge-base: commits, the index, the working tree and new files alike.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MODULE = path.join(__dirname, "..", "skills", "x-review", "scripts", "change-scope.mjs");

let repo;

const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
const write = (rel, text = "export const x = 1;\n") => fs.writeFileSync(path.join(repo, rel), text);

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "xreview-scope-")));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("changeScope", () => {
  it("lists committed, staged, unstaged and untracked source files since the merge-base", async () => {
    git("init", "-q", "-b", "main");
    write("base.mjs");
    write("gone.mjs");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("switch", "-qc", "feat");
    write("a.mjs");
    git("add", "a.mjs");
    git("commit", "-qm", "a");
    write("b.mjs");
    git("add", "b.mjs");
    write("base.mjs", "export const x = 2;\n");
    write("c.mjs");
    write("notes.txt", "not source\n");
    fs.rmSync(path.join(repo, "gone.mjs"));

    const { changeScope } = await import(MODULE);
    const scope = changeScope({ cwd: repo });

    assert.equal(scope.kind, "change");
    assert.equal(scope.ref, "main");
    assert.deepEqual(scope.committed, ["a.mjs"]);
    assert.deepEqual(scope.staged, ["b.mjs"]);
    assert.deepEqual(scope.unstaged, ["base.mjs"]);
    assert.deepEqual(scope.untracked, ["c.mjs"]);
    assert.deepEqual(scope.files, ["a.mjs", "b.mjs", "base.mjs", "c.mjs"].map((f) => path.join(repo, f)));
  });

  it("measures the whole tree outside a git repository", async () => {
    const { changeScope } = await import(MODULE);
    assert.equal(changeScope({ cwd: repo }).kind, "tree");
  });
});
