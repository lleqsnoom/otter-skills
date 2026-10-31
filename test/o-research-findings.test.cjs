"use strict";

/**
 * o-research tells the agent to add what each source answers to research.md, but every `record` rewrote that file
 * whole from state.json: a nine-source run lost every finding at its next record. The script now owns only the part
 * above the findings marker, and keeps every line the agent wrote below it.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const STATE = path.join(__dirname, "..", "skills", "o-research", "scripts", "state.mjs");
const run = (cwd, ...args) => {
  const out = spawnSync(process.execPath, [STATE, ...args], { cwd, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr || out.stdout);
  return JSON.parse(out.stdout);
};
const START = ["start", "--slug", "topic", "--metric", "criteria_coverage", "--evaluator", "agent", "--criteria", "2", "--no-evidence"];

function startRun() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "oresearch-findings-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const { dir } = run(repo, ...START);
  return { repo, dir };
}

describe("research.md keeps the agent's findings", () => {
  it("keeps what the agent wrote below the marker across records, and still rewrites the history", () => {
    const { repo, dir } = startRun();
    const report = path.join(dir, "research.md");
    assert.match(fs.readFileSync(report, "utf8"), /<!-- findings[^\n]*-->\n\n## Findings\n/);
    fs.appendFileSync(report, "\n- C1: the first source answers it — https://example.com/a\n");
    run(repo, "record", "--dir", dir, "--baseline", "--coverage", "0/2");
    fs.appendFileSync(report, "- C2: the second source answers it — https://example.com/b\n");
    run(repo, "record", "--dir", dir, "--candidate", "--coverage", "2/2", "--changed", "research.md", "--change", "second source");
    const text = fs.readFileSync(report, "utf8");
    assert.match(text, /\| 1 \| candidate \| 1 \|/, "the history table is current");
    assert.match(text, /- C1: the first source answers it/);
    assert.match(text, /- C2: the second source answers it/);
    assert.equal(text.match(/## Findings/g).length, 1, "the findings heading is not repeated");
    assert.ok(text.startsWith("---\ntype: research\n"), "the property block stays first");
  });

  it("keeps the lines below the history table of a research.md written before the marker existed", () => {
    const { repo, dir } = startRun();
    const report = path.join(dir, "research.md");
    const legacy = fs.readFileSync(report, "utf8").replace(/\n<!-- findings[\s\S]*$/, "\n");
    fs.writeFileSync(report, `${legacy}## C1\n\nA finding from an older run.\n`);
    run(repo, "record", "--dir", dir, "--baseline", "--coverage", "1/2");
    const text = fs.readFileSync(report, "utf8");
    assert.match(text, /\| 0 \| baseline \|/);
    assert.match(text, /<!-- findings[^\n]*-->\n\n## C1\n\nA finding from an older run\.\n$/);
  });

  it("keeps the whole file when the agent replaced the generated part", () => {
    const { repo, dir } = startRun();
    const report = path.join(dir, "research.md");
    fs.writeFileSync(report, "# My own report\n\nEverything here is mine.\n");
    run(repo, "record", "--dir", dir, "--baseline", "--coverage", "0/2");
    assert.match(fs.readFileSync(report, "utf8"), /## History[\s\S]*<!-- findings[^\n]*-->\n\n# My own report\n\nEverything here is mine\.\n$/);
  });
});
