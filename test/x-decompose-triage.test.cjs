"use strict";

/**
 * x-decompose triages every candidate before it writes a task file: the work stays a task here, needs a run of
 * its own, needs an analysis first, or drops. These tests hold what that decision implies - a verdict with a
 * reason, a child run that exists and holds an artifact for the two verdicts that cost a run, task files that
 * match the `task` verdicts one for one - and, since a run can hold two decompositions, that each ledger rules
 * its own tasks rung instead of the pair sharing one.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TRIAGE = path.join(__dirname, "..", "skills", "x-decompose", "scripts", "triage.mjs");

let root;
let run;
let rel;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-triage-"));
  run = path.join(root, ".x-skills", "runs", "2026-01-01-0900-R01-platform-game");
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "E01-epic.md"), "# Epic\n\n### L0 - Walking skeleton\n");
  rel = path.relative(root, run);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function triage(args) {
  const result = spawnSync(process.execPath, [TRIAGE, ...args], { cwd: root, encoding: "utf8" });
  const json = parse(result.stdout) || parse(result.stderr);
  assert.ok(json, `no JSON on either stream: ${result.stdout}${result.stderr}`);
  return { code: result.status, json, stdout: result.stdout, stderr: result.stderr };
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function start(...extra) {
  const result = triage(["start", "--dir", rel, ...extra]);
  assert.equal(result.code, 0, result.stderr);
  return result.json;
}

function add(task, title, ...extra) {
  const result = triage(["add", "--dir", rel, "--task", task, "--title", title, ...extra]);
  assert.equal(result.code, 0, result.stderr);
  return result.json;
}

function decide(args) {
  const result = triage(["decide", "--dir", rel, ...args]);
  assert.equal(result.code, 0, result.stderr);
  return result.json;
}

function tryAdd(task, title, ...extra) {
  return triage(["add", "--dir", rel, "--task", task, "--title", title, ...extra]);
}

function tryDecide(args) {
  return triage(["decide", "--dir", rel, ...args]);
}

function verify(...extra) {
  return triage(["verify", "--dir", rel, ...extra]);
}

function childRun(slug, artifact = "E00-plan.md") {
  const dir = path.join(root, ".x-skills", "runs", `2026-01-01-0901-R01-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  if (artifact) fs.writeFileSync(path.join(dir, artifact), "# Artifact\n");
  return dir;
}

/** Stands in for save-tasks.mjs: the tasks folder is the next rung after the ledger. */
function tasksDir() {
  const used = fs
    .readdirSync(run)
    .map((name) => Number((name.match(/^E(\d{2})-/) || [])[1]))
    .filter((value) => Number.isInteger(value));
  const next = used.length ? Math.max(...used) + 1 : 0;
  const dir = path.join(run, `E${String(next).padStart(2, "0")}-tasks`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A task file as the template writes one: its property block, then the body. `properties` overrides the block. */
function taskFile(name, dir = null, properties = "size: S\ncomplexity: clear\ncomplexity_why: copies a sibling\n") {
  const target = dir || tasksDir();
  const block = properties === null ? "" : `---\ntype: task\n${properties}---\n`;
  fs.writeFileSync(path.join(target, name), `${block}# Task\n\n## Definition of Done\n- [ ] something\n`);
  return target;
}

function rules(result) {
  return result.json.violations.map((violation) => violation.rule);
}

/** A candidate whose verdict hands the work to a child run that has been started, waiting on layer 2 by default. */
function planCandidate(task, title, child = "platform-physics", layer = 2) {
  add(task, title);
  childRun(child);
  return decide(["--task", task, "--verdict", "plan", "--why", "own contract", "--evidence", "src/game/loop.js:1", "--child", child, "--layer", String(layer)]);
}

/** Five candidates across three layers: two tasks, two child runs, one drop, and the files the tasks verdicts earn. */
function agreedDecomposition() {
  start();
  add("L0-T1", "one level, one sprite, arrow keys move it");
  add("L1-T2", "pause menu");
  add("L2-T1", "physics and collisions");
  add("L2-T2", "leaderboard storage");
  add("L3-T1", "the old rendering test, again");
  childRun("platform-physics", "E00-plan.md");
  childRun("leaderboard-backend", "E03-analysis.md");
  decide(["--task", "L0-T1", "--verdict", "task", "--why", "one change, one check, 3h"]);
  decide(["--task", "L1-T2", "--verdict", "task", "--why", "one component, one test, 2h"]);
  decide(["--task", "L2-T1", "--verdict", "plan", "--why", "own contract", "--evidence", "src/game/loop.js:1", "--child", "platform-physics", "--layer", "2"]);
  decide(["--task", "L2-T2", "--verdict", "analyze", "--why", "storage shape undecided", "--evidence", "src/score.js:4", "--child", "leaderboard-backend", "--layer", "2"]);
  decide(["--task", "L3-T1", "--verdict", "drop", "--why", "L0 already covers it"]);
  const dir = tasksDir();
  taskFile("L0-T1-one-level-one-sprite.md", dir);
  taskFile("L1-T2-pause-menu.md", dir);
  return dir;
}

describe("x-decompose triage ledger", () => {
  it("starts a ledger beside the artifact it was drafted from", () => {
    const started = start();
    assert.equal(started.candidates, 0);
    assert.equal(started.source, "E01-epic.md");
    assert.equal(started.report, path.join(rel, "E02-triage.md"));
    assert.equal(started.ledger, "triage-02.json");
    assert.ok(fs.existsSync(path.join(run, "E02-triage.md")));
    assert.equal(JSON.parse(fs.readFileSync(path.join(run, "triage-02.json"), "utf8")).slug, "platform-game");
  });

  it("reads a plan as the source when the run holds one", () => {
    fs.writeFileSync(path.join(run, "E03-plan.md"), "# Plan\n");
    assert.equal(start().source, "E03-plan.md");
  });

  it("refuses to start when the run holds no plan and no epic", () => {
    fs.rmSync(path.join(run, "E01-epic.md"));
    const result = triage(["start", "--dir", rel]);
    assert.equal(result.code, 2);
    assert.match(result.json.error, /no E<nn>-plan\.md or E<nn>-epic\.md/);
  });

  it("keeps the slug when one is given", () => {
    start("--slug", "Platform Game!");
    assert.equal(JSON.parse(fs.readFileSync(path.join(run, "triage-02.json"), "utf8")).slug, "Platform-Game");
  });

  it("refuses a candidate id that is not L<N>-T<M>", () => {
    start();
    const result = tryAdd("T1", "physics");
    assert.equal(result.code, 2);
    assert.match(result.json.error, /is not L<N>-T<M>/);
  });

  it("refuses a verdict for a candidate that was never added", () => {
    start();
    const result = tryDecide(["--task", "L0-T1", "--verdict", "task", "--why", "small"]);
    assert.equal(result.code, 2);
    assert.match(result.json.error, /was never added/);
  });

  it("refuses a verdict with no reason", () => {
    start();
    add("L0-T1", "one sprite that moves");
    const result = tryDecide(["--task", "L0-T1", "--verdict", "task"]);
    assert.equal(result.code, 2);
    assert.match(result.json.error, /--why is required/);
  });

  it("refuses a verdict kind outside the four", () => {
    start();
    add("L0-T1", "one sprite that moves");
    const result = tryDecide(["--task", "L0-T1", "--verdict", "maybe", "--why", "unsure"]);
    assert.equal(result.code, 2);
    assert.match(result.json.error, /not one of task\|plan\|analyze\|drop/);
  });
});

describe("x-decompose triage hands work to a run of its own", () => {
  it("refuses a plan verdict with no evidence and no child", () => {
    start();
    add("L2-T1", "physics and collisions");
    const noEvidence = tryDecide(["--task", "L2-T1", "--verdict", "plan", "--why", "too big"]);
    assert.equal(noEvidence.code, 2);
    assert.match(noEvidence.json.error, /--evidence is required/);

    const withEvidence = tryDecide(["--task", "L2-T1", "--verdict", "plan", "--why", "too big", "--evidence", "src/game/loop.js:1"]);
    assert.equal(withEvidence.code, 2);
    assert.match(withEvidence.json.error, /--child is required/);
  });

  it("refuses a plan verdict while the child run does not exist", () => {
    start();
    add("L2-T1", "physics and collisions");
    const result = tryDecide([
      "--task", "L2-T1", "--verdict", "plan", "--why", "own contract", "--evidence", "src/game/loop.js:1", "--child", "platform-physics",
    ]);
    assert.equal(result.code, 2);
    assert.match(result.json.error, /no run folder ending in -platform-physics/);
    assert.match(result.json.error, /scenario\.mjs start --slug platform-physics/);
  });

  it("refuses a plan verdict for a child run that was never started", () => {
    start();
    add("L2-T1", "physics and collisions");
    childRun("platform-physics", null);
    const result = tryDecide([
      "--task", "L2-T1", "--verdict", "plan", "--why", "own contract", "--evidence", "src/game/loop.js:1", "--child", "platform-physics",
    ]);
    assert.equal(result.code, 2);
    assert.match(result.json.error, /holds no E<nn>-\*\.md artifact yet/);
  });

  it("records the child run's folder once the run holds an artifact", () => {
    start();
    const recorded = planCandidate("L2-T1", "physics and collisions");
    assert.equal(recorded.childRun, path.join(rel, "..", "2026-01-01-0901-R01-platform-physics"));
  });

  it("refuses an analyze verdict for an empty child run too", () => {
    start();
    add("L2-T2", "leaderboard storage");
    childRun("leaderboard-backend", null);
    const result = tryDecide([
      "--task", "L2-T2", "--verdict", "analyze", "--why", "shape undecided", "--evidence", "src/score.js:4", "--child", "leaderboard-backend",
    ]);
    assert.equal(result.code, 2);
    assert.match(result.json.error, /has not been started/);
  });
});

describe("x-decompose triage report", () => {
  it("writes one row per candidate and lists the handoffs", () => {
    start();
    add("L0-T1", "one sprite that moves");
    decide(["--task", "L0-T1", "--verdict", "task", "--why", "one change, one check, 3h"]);
    planCandidate("L2-T1", "physics and collisions");

    const report = fs.readFileSync(path.join(run, "E02-triage.md"), "utf8");
    assert.match(report, /\*\*Source:\*\* E01-epic\.md/);
    assert.match(report, /This is a task ledger, not x-triage's bug brief/);
    assert.match(report, /\| L0-T1 \| task \| one change, one check, 3h \| - \|/);
    assert.match(report, /\| L2-T1 \| plan \| own contract \| src\/game\/loop\.js:1 \|/);
    assert.match(report, /## Handoffs\n\n- \*\*L2-T1\*\* - x-plan run `platform-physics`/);
  });

  it("keeps prose written outside the blocks it owns", () => {
    start();
    const report = path.join(run, "E02-triage.md");
    fs.appendFileSync(report, "\n## Notes\n\nThe layers read as components; say so at the gate.\n");
    add("L0-T1", "one sprite that moves");
    const text = fs.readFileSync(report, "utf8");
    assert.match(text, /The layers read as components; say so at the gate\./);
    assert.match(text, /\| L0-T1 \| - \| - \| - \|/);
  });
});

describe("x-decompose triage verify", () => {
  it("fails while a candidate is undecided", () => {
    start();
    add("L0-T1", "one sprite that moves");
    tasksDir();
    const result = verify();
    assert.equal(result.code, 1);
    assert.deepEqual(rules(result), ["undecided"]);
  });

  it("fails when a plan verdict has no run behind it", () => {
    start();
    add("L2-T1", "physics and collisions");
    childRun("platform-physics");
    decide([
      "--task", "L2-T1", "--verdict", "plan", "--why", "own contract", "--evidence", "src/game/loop.js:1", "--child", "platform-physics", "--layer", "2",
    ]);
    fs.rmSync(path.join(root, ".x-skills", "runs", "2026-01-01-0901-R01-platform-physics"), { recursive: true, force: true });
    tasksDir();
    const result = verify();
    assert.equal(result.code, 1);
    assert.deepEqual(rules(result), ["child-run-missing"]);
    assert.match(result.json.violations[0].detail, /-platform-physics/);
  });

  it("fails when a task verdict has no file", () => {
    start();
    add("L0-T1", "one sprite that moves");
    decide(["--task", "L0-T1", "--verdict", "task", "--why", "small"]);
    tasksDir();
    const result = verify();
    assert.equal(result.code, 1);
    assert.deepEqual(rules(result), ["task-file-missing"]);
  });

  it("fails on an orphan file and on a file whose verdict is not task", () => {
    start();
    add("L0-T1", "one sprite that moves");
    childRun("platform-physics");
    decide(["--task", "L0-T1", "--verdict", "plan", "--why", "own contract", "--evidence", "src/game/loop.js:1", "--child", "platform-physics", "--layer", "2"]);
    const dir = tasksDir();
    taskFile("L0-T1-one-sprite.md", dir);
    taskFile("L9-T9-stray.md", dir);
    const result = verify();
    assert.equal(result.code, 1);
    assert.deepEqual(rules(result).sort(), ["orphan-task-file", "verdict-not-task"]);
  });

  it("fails on a file that is not named by id", () => {
    start();
    add("L0-T1", "one sprite that moves");
    decide(["--task", "L0-T1", "--verdict", "task", "--why", "small"]);
    taskFile("sprite.md");
    const result = verify();
    assert.equal(result.code, 1);
    assert.deepEqual(rules(result).sort(), ["bad-name", "task-file-missing"]);
  });

  it("fails a duplicate claim on one id", () => {
    start();
    add("L0-T1", "one sprite that moves");
    decide(["--task", "L0-T1", "--verdict", "task", "--why", "small"]);
    const dir = taskFile("L0-T1-one-sprite.md");
    taskFile("L0-T1-one-sprite-again.md", dir);
    const result = verify();
    assert.equal(result.code, 1);
    assert.deepEqual(rules(result), ["task-file-duplicate"]);
  });

  it("fails when the tasks folder does not exist", () => {
    start();
    add("L0-T1", "one sprite that moves");
    decide(["--task", "L0-T1", "--verdict", "task", "--why", "small"]);
    const result = verify();
    assert.equal(result.code, 1);
    assert.deepEqual(rules(result), ["no-tasks-dir"]);
  });

  it("passes when the verdicts, the child runs and the task files agree", () => {
    agreedDecomposition();
    const result = verify();
    assert.deepEqual(result.json.violations, []);
    assert.equal(result.code, 0);
    assert.equal(result.json.candidates, 5);
    assert.equal(result.json.taskFiles, 2);
  });

  it("writes no task file for a plan or an analyze verdict", () => {
    const dir = agreedDecomposition();
    assert.deepEqual(fs.readdirSync(dir).sort(), ["L0-T1-one-level-one-sprite.md", "L1-T2-pause-menu.md"]);
  });

  it("counts the candidates, the decisions and the handoffs it lists", () => {
    agreedDecomposition();
    const listed = triage(["list", "--dir", rel]);
    assert.equal(listed.json.candidates, 5);
    assert.equal(listed.json.decided, 5);
    assert.equal(listed.json.handoffs, 2);
  });
});

describe("x-decompose triage receipts", () => {
  /** A child run holding a tasks folder with one task file, ticked or not. */
  function childWithTasks(slug, ticked) {
    const dir = childRun(slug, null);
    const tasks = path.join(dir, "E01-tasks");
    fs.mkdirSync(tasks, { recursive: true });
    fs.writeFileSync(path.join(tasks, "L0-T1-step.md"), `# Task\n\n## Definition of Done\n- [${ticked ? "x" : " "}] the step works\n`);
    return dir;
  }

  /** A ledger with one plan verdict for a child prepared by the caller. */
  function ledgerWithPlan(child, layer = 2) {
    start();
    add("L2-T1", "physics and collisions");
    const args = ["--task", "L2-T1", "--verdict", "plan", "--why", "own contract", "--evidence", "src/game/loop.js:1", "--child", child];
    if (layer !== null) args.push("--layer", String(layer));
    return decide(args);
  }

  it("records which layer waits on the child run", () => {
    childRun("platform-physics", "E00-plan.md");
    ledgerWithPlan("platform-physics", 3);
    tasksDir();
    const result = verify();
    assert.deepEqual(result.json.violations, []);
    assert.equal(result.json.receipts.length, 1);
    assert.equal(result.json.receipts[0].layer, 3);
    assert.equal(result.json.receipts[0].child, "platform-physics");
  });

  it("reports a child that closed as delivered", () => {
    childRun("platform-physics", "E00-summary.md");
    ledgerWithPlan("platform-physics");
    const result = verify();
    assert.equal(result.json.receipts[0].delivered, true);
    assert.match(result.json.receipts[0].evidence, /E00-summary\.md/);
  });

  it("reports a child whose own tasks are all ticked as delivered", () => {
    childWithTasks("platform-physics", true);
    ledgerWithPlan("platform-physics");
    const result = verify();
    assert.equal(result.json.receipts[0].delivered, true);
    assert.match(result.json.receipts[0].evidence, /1 task file/);
  });

  it("reports an undelivered child without failing the run", () => {
    childWithTasks("platform-physics", false);
    ledgerWithPlan("platform-physics");
    tasksDir();
    const result = verify();
    assert.equal(result.code, 0);
    assert.deepEqual(result.json.violations, []);
    assert.equal(result.json.receipts[0].delivered, false);
    assert.match(result.json.receipts[0].evidence, /unticked/);
  });

  it("refuses a plan verdict that waits on no layer", () => {
    childRun("platform-physics", "E00-plan.md");
    ledgerWithPlan("platform-physics", null);
    const result = verify();
    assert.equal(result.code, 1);
    assert.ok(rules(result).includes("no-layer"));
  });

  it("refuses a layer on a verdict that waits on nothing", () => {
    start();
    add("L0-T1", "one sprite that moves");
    const result = tryDecide(["--task", "L0-T1", "--verdict", "task", "--why", "small", "--layer", "1"]);
    assert.equal(result.code, 2);
    assert.match(result.json.error, /no layer/);
  });

  it("refuses a layer that is not a positive whole number", () => {
    start();
    add("L2-T1", "physics and collisions");
    childRun("platform-physics", "E00-plan.md");
    const result = tryDecide([
      "--task", "L2-T1", "--verdict", "plan", "--why", "own contract", "--evidence", "src/game/loop.js:1", "--child", "platform-physics", "--layer", "0",
    ]);
    assert.equal(result.code, 2);
    assert.match(result.json.error, /positive/);
  });
});

describe("x-decompose triage across two decompositions in one run", () => {
  /** A second pass over the same topic: a second epic, a second ledger, a second tasks rung. */
  function decomposeAgain() {
    fs.writeFileSync(path.join(run, "E04-epic.md"), "# Epic 2\n");
    const second = start();
    assert.equal(second.source, "E04-epic.md");
    assert.equal(second.ledger, "triage-05.json");
    return second;
  }

  it("gives the second decomposition its own ledger and its own tasks rung", () => {
    start();
    add("L0-T1", "first pass skeleton");
    decide(["--task", "L0-T1", "--verdict", "task", "--why", "small"]);
    taskFile("L0-T1-first-pass-skeleton.md");

    decomposeAgain();
    add("L1-T1", "second pass movement");
    decide(["--task", "L1-T1", "--verdict", "task", "--why", "small"]);
    taskFile("L1-T1-second-pass-movement.md");

    const first = verify("--source", "E01-epic.md");
    assert.equal(first.code, 0, first.stdout);
    assert.equal(first.json.source, "E01-epic.md");
    assert.match(first.json.tasksDir, /E03-tasks$/);

    const second = verify("--source", "E04-epic.md");
    assert.equal(second.code, 0, second.stdout);
    assert.match(second.json.tasksDir, /E06-tasks$/);
  });

  it("follows the newest source until it is told which decomposition it means", () => {
    start();
    add("L0-T1", "first pass skeleton");
    decomposeAgain();

    const defaulted = add("L5-T5", "second pass only");
    assert.equal(defaulted.ledger, "triage-05.json");
    assert.equal(defaulted.source, "E04-epic.md");

    const older = add("L4-T4", "first pass only", "--source", "E01-epic.md");
    assert.equal(older.ledger, "triage-02.json");
    assert.equal(older.source, "E01-epic.md");
  });

  it("refuses a source no ledger was started for", () => {
    start();
    decomposeAgain();
    const result = tryAdd("L9-T9", "unknown source", "--source", "E09-plan.md");
    assert.equal(result.code, 2);
    assert.match(result.json.error, /no ledger for source E09-plan\.md/);
    assert.match(result.json.error, /triage-02\.json \(E01-epic\.md\)/);
    assert.match(result.json.error, /triage-05\.json \(E04-epic\.md\)/);
  });

  it("keeps verifying the first decomposition after the second exists", () => {
    start();
    add("L0-T1", "first pass skeleton");
    decide(["--task", "L0-T1", "--verdict", "task", "--why", "small"]);
    taskFile("L0-T1-first-pass-skeleton.md");
    assert.equal(verify().code, 0);

    decomposeAgain();
    add("L1-T1", "second pass movement", "--source", "E04-epic.md");
    decide(["--source", "E04-epic.md", "--task", "L1-T1", "--verdict", "task", "--why", "small"]);
    taskFile("L1-T1-second-pass-movement.md");

    const first = verify("--source", "E01-epic.md");
    assert.equal(first.code, 0, first.stdout);
    assert.deepEqual(first.json.violations, []);
  });

  it("reports the source of a ledger that has no ledger for it", () => {
    start();
    const result = verify("--source", "E09-plan.md");
    assert.equal(result.code, 2);
    assert.match(result.json.error, /no ledger for source E09-plan\.md/);
  });
});

describe("x-decompose triage verify checks each task's size and complexity", () => {
  function oneTask(properties) {
    start();
    add("L0-T1", "one level, one sprite");
    decide(["--task", "L0-T1", "--verdict", "task", "--why", "one change, one check"]);
    taskFile("L0-T1-one-level.md", null, properties);
    return verify();
  }

  it("passes a task sized and rated within the scales", () => {
    const result = oneTask("size: M\ncomplexity: complicated\ncomplexity_why: two ways to store it\n");
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(result.json.violations, []);
  });

  it("passes an L that gives its reason", () => {
    assert.equal(oneTask("size: L\ncomplexity: clear\ncomplexity_why: touches two packages for one rename\n").code, 0);
  });

  it("flags a task with no size or no complexity", () => {
    assert.deepEqual(rules(oneTask("complexity: clear\n")), ["no-size"]);
  });

  it("flags a task with no property block at all", () => {
    assert.deepEqual(rules(oneTask(null)), ["no-size", "no-complexity"]);
  });

  it("flags a value outside its scale", () => {
    assert.deepEqual(rules(oneTask("size: huge\ncomplexity: hard\n")), ["bad-size", "bad-complexity"]);
  });

  it("flags an L with no reason", () => {
    assert.deepEqual(rules(oneTask("size: L\ncomplexity: clear\n")), ["unjustified-l"]);
  });

  it("flags an XL, which is a plan and not a task", () => {
    assert.deepEqual(rules(oneTask("size: XL\ncomplexity: complex\ncomplexity_why: new protocol\n")), ["oversize"]);
  });

  it("leaves a ledger started before tasks carried properties as it was", () => {
    start();
    const ledgerPath = path.join(run, fs.readdirSync(run).find((name) => /^triage-\d+\.json$/.test(name)));
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    delete ledger.taskProperties;
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
    add("L0-T1", "one level, one sprite");
    decide(["--task", "L0-T1", "--verdict", "task", "--why", "one change, one check"]);
    taskFile("L0-T1-one-level.md", null, null);
    const result = verify();
    assert.equal(result.code, 0, result.stdout);
  });
});
