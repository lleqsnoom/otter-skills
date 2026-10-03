"use strict";

/** In a fresh repository with no commit, `verdicts new` failed with git's own "ambiguous argument 'HEAD'". */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const VERDICTS = path.join(__dirname, "..", "skills", "o-unbloat", "scripts", "verdicts.mjs");

describe("o-unbloat verdicts new", () => {
  it("says a repository with no commit has no base yet, instead of git's error", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ounbloat-nocommit-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const out = spawnSync(process.execPath, [VERDICTS, "new", "--slug", "x"], { cwd: repo, encoding: "utf8" });
    assert.equal(out.status, 2);
    assert.match(JSON.parse(out.stderr).error, /no commit yet/);
    assert.doesNotMatch(out.stderr, /ambiguous argument/);
  });
});
