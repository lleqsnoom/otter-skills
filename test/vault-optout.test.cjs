"use strict";

/**
 * Obsidian's links, topics and tag notes are written by default, and `.o-skills/config/vault.json` with
 * `{ "enabled": false }` turns them off for a repo that does not use a vault. The fields scripts read stay.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCENARIO = path.join(__dirname, "..", "skills", "o-plan", "scripts", "scenario.mjs");

function startPlan(vault) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ovault-"));
  if (vault !== undefined) {
    fs.mkdirSync(path.join(repo, ".o-skills", "config"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".o-skills", "config", "vault.json"), JSON.stringify({ enabled: vault }));
  }
  const run = spawnSync(process.execPath, [SCENARIO, "start", "--slug", "cache", "--goal", "add a cache", "--topics", "domain/search"], { cwd: repo, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const runs = path.join(repo, ".o-skills", "runs");
  const dir = path.join(runs, fs.readdirSync(runs).find((name) => name.endsWith("-cache")));
  const plan = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((name) => /^E\d+-plan\.md$/.test(name))), "utf8");
  return { plan, tags: fs.existsSync(path.join(repo, ".o-skills", "tags")) };
}

describe("vault opt-out", () => {
  it("writes links, topics and tag notes by default", () => {
    const { plan, tags } = startPlan(undefined);
    assert.match(plan, /^run: "\[\[runs\/.+\/index\]\]"$/m);
    assert.match(plan, /\[\[tags\/domain\/search\]\]/);
    assert.equal(tags, true);
  });

  it("writes none of them when the repo turns the vault off, and keeps the type", () => {
    const { plan, tags } = startPlan(false);
    assert.doesNotMatch(plan, /\[\[/);
    assert.match(plan, /^type: plan$/m);
    assert.equal(tags, false);
  });
});
