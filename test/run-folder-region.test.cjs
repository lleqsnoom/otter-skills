"use strict";

/**
 * Fifteen scripts carry the same run-folder code between `#region run-folder` markers, because a skill may not import
 * another skill's script. The copies must stay identical — a fix made in one and not the others is the drift this
 * catches. The region warns when a run would land in a scratch folder: an agent told to keep temporary files in
 * one started an o-research run from it, and the run was lost to /tmp until the user asked for it back.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");
const REGION = /\/\/ #region run-folder[\s\S]*?\/\/ #endregion run-folder/;

function regionFiles() {
  return fs.readdirSync(SKILLS).flatMap((skill) => {
    const dir = path.join(SKILLS, skill, "scripts");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).map((f) => path.join(dir, f)).filter((f) => REGION.test(fs.readFileSync(f, "utf8")));
  });
}

describe("the run-folder region", () => {
  it("is identical in every script that carries it", () => {
    const files = regionFiles();
    assert.ok(files.length >= 15, `found ${files.length}`);
    const first = fs.readFileSync(files[0], "utf8").match(REGION)[0];
    for (const file of files) assert.equal(fs.readFileSync(file, "utf8").match(REGION)[0], first, `${path.relative(SKILLS, file)} has drifted`);
  });

  it("warns when a run would land in a scratch folder, and not in a repository that lives in /tmp", () => {
    const analyze = path.join(SKILLS, "o-debug", "scripts", "analyze.mjs");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orunfolder-scratch-"));
    const warned = spawnSync(process.execPath, [analyze, "--error", "TypeError: x is undefined"], { cwd: scratch, encoding: "utf8" });
    assert.equal(warned.status, 0, warned.stderr);
    assert.match(warned.stderr, /warning: .* temp folder outside any repository/);

    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "orunfolder-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const quiet = spawnSync(process.execPath, [analyze, "--error", "TypeError: x is undefined"], { cwd: repo, encoding: "utf8" });
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.doesNotMatch(quiet.stderr, /warning:/);
  });
});
