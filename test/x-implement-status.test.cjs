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
    const noEpic = status(run);
    assert.equal(noEpic.status, 1);
    assert.match(noEpic.stderr, /No epic in/);

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
