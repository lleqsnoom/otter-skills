"use strict";

/**
 * o-rollback reverts what it was asked to, and only with an approval that names the commits. `--last 1` once
 * meant HEAD~1 — the commit before the last — and a shell with no terminal (every agent's shell) skipped the
 * confirmation entirely, so "roll back the last commit" reverted the wrong one without asking.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REVERT = path.join(__dirname, "..", "skills", "o-rollback", "scripts", "revert.mjs");

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orollback-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  for (const n of [1, 2, 3]) {
    fs.writeFileSync(path.join(dir, `f${n}.txt`), `${n}\n`);
    git("add", ".");
    git("commit", "-qm", `feat: add f${n}`);
  }
  return { dir, git };
}

const run = (dir, ...args) => spawnSync(process.execPath, [REVERT, ...args], { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

describe("o-rollback targets", () => {
  it("--last 1 is the most recent commit, --last 2 the two most recent, newest first", () => {
    const { dir } = repo();
    const one = JSON.parse(run(dir, "--last", "1", "--dry-run").stdout);
    assert.deepEqual(one.targets.map((t) => t.message), ["feat: add f3"]);
    const two = JSON.parse(run(dir, "--last", "2", "--dry-run").stdout);
    assert.deepEqual(two.targets.map((t) => t.message), ["feat: add f3", "feat: add f2"]);
  });

  it("refuses a commit that is not in the current branch's history", () => {
    const { dir, git } = repo();
    git("switch", "-qc", "side");
    fs.writeFileSync(path.join(dir, "side.txt"), "x\n");
    git("add", ".");
    git("commit", "-qm", "feat: side");
    const side = git("rev-parse", "HEAD");
    git("switch", "-q", "-");
    const result = run(dir, "--commit", side, "--dry-run");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not in the current branch's history/);
  });

  it("refuses to revert on a dirty tree, but still previews and says what blocks it", () => {
    const { dir, git } = repo();
    const head = git("rev-parse", "HEAD");
    fs.writeFileSync(path.join(dir, "f1.txt"), "changed\n");
    const revert = run(dir, "--last", "1", "--yes", "--expect-sha", head.slice(0, 12));
    assert.equal(revert.status, 1);
    assert.match(revert.stderr, /not clean/);
    assert.equal(git("rev-parse", "HEAD"), head, "nothing was reverted");
    const preview = run(dir, "--last", "1", "--dry-run");
    assert.equal(preview.status, 0);
    assert.match(JSON.parse(preview.stdout).blocked, /not clean/);
  });
});

describe("o-rollback confirmation without a terminal", () => {
  it("refuses to revert without --yes and names the approval to ask for", () => {
    const { dir, git } = repo();
    const head = git("rev-parse", "HEAD");
    const result = run(dir, "--last", "1");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--yes --expect-sha [0-9a-f]{12}/);
    assert.equal(git("rev-parse", "HEAD"), head, "nothing was reverted");
  });

  it("refuses --yes when --expect-sha names a different commit than --last resolves to", () => {
    const { dir, git } = repo();
    const parent = git("rev-parse", "HEAD~1");
    const result = run(dir, "--last", "1", "--yes", "--expect-sha", parent.slice(0, 12));
    assert.equal(result.status, 1);
    assert.equal(git("log", "-1", "--format=%s"), "feat: add f3");
  });

  it("reverts exactly the approved commit with a conventional message", () => {
    const { dir, git } = repo();
    const head = git("rev-parse", "HEAD");
    const result = run(dir, "--last", "1", "--yes", "--expect-sha", head.slice(0, 12));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git("log", "-1", "--format=%s"), "revert: feat: add f3");
    assert.equal(fs.existsSync(path.join(dir, "f3.txt")), false);
    assert.equal(fs.existsSync(path.join(dir, "f2.txt")), true, "the commit before it is untouched");
  });

  it("refuses a merge commit until --mainline says which side to keep", () => {
    const { dir, git } = repo();
    git("switch", "-qc", "side");
    fs.writeFileSync(path.join(dir, "side.txt"), "x\n");
    git("add", ".");
    git("commit", "-qm", "feat: side");
    git("switch", "-q", "-");
    git("merge", "--no-ff", "-q", "-m", "chore: merge side", "side");
    const result = run(dir, "--last", "1", "--dry-run");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /merge commit; pass --mainline 1/);
  });
});
