"use strict";

/**
 * o-commit validates and commits in one step. The commit runs without a shell, so a message carrying `$(…)` is
 * text, not a command; and a body is reserved for a change large enough to need its why written down.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPTS = path.join(__dirname, "..", "skills", "o-commit", "scripts");
const COMMIT = path.join(SCRIPTS, "commit.mjs");
const validator = () => import(pathToFileURL(path.join(SCRIPTS, "validate-commit.mjs")).href);
const suggester = () => import(pathToFileURL(path.join(SCRIPTS, "suggest-type.mjs")).href);

function stagedRepo(files = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ocommit-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  for (let n = 0; n < files; n++) fs.writeFileSync(path.join(dir, `f${n}.txt`), `${n}\n`);
  git("add", ".");
  return { dir, git };
}

describe("o-commit message rules", () => {
  it("accepts a conventional subject and a single BREAKING CHANGE footer, and nothing else", async () => {
    const { validateMessage } = await validator();
    assert.deepEqual(validateMessage("feat(api): add the export endpoint"), []);
    assert.deepEqual(validateMessage("feat(api)!: drop v1\n\nBREAKING CHANGE: v1 clients must move to v2"), []);
    assert.ok(validateMessage("feat: add x\n\nsome body").length);
    assert.ok(validateMessage("feat: add x.").length);
    assert.ok(validateMessage("added stuff").length);
    assert.ok(validateMessage("fix: x\n\nBREAKING CHANGE: y\nCo-authored-by: someone").length);
  });

  it("allows a body only for a large change, as one short paragraph without attribution", async () => {
    const { validateBody } = await validator();
    assert.match(validateBody("why it changed", { files: 2, lines: 30 }).join(), /large change/);
    assert.deepEqual(validateBody("why it changed", { files: 12, lines: 30 }), []);
    assert.deepEqual(validateBody("why it changed", { files: 1, lines: 500 }), []);
    assert.match(validateBody("one\n\ntwo", { files: 12, lines: 0 }).join(), /one paragraph/);
    assert.match(validateBody("x Co-authored-by: a", { files: 12, lines: 0 }).join(), /attribution/);
  });
});

describe("o-commit commits", () => {
  it("never hands the message to a shell", () => {
    const { dir, git } = stagedRepo();
    const marker = path.join(dir, "PWNED");
    const message = `fix: handle $(touch ${marker}) and \`touch ${marker}\` in names`;
    const result = spawnSync(process.execPath, [COMMIT, message], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(marker), false, "the message was run as a command");
    assert.equal(git("log", "-1", "--format=%s"), message);
  });

  it("writes the body as its own paragraph when the change is large enough", () => {
    const { dir, git } = stagedRepo(12);
    const result = spawnSync(process.execPath, [COMMIT, "feat: add twelve files", "--body", "They seed the fixture set."], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git("log", "-1", "--format=%b").trim(), "They seed the fixture set.");
  });

  it("refuses a body on a small change and makes no commit", () => {
    const { dir, git } = stagedRepo(1);
    const result = spawnSync(process.execPath, [COMMIT, "feat: add one file", "--body", "Because."], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.throws(() => git("rev-parse", "HEAD"), "no commit exists");
  });
});

describe("o-commit scope suggestion", () => {
  it("names the area most files sit in, and nothing when the change is spread out", async () => {
    const { suggestScope } = await suggester();
    assert.equal(suggestScope("", ["skills/o-review/SKILL.md", "skills/o-review/scripts/a.mjs", "test/x.cjs"]), "o-review");
    assert.equal(suggestScope("", ["skills/o-fix/SKILL.md", "hooks/a.mjs", "scripts/b.mjs", "README.md", "test/c.cjs"]), null);
  });
});
