"use strict";

/**
 * x-implement finishes a task and has to leave two files telling the truth: the task's own definition of done, and
 * the epic that commissioned it. The task's boxes are a judgement — only whoever ran the check may tick it — but the
 * epic's are arithmetic over the task files, and this is where that arithmetic is proved: a layer closes when its
 * tasks do, the epic-level criteria close only on the caller's word, and nothing is ever unticked.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const STATUS = path.join(ROOT, "skills", "x-implement", "scripts", "status.mjs");

const EPIC = `# Epic — demo

**Date:** 2026-01-01 09:00
**Branch:** feat/demo
**Scope:** One thing, working.

---

goal:         The thing works.
spec:         .x-skills/runs/2026-01-01-0900-R01-demo/E00-plan.md
issue:

## Layer 0 — Skeleton

**Objective:** Something runs.
**Definition of Done:**
- [ ] the skeleton runs
- [ ] it is covered by a test

## Layer 1 — Real logic

**Objective:** It does the real thing.
**Definition of Done:**
- [ ] the real path works

## Definition of Done (Epic Level)

- [ ] All layers delivered and acceptance criteria verified
- [ ] No regressions across layers
`;

const PLAN = `# Plan — demo

goal:         Every script runs where it is installed.
contract:     The one interface that must hold.
invariant:    Nothing regresses.
test:         given a run, when it finishes, then it is green

## Layers

### L0 — the checker

**Goal:** the rule exists.
**Definition of Done:**
- [ ] the rule fires on a fixture
- [ ] the test proves it on a clean root

### L1 — the receipt

**Goal:** the receipt is reported.
**Definition of Done:**
- [ ] the receipt names the child run
`;

/** A run with an epic and three task files: two in layer 0, one in layer 1. */
function fixture() {
  const run = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xskills-status-")), ".x-skills", "runs", "2026-01-01-0900-R01-demo");
  const tasks = path.join(run, "E02-tasks");
  fs.mkdirSync(tasks, { recursive: true });
  fs.writeFileSync(path.join(run, "E01-epic.md"), EPIC);
  const task = (name, layer, boxes) =>
    fs.writeFileSync(
      path.join(tasks, name),
      `# Task: ${name}\n**Layer:** ${layer} — a layer\n**Effort:** 1h\n\n## Definition of Done\n${boxes.map((box) => `- [ ] ${box}`).join("\n")}\n`,
    );
  task("L0-0.1-skeleton.md", 0, ["the skeleton runs"]);
  task("L0-0.2-cover-it.md", 0, ["a test covers it"]);
  task("L1-1.1-real.md", 1, ["the real path works"]);
  return { run, tasks, epic: path.join(run, "E01-epic.md") };
}

/** The CLI, as the skill calls it. */
function status(run, ...args) {
  return spawnSync(process.execPath, [STATUS, run, ...args], { encoding: "utf8" });
}

/** Every `- [ ]`/`- [x]` line of a file, as booleans, in order. */
function boxes(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.match(/^\s*[-*]\s+\[([ xX])\]/))
    .filter(Boolean)
    .map((match) => match[1].toLowerCase() === "x");
}

/** The task file of one fixture task, with every box ticked — the state the agent leaves it in when it is verified. */
function finish(tasks, name) {
  const file = path.join(tasks, name);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^(\s*[-*]\s+)\[ \]/gm, "$1[x]"));
  return file;
}

const epicText = (epic) => fs.readFileSync(epic, "utf8");
const statusLineOf = (epic) => (epicText(epic).match(/^\*\*Status:\*\* (.*)$/m) ?? [])[1];

describe("x-implement status", async () => {
  const mod = await import(STATUS);

  it("ticks a layer's definition of done when its tasks are all done, and no other layer's", () => {
    const { run, tasks, epic } = fixture();
    finish(tasks, "L0-0.1-skeleton.md");
    finish(tasks, "L0-0.2-cover-it.md");

    const answer = status(run);
    assert.equal(answer.status, 0, answer.stderr);
    assert.match(answer.stdout, /layer 0: 2 box\(es\) ticked/);
    assert.deepEqual(boxes(epic).slice(0, 3), [true, true, false], "layer 0 closed, layer 1 did not");
    assert.deepEqual(boxes(epic).slice(-2), [false, false], "and the epic's own criteria are untouched");
  });

  it("keeps a layer open while one of its tasks has a check unticked", () => {
    const { run, tasks, epic } = fixture();
    finish(tasks, "L0-0.1-skeleton.md");

    assert.equal(status(run).status, 0, "the run is still updated — only the layer is held back");
    assert.deepEqual(boxes(epic).slice(0, 3), [false, false, false], "a task that is not finished means a layer that is not");
    assert.equal(statusLineOf(epic), "1/3 tasks done · layers 0, 1 open");
  });

  it("says how far the run got, in the epic, without touching a box the tasks do not account for", () => {
    const { run, epic } = fixture();
    finish(path.join(path.dirname(epic), "E02-tasks"), "L0-0.1-skeleton.md");

    status(run);
    assert.ok(epicText(epic).includes("**Status:** 1/3 tasks done"), "the status line is the epic's own tally");
    const header = epicText(epic).split("\n").slice(0, 10);
    assert.ok(header.some((line) => line.startsWith("**Status:**")), "written into the header the reader starts in");
    assert.ok(header.findIndex((line) => line.startsWith("**Status:**")) < header.findIndex((line) => line.trim() === "---"), "and before the fields that describe the work");
  });

  it("ticks the epic-level criteria on the caller's word, and only when every task is done", () => {
    const { run, tasks, epic } = fixture();
    finish(tasks, "L0-0.1-skeleton.md");
    finish(tasks, "L0-0.2-cover-it.md");

    status(run, "--epic-done");
    assert.deepEqual(boxes(epic).slice(-2), [false, false], "one task is still open, so the epic cannot be done");
    assert.doesNotMatch(statusLineOf(epic), /epic-level/, "and the status line does not claim it");

    finish(tasks, "L1-1.1-real.md");
    const done = status(run, "--epic-done");
    assert.match(done.stdout, /epic level: 2 box\(es\) ticked/);
    assert.deepEqual(boxes(epic).slice(-2), [true, true]);
    assert.equal(statusLineOf(epic), "3/3 tasks done · layers 0, 1 done · epic-level definition of done verified");
  });

  it("does not touch the epic-level criteria unless the caller says they are verified", () => {
    const { run, tasks, epic } = fixture();
    for (const name of ["L0-0.1-skeleton.md", "L0-0.2-cover-it.md", "L1-1.1-real.md"]) finish(tasks, name);

    status(run);
    assert.deepEqual(boxes(epic).slice(-2), [false, false], "every task done is not the same claim as the epic verified");
    assert.equal(statusLineOf(epic), "3/3 tasks done · layers 0, 1 done");
  });

  it("writes nothing on a dry run, and nothing on a second run", () => {
    const { run, tasks, epic } = fixture();
    finish(tasks, "L0-0.1-skeleton.md");
    finish(tasks, "L0-0.2-cover-it.md");
    const before = epicText(epic);

    const dry = status(run, "--dry-run");
    assert.match(dry.stdout, /would change: layer 0/);
    assert.equal(epicText(epic), before, "a dry run reports and leaves the file alone");

    status(run);
    const once = epicText(epic);
    const again = status(run);
    assert.equal(epicText(epic), once, "the second run has nothing to write");
    assert.match(again.stdout, /already up to date/);
  });

  it("counts a task that names no layer, and says so on stderr", () => {
    const { run, tasks, epic } = fixture();
    fs.writeFileSync(path.join(tasks, "loose.md"), "# Task: loose\n\n## Definition of Done\n- [x] something\n");

    const answer = status(run);
    assert.equal(answer.status, 0);
    assert.match(answer.stderr, /loose\.md names no \*\*Layer:\*\*/, "the author of the file hears about it");
    assert.match(statusLineOf(epic), /1 with no layer/, "and the epic says it rather than hiding the task");
  });

  it("refuses a run it cannot describe, with the reason", () => {
    const { run, tasks } = fixture();
    fs.rmSync(path.join(run, "E01-epic.md"));
    const noLayers = status(run);
    assert.equal(noLayers.status, 1);
    assert.match(noLayers.stderr, /No layers in/);
    assert.match(noLayers.stderr, /E<nn>-epic\.md nor an E00-plan\.md/, "and it names both artifacts a run can hold them in");

    fs.rmSync(tasks, { recursive: true });
    assert.equal(status(run).status, 1);
    assert.match(status(run).stderr, /No task files in/);

    const usage = spawnSync(process.execPath, [STATUS], { encoding: "utf8" });
    assert.equal(usage.status, 2, "no run folder is a usage error, not a file to guess");
  });

  it("reads a task's layer from its own line, and a task is done only when every check is", () => {
    const task = mod.parseTask("L1-1.1-real.md", fs.readFileSync(path.join(fixture().tasks, "L1-1.1-real.md"), "utf8"));
    assert.equal(task.layer, 1);
    assert.deepEqual([task.done, task.total, task.complete], [0, 1, false]);

    const report = mod.summarise([
      { name: "a.md", layer: 0, done: 1, total: 1, complete: true },
      { name: "b.md", layer: 0, done: 1, total: 2, complete: false },
      { name: "c.md", layer: 2, done: 0, total: 0, complete: false },
    ]);
    assert.deepEqual(
      report.layers.map((layer) => [layer.number, layer.done, layer.tasks, layer.complete]),
      [
        [0, 1, 2, false],
        [2, 0, 1, false],
      ],
      "a task with no checklist is not a task that is done",
    );
    assert.equal(report.total, 3);
    assert.equal(report.complete, false);
  });
});

/** A run whose layers live in a plan: the shape `x-plan` produces, with no epic anywhere. */
function planFixture() {
  const run = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xskills-status-plan-")), ".x-skills", "runs", "2026-01-02-0900-R01-demo");
  const tasks = path.join(run, "E01-tasks");
  fs.mkdirSync(tasks, { recursive: true });
  fs.writeFileSync(path.join(run, "E00-plan.md"), PLAN);
  const task = (name, layer) =>
    fs.writeFileSync(
      path.join(tasks, name),
      `# Task: ${name}\n**Layer:** ${layer} — a layer\n**Effort:** 1h\n\n## Definition of Done\n- [ ] the step works\n`,
    );
  task("L0-T1-rule.md", 0);
  task("L1-T1-receipt.md", 1);
  return { run, tasks, plan: path.join(run, "E00-plan.md") };
}

describe("x-implement status: a plan-based run", () => {
  it("ticks a layer in the plan when the run has no epic", () => {
    const { run, tasks, plan } = planFixture();
    finish(tasks, "L0-T1-rule.md");

    const answer = status(run);
    assert.equal(answer.status, 0, answer.stderr);
    assert.match(answer.stdout, /layer 0: 2 box\(es\) ticked/);
    assert.deepEqual(boxes(plan).slice(0, 3), [true, true, false], "the plan's layer 0 closed, layer 1 did not");
  });

  it("says how far the run got, in the plan", () => {
    const { run, plan } = planFixture();
    assert.equal(status(run).status, 0);
    assert.match(fs.readFileSync(plan, "utf8"), /^\*\*Status:\*\* 0\/2 tasks done/m);
  });

  it("leaves the plan alone when the run also holds an epic", () => {
    const { run, tasks, plan } = planFixture();
    fs.writeFileSync(path.join(run, "E02-epic.md"), EPIC.replace(/E02-tasks/g, "E01-tasks"));

    finish(tasks, "L0-T1-rule.md");
    const answer = status(run);
    assert.equal(answer.status, 0, answer.stderr);
    assert.deepEqual(boxes(plan).slice(0, 3), [false, false, false], "the epic is the layers artifact while it exists");
    assert.deepEqual(boxes(path.join(run, "E02-epic.md")).slice(0, 3), [true, true, false]);
  });

  it("reads the layer heading x-epic documents, not only the one it emits", () => {
    const { run, tasks } = planFixture();
    const documented = PLAN.replace(/^### L(\d+) —/gm, "### Layer $1 —");
    fs.rmSync(path.join(run, "E00-plan.md"));
    fs.writeFileSync(path.join(run, "E01-epic.md"), documented);

    finish(tasks, "L0-T1-rule.md");
    const answer = status(run);
    assert.equal(answer.status, 0, answer.stderr);
    assert.deepEqual(boxes(path.join(run, "E01-epic.md")).slice(0, 3), [true, true, false]);
  });

  it("refuses a run holding neither artifact, naming both", () => {
    const { run } = planFixture();
    fs.rmSync(path.join(run, "E00-plan.md"));

    const answer = status(run);
    assert.equal(answer.status, 1);
    assert.match(answer.stderr, /E<nn>-epic\.md nor an E00-plan\.md/);
  });
});

describe("x-implement status: a run-level status line", () => {
  it("writes the run's tally into the header, not into a layer's own status note", () => {
    const { run, tasks, plan } = planFixture();
    const withNote = `${PLAN}`.replace("### L0 — the checker", "### L0 — the checker\n**Status:** this layer's own note");
    fs.writeFileSync(plan, withNote);
    finish(tasks, "L0-T1-rule.md");

    const answer = status(run);
    assert.equal(answer.status, 0, answer.stderr);
    const text = fs.readFileSync(plan, "utf8");
    assert.match(text, /the checker\n\*\*Status:\*\* this layer's own note/, "a layer's note is left as the author wrote it");
    assert.match(text, /^\*\*Status:\*\* 1\/2 tasks done/m, "and the run's tally lands in the header");
    assert.ok(
      text.indexOf("**Status:** 1/2 tasks done") < text.indexOf("## Layers"),
      "the run's line sits above the run's own sections",
    );
  });
});

/** A plan-based run whose one task carries a property block, as x-decompose writes it now. */
function propertyFixture(boxes = ["[ ] the rule fires"]) {
  const run = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xskills-status-props-")), ".x-skills", "runs", "2026-01-01-0900-R01-demo");
  fs.mkdirSync(path.join(run, "E02-tasks"), { recursive: true });
  fs.writeFileSync(path.join(run, "E00-plan.md"), PLAN);
  const task = path.join(run, "E02-tasks", "L0-T1-rule.md");
  const body = `# Task: rule\n**Layer:** 0 — the checker\n\n## Definition of Done\n${boxes.map((box) => `- ${box}`).join("\n")}\n`;
  fs.writeFileSync(task, `---\ntype: task\nsize: S\ncomplexity: clear\n---\n${body}`);
  return { run, task, body };
}

const property = (file, key) => (fs.readFileSync(file, "utf8").match(new RegExp(`^${key}: (.*)$`, "m")) || [])[1];
const setBoxes = (file, mark) => fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/- \[[ x]\] the rule fires/, `- [${mark}] the rule fires`));

describe("x-implement status: a task's done, finished and reopened", () => {
  it("mirrors an open task as done: false, and leaves the body byte for byte", () => {
    const { run, task, body } = propertyFixture();
    assert.equal(status(run).status, 0);
    assert.equal(property(task, "done"), "false");
    assert.ok(fs.readFileSync(task, "utf8").endsWith(body), "only the property block changes");
  });

  it("marks a fully ticked task done and stamps when it finished", () => {
    const { run, task } = propertyFixture(["[x] the rule fires"]);
    assert.equal(status(run).status, 0);
    assert.equal(property(task, "done"), "true");
    assert.match(property(task, "finished"), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("counts a reopen when a finished task has a box unticked, and drops its finish", () => {
    const { run, task } = propertyFixture(["[x] the rule fires"]);
    status(run);
    setBoxes(task, " ");
    status(run);
    assert.equal(property(task, "done"), "false");
    assert.equal(property(task, "reopened"), "1");
    assert.equal(property(task, "finished"), undefined);
  });

  it("overwrites a done set by hand, without counting it as a reopen", () => {
    const { run, task } = propertyFixture();
    fs.writeFileSync(task, fs.readFileSync(task, "utf8").replace("complexity: clear\n", "complexity: clear\ndone: true\n"));
    status(run);
    assert.equal(property(task, "done"), "false");
    assert.equal(property(task, "reopened"), undefined);
  });

  it("stamps started once, and keeps the first stamp", () => {
    const { run, task } = propertyFixture();
    assert.equal(status(run, "--start", "L0-T1-rule.md").status, 0);
    const first = property(task, "started");
    assert.match(first, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    fs.writeFileSync(task, fs.readFileSync(task, "utf8").replace(`started: ${first}`, "started: 2000-01-01T00:00:00.000Z"));
    status(run, "--start", "L0-T1-rule.md");
    assert.equal(property(task, "started"), "2000-01-01T00:00:00.000Z");
  });

  it("refuses to start a task the run does not hold", () => {
    const { run } = propertyFixture();
    const result = status(run, "--start", "L9-T9-missing.md");
    assert.equal(result.status, 2);
    assert.match(result.stderr, /L9-T9-missing\.md/);
  });

  it("writes nothing to a task on a dry run, and says what it would", () => {
    const { run, task } = propertyFixture(["[x] the rule fires"]);
    const before = fs.readFileSync(task, "utf8");
    const result = status(run, "--dry-run");
    assert.equal(fs.readFileSync(task, "utf8"), before);
    assert.match(result.stdout, /would change: L0-T1-rule\.md: done true/);
  });
});

describe("x-implement status: a plan that starts with its property block", () => {
  it("writes the status line below the block and the heading, and keeps the block on the first line", () => {
    const { run } = propertyFixture();
    const plan = path.join(run, "E00-plan.md");
    fs.writeFileSync(plan, `---\ntype: plan\ntitle: "Plan · demo"\n---\n${PLAN}`);
    assert.equal(status(run).status, 0);
    const once = fs.readFileSync(plan, "utf8");
    assert.ok(once.startsWith('---\ntype: plan\ntitle: "Plan · demo"\n---\n# Plan — demo\n'), once.slice(0, 200));
    assert.equal((once.match(/^\*\*Status:\*\*/gm) || []).length, 1);

    status(run);
    assert.equal(fs.readFileSync(plan, "utf8"), once, "a second run finds the same line and changes nothing");
  });
});
