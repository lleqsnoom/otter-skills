"use strict";

/**
 * The artifacts a chain starts from — an analysis, a research report, a plan — open with a property block, so a run
 * reads analysis → plan → tasks in Obsidian. A plan names the input it came from; the others name their type and run.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");

function cli(cwd, script, ...args) {
  const result = spawnSync(process.execPath, [path.join(SKILLS, script), ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const repo = () => fs.mkdtempSync(path.join(os.tmpdir(), "xskills-origin-"));
const runOf = (dir) => `runs/${path.basename(dir)}`;

describe("origin artifacts start with their property block", () => {
  it("a plan names its type, its run, and the analysis it came from", () => {
    const cwd = repo();
    const analysis = path.join(".x-skills", "runs", "2026-01-01-0800-R01-key", "E00-analysis.md");
    fs.mkdirSync(path.join(cwd, path.dirname(analysis)), { recursive: true });
    fs.writeFileSync(path.join(cwd, analysis), "# Analysis — key\n");
    const { dir, state } = cli(cwd, "x-plan/scripts/scenario.mjs", "start", "--slug", "kms", "--input", analysis);
    const plan = fs.readFileSync(path.join(cwd, dir, state.report), "utf8");
    assert.ok(
      plan.startsWith(`---\ntype: plan\ntitle: "Plan · kms"\nrun: "[[${runOf(dir)}/index]]"\ninput: "[[runs/2026-01-01-0800-R01-key/E00-analysis]]"\n---\n# Plan — kms\n`),
      plan.slice(0, 300),
    );
    cli(cwd, "x-plan/scripts/scenario.mjs", "record", "--dir", dir, "--event", "research", "--data", "a finding");
    assert.ok(fs.readFileSync(path.join(cwd, dir, state.report), "utf8").startsWith("---\ntype: plan\n"), "a later record keeps the block");
  });

  it("a plan started without an input has no input key", () => {
    const cwd = repo();
    const { dir, state } = cli(cwd, "x-plan/scripts/scenario.mjs", "start", "--slug", "kms");
    assert.ok(fs.readFileSync(path.join(cwd, dir, state.report), "utf8").startsWith(`---\ntype: plan\ntitle: "Plan · kms"\nrun: "[[${runOf(dir)}/index]]"\n---\n`));
  });

  it("an analysis names its type and run", () => {
    const cwd = repo();
    const { dir, state } = cli(cwd, "x-analyze/scripts/scenario.mjs", "start", "--slug", "key");
    assert.ok(fs.readFileSync(path.join(cwd, dir, state.report), "utf8").startsWith(`---\ntype: analysis\ntitle: "Analysis · key"\nrun: "[[${runOf(dir)}/index]]"\n---\n# Analysis — key\n`));
  });

  it("a research report names its type and the run it sits in, and keeps it on every rewrite", () => {
    const cwd = repo();
    const { dir } = cli(cwd, "x-research/scripts/state.mjs", "start", "--slug", "topic", "--metric", "criteria_coverage", "--evaluator", "agent", "--criteria", "2", "--no-evidence");
    const run = path.dirname(dir);
    const expected = `---\ntype: research\ntitle: "Research · topic"\nrun: "[[runs/${path.basename(run)}/index]]"\n---\n# Research — topic\n`;
    assert.ok(fs.readFileSync(path.join(dir, "research.md"), "utf8").startsWith(expected));
    cli(cwd, "x-research/scripts/state.mjs", "record", "--dir", dir, "--baseline", "--coverage", "1/2");
    assert.ok(fs.readFileSync(path.join(dir, "research.md"), "utf8").startsWith(expected), "research.md is rewritten whole, block included");
  });
});
