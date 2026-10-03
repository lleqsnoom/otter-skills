"use strict";

/**
 * o-plan stored --input as the absolute path it was given, so a run moved into another checkout or committed pointed
 * back into the machine it was made on. It is stored relative to the run, and the plan still links it.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCENARIO = path.join(__dirname, "..", "skills", "o-plan", "scripts", "scenario.mjs");

describe("o-plan --input", () => {
  it("is stored relative to the run, however it was named, and still linked from the plan", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "oplan-input-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const analysis = path.join(repo, ".o-skills", "runs", "2026-01-01-0000-R01-cache", "E00-analysis.md");
    fs.mkdirSync(path.dirname(analysis), { recursive: true });
    fs.writeFileSync(analysis, "# Analysis\n");
    const run = spawnSync(process.execPath, [SCENARIO, "start", "--slug", "cache-plan", "--goal", "g", "--input", analysis], { cwd: repo, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const runs = path.join(repo, ".o-skills", "runs");
    const dir = path.join(runs, fs.readdirSync(runs).find((name) => name.endsWith("-cache-plan")));
    const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.input, "../2026-01-01-0000-R01-cache/E00-analysis.md");
    const plan = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((name) => /^E\d+-plan\.md$/.test(name))), "utf8");
    assert.match(plan, /^input: "\[\[runs\/2026-01-01-0000-R01-cache\/E00-analysis\]\]"$/m);
  });
});
