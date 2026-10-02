#!/usr/bin/env node

/**
 * Task triage ledger for o-decompose. Every candidate task drafted from a plan or epic gets one
 * verdict before any task file is written: the work stays a task HERE, needs its own plan run,
 * needs an analysis first, or drops.
 *
 * One ledger belongs to one decomposition. It carries the artifact it was drafted from, and it
 * verifies against the tasks rung above it, so a run that numbers two epics keeps two ledgers.
 *
 * Usage:
 *   node triage.mjs start  --dir <run folder> [--source <plan|epic artifact>] [--slug <slug>]
 *   node triage.mjs add    --dir <run folder> [--source <artifact>] --task L0-T1 --title "<candidate>"
 *   node triage.mjs decide --dir <run folder> [--source <artifact>] --task L0-T1 --verdict <task|plan|analyze|drop> --why "<reason>" [--evidence "<file:line|url>"] [--child <slug>]
 *   node triage.mjs list   --dir <run folder> [--source <artifact>]
 *   node triage.mjs verify --dir <run folder> [--source <artifact>] [--tasks-dir <dir>] [--runs-root <dir>]
 *
 * Exit codes: 0 clean, 1 violations, 2 usage error.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SKILL = "o-decompose";
export const LEDGER_PATTERN = /^triage(-(\d{2}))?\.json$/;
export const SOURCE_PATTERN = /^E(\d{2})-(plan|epic)\.md$/;
export const VERDICT_KINDS = ["task", "plan", "analyze", "drop"];
export const OWN_PLAN_VERDICTS = ["plan", "analyze"];
export const TASK_ID = /^L\d+-T\d+$/;
export const TASK_FILE = /^L(\d+)-T(\d+)-.+\.md$/;
export const CHILD_ARTIFACT = /^E\d{2}-.+\.md$/;
export const RUNS_ROOT = ".x-skills/runs";
export const MAX_E = 99;

// Mirrors the shared helper the sibling skills ship, kept local so this script
// has no import across skill boundaries.
function pad(value) {
  return String(value).padStart(2, "0");
}

export function rungOf(name) {
  const match = String(name).match(/^E(\d{2})-/);
  return match ? Number(match[1]) : null;
}

function entries(runDir, pattern) {
  if (!fs.existsSync(runDir)) return [];
  return fs.readdirSync(runDir).filter((name) => pattern.test(name)).sort();
}

function nextE(runDir) {
  const used = entries(runDir, /^E\d{2}-/)
    .map((name) => rungOf(name))
    .filter((value) => value !== null);
  const next = used.length ? Math.max(...used) + 1 : 0;
  if (next > MAX_E) throw new Error(`artifact counter would exceed E${MAX_E}`);
  return `E${pad(next)}`;
}

/** Repeatable: a run that numbers two decompositions gets a ledger per decomposition. */
function reportPath(runDir) {
  return path.join(runDir, `${nextE(runDir)}-triage.md`);
}

/** The slug is the run folder's own name once the stamp and R<nn> are stripped. */
export function slugFromRunDir(runDir) {
  const name = path.basename(path.resolve(runDir));
  const match = name.match(/^(?:\d{4}-\d{2}-\d{2}-\d{4})-R\d{2}-(.+)$/);
  return match ? match[1] : name;
}

export function sanitizeSlug(slug) {
  return String(slug)
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function displayPath(target) {
  return path.relative(process.cwd(), target) || target;
}

/**
 * The runs root is the run folder's own parent when that parent is `runs`, so a
 * run stays findable no matter which directory the command was started from.
 */
export function resolveRunsRoot(runDir, override = null) {
  if (override) return path.resolve(override);
  const parent = path.dirname(path.resolve(runDir));
  return path.basename(parent) === "runs" ? parent : path.resolve(RUNS_ROOT);
}

/**
 * The artifact a decomposition was drafted from: the plan or epic the caller names,
 * or the newest one in the run. A run with no plan and no epic cannot be triaged.
 */
export function resolveSource(runDir, explicit = null) {
  if (explicit) {
    const named = fs.existsSync(path.resolve(explicit)) ? path.resolve(explicit) : path.join(runDir, explicit);
    if (!fs.existsSync(named)) throw new Error(`no source artifact at ${explicit}`);
    return path.basename(named);
  }
  const found = entries(runDir, SOURCE_PATTERN);
  if (!found.length) {
    throw new Error(`no E<nn>-plan.md or E<nn>-epic.md in ${runDir}; triage starts from the layers, so pass --source <artifact>`);
  }
  return found[found.length - 1];
}

/** The run folders of a slug, oldest first, and the slug they were looked up under. */
function childRunDirs(runsRoot, slug) {
  const wanted = sanitizeSlug(slug || "");
  if (!wanted || !fs.existsSync(runsRoot)) return { wanted, dirs: [] };
  return { wanted, dirs: fs.readdirSync(runsRoot).filter((name) => name.endsWith(`-${wanted}`)).sort() };
}

/** The first non-empty `E<nn>-*.md` a directory holds, or null: a plan nobody opened is an empty file. */
function startedArtifact(dir) {
  return (
    entries(dir, CHILD_ARTIFACT).find((file) => {
      const full = path.join(dir, file);
      return fs.statSync(full).isFile() && fs.readFileSync(full, "utf8").trim() !== "";
    }) ?? null
  );
}

/** The child's own `E<nn>-tasks/` folder, when it holds at least one task file: work begun before any summary. */
function childTasksDir(dir) {
  const name = entries(dir, /^E\d{2}-tasks$/).find((candidate) => fs.statSync(path.join(dir, candidate)).isDirectory());
  if (!name) return null;
  const tasksDir = path.join(dir, name);
  return taskFiles(tasksDir).length ? tasksDir : null;
}

/**
 * A child run counts as started once it holds an artifact or a tasks folder with a task in it: a folder on
 * its own is a plan that was never opened, and the parent's ledger would record a hand-off to nothing.
 * Returns the reason it is not started, or null when it is.
 */
export function childRunState(runsRoot, slug) {
  const { wanted, dirs } = childRunDirs(runsRoot, slug);
  if (!wanted) return { dir: null, artifact: null, problem: "no child slug" };
  if (!dirs.length) {
    return {
      dir: null,
      artifact: null,
      problem: `no run folder ending in -${wanted} under ${displayPath(runsRoot)}; start it with \`node <o-plan skill>/scripts/scenario.mjs start --slug ${wanted}\``,
    };
  }
  for (const name of [...dirs].reverse()) {
    const dir = path.join(runsRoot, name);
    const artifact = startedArtifact(dir);
    if (artifact || childTasksDir(dir)) return { dir, artifact, problem: null };
  }
  return {
    dir: path.join(runsRoot, dirs[dirs.length - 1]),
    artifact: null,
    problem: `run folder ${dirs[dirs.length - 1]} holds no E<nn>-*.md artifact yet; the child has not been started`,
  };
}

/**
 * Whether the child run in this folder delivered: it closed with a summary, or every task file it wrote is
 * ticked. Reported rather than blocking - a parent task names the state it needs, and the implementer decides
 * whether to wait.
 */
export function childDelivery(dir) {
  if (!dir || !fs.existsSync(dir)) return { delivered: false, evidence: "no child run folder" };
  const summary = entries(dir, CHILD_ARTIFACT).find((name) => /summary/i.test(name) && fs.readFileSync(path.join(dir, name), "utf8").trim() !== "");
  if (summary) return { delivered: true, evidence: `${summary} is written` };
  const tasksDir = childTasksDir(dir);
  if (!tasksDir) return { delivered: false, evidence: "no summary and no task files" };
  const files = taskFiles(tasksDir);
  const unticked = files.filter((name) => /^\s*-\s*\[ \]/m.test(fs.readFileSync(path.join(tasksDir, name), "utf8")));
  return unticked.length
    ? { delivered: false, evidence: `${unticked.length} of ${files.length} task files have an unticked check` }
    : { delivered: true, evidence: `all ${files.length} task file(s) are ticked` };
}

/** One receipt per child run this ledger handed work to, in the order the verdicts were recorded. */
export function receiptsFor(ledger, findChild = () => null) {
  return ledger.verdicts
    .filter((entry) => OWN_PLAN_VERDICTS.includes(entry.verdict))
    .map((entry) => {
      const state = findChild(entry.child) ?? { dir: null };
      const delivery = childDelivery(state.dir);
      return {
        task: entry.id,
        child: entry.child,
        childRun: state.dir ? displayPath(state.dir) : null,
        layer: entry.layer ?? null,
        delivered: delivery.delivered,
        evidence: delivery.evidence,
      };
    });
}

/**
 * The tasks folder this ledger rules: the rung above the ledger, because a
 * decomposition writes its tasks after the ledger that decided them. A run with
 * two decompositions therefore keeps two pairings instead of one shared folder.
 */
export function findTasksDir(runDir, { rung = null, override = null } = {}) {
  if (override) return path.resolve(override);
  const found = entries(runDir, /^E\d{2}-tasks$/).filter((name) => fs.statSync(path.join(runDir, name)).isDirectory());
  if (!found.length) return null;
  if (rung === null) return path.join(runDir, found[found.length - 1]);
  const above = found.filter((name) => rungOf(name) > rung);
  return path.join(runDir, above.length ? above[0] : found[found.length - 1]);
}

export function taskFiles(tasksDir) {
  if (!tasksDir || !fs.existsSync(tasksDir)) return [];
  return fs
    .readdirSync(tasksDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}
/** Ledger file names carry the report's rung, so two decompositions never share one. */
export function ledgerName(rung) {
  return rung === null || rung === undefined ? "triage.json" : `triage-${pad(rung)}.json`;
}

export function createLedger(runDir, { slug = null, source = null, now = new Date() } = {}) {
  const dirAbs = path.resolve(runDir);
  fs.mkdirSync(dirAbs, { recursive: true });
  const reportAbs = reportPath(dirAbs);
  return {
    skill: SKILL,
    slug: sanitizeSlug(slug || slugFromRunDir(dirAbs)),
    source: source ? path.basename(source) : resolveSource(dirAbs),
    rung: rungOf(path.basename(reportAbs)),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    dir: displayPath(dirAbs),
    report: path.basename(reportAbs),
    /** Tasks cut under this ledger carry a property block, so `verify` holds their size and complexity to the scales. */
    taskProperties: true,
    verdicts: [],
  };
}

/** Every ledger in the run, oldest rung first. */
export function loadLedgers(runDir) {
  const dirAbs = path.resolve(runDir);
  return entries(dirAbs, LEDGER_PATTERN)
    .map((name) => {
      try {
        return { name, ledger: JSON.parse(fs.readFileSync(path.join(dirAbs, name), "utf8")) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function newestSource(runDir) {
  const found = entries(runDir, SOURCE_PATTERN);
  return found.length ? found[found.length - 1] : null;
}

/** The ledgers of a run as one line, so every refusal can name the choices it refused. */
function describeLedgers(ledgers) {
  return ledgers.map((entry) => `${entry.name} (${entry.ledger.source})`).join(", ");
}

function ledgerFor(ledgers, source) {
  return ledgers.find((entry) => entry.ledger.source === source) ?? null;
}

/**
 * Picks the ledger for a source artifact. Naming the source reaches an older
 * decomposition; naming none follows the same rule `start` does and takes the
 * newest one, so an ordinary single-decomposition run never needs the flag and a
 * run that holds two never verifies one decomposition's candidates against the
 * other decomposition's task files.
 */
export function pickLedger(runDir, source = null) {
  const ledgers = loadLedgers(runDir);
  if (!ledgers.length) {
    throw new Error(`no ledger in ${runDir}; run \`node triage.mjs start --dir <run folder>\` first`);
  }
  const wanted = source || newestSource(runDir);
  if (!wanted) {
    throw new Error(`no E<nn>-plan.md or E<nn>-epic.md in ${runDir}; pass --source <artifact> to pick the ledger: ${describeLedgers(ledgers)}`);
  }
  const hit = ledgerFor(ledgers, wanted);
  if (hit) return hit.ledger;
  const named = source ? `no ledger for source ${source}` : `no ledger for ${wanted}, the newest source artifact in the run`;
  const next = source ? "" : "; run `node triage.mjs start --dir <run folder>` first";
  throw new Error(`${named}${next}. Ledgers here: ${describeLedgers(ledgers)}`);
}

function knownIds(ledger) {
  return ledger.verdicts.map((entry) => entry.id).join(", ") || "none";
}

export function addCandidate(ledger, { task, title }, now = new Date()) {
  if (!task || !TASK_ID.test(task)) {
    throw new Error(`task id "${task ?? ""}" is not L<N>-T<M>, for example L0-T1`);
  }
  if (ledger.verdicts.some((entry) => entry.id === task)) {
    throw new Error(`task ${task} is already a candidate; decide it or pick another id`);
  }
  if (!title) throw new Error("--title is required: a candidate with no title cannot be triaged");
  return {
    ...ledger,
    updatedAt: now.toISOString(),
    verdicts: [
      ...ledger.verdicts,
      { id: task, title, verdict: null, why: null, evidence: null, child: null, childRun: null, at: now.toISOString() },
    ],
  };
}

/** The run a `plan` or `analyze` verdict hands to, or the reason it may not be recorded yet. */
function childOfVerdict(verdict, { evidence, child }, findChild) {
  if (!evidence) throw new Error(`--evidence is required for a "${verdict}" verdict: name the file:line or URL that makes this too big to be a task`);
  if (!sanitizeSlug(child || "")) throw new Error(`--child is required for a "${verdict}" verdict: name the slug of the run that will own this work`);
  const state = findChild(child);
  if (!state || state.problem) throw new Error(`${state?.problem ?? `no child run for ${child}`}; the run that owns the work must exist before the verdict is recorded`);
  return { dir: state.dir, artifact: state.artifact };
}

/** The recorded row for a candidate: its title, this verdict, and where the work went. */
/** The layer a verdict feeds, as recorded: a plan or analyze verdict waits on one, the others wait on nothing. */
function layerOfVerdict(verdict, layer) {
  if (layer === null || layer === undefined || layer === "") return null;
  const wanted = String(layer).trim();
  if (!/^\d+$/.test(wanted) || Number(wanted) < 1) {
    throw new Error(`--layer must be a positive whole number, not "${layer}"; it names the layer whose tasks wait on this run`);
  }
  if (!OWN_PLAN_VERDICTS.includes(verdict)) {
    throw new Error(`a "${verdict}" verdict waits on no layer; --layer names the layer a plan or analyze verdict feeds`);
  }
  return Number(wanted);
}

function verdictEntry(previous, { verdict, why, evidence, child, owned, layer }, now) {
  return {
    id: previous.id,
    title: previous.title,
    verdict,
    why,
    evidence: evidence || null,
    child: child ? sanitizeSlug(child) : null,
    childRun: owned ? displayPath(owned.dir) : null,
    layer,
    at: now.toISOString(),
  };
}

/**
 * A verdict of `plan` or `analyze` starts a run of its own, so it has to name
 * both the reason and the evidence for that reason, and the child run has to
 * exist by the time the verdict is recorded - otherwise the ledger records a
 * hand-off to a folder nobody opened. A task id that was never drafted is
 * refused: triage decides candidates, it does not invent them.
 */
export function decideCandidate(ledger, { task, verdict, why, evidence = null, child = null, layer = null }, now = new Date(), findChild = () => null) {
  const index = ledger.verdicts.findIndex((entry) => entry.id === task);
  if (index < 0) {
    throw new Error(`task ${task} was never added; known candidates: ${knownIds(ledger)}`);
  }
  if (!VERDICT_KINDS.includes(verdict)) {
    throw new Error(`verdict "${verdict ?? ""}" is not one of ${VERDICT_KINDS.join("|")}`);
  }
  if (!why) throw new Error("--why is required: a verdict with no reason is a guess");
  const wantedLayer = layerOfVerdict(verdict, layer);
  const owned = OWN_PLAN_VERDICTS.includes(verdict) ? childOfVerdict(verdict, { evidence, child }, findChild) : null;
  const entry = verdictEntry(ledger.verdicts[index], { verdict, why, evidence, child, owned, layer: wantedLayer }, now);
  return {
    ...ledger,
    updatedAt: entry.at,
    verdicts: ledger.verdicts.map((current, position) => (position === index ? entry : current)),
  };
}

function cell(value) {
  const text = value === null || value === undefined || value === "" ? "-" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

export function reportSections(ledger) {
  const rows = ledger.verdicts.map(
    (entry) => `| ${cell(entry.id)} | ${cell(entry.verdict)} | ${cell(entry.why)} | ${cell(entry.evidence)} |`,
  );
  const verdicts = [
    "| Task | Verdict | Why | Evidence |",
    "|------|---------|-----|----------|",
    ...(rows.length ? rows : ["| - | - | no candidate added yet | - |"]),
  ];
  const handoffs = ledger.verdicts
    .filter((entry) => OWN_PLAN_VERDICTS.includes(entry.verdict))
    .map((entry) => {
      const owner = entry.verdict === "plan" ? "o-plan" : "o-analyze";
      const where = entry.childRun ? ` (\`${entry.childRun}\`)` : "";
      return `- **${cell(entry.id)}** - ${owner} run \`${cell(entry.child)}\`${where} - ${entry.why}`;
    });
  return { verdicts, handoffs: handoffs.length ? handoffs : ["- none"] };
}

export function reportSkeleton(ledger) {
  return [
    `# Task triage - ${ledger.slug}`,
    "",
    `**Date:** ${ledger.createdAt}`,
    `**Run:** ${ledger.dir}`,
    `**Source:** ${ledger.source}`,
    "",
    "This is a task ledger, not o-triage's bug brief: one verdict per candidate task drafted from the source above. `task` becomes a file in the run's `E<nn>-tasks/` folder; `plan` and `analyze` are handed to a run of their own.",
    "",
  ].join("\n");
}

/** Replaces the section whose heading matches, leaving every other block alone. */
export function upsertSection(text, heading, bodyLines) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  const section = [heading, "", ...bodyLines];
  if (start === -1) return `${text.trimEnd()}\n\n${section.join("\n")}\n`;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^##\s/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const parts = [lines.slice(0, start).join("\n"), section.join("\n"), lines.slice(end).join("\n")]
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return `${parts.join("\n\n")}\n`;
}

export function renderReport(ledger, existing = "") {
  const body = existing.trim() ? existing : reportSkeleton(ledger);
  const { verdicts, handoffs } = reportSections(ledger);
  return upsertSection(upsertSection(body, "## Verdicts", verdicts), "## Handoffs", handoffs);
}

/** What the verdicts alone say: a missing verdict, a missing reason, a child that was never started. */
export function verdictViolations(ledger, findChild = () => null) {
  const violations = [];
  for (const entry of ledger.verdicts) {
    if (!entry.verdict) {
      violations.push({ rule: "undecided", task: entry.id, detail: `no verdict for "${entry.title}"` });
      continue;
    }
    if (!entry.why) violations.push({ rule: "no-reason", task: entry.id, detail: "a verdict with no reason is a guess" });
    if (!OWN_PLAN_VERDICTS.includes(entry.verdict)) continue;
    if (!entry.evidence) violations.push({ rule: "no-evidence", task: entry.id, detail: `"${entry.verdict}" cites no file:line or URL` });
    if (!entry.layer) {
      violations.push({
        rule: "no-layer",
        task: entry.id,
        detail: `"${entry.verdict}" names no layer that waits on this run; record it with --layer <n>`,
      });
    }
    if (!entry.child) {
      violations.push({ rule: "no-child", task: entry.id, detail: `"${entry.verdict}" names no run to own the work` });
      continue;
    }
    const state = findChild(entry.child);
    if (!state || state.problem) {
      violations.push({
        rule: "child-run-missing",
        task: entry.id,
        detail: state?.problem ?? `no run folder ending in -${entry.child}`,
      });
    }
  }
  return violations;
}

/** The task files grouped by the id their name carries; a name with no id is a violation of its own. */
export function taskFileIds(files) {
  const violations = [];
  const byId = new Map();
  for (const name of files) {
    const match = name.match(TASK_FILE);
    if (!match) {
      violations.push({ rule: "bad-name", file: name, detail: "a task file is named L<N>-T<M>-<slug>.md" });
      continue;
    }
    const id = `L${match[1]}-T${match[2]}`;
    byId.set(id, [...(byId.get(id) || []), name]);
  }
  return { violations, byId };
}

/** What the files and the verdicts say about each other, one id at a time. */
export function fileMatchViolations(ledger, byId, tasksDir) {
  const violations = [];
  for (const [id, holders] of byId) {
    if (holders.length > 1) {
      violations.push({ rule: "task-file-duplicate", task: id, detail: `two files claim ${id}: ${holders.join(", ")}` });
    }
    const entry = ledger.verdicts.find((candidate) => candidate.id === id);
    if (!entry) {
      violations.push({ rule: "orphan-task-file", task: id, detail: `${holders[0]} has no candidate in the ledger for ${ledger.source}` });
    } else if (entry.verdict !== "task") {
      violations.push({ rule: "verdict-not-task", task: id, detail: `${holders[0]} exists but its verdict is "${entry.verdict}"` });
    }
  }
  for (const entry of ledger.verdicts) {
    if (entry.verdict !== "task") continue;
    if (!byId.has(entry.id)) {
      violations.push({ rule: "task-file-missing", task: entry.id, detail: `verdict "task" but no L<N>-T<M>-<slug>.md in ${displayPath(tasksDir)}` });
    }
  }
  return violations;
}

const TASK_SIZES = new Set(["XS", "S", "M", "L", "XL"]);
const TASK_COMPLEXITIES = new Set(["clear", "complicated", "complex"]);

/** The `key: value` scalars of a task's leading `---` block, quotes stripped; empty when it has none. */
export function taskProperties(text) {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return {};
  return Object.fromEntries(
    lines
      .slice(1, end)
      .map((line) => line.match(/^([a-z_]+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim().replace(/^(["'])(.*)\1$/, "$2")]),
  );
}

/** Each check a task's property block must pass: the rule, when it fires, and what it says. */
const SIZE_RULES = [
  ["no-size", ({ size }) => !size, () => "a task names its size: XS, S, M or L"],
  ["bad-size", ({ size }) => size && !TASK_SIZES.has(size), ({ size }) => `size "${size}" is not XS, S, M, L or XL`],
  ["no-complexity", ({ complexity }) => !complexity, () => "a task names its complexity: clear, complicated or complex"],
  [
    "bad-complexity",
    ({ complexity }) => complexity && !TASK_COMPLEXITIES.has(complexity),
    ({ complexity }) => `complexity "${complexity}" is not clear, complicated or complex`,
  ],
  ["unjustified-l", ({ size, complexity_why: why }) => size === "L" && !why, () => "an L carries its reason in complexity_why"],
  ["oversize", ({ size }) => size === "XL", () => "an XL is a plan, not a task: triage it again"],
];

/** What one task's size and complexity say against the scales the template writes them on. */
export function sizeViolations(name, properties) {
  return SIZE_RULES.filter(([, fires]) => fires(properties)).map(([rule, , detail]) => ({ rule, file: name, detail: detail(properties) }));
}

/**
 * Triage is complete when every candidate carries a verdict with a reason, every
 * `plan` and `analyze` verdict names a child run that exists and holds an artifact,
 * and the task files in this ledger's own tasks folder match the `task` verdicts
 * one for one.
 */
export function computeViolations(ledger, { reportText = "", tasksDir = null, findChild = () => null } = {}) {
  const violations = [];
  if (!reportText.trim()) violations.push({ rule: "no-report", detail: `the triage report ${ledger.report} is missing or empty` });
  violations.push(...verdictViolations(ledger, findChild));

  if (!tasksDir) {
    violations.push({ rule: "no-tasks-dir", detail: "no E<nn>-tasks/ folder in the run; create it before verifying" });
    return { violations, files: [] };
  }

  const files = taskFiles(tasksDir);
  const { violations: naming, byId } = taskFileIds(files);
  violations.push(...naming, ...fileMatchViolations(ledger, byId, tasksDir));
  if (ledger.taskProperties) {
    violations.push(...files.flatMap((name) => sizeViolations(name, taskProperties(fs.readFileSync(path.join(tasksDir, name), "utf8")))));
  }
  return { violations, files };
}

function parseArgs(args) {
  const out = { _: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      out[arg.slice(2)] = index + 1 < args.length && !args[index + 1].startsWith("--") ? args[++index] : true;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function value(args, key, short = null) {
  const found = args[key] ?? (short ? args[short] : undefined);
  return found === true || found === undefined ? null : found;
}

function requireDir(args) {
  const dir = value(args, "dir");
  if (!dir) throw new Error("--dir is required: the run folder holding the source artifact and the tasks");
  return path.resolve(dir);
}

function usage() {
  return [
    "o-decompose triage - one verdict per candidate task, one ledger per decomposition.",
    "",
    "Usage:",
    "  node triage.mjs start  --dir <run folder> [--source <plan|epic artifact>] [--slug <slug>]",
    "  node triage.mjs add    --dir <run folder> [--source <artifact>] --task L0-T1 --title \"<candidate>\"",
    "  node triage.mjs decide --dir <run folder> [--source <artifact>] --task L0-T1 --verdict <task|plan|analyze|drop> --why \"<reason>\" [--evidence \"<file:line|url>\"] [--child <slug>]",
    "  node triage.mjs list   --dir <run folder> [--source <artifact>]",
    "  node triage.mjs verify --dir <run folder> [--source <artifact>] [--tasks-dir <dir>] [--runs-root <dir>]",
    "",
  ].join("\n");
}

function saveLedger(runDir, ledger) {
  fs.mkdirSync(runDir, { recursive: true });
  const reportAbs = path.join(runDir, ledger.report);
  const existing = fs.existsSync(reportAbs) ? fs.readFileSync(reportAbs, "utf8") : "";
  fs.writeFileSync(reportAbs, renderReport(ledger, existing));
  fs.writeFileSync(path.join(runDir, ledgerName(ledger.rung)), `${JSON.stringify(ledger, null, 2)}\n`);
  return reportAbs;
}

function commandStart(args) {
  const dir = requireDir(args);
  const explicit = value(args, "source", "s");
  const source = resolveSource(dir, explicit);
  let ledger = loadLedgers(dir).find((entry) => entry.ledger.source === source)?.ledger ?? null;
  if (ledger) {
    ledger = { ...ledger, slug: sanitizeSlug(value(args, "slug") || ledger.slug) };
  } else {
    ledger = createLedger(dir, { slug: value(args, "slug"), source });
  }
  const reportAbs = saveLedger(dir, ledger);
  return {
    dir: displayPath(dir),
    ledger: ledgerName(ledger.rung),
    report: displayPath(reportAbs),
    source: ledger.source,
    candidates: ledger.verdicts.length,
  };
}

function commandAdd(args) {
  const dir = requireDir(args);
  const ledger = addCandidate(pickLedger(dir, value(args, "source", "s")), {
    task: value(args, "task"),
    title: value(args, "title"),
  });
  saveLedger(dir, ledger);
  return { dir: displayPath(dir), ledger: ledgerName(ledger.rung), source: ledger.source, candidates: ledger.verdicts.length };
}

/** The flags a verdict is recorded with, named once so the command reads as one call. */
function verdictArgs(args) {
  return {
    task: value(args, "task"),
    verdict: value(args, "verdict"),
    why: value(args, "why"),
    evidence: value(args, "evidence"),
    child: value(args, "child"),
    layer: value(args, "layer"),
  };
}

/** The ledger's report as written on disk, or empty when it was never written. */
function reportTextFor(dir, ledger) {
  const file = path.join(dir, ledger.report);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function commandDecide(args) {
  const dir = requireDir(args);
  const runsRoot = resolveRunsRoot(dir, value(args, "runs-root"));
  const ledger = decideCandidate(
    pickLedger(dir, value(args, "source", "s")),
    verdictArgs(args),
    new Date(),
    (slug) => childRunState(runsRoot, slug),
  );
  saveLedger(dir, ledger);
  const entry = ledger.verdicts.find((candidate) => candidate.id === value(args, "task"));
  return {
    dir: displayPath(dir),
    ledger: ledgerName(ledger.rung),
    source: ledger.source,
    task: entry.id,
    verdict: entry.verdict,
    child: entry.child,
    childRun: entry.childRun,
  };
}

function commandList(args) {
  const dir = requireDir(args);
  const ledger = pickLedger(dir, value(args, "source", "s"));
  return {
    dir: displayPath(dir),
    ledger: ledgerName(ledger.rung),
    slug: ledger.slug,
    source: ledger.source,
    candidates: ledger.verdicts.length,
    decided: ledger.verdicts.filter((entry) => entry.verdict).length,
    handoffs: ledger.verdicts.filter((entry) => OWN_PLAN_VERDICTS.includes(entry.verdict)).length,
    verdicts: ledger.verdicts.map(({ id, title, verdict }) => ({ id, title, verdict })),
  };
}

function commandVerify(args) {
  const dir = requireDir(args);
  const ledger = pickLedger(dir, value(args, "source", "s"));
  const tasksDir = findTasksDir(dir, { rung: ledger.rung, override: value(args, "tasks-dir") });
  const runsRoot = resolveRunsRoot(dir, value(args, "runs-root"));
  const findChild = (slug) => childRunState(runsRoot, slug);
  const { violations, files } = computeViolations(ledger, {
    reportText: reportTextFor(dir, ledger),
    tasksDir,
    findChild,
  });
  return {
    exitCode: violations.length ? 1 : 0,
    result: {
      dir: displayPath(dir),
      ledger: ledgerName(ledger.rung),
      source: ledger.source,
      candidates: ledger.verdicts.length,
      taskFiles: files.length,
      tasksDir: tasksDir ? displayPath(tasksDir) : null,
      receipts: receiptsFor(ledger, findChild),
      violations,
    },
  };
}

const COMMANDS = { start: commandStart, add: commandAdd, decide: commandDecide, list: commandList, verify: commandVerify };

function dispatch(command, args) {
  const handler = COMMANDS[command];
  if (!handler) throw new Error(`unknown command "${command}"`);
  return handler(args);
}

/** Print what a command returned, and exit with the code it decided when it has one. */
function emit(output) {
  process.stdout.write(`${JSON.stringify(output.result ?? output, null, 2)}\n`);
  if (output.exitCode) process.exit(output.exitCode);
}

function wantsHelp(command) {
  return !command || command === "--help" || command === "-h";
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (wantsHelp(command)) {
      process.stdout.write(usage());
      return;
    }
    emit(dispatch(command, parseArgs(rest)));
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
