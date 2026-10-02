"use strict";

/**
 * The trigger-rate measurement is a lexical approximation of routing, so what it must get right is narrow and
 * checkable: a query whose words sit in a description ranks that skill first, a query whose words sit in another
 * skill's description does not, and the floor is enforced only when it is asked for. Reporting is the default,
 * so a repo adopting it can read its own baseline before it commits to a number.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RUNNER = path.join(__dirname, "..", "skills", "o-skill-lint", "scripts", "trigger-rate.mjs");

let root;

const write = (rel, text) => {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};

const skill = (name, description) =>
  write(`skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nA fixture skill.\n`);

const triggers = (name, queries) => write(`skills/${name}/evals/triggers.json`, JSON.stringify({ skill: name, queries }, null, 2));

const run = (...args) => {
  const result = spawnSync(process.execPath, [RUNNER, "--root", root, ...args], { encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, json: result.stdout && result.stdout.trim().startsWith("{") ? JSON.parse(result.stdout) : null };
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "o-trigger-rate-"));
  skill("o-canvas", "Draw charts and diagrams onto a canvas element with crisp rendering.");
  skill("o-queue", "Publish jobs onto a queue, retry failed deliveries and inspect dead letters.");
  triggers("o-canvas", [
    { query: "draw a diagram onto the canvas", should_trigger: true },
    { query: "render a crisp chart", should_trigger: true },
    { query: "publish a job onto the queue", should_trigger: false },
  ]);
  triggers("o-queue", [
    { query: "publish a job onto the queue", should_trigger: true },
    { query: "retry failed deliveries and inspect dead letters", should_trigger: true },
    { query: "draw a diagram onto the canvas", should_trigger: false },
  ]);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("o-skill-lint trigger-rate", () => {
  it("ranks a query first for the skill whose description carries its words", () => {
    const { code, json } = run("--json");
    assert.equal(code, 0);
    assert.equal(json.skills, 2);
    assert.equal(json.skillsWithTriggers, 2);
    assert.equal(json.positives, 4);
    assert.equal(json.rank1, 100);
    assert.equal(json.falsePositives, 0);
    assert.deepEqual(json.misses, []);
  });

  it("names the miss, the skill that beat it and the runner-up", () => {
    triggers("o-canvas", [{ query: "retry failed deliveries and inspect the dead letter queue", should_trigger: true }]);
    const { code, json } = run("--json");
    assert.equal(code, 0, "reporting only: a miss is not a failure on its own");
    assert.ok(json.rank1 < 100);
    const miss = json.misses[0];
    assert.equal(miss.skill, "o-canvas");
    assert.equal(miss.top, "o-queue");
    assert.equal(miss.runnerUp, "o-canvas");
    assert.equal(json.collisions.length, 0);
  });

  it("reports how many should-not-trigger queries fired the wrong skill", () => {
    triggers("o-queue", [
      { query: "publish a job onto the queue", should_trigger: true },
      { query: "inspect the dead letter queue", should_trigger: false },
    ]);
    const { json } = run("--json");
    assert.equal(json.falsePositives, 1);
    assert.equal(json.unexpected[0].query, "inspect the dead letter queue");
    assert.equal(json.unexpected[0].top, "o-queue");
  });

  it("enforces the floor only when one is asked for", () => {
    assert.equal(run("--json").code, 0);
    assert.equal(run("--min-rank1", "50").code, 0);
    assert.equal(run("--min-rank1", "101").code, 1);
    assert.equal(run("--min-rank1", "not-a-number").code, 2);
  });

  it("warns on two descriptions that say nearly the same thing", () => {
    skill("o-queue", "Draw charts and diagrams onto a canvas element with crisp rendering, and publish jobs.");
    const { json } = run("--json");
    assert.ok(json.collisions.length >= 1);
    assert.ok(json.collisions[0].score >= 0.5);
  });

  it("refuses an option it does not know", () => {
    const { code, stderr } = run("--explain");
    assert.equal(code, 2);
    assert.match(stderr, /unknown argument/);
  });
});
