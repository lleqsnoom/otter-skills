"use strict";

/**
 * The eval runner runs a real agent, which costs tokens, so CI drives it with a scripted agent instead: one that
 * does what o-fix asks and one that resets the file first, the way o-fix once told agents to. The case's check
 * must pass the first and fail the second, or it is not checking the behaviour it names.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const RUNNER = path.join(ROOT, "scripts", "eval-run.mjs");
const load = () => import(pathToFileURL(RUNNER).href);

const PLAN = ".o-skills/runs/2026-01-01-0000-R01-stats/E01-review-plan.md";
const tick = `node -e "const f='${PLAN}';const fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replaceAll('- [ ]','- [x]'))"`;
const fixLines = `node -e "const fs=require('fs');const f='src/stats.mjs';fs.writeFileSync(f,fs.readFileSync(f,'utf8').split('\\n').filter(l=>!/const unused|average returns/.test(l)).join('\\n'))"`;

async function runWith(agent) {
  const { findCases, runCase } = await load();
  const entry = findCases().find((c) => c.skill === "o-fix" && c.name === "keeps-uncommitted-work");
  assert.ok(entry, "the o-fix case exists");
  process.env.OTTER_EVAL_AGENT_CMD = agent;
  try {
    const result = runCase(entry);
    if (result.fixture) fs.rmSync(result.fixture, { recursive: true, force: true });
    return result;
  } finally {
    delete process.env.OTTER_EVAL_AGENT_CMD;
  }
}

describe("eval runner", () => {
  it("finds every case that ships a setup, a prompt and a check", async () => {
    const { findCases } = await load();
    const names = findCases().map((c) => `${c.skill}/${c.name}`);
    for (const name of ["o-commit/one-line-message", "o-debug/reproduction-first", "o-fix/keeps-uncommitted-work"]) {
      assert.ok(names.includes(name), `${name} is found`);
    }
  });

  it("passes an agent that fixes both issues and keeps the uncommitted work", async () => {
    const result = await runWith(`${fixLines} && ${tick}`);
    assert.equal(result.passed, true, result.detail);
  });

  it("fails an agent that resets the file before fixing, naming the lost work", async () => {
    const result = await runWith(`git checkout -- src/stats.mjs && ${tick}`);
    assert.equal(result.passed, false);
    assert.match(result.detail, /uncommitted average\(\) is gone/);
  });
});
