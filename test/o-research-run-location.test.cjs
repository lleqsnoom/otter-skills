"use strict";

/**
 * An agent wrote its criteria file in the session's scratch folder, ran `start --root .` from there, and the whole
 * research run landed in /tmp; the user had to ask for it to be moved into the project, and the move broke the
 * absolute evidence paths in state.json. A run started in a temp folder outside any repository now says so, and
 * evidence is recorded relative to the run.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const STATE = path.join(__dirname, "..", "skills", "o-research", "scripts", "state.mjs");
const run = (cwd, ...args) => spawnSync(process.execPath, [STATE, ...args], { cwd, encoding: "utf8" });
const START = ["start", "--slug", "topic", "--metric", "criteria_coverage", "--evaluator", "agent", "--criteria", "2"];

describe("o-research run location", () => {
  it("warns when the run lands in a temp folder that is not a repository", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oresearch-scratch-"));
    const out = run(scratch, ...START, "--root", ".");
    assert.equal(out.status, 0, out.stderr);
    assert.match(JSON.parse(out.stdout).warning, /run this from the project root/);
    assert.match(out.stderr, /warning:/);
  });

  it("stays quiet for a repository, even one that lives in /tmp", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "oresearch-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const out = run(repo, ...START);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).warning, undefined);
  });

  it("records the evidence file relative to the run, however it was named", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "oresearch-evidence-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const { dir } = JSON.parse(run(repo, ...START).stdout);
    assert.equal(run(repo, "record", "--dir", dir, "--baseline", "--coverage", "0/2").status, 0);
    const evidence = path.join(dir, "evidence.md");
    fs.writeFileSync(evidence, "C1: https://example.com/a — answers it\n");
    const rec = run(repo, "record", "--dir", dir, "--candidate", "--coverage", "1/2", "--evidence", evidence, "--changed", "research.md", "--change", "first source");
    assert.equal(rec.status, 0, rec.stderr);
    const last = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")).history.at(-1);
    assert.equal(last.evidence.file, "evidence.md");
  });
});
