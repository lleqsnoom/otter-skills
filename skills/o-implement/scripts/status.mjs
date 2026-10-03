#!/usr/bin/env node

/**
 * Reflect finished tasks in the epic that commissioned them.
 *
 * A task's own `## Definition of Done` is ticked by whoever verified each check — that is a judgement about the
 * code, and no script can make it. What a script *can* do is the arithmetic nobody should be doing by hand: a layer
 * is done when every task decomposed from it is done, and the epic is done when every layer is. Without it the run
 * reads backwards — the task files fill with `[x]` while the epic they came from still shows every box open, and a
 * reader has to check eleven files to learn where the work stands.
 *
 * So this reads the tasks and writes the epic: the layer's `**Definition of Done:**` when its tasks are all done, a
 * `**Status:**` line that says how far the whole run got, and — only when the caller says so with `--epic-done` — the
 * epic-level `## Definition of Done`, which asks for things a task list cannot prove (no regressions across layers,
 * docs updated). The script never asserts what it cannot check, and it never unticks: a box that is open because a
 * check is deferred stays open, and the status line is what says the run is nearly there anyway.
 *
 * It also writes the one thing a task's own property block cannot know by itself: whether its boxes are all ticked.
 * `done` mirrors them both ways, `finished` and `reopened` follow from its turns, `--ready <task file>` stamps when
 * the agent's own work is done, and `--start <task file>` stamps
 * `started` once — so Obsidian, which cannot read checkboxes, can still tell open work from finished work. Nothing
 * outside the block is ever rewritten, and a task with no block is left exactly as it is.
 *
 * Usage:
 *   node status.mjs <run folder> [--start <task file>] [--ready <task file>] [--epic-done] [--dry-run]
 *
 * Exit 0 when the epic is up to date (or was updated), 1 when the run has no epic or no tasks to read, 2 on a usage
 * error. ESM rather than the CommonJS its sibling scripts use, so it runs from inside a checkout of the repo that
 * ships it (where `package.json` says `"type": "module"`) as well as from a symlinked global install.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BOX = /^(\s*)([-*])\s+\[([ xX])\]\s*(.*)$/;
const LAYER_FIELD = /^\*\*Layer:\*\*\s*(\d+)/;
const LAYER_HEADING = /^#{2,3}\s+(?:Layer\s+(\d+)|L(\d+))\b/i;
const EPIC_DOD_HEADING = /^##\s+Definition of Done\b/i;
const DOD_FIELD = /^\*\*Definition of Done:\*\*/;
const STATUS_LINE = /^\*\*Status:\*\*\s*(.*)$/;

/** The one `E<nn>-<kind>` entry of a run, whether the kind names a file or a directory. */
function artifactOf(runDir, kind, { directory = false } = {}) {
  const names = fs.existsSync(runDir) ? fs.readdirSync(runDir) : [];
  const pattern = new RegExp(`^E\\d+-${kind}${directory ? "" : "\\.md"}$`);
  return names.filter((name) => pattern.test(name)).sort()[0] ?? null;
}

/** Every box under a heading's span, with the line each one sits on so a tick can be written back. */
function boxesIn(lines, from, to) {
  const boxes = [];
  for (let index = from; index < to; index += 1) {
    const match = lines[index].match(BOX);
    if (match) boxes.push({ index, checked: match[3].toLowerCase() === "x" });
  }
  return boxes;
}

/**
 * A section's bullets end where its prose resumes: a blank line, another field, or the next heading. Reading to the
 * next heading would swallow the following section's boxes, which is how a tick lands in the wrong list.
 */
function sectionEnd(lines, from) {
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index];
    if (BOX.test(line)) continue;
    if (!line.trim()) continue;
    return index;
  }
  return lines.length;
}

/** The layer a task names, read from its own line: anchoring against the whole file only ever sees line one. */
function layerOf(lines) {
  for (const line of lines) {
    const match = line.match(LAYER_FIELD);
    if (match) return Number(match[1]);
  }
  return null;
}

/** One task file, as the epic needs it: which layer it belongs to, and whether every check in it is ticked. */
function parseTask(name, text) {
  const lines = text.split("\n");
  const dod = lines.findIndex((line) => /^##\s+Definition of Done\b/i.test(line));
  const boxes = dod === -1 ? [] : boxesIn(lines, dod, sectionEnd(lines, dod + 1));
  return {
    name,
    // The body's **Layer:** first; o-decompose's file name (`L<N>-T<M>-<slug>.md`) names it too.
    layer: layerOf(lines) ?? (/^L(\d+)-T\d+/.test(name) ? Number(name.match(/^L(\d+)-/)[1]) : null),
    done: boxes.filter((box) => box.checked).length,
    total: boxes.length,
    complete: boxes.length > 0 && boxes.every((box) => box.checked),
  };
}

/** Every task file of a run, by name. */
function readTasks(tasksDir) {
  if (!fs.existsSync(tasksDir)) return [];
  return fs
    .readdirSync(tasksDir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => parseTask(name, fs.readFileSync(path.join(tasksDir, name), "utf8")));
}

/**
 * What the epic should say now: each layer with its task count, and the whole run's tally. `layers` are keyed by the
 * number a task names (`**Layer:** 2`), so an epic whose headings are worded differently still lines up.
 */
function summarise(tasks) {
  const layers = new Map();
  for (const task of tasks) {
    const layer = layers.get(task.layer) ?? { number: task.layer, tasks: 0, done: 0, complete: true };
    layer.tasks += 1;
    if (task.complete) layer.done += 1;
    else layer.complete = false;
    layers.set(task.layer, layer);
  }
  const ordered = [...layers.values()].sort((a, b) => a.number - b.number);
  return {
    layers: ordered,
    done: tasks.filter((task) => task.complete).length,
    total: tasks.length,
    complete: tasks.length > 0 && tasks.every((task) => task.complete),
  };
}

/** The numbered layers of a report, split by whether they closed: the one question the status line asks of them. */
function partitionLayers(report) {
  const numbered = report.layers.filter((layer) => layer.number !== null);
  return {
    done: numbered.filter((layer) => layer.complete).map((layer) => layer.number),
    open: numbered.filter((layer) => !layer.complete).map((layer) => layer.number),
    unnumbered: report.layers.filter((layer) => layer.number === null).reduce((sum, layer) => sum + layer.tasks, 0),
  };
}

/** The `**Status:**` line for a report: short, factual, and the only place the epic speaks about task counts. */
function statusLine(report, { epicDone }) {
  return `**Status:** ${statusClauses(report, epicDone).join(" · ")}`;
}

/**
 * What the line is made of. The clauses are data because each one is optional and independent: a list of
 * `[what it says, whether it applies]` makes the whole sentence readable at a glance, where five `if`s around five
 * `push`es is a paragraph of branching that only a reader can hold.
 */
function statusClauses(report, epicDone) {
  const { done, open, unnumbered } = partitionLayers(report);
  return [
    [`${report.done}/${report.total} tasks done`, true],
    [`layers ${done.join(", ")} done`, done.length > 0],
    [`layers ${open.join(", ")} open`, open.length > 0],
    [`${unnumbered} with no layer`, unnumbered > 0],
    ["epic-level definition of done verified", epicDone && report.complete],
  ]
    .filter(([, applies]) => applies)
    .map(([clause]) => clause);
}

/** The header block ends at the `---` every skill's skeleton writes, or at the first section heading. */
function headerEnd(lines) {
  // A leading property block also opens with `---`; the header is what comes after it.
  const start = blockEnd(lines) + 1;
  const separator = lines.findIndex((line, index) => index >= start && line.trim() === "---");
  if (separator !== -1) return separator;
  const heading = lines.findIndex((line, index) => index >= start && /^##\s/.test(line));
  return heading === -1 ? lines.length : heading;
}

/** Ticks the boxes in a range. A box already ticked is left alone, and nothing is ever unticked. */
function tick(lines, from, to) {
  let changed = 0;
  for (let index = from; index < to; index += 1) {
    if (!BOX.test(lines[index])) continue;
    const ticked = lines[index].replace(/\[[ ]\]/, "[x]");
    if (ticked !== lines[index]) changed += 1;
    lines[index] = ticked;
  }
  return changed;
}

/**
 * The layer headings of a run's layers artifact, with the span each one owns.
 *
 * Both dialects count: `## Layer 0 — …`, which a legacy epic wrote, and the plan's `### L0 — …`. The number is
 * whichever group the heading matched.
 *
 * A layer's boxes are read from its `**Definition of Done:**` to the end of its bullet list, which is either the next
 * layer's heading or the end of the file. A layer whose field is missing is not a span, so the misses are dropped
 * rather than carried as nulls.
 */
function layerSpans(lines) {
  const headings = lines.flatMap((line, index) => {
    const match = line.match(LAYER_HEADING);
    return match ? [{ number: Number(match[1] ?? match[2]), index }] : [];
  });
  return headings.flatMap((heading, at) => {
    const next = headings[at + 1] ?? null;
    const limit = next?.index ?? lines.length;
    const field = lines.findIndex((line, index) => index > heading.index && index < limit && DOD_FIELD.test(line));
    if (field === -1) return [];
    return [{ number: heading.number, from: field + 1, to: Math.min(limit, sectionEnd(lines, field + 1)) }];
  });
}

/** The layers whose tasks are all done: each one's definition of done closes. */
function tickLayerDefinitions(lines, report) {
  const changes = [];
  for (const span of layerSpans(lines)) {
    const layer = report.layers.find((candidate) => candidate.number === span.number);
    if (!layer?.complete) continue;
    const ticked = tick(lines, span.from, span.to);
    if (ticked) changes.push(`layer ${span.number}: ${ticked} box(es) ticked`);
  }
  return changes;
}

/** The epic's own criteria, ticked only on the caller's word — they ask for what a task list cannot prove. */
function tickEpicDefinition(lines, report, { epicDone }) {
  const heading = lines.findIndex((line) => EPIC_DOD_HEADING.test(line));
  if (!epicDone || !report.complete || heading === -1) return [];
  const ticked = tick(lines, heading + 1, sectionEnd(lines, heading + 1));
  return ticked ? [`epic level: ${ticked} box(es) ticked`] : [];
}

/**
 * The status line, replaced where it is or added to the end of the header block.
 *
 * Only the header's line is the run's: a layer block may carry a `**Status:**` note of its own, and reading the
 * first one in the file would overwrite that note with the whole run's tally (it did, until this was scoped).
 */
function rewriteStatusLine(lines, report, { epicDone }) {
  const status = statusLine(report, { epicDone });
  const limit = headerEnd(lines);
  const existing = lines.findIndex((line, index) => index < limit && STATUS_LINE.test(line));
  if (existing !== -1) {
    if (lines[existing] === status) return [];
    lines[existing] = status;
    return ["status line updated"];
  }
  lines.splice(limit, 0, status, "");
  return ["status line added"];
}

/**
 * The epic as it should read, and what that took. Each phase edits the lines it owns and says what it did; the
 * ledger of changes is collected here and nowhere else.
 *
 * @returns {{ text: string, changes: string[] }}
 */
function applyStatus(epic, report, options = {}) {
  const lines = epic.split("\n");
  const changes = [
    ...tickLayerDefinitions(lines, report),
    ...tickEpicDefinition(lines, report, options),
    ...rewriteStatusLine(lines, report, options),
  ];
  return { text: lines.join("\n"), changes };
}

/** Where a task's leading `---` block closes, or -1 when the task has none (a task written before tasks carried one). */
function blockEnd(lines) {
  if (lines[0]?.trim() !== "---") return -1;
  return lines.findIndex((line, index) => index > 0 && line.trim() === "---");
}

/** One key's value in a block, or `undefined`. */
function readKey(lines, end, key) {
  const line = lines.slice(1, end).find((candidate) => candidate.startsWith(`${key}:`));
  return line === undefined ? undefined : line.slice(key.length + 1).trim();
}

/** The block with `key` set to `value`, or removed when `value` is `undefined`; the body is never touched. */
function withKey(lines, key, value) {
  const end = blockEnd(lines);
  const at = lines.slice(0, end).findIndex((line, index) => index > 0 && line.startsWith(`${key}:`));
  if (value === undefined) return at === -1 ? lines : lines.filter((_, index) => index !== at);
  const line = `${key}: ${value}`;
  if (at !== -1) return lines.map((candidate, index) => (index === at ? line : candidate));
  return [...lines.slice(0, end), line, ...lines.slice(end)];
}

/**
 * A task's `done`, `finished` and `reopened`, mirrored from its boxes. `done` follows the boxes both ways; `finished`
 * is stamped when it turns true and dropped when it turns false; a turn back to false counts as a reopen only when
 * this script had finished the task — a `done` someone typed by hand is corrected, not counted.
 */
function mirrorTask(text, complete, now) {
  const lines = text.split("\n");
  const end = blockEnd(lines);
  if (end === -1) return { text, change: null };
  const was = readKey(lines, end, "done");
  const finished = readKey(lines, end, "finished");
  const done = String(complete);
  if (was === done && (complete ? finished !== undefined : finished === undefined)) return { text, change: null };
  const reopened = !complete && finished !== undefined ? Number(readKey(lines, end, "reopened") ?? 0) + 1 : undefined;
  const steps = [
    ["done", done],
    ["finished", complete ? (finished ?? now) : undefined],
    ...(reopened === undefined ? [] : [["reopened", String(reopened)]]),
  ];
  const next = steps.reduce((current, [key, value]) => withKey(current, key, value), lines);
  return { text: next.join("\n"), change: `done ${done}${reopened ? ` (reopened ${reopened})` : ""}` };
}

/**
 * One of a task's moments, stamped the first time it happens and never again: `started` when the work begins, `ready`
 * when the agent's own work is done — tests green, review clean, committed — before any check a person still owes.
 */
function stampOnce(text, key, now) {
  const lines = text.split("\n");
  const end = blockEnd(lines);
  if (end === -1 || readKey(lines, end, key) !== undefined) return { text, change: null };
  return { text: withKey(lines, key, now).join("\n"), change: `${key} ${now}` };
}

/**
 * The run a set of arguments names: the folder must hold its layers — an epic, or the plan a run was decomposed
 * from — and a task folder. The epic wins while a run holds one, because that is the expanded form of the same
 * roadmap; a run the pipeline decomposed straight from its plan has only the plan.
 */
function locate(runDir) {
  const tasksDir = path.join(runDir, artifactOf(runDir, "tasks", { directory: true }) ?? "E00-tasks");
  const layersName = artifactOf(runDir, "epic") ?? artifactOf(runDir, "plan");
  return { tasksDir, layersPath: layersName ? path.join(runDir, layersName) : null };
}

/** The flags that take a task file name, and the moment each one stamps on that task. */
const STAMP_FLAGS = { "--start": "started", "--ready": "ready" };

/**
 * The run folder, the two switches, and the stamp flags — `--start <task file>` and `--ready <task file>`, the only
 * flags that take a value, because the task they name is the whole of what they ask for.
 */
function parseArgs(argv) {
  const switches = new Set(["--epic-done", "--dry-run"]);
  const valued = Object.keys(STAMP_FLAGS).map((flag) => [flag, argv.indexOf(flag)]).filter(([, at]) => at !== -1);
  const stamps = valued.map(([flag, at]) => ({ key: STAMP_FLAGS[flag], flag, task: argv[at + 1] ?? "" }));
  const taken = new Set(valued.flatMap(([, at]) => [at, at + 1]));
  const rest = argv.filter((_, index) => !taken.has(index));
  const unknown = rest.find((arg) => arg.startsWith("--") && !switches.has(arg));
  if (unknown) {
    process.stderr.write(`Unknown argument: ${unknown}\n`);
    process.exit(2);
  }
  return {
    run: rest.find((arg) => !arg.startsWith("--")) ?? null,
    epicDone: rest.includes("--epic-done"),
    dryRun: rest.includes("--dry-run"),
    stamps,
  };
}

/** A run this script cannot describe, said once and exited for: three of them are the same four lines. */
function refuse(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/** The one-line tally the caller reads, which is the same sentence the status line is built from. */
function describeRun(report) {
  const layers = report.layers.filter((layer) => layer.complete).length;
  return `${report.done}/${report.total} tasks done · ${layers}/${report.layers.length} layers`;
}

/** Tasks that name no layer, said out loud: no layer's definition of done can close for them, and the epic says so. */
function warnUnlayered(tasks) {
  for (const task of tasks.filter((candidate) => candidate.layer === null)) {
    process.stderr.write(`Warning: ${task.name} names no **Layer:**, so no layer's definition of done can close for it.\n`);
  }
}

/** What the run came to, and what was written to get there. The only place this script prints. */
function announce({ layersPath, report, changes, dryRun }) {
  for (const change of changes) process.stdout.write(`${dryRun ? "would change" : "changed"}: ${change}\n`);
  const tally = describeRun(report);
  process.stdout.write(`${layersPath} — ${tally}${changes.length ? "" : " (already up to date)"}\n`);
}

/**
 * The two files a run needs to be described: its tasks and its epic. A run missing either is refused here rather than
 * a step later, and the refusal says which one — a status written into the wrong place is worse than none.
 */
function runFiles(run) {
  const { tasksDir, layersPath } = locate(run);
  const tasks = readTasks(tasksDir);
  if (!tasks.length) refuse(`No task files in ${tasksDir} — nothing to reflect in a layers artifact.`, 1);
  if (!layersPath || !fs.existsSync(layersPath)) {
    refuse(
      `No layers in ${run} — neither an E<nn>-epic.md nor an E00-plan.md holds the roadmap the tasks belong to.`,
      1,
    );
  }
  return { tasks, layersPath };
}

/** Each task's own properties brought in line with its boxes; returns the changes, written unless it is a dry run. */
function mirrorTasks(tasksDir, tasks, { now, stamps, dryRun }) {
  const edits = tasks.map((task) => {
    const file = path.join(tasksDir, task.name);
    const text = fs.readFileSync(file, "utf8");
    const stamped = stamps
      .filter((stamp) => stamp.task === task.name)
      .reduce((current, stamp) => {
        const next = stampOnce(current.text, stamp.key, now);
        return { text: next.text, changes: [...current.changes, next.change].filter(Boolean) };
      }, { text, changes: [] });
    const mirrored = mirrorTask(stamped.text, task.complete, now);
    return { file, name: task.name, text: mirrored.text, changes: [...stamped.changes, mirrored.change].filter(Boolean) };
  });
  if (!dryRun) for (const edit of edits.filter((candidate) => candidate.changes.length)) fs.writeFileSync(edit.file, edit.text, "utf8");
  return edits.flatMap((edit) => edit.changes.map((change) => `${edit.name}: ${change}`));
}

/** Each stamp flag names a task file of this run, or the call is refused before anything is written. */
function refuseUnknownStamp(tasks, stamps) {
  const unknown = stamps.find((stamp) => !tasks.some((task) => task.name === stamp.task));
  if (!unknown) return;
  refuse(`No task ${unknown.task || "(none named)"} in this run — ${unknown.flag} takes a task file name from its tasks folder.`, 2);
}

const USAGE = `Usage: node status.mjs <run folder> [--start <task file>] [--ready <task file>] [--epic-done] [--dry-run]
Ticks each layer whose tasks are done, refreshes the plan's Status line, and stamps the named task.`;

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  if (!args.run) refuse(USAGE, 2);

  const { tasks, layersPath } = runFiles(args.run);
  refuseUnknownStamp(tasks, args.stamps);
  warnUnlayered(tasks);
  const report = summarise(tasks);
  const { text, changes } = applyStatus(fs.readFileSync(layersPath, "utf8"), report, { epicDone: args.epicDone });
  if (!args.dryRun && changes.length) fs.writeFileSync(layersPath, text, "utf8");
  const taskChanges = mirrorTasks(locate(args.run).tasksDir, tasks, { now: new Date().toISOString(), stamps: args.stamps, dryRun: args.dryRun });
  announce({ layersPath, report, changes: [...changes, ...taskChanges], dryRun: args.dryRun });
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main();

export { applyStatus, artifactOf, boxesIn, locate, mirrorTask, parseTask, readTasks, stampOnce, statusLine, summarise };
