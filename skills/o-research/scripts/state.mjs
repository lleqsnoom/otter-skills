#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PHASES = ["baseline", "iterate", "done", "escalate"];
export const STOP_PHASES = new Set(["done", "escalate"]);
export const DIRECTIONS = ["maximize", "minimize"];
export const POLICIES = ["score_improvement", "pass_only"];
export const EVALUATOR_KINDS = ["command", "agent"];
export const DEFAULT_CAP = 10;
export const DEFAULT_MIN_DELTA = 0;
export const DEFAULT_NOISE_RUNS = 1;
export const DEFAULT_TIMEOUT_MS = 60000;
export const DEFAULT_ROOT = ".o-skills/runs";

export const GRAPH = {
  nodes: ["baseline", "iterate", "done", "escalate"],
  edges: [
    { from: "baseline", to: "iterate", guard: null },
    { from: "iterate", to: "iterate", guard: "target_unmet" },
    { from: "iterate", to: "done", guard: "target_met_and_pass" },
    { from: "iterate", to: "escalate", guard: "cap_reached" },
  ],
};

function round(value, places = 3) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function normalizeList(value) {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : String(value).split(",");
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

function normalizeSamples(value) {
  if (value === undefined || value === null) return null;
  const arr = Array.isArray(value) ? value : String(value).split(",");
  const nums = arr.map(Number).filter(Number.isFinite);
  return nums.length ? nums : null;
}

// Criteria count from a checklist file: every non-empty line that is not a
// comment counts as one criterion (so a markdown bullet list is 1:1).
export function countCriteriaEntries(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")).length;
}

// An agent-judged per-iteration verdict, `k/n` met criteria, normalized to the same
// `{ pass, score }` shape a command evaluator emits. `pass` is all-met; `score` is
// the coverage ratio.
export function coverageVerdict(spec) {
  const m = String(spec).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) throw new Error("coverage must look like k/n (e.g. 2/3)");
  const met = Number(m[1]);
  const total = Number(m[2]);
  if (total < 1) throw new Error("coverage denominator must be at least 1");
  if (met > total) throw new Error("coverage numerator cannot exceed the denominator");
  return { met, total, score: round(met / total), pass: met === total };
}

// A criterion counts as cited when its line names a URL or a file:line — something someone can
// open. "I read it somewhere" is how a run reaches 1/1 without reading anything.
const EVIDENCE_SOURCE_RE = /https?:\/\/\S+|\S+\.[A-Za-z0-9]+:\d+/;

export function evidenceCount(text, total) {
  const cited = new Set(
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^[-*]?\s*C(\d+)\b(.*)$/))
      .filter((match) => match && EVIDENCE_SOURCE_RE.test(match[2]))
      .map((match) => Number(match[1]))
      .filter((id) => id >= 1 && id <= total)
  );
  const criteria = [...cited].sort((a, b) => a - b);
  return { cited: criteria.length, criteria };
}

// Minimal glob: `**` crosses directories, `*` stays within one path segment.
export function matchesGlob(pattern, target) {
  const p = String(pattern).trim();
  if (!p) return false;
  const t = String(target).replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        re += ".*";
        i += 1;
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`).test(t);
}

// Constrained search: every changed path must match an `allowed` glob (when any
// are declared) and must not match any `forbidden` glob.
export function searchVerdict(search, changed) {
  const paths = normalizeList(changed);
  const allowed = normalizeList(search?.allowed);
  const forbidden = normalizeList(search?.forbidden);
  const forbiddenHits = paths.filter((p) => forbidden.some((f) => matchesGlob(f, p)));
  const outsideAllowed = allowed.length ? paths.filter((p) => !allowed.some((a) => matchesGlob(a, p))) : [];
  return { allowed, forbidden, paths, forbiddenHits, outsideAllowed, pass: forbiddenHits.length === 0 && outsideAllowed.length === 0 };
}

export function targetMet(state, value) {
  if (!Number.isFinite(value)) return false;
  return state.direction === "minimize" ? value <= state.target : value >= state.target;
}

const START_DEFAULTS = {
  direction: "maximize",
  policy: "score_improvement",
  guard: null,
  noiseRuns: DEFAULT_NOISE_RUNS,
  minDelta: DEFAULT_MIN_DELTA,
  cap: DEFAULT_CAP,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  candidates: null,
  evidence: true,
};

/** Each setting a run cannot start without, and what to say when it is wrong. */
const SETTING_CHECKS = [
  [(o) => o.slug && typeof o.slug === "string", "slug is required"],
  [(o) => o.metric && typeof o.metric === "string", "metric is required"],
  [(o) => DIRECTIONS.includes(o.direction), `direction must be one of ${DIRECTIONS.join(", ")}`],
  [(o) => POLICIES.includes(o.policy), `policy must be one of ${POLICIES.join(", ")}`],
  [(o) => Number.isInteger(o.cap) && o.cap >= 1, "cap must be a positive integer"],
  [(o) => Number.isInteger(o.noiseRuns) && o.noiseRuns >= 1, "noiseRuns must be a positive integer"],
  [(o) => Number.isFinite(o.minDelta) && o.minDelta >= 0, "minDelta must be a non-negative number"],
  [(o) => Number.isFinite(o.timeoutMs) && o.timeoutMs > 0, "timeoutMs must be a positive number"],
];

/**
 * The evaluator a run is judged by. The agent-judged mode needs a criteria count, takes its label from it, and
 * defaults its target to every criterion met (a ratio of 1).
 */
function resolveEvaluator({ evaluator, evaluatorKind, criteria, target }) {
  const kind = evaluatorKind || (evaluator === "agent" ? "agent" : "command");
  if (!EVALUATOR_KINDS.includes(kind)) throw new Error(`evaluator kind must be one of ${EVALUATOR_KINDS.join(", ")}`);
  if (kind === "agent" && (!Number.isInteger(criteria) || criteria < 1)) throw new Error("agent evaluator needs a positive --criteria count");
  const label = kind === "agent" ? `agent (coverage of ${criteria} criteria)` : evaluator;
  const resolvedTarget = kind === "agent" && !Number.isFinite(target) ? 1 : target;
  if (!label || typeof label !== "string") throw new Error("evaluator command is required");
  if (!Number.isFinite(resolvedTarget)) throw new Error("target must be a number");
  return { target: resolvedTarget, evaluator: label, evaluatorKind: kind, criteria: kind === "agent" ? criteria : null };
}

/** What every run holds before its first experiment. */
const freshRun = (now) => ({ iteration: 0, phase: "baseline", best: null, history: [], stopReason: null, stopGates: null, createdAt: now.toISOString(), updatedAt: now.toISOString() });

export function startState(options = {}) {
  // An option passed as undefined means "not given", so it must not overwrite its default.
  const o = { ...START_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  for (const [ok, message] of SETTING_CHECKS) if (!ok(o)) throw new Error(message);
  const judge = resolveEvaluator(o);
  const candidates = normalizeList(o.candidates);
  if (o.candidates !== null && candidates.length < 3) throw new Error("a run needs at least 3 candidate changes (--candidates)");
  return {
    slug: o.slug,
    goal: o.goal || null,
    metric: o.metric,
    direction: o.direction,
    policy: o.policy,
    ...judge,
    // Agent-judged coverage must name a source per met criterion unless the run opted out at start.
    evidenceRequired: judge.evaluatorKind === "agent" && o.evidence !== false,
    guard: o.guard || null,
    search: { allowed: normalizeList(o.allowed), forbidden: normalizeList(o.forbidden) },
    graph: GRAPH,
    candidates,
    noiseRuns: o.noiseRuns,
    minDelta: o.minDelta,
    cap: o.cap,
    timeoutMs: o.timeoutMs,
    ...freshRun(o.now ?? new Date()),
  };
}

function bestEntry(state) {
  const it = state.best ? state.best.iteration : null;
  return state.history.find((h) => h.iteration === it) || state.history[state.history.length - 1];
}

// Stop verdict recomputed from the numbers on the held best entry alone.
export function stopVerdict(state, best) {
  const metricGate = { actual: best.score, expected: state.target, pass: targetMet(state, best.score) };
  const evaluatorGate = best.gates.evaluator;
  const guardGate = state.guard ? best.gates.guard : null;
  const evidenceGate = best.gates.evidence ?? null;
  const pass =
    metricGate.pass &&
    (evaluatorGate ? evaluatorGate.pass : true) &&
    (guardGate ? guardGate.pass : true) &&
    (evidenceGate ? evidenceGate.pass : true);
  return { pass, gates: { metric: metricGate, evaluator: evaluatorGate, guard: guardGate, evidence: evidenceGate } };
}

function commitStopOrAdvance(state) {
  const best = bestEntry(state);
  const stop = stopVerdict(state, best);
  state.stopGates = stop.gates;
  const dir = state.direction === "minimize" ? "<=" : ">=";
  if (stop.pass) {
    state.phase = "done";
    state.stopReason = `target met: ${state.metric} ${dir} ${state.target} (best ${best.score})`;
    return state;
  }
  if (state.iteration >= state.cap) {
    state.phase = "escalate";
    state.stopReason = `cap ${state.cap} reached; best ${state.metric}=${best.score} did not meet ${dir} ${state.target}`;
    return state;
  }
  state.iteration += 1;
  state.phase = "iterate";
  return state;
}

export function recordBaseline(state, { score, samples, pass } = {}) {
  if (state.phase !== "baseline") throw new Error(`not awaiting baseline (phase "${state.phase}")`);
  const nums = normalizeSamples(samples);
  const value = Number.isFinite(Number(score))
    ? Number(score)
    : nums
      ? round(nums.reduce((a, b) => a + b, 0) / nums.length)
      : null;
  if (!Number.isFinite(value)) throw new Error("baseline needs a numeric score (or samples)");
  const entry = {
    iteration: 0,
    kind: "baseline",
    score: value,
    samples: nums,
    pass: pass === undefined ? null : pass === true,
    guardPass: null,
    delta: null,
    decision: "baseline",
    change: null,
    gates: {
      metric: { actual: value, expected: state.target, pass: targetMet(state, value) },
      evaluator: pass === undefined ? null : { actual: pass === true ? 1 : 0, expected: 1, pass: pass === true },
      noise: nums ? { actual: nums.length, expected: state.noiseRuns, pass: nums.length >= state.noiseRuns } : null,
      guard: null,
      atomic: null,
      search: null,
      improvement: null,
    },
    ts: new Date().toISOString(),
  };
  state.history.push(entry);
  state.best = { score: value, iteration: 0 };
  state.iteration = 1;
  state.phase = "iterate";
  const stop = stopVerdict(state, bestEntry(state));
  state.stopGates = stop.gates;
  if (stop.pass) {
    state.phase = "done";
    state.stopReason = `target already met at baseline: ${state.metric} ${state.direction === "minimize" ? "<=" : ">="} ${state.target} (best ${value})`;
  }
  return touch(state);
}

/** The score a candidate carries: the number given, or the mean of its samples. */
function candidateScore(score, samples) {
  const nums = normalizeSamples(samples);
  const value = Number.isFinite(Number(score)) ? Number(score) : nums ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
  if (!Number.isFinite(value)) throw new Error("candidate needs a numeric score (or samples)");
  return { value, nums };
}

/** Every gate a candidate is held to; a gate that does not apply to this run is null. */
function candidateGates(state, { value, nums, pass, guardPass, paths, evidence }) {
  const improvement = state.direction === "minimize" ? state.best.score - value : value - state.best.score;
  const met = state.evaluatorKind === "agent" ? Math.round(value * state.criteria) : null;
  const cited = evidence?.cited ?? 0;
  return {
    improvement,
    gates: {
      metric: { actual: value, expected: state.target, pass: targetMet(state, value) },
      evaluator: { actual: pass === true ? 1 : 0, expected: 1, pass: pass === true },
      noise: nums ? { actual: nums.length, expected: state.noiseRuns, pass: nums.length >= state.noiseRuns } : null,
      guard: state.guard ? { actual: guardPass === true ? 1 : 0, expected: 1, pass: guardPass === true } : null,
      atomic: paths.length ? { actual: paths.length, expected: 1, pass: paths.length === 1 } : null,
      search: paths.length ? searchVerdict(state.search, paths) : null,
      improvement: { actual: round(improvement), expected: state.minDelta, pass: improvement >= state.minDelta },
      evidence: state.evidenceRequired ? { actual: cited, expected: met, pass: cited >= met } : null,
    },
  };
}

/**
 * Keep or revert. In agent mode a candidate that raises coverage is progress the run keeps: its text stays in the
 * research file, and recording it as "revert" made the trail say the opposite of what happened.
 */
function keepCandidate(state, { gates, improvement }) {
  const progress = state.evaluatorKind === "agent" && improvement > 0;
  if (!(gates.evaluator.pass || progress)) return false;
  if (state.policy === "score_improvement" && !gates.improvement.pass) return false;
  return [gates.evidence, gates.noise, gates.guard, gates.atomic, gates.search].every((gate) => !gate || gate.pass);
}

export function recordCandidate(state, { pass, score, samples, guardPass, changed, change, evidence = null } = {}) {
  if (STOP_PHASES.has(state.phase)) throw new Error(`loop already stopped (${state.phase})`);
  if (state.phase !== "iterate") throw new Error(`not awaiting a candidate (phase "${state.phase}")`);
  if (pass === undefined) throw new Error("candidate needs pass (boolean) — pass the evaluator output");
  const { value, nums } = candidateScore(score, samples);
  const judged = candidateGates(state, { value, nums, pass, guardPass, paths: normalizeList(changed), evidence });
  const keep = keepCandidate(state, judged);
  state.history.push({
    iteration: state.iteration,
    kind: "candidate",
    score: value,
    samples: nums,
    pass: pass === true,
    guardPass: state.guard ? guardPass === true : null,
    delta: round(judged.improvement),
    decision: keep ? "keep" : "revert",
    change: change || null,
    evidence: evidence ? { cited: evidence.cited, file: evidence.file ?? null } : null,
    gates: judged.gates,
    ts: new Date().toISOString(),
  });
  if (keep) state.best = { score: value, iteration: state.iteration };
  commitStopOrAdvance(state);
  return touch(state);
}

export function isStopped(state) {
  return STOP_PHASES.has(state.phase);
}

export function nextAction(state) {
  return state.phase;
}

export function summarize(state) {
  const cands = state.history.filter((h) => h.kind === "candidate");
  const base = state.history.find((h) => h.kind === "baseline");
  const best = state.best || { score: null, iteration: null };
  const gain =
    base && Number.isFinite(best.score)
      ? round(state.direction === "minimize" ? base.score - best.score : best.score - base.score)
      : null;
  return {
    slug: state.slug,
    metric: state.metric,
    direction: state.direction,
    target: state.target,
    policy: state.policy,
    phase: state.phase,
    iteration: state.iteration,
    experiments: cands.length,
    kept: cands.filter((h) => h.decision === "keep").length,
    baselineScore: base ? base.score : null,
    bestScore: best.score,
    bestIteration: best.iteration,
    gain,
    stopReason: state.stopReason,
  };
}

// Re-derive the stop decision from the recorded numbers alone.
export function verify(state) {
  const checks = [];
  let ok = false;
  const best = state.best ? bestEntry(state) : null;
  if (state.phase === "done" && best) {
    const sv = stopVerdict(state, best);
    checks.push({ name: "metric meets target", actual: sv.gates.metric.actual, expected: sv.gates.metric.expected, pass: sv.gates.metric.pass });
    if (sv.gates.evaluator) checks.push({ name: "evaluator pass", actual: sv.gates.evaluator.actual, expected: 1, pass: sv.gates.evaluator.pass });
    if (sv.gates.guard) checks.push({ name: "guard pass", actual: sv.gates.guard.actual, expected: 1, pass: sv.gates.guard.pass });
    ok = checks.every((c) => c.pass);
  }
  return {
    ok,
    phase: state.phase,
    metric: state.metric,
    direction: state.direction,
    target: state.target,
    bestScore: state.best ? state.best.score : null,
    checks,
    stopReason: state.stopReason,
    summary: summarize(state),
  };
}

function touch(state) {
  state.updatedAt = new Date().toISOString();
  return state;
}

function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

// #region run-folder
// Two digits, not more: a wider counter would sort E100 before E99.
const RUNS_ROOT = ".o-skills/runs";
const MAX_COUNTER = 99;

function padRunCounter(value) {
  return String(value).padStart(2, "0");
}

function runFolders(rootAbs, slug) {
  if (!fs.existsSync(rootAbs)) return [];
  return fs
    .readdirSync(rootAbs)
    .filter((name) => name.endsWith(`-${slug}`))
    .sort();
}

// Counts runs of this slug only, so R<nn> reads as "the nth run of this topic".
// Works together with `fresh`: a global counter would make the number depend on
// unrelated topics, and per-slug numbering alone could never reach 02 because
// resolveRunDir joins an existing run for the slug.
function highestRun(rootAbs, slug) {
  return runFolders(rootAbs, slug).reduce((max, name) => {
    const match = name.match(/-R(\d+)-/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function mintRunDir(rootAbs, slug, now) {
  const run = highestRun(rootAbs, slug) + 1;
  if (run > MAX_COUNTER) throw new Error(`run counter would exceed R${MAX_COUNTER}`);
  const stamp = `${now.getFullYear()}-${padRunCounter(now.getMonth() + 1)}-${padRunCounter(now.getDate())}-${padRunCounter(now.getHours())}${padRunCounter(now.getMinutes())}`;
  const dir = path.join(rootAbs, `${stamp}-R${padRunCounter(run)}-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A run folder in the system temp directory and outside any repository — a session's scratch folder — is cleared
 * with it, and the user never finds it in the project. Agents are told to put temporary files there, so a run
 * started from it lands there too. A repository that happens to live in /tmp is still the project.
 */
export function outsideProjectWarning(rootAbs) {
  const temp = path.resolve(process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp");
  if (rootAbs !== temp && !rootAbs.startsWith(`${temp}${path.sep}`)) return null;
  for (let dir = rootAbs; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return null;
    if (path.dirname(dir) === dir) break;
  }
  return `${rootAbs} is in a temp folder outside any repository, which is cleared and is not the project: run this from the project root, so the run lands in its .o-skills/runs/`;
}

function warnOutsideProject(rootAbs) {
  const warning = outsideProjectWarning(rootAbs);
  if (warning) process.stderr.write(`warning: ${warning}\n`);
}

/**
 * Return the run folder for a slug, choosing in this order:
 * `fresh` mints a new R<nn>, `run` selects that R number, `marker` selects the
 * folder holding that artifact, one match is returned, none mints, and more
 * than one without a selector throws rather than guessing.
 */
function resolveRunDir(slug, { root = RUNS_ROOT, now = new Date(), marker = null, fresh = false, run = null } = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  const rootAbs = path.resolve(root);
  warnOutsideProject(rootAbs);
  fs.mkdirSync(rootAbs, { recursive: true });

  if (fresh) return mintRunDir(rootAbs, slug, now);

  const folders = runFolders(rootAbs, slug);
  if (run !== null) {
    const wanted = `-R${padRunCounter(run)}-`;
    const picked = folders.find((name) => name.includes(wanted));
    if (!picked) throw new Error(`no run R${padRunCounter(run)} for "${slug}"`);
    return path.join(rootAbs, picked);
  }
  if (marker) {
    const holding = folders.filter((name) => fs.existsSync(path.join(rootAbs, name, marker)));
    if (holding.length) return path.join(rootAbs, holding[holding.length - 1]);
  }
  if (folders.length > 1) {
    throw new Error(`${folders.length} runs match "${slug}"; pass --run <nn> to pick one, or --new-run to start another`);
  }
  if (folders.length) return path.join(rootAbs, folders[0]);
  return mintRunDir(rootAbs, slug, now);
}

function nextE(runDir) {
  const used = fs.existsSync(runDir)
    ? fs
        .readdirSync(runDir)
        .map((name) => {
          const match = name.match(/^E(\d{2})-/);
          return match ? Number(match[1]) : null;
        })
        .filter((value) => value !== null)
    : [];
  const next = used.length ? Math.max(...used) + 1 : 0;
  if (next > MAX_COUNTER) throw new Error(`artifact counter would exceed E${MAX_COUNTER}`);
  return `E${String(next).padStart(2, "0")}`;
}
// #endregion run-folder

function stampTime(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function cell(value) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

// --- audit trail files -------------------------------------------------------

export function renderGraphMermaid(state) {
  const graph = state.graph || GRAPH;
  const lines = ["```mermaid", "graph LR"];
  for (const edge of graph.edges) {
    lines.push(edge.guard ? `  ${edge.from} -->|${edge.guard}| ${edge.to}` : `  ${edge.from} --> ${edge.to}`);
  }
  lines.push(`  classDef current stroke-width:3px,stroke:#f60`);
  lines.push(`  class ${state.phase} current`);
  lines.push("```");
  return lines.join("\n");
}

export function renderMemoryLine(entry) {
  const parts = [entry.kind, entry.score, entry.decision, entry.change].filter(
    (part) => part !== null && part !== undefined && part !== ""
  );
  return `- [${entry.ts}] ${parts.join(": ")}`;
}

/** A path inside a `.o-skills` tree, from its root and without `.md` — the form Obsidian links by — or `null` outside one. */
function vaultNote(target) {
  const parts = path.resolve(target).split(path.sep);
  const at = parts.lastIndexOf(".o-skills");
  if (at === -1 || !vaultEnabled(parts.slice(0, at + 1).join(path.sep))) return null;
  return parts.slice(at + 1).join("/").replace(/\.md$/, "");
}

/**
 * Obsidian's links, topics and tag notes are written unless the repo turns them off with
 * `.o-skills/config/vault.json` → `{ "enabled": false }`. Fields the scripts read (type, size, status) stay either way.
 */
function vaultEnabled(oSkillsRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(oSkillsRoot, "config", "vault.json"), "utf8")).enabled !== false;
  } catch {
    return true;
  }
}

/** A run folder's topic: its name without the `YYYY-MM-DD-hhmm-R<nn>-` stamp. */
function runSlug(runDir) {
  return path.basename(path.resolve(runDir)).replace(/^\d{4}-\d{2}-\d{2}-\d{4}-R\d+-/, "");
}

/** An artifact's property block: its type, its title, the run hub of `runDir`, and the artifacts it names by key. */
function propertyBlock(type, title, runDir, links = {}) {
  const run = vaultNote(path.join(runDir, "index"));
  const named = Object.entries(links)
    .map(([key, target]) => [key, target ? vaultNote(target) : null])
    .filter(([, note]) => note);
  return [
    "---",
    `type: ${type}`,
    `title: ${JSON.stringify(title)}`,
    ...(run ? [`run: "[[${run}]]"`] : []),
    ...named.map(([key, note]) => `${key}: "[[${note}]]"`),
    "---",
    "",
  ].join("\n");
}

/** The research report's block: it sits in `<run>/E<nn>-research/`, so its run hub is one folder up. */
function researchBlock(runDir, kind) {
  const run = runDir ? path.dirname(runDir) : null;
  return run ? propertyBlock("research", `${kind} · ${runSlug(run)}`, run) : "";
}

export function renderResearchMd(state, runDir = null) {
  const dir = state.direction === "minimize" ? "<=" : ">=";
  const lines = [
    `${researchBlock(runDir, "Research")}# Research — ${state.slug}`,
    "",
    `**Goal:** ${state.goal || "(not set)"}`,
    `**Metric:** ${state.metric} (${state.direction} → target ${dir} ${state.target})`,
    `**Policy:** ${state.policy}`,
    `**Evaluator:** \`${state.evaluator}\`${state.evaluatorKind === "agent" ? " (agent-judged)" : ""}`,
    `**Guard:** ${state.guard ? `\`${state.guard}\`` : "none"}`,
    `**Search space:** allowed [${state.search.allowed.join(", ") || "any"}]; forbidden [${state.search.forbidden.join(", ") || "none"}]`,
    `**Noise:** noise_runs=${state.noiseRuns}, min_delta=${state.minDelta}`,
    `**Experiment timeout:** ${state.timeoutMs} ms`,
    `**Cap:** ${state.cap}`,
    "",
    "## History",
    "",
    "| # | kind | score | pass | guard | delta | decision | change |",
    "|---|------|-------|------|-------|-------|----------|--------|",
  ];
  for (const h of state.history) {
    lines.push(
      `| ${h.iteration} | ${h.kind} | ${h.score} | ${h.pass === null ? "—" : h.pass} | ${
        h.guardPass === null ? "—" : h.guardPass
      } | ${h.delta === null ? "—" : h.delta} | ${h.decision} | ${cell(h.change)} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderResultsTsv(state) {  const header = ["iteration", "kind", "score", "pass", "guard_pass", "delta", "decision", "change"].join("\t");
  const rows = state.history.map((h) =>
    [
      h.iteration,
      h.kind,
      h.score,
      h.pass === null ? "" : h.pass,
      h.guardPass === null ? "" : h.guardPass,
      h.delta === null ? "" : h.delta,
      h.decision,
      cell(h.change),
    ].join("\t")
  );
  return `${[header, ...rows].join("\n")}\n`;
}

export function logLineFor(entry) {
  return `- [${stampTime(new Date(entry.ts))}] iter ${entry.iteration} ${entry.kind} score=${entry.score} pass=${
    entry.pass === null ? "—" : entry.pass
  } guard=${entry.guardPass === null ? "—" : entry.guardPass} delta=${entry.delta === null ? "—" : entry.delta} ${
    entry.decision
  }${entry.change ? ` — ${cell(entry.change)}` : ""}`;
}

export function renderFinalReportMd(state, runDir = null) {
  const s = summarize(state);
  const v = verify(state);
  const dir = state.direction === "minimize" ? "<=" : ">=";
  const lines = [
    `${researchBlock(runDir, "Research report")}# Final report — ${state.slug}`,
    "",
    `**Outcome:** ${state.phase === "done" ? "target met" : "escalated (cap reached without meeting target)"}`,
    `**Stop reason:** ${state.stopReason || "(none)"}`,
    "",
    "## Result",
    "",
    `- Metric: **${state.metric}** (${dir} ${state.target})`,
    `- Baseline: ${s.baselineScore}`,
    `- Best: ${s.bestScore} (iteration ${s.bestIteration})`,
    `- Gain: ${s.gain}`,
    `- Experiments: ${s.experiments} (${s.kept} kept)`,
    `- Verify: ${v.ok ? "justified (exit 0)" : "not justified (exit 1)"}`,
    "",
    "## Scenario",
    "",
    renderGraphMermaid(state),
    "",
    "## Evidence",
    "",
    `- \`${state.evaluator}\``,
    state.guard ? `- guard: \`${state.guard}\`` : "- guard: none",
    "",
    "## History",
    "",
    "| # | kind | score | pass | guard | delta | decision | change |",
    "|---|------|-------|------|-------|-------|----------|--------|",
  ];
  for (const h of state.history) {
    lines.push(
      `| ${h.iteration} | ${h.kind} | ${h.score} | ${h.pass === null ? "—" : h.pass} | ${
        h.guardPass === null ? "—" : h.guardPass
      } | ${h.delta === null ? "—" : h.delta} | ${h.decision} | ${cell(h.change)} |`
    );
  }
  if (state.phase !== "done") {
    lines.push(
      "",
      "## Open findings",
      "",
      `The metric did not reach the target within the cap. Best held value ${s.bestScore} vs ${dir} ${state.target}.`,
      "Hand the remaining gap to `o-investigate` (root cause) or `o-plan` (a different approach), or raise the cap knowingly.",
      ""
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// --- CLI ---------------------------------------------------------------------

function usage() {
  return [
    "loop state — numeric, bounded iteration state machine shared by o-tune and o-research.",
    "",
    "Usage:",
    "  node state.mjs start --slug <s> --metric <name> --target <n> --evaluator <cmd>",
    "        [--direction maximize|minimize] [--policy score_improvement|pass_only] [--goal <text>]",
    "        [--guard <cmd>] [--allow g1,g2] [--forbid g1,g2] [--noise-runs <n>] [--min-delta <n>]",
    "        [--cap <n>] [--timeout <ms>] [--root <runs dir>] [--candidates <file|a,b,c>]",
    "        # --root: the folder that holds the run folders (default .o-skills/runs), not the project root",
    "        # --candidates: at least 3 candidate changes proposed before the first experiment",
    "  node state.mjs start --slug <s> --metric <name> --evaluator agent --criteria <n|file>",
    "        # agent-judged: --target defaults to 1 (all criteria); no shell command runs",
    "  node state.mjs record --dir <dir> --baseline <n|file|-> [--samples a,b,c] [--pass true|false]",
    "  node state.mjs record --dir <dir> --baseline --coverage <k/n>",
    "  node state.mjs record --dir <dir> --candidate <file|->   # evaluator JSON: {\"pass\":bool,\"score\":number}",
    "  node state.mjs record --dir <dir> --candidate --coverage <k/n> --evidence <file> [--changed path1,path2] [--change <text>]",
    "      (agent mode: --evidence lists one line per met criterion, `C2: <URL or path:line>`; a run started",
    "       with --no-evidence records coverage without it, and says so in its state)",
    "        [--guard true|false]",
    "  node state.mjs snapshot --dir <dir> --changed path1,path2   # before an experiment: what a revert restores",
    "  node state.mjs status --dir <dir>",
    "  node state.mjs verify --dir <dir>   # exit 0 iff the stop is justified",
    "",
  ].join("\n");
}

// ── Snapshots: a revert that actually reverts ───────────────────────────
//
// A "revert" decision used to be only a word in the history: the changed file still held the experiment, so the
// trail and the tree disagreed. `snapshot` copies the paths an experiment will change before it starts; the next
// `record --candidate` restores them when the decision is revert, and drops the copy when it is keep.

const snapshotDir = (dir) => path.join(dir, "snapshot");

export function takeSnapshot(dir, changed, root = process.cwd()) {
  const paths = normalizeList(changed);
  if (!paths.length) throw new Error("snapshot needs --changed <path,…>: the files the next experiment will change");
  const target = snapshotDir(dir);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  const entries = paths.map((rel) => {
    const source = path.resolve(root, rel);
    const existed = fs.existsSync(source);
    if (existed) {
      fs.mkdirSync(path.dirname(path.join(target, "files", rel)), { recursive: true });
      fs.copyFileSync(source, path.join(target, "files", rel));
    }
    return { path: rel, existed };
  });
  fs.writeFileSync(path.join(target, "manifest.json"), `${JSON.stringify({ root, entries }, null, 2)}\n`);
  return entries;
}

/** Restore the snapshot when the decision was revert, and drop it either way. Returns what was restored. */
export function settleSnapshot(dir, decision) {
  const target = snapshotDir(dir);
  const manifestFile = path.join(target, "manifest.json");
  if (!fs.existsSync(manifestFile)) return null;
  const { root, entries } = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const restored = [];
  if (decision === "revert") {
    for (const entry of entries) {
      const live = path.resolve(root, entry.path);
      if (entry.existed) {
        fs.mkdirSync(path.dirname(live), { recursive: true });
        fs.copyFileSync(path.join(target, "files", entry.path), live);
      } else {
        fs.rmSync(live, { force: true });
      }
      restored.push(entry.path);
    }
  }
  fs.rmSync(target, { recursive: true, force: true });
  return restored;
}

function loadState(dir) {
  const file = path.join(dir, "state.json");
  if (!fs.existsSync(file)) throw new Error(`no state.json in ${dir}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function persist(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "research.md"), renderResearchMd(state, dir));
  fs.writeFileSync(path.join(dir, "results.tsv"), renderResultsTsv(state));
  if (STOP_PHASES.has(state.phase)) {
    fs.writeFileSync(path.join(dir, "final_report.md"), renderFinalReportMd(state, dir));
  }
}

function appendLog(dir, line) {
  fs.appendFileSync(path.join(dir, "research_log.md"), `${line}\n`);
}

function appendMemory(dir, line) {
  fs.appendFileSync(path.join(dir, "memory.md"), `${line}\n`);
}

function writeMemoryHeader(dir, state) {
  const lines = [`# Memory — ${state.slug}`, "", "- candidates:"];
  for (const candidate of state.candidates) lines.push(`  - ${candidate}`);
  fs.writeFileSync(path.join(dir, "memory.md"), `${lines.join("\n")}\n`);
}

function readCandidates(spec) {
  const text = fs.existsSync(String(spec)) ? fs.readFileSync(String(spec), "utf8") : String(spec).split(",").join("\n");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = i + 1 < args.length && !args[i + 1].startsWith("--") ? args[++i] : true;
      out[key] = val;
    } else {
      out._.push(a);
    }
  }
  return out;
}

/**
 * The evidence file is recorded relative to the run folder, never as the absolute path the agent typed: a run is
 * moved and committed, and an absolute path points into the machine it was made on.
 */
function readEvidence(file, state, dir) {
  if (file === undefined) return null;
  if (file === true) throw new Error("--evidence needs a file: one line per met criterion, e.g. `C2: https://… or path:line`");
  const relative = path.relative(path.resolve(dir), path.resolve(file)).split(path.sep).join("/");
  return { ...evidenceCount(fs.readFileSync(file, "utf8"), state.criteria ?? 0), file: relative };
}

function num(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
  return n;
}

function int(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer`);
  return n;
}

function bool(value, label) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new Error(`${label} must be true or false`);
}

function readJsonSource(spec) {
  const text = spec === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(String(spec), "utf8");
  return JSON.parse(text);
}

// `--criteria` accepts a positive integer or a path to a checklist file (one
// criterion per non-empty, non-comment line).
function resolveCriteria(spec) {
  const s = String(spec).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n < 1) throw new Error("--criteria must be at least 1");
    return n;
  }
  if (fs.existsSync(s)) {
    const n = countCriteriaEntries(fs.readFileSync(s, "utf8"));
    if (n < 1) throw new Error(`--criteria file ${s} has no criteria`);
    return n;
  }
  throw new Error("--criteria must be a positive integer or a path to a criteria file");
}

// A numeric literal, a JSON file, or "-" (stdin).
function scoreSource(spec) {
  if (spec !== "-" && spec !== true && Number.isFinite(Number(spec))) return { score: Number(spec) };
  return readJsonSource(spec);
}

function decision(state) {
  const last = state.history.at(-1);
  return {
    ...(last?.restored ? { restored: last.restored } : {}),
    ...(last?.revertTodo ? { revertTodo: last.revertTodo } : {}),
    next: nextAction(state),
    phase: state.phase,
    iteration: state.iteration,
    stop: isStopped(state),
    reason: state.stopReason,
    summary: summarize(state),
  };
}

/** A flag given without a value parses as `true`; these read it as absent. */
const given = (value) => (value === undefined || value === true ? undefined : value);

function requireDir(args) {
  if (!args.dir || args.dir === true) throw new Error("--dir is required");
  return args.dir;
}

function commandStart(args) {
  if (!args.slug || args.slug === true) throw new Error("--slug is required");
  const root = path.resolve(given(args.root) ?? DEFAULT_ROOT);
  const runDir = resolveRunDir(args.slug, { root, fresh: args["new-run"] === true, run: given(args.run) === undefined ? null : Number(args.run) });
  const dir = path.join(runDir, `${nextE(runDir)}-research`);
  const state = startState({
    slug: args.slug,
    goal: args.goal === true ? null : args.goal,
    metric: given(args.metric),
    direction: given(args.direction) || "maximize",
    target: given(args.target) === undefined ? undefined : num(args.target, "--target"),
    policy: given(args.policy) || "score_improvement",
    evaluator: given(args.evaluator),
    evaluatorKind: args.evaluator === "agent" || args["evaluator-kind"] === "agent" ? "agent" : undefined,
    criteria: given(args.criteria) === undefined ? undefined : resolveCriteria(args.criteria),
    guard: given(args.guard) || null,
    allowed: args.allow,
    forbidden: args.forbid,
    noiseRuns: args["noise-runs"] === undefined ? DEFAULT_NOISE_RUNS : int(args["noise-runs"], "--noise-runs"),
    minDelta: args["min-delta"] === undefined ? DEFAULT_MIN_DELTA : num(args["min-delta"], "--min-delta"),
    cap: args.cap === undefined ? DEFAULT_CAP : int(args.cap, "--cap"),
    timeoutMs: args.timeout === undefined ? DEFAULT_TIMEOUT_MS : num(args.timeout, "--timeout"),
    candidates: given(args.candidates) === undefined ? null : readCandidates(args.candidates),
    evidence: args["no-evidence"] !== true,
  });
  persist(dir, state);
  fs.writeFileSync(path.join(dir, "research_log.md"), `# Research log — ${state.slug}\n\n`);
  writeMemoryHeader(dir, state);
  appendLog(dir, `- [${stampTime()}] start: ${state.metric} ${state.direction} target ${state.target}`);
  // resolveRunDir has already printed it; the JSON carries it too, since that is the part a caller parses.
  const warning = outsideProjectWarning(path.resolve(root));
  return { output: { dir, ...(warning ? { warning } : {}), state, ...decision(state) } };
}

/** The score a `record` call carries: from `--coverage k/n` when given, else from the flag's file or number. */
function recordedScore(args, flag, coverage, readSource) {
  if (coverage) return { score: coverage.score, pass: coverage.pass };
  if (args[flag] === true) throw new Error(flag === "baseline" ? "--baseline needs a score, file, or -" : "--candidate needs a file or -");
  return readSource(args[flag]);
}

function recordCandidateArgs(dir, state, args, coverage) {
  const src = recordedScore(args, "candidate", coverage, readJsonSource);
  recordCandidate(state, {
    pass: src.pass,
    score: src.score,
    samples: args.samples,
    // evaluate.mjs --guard writes guardPass into the candidate file; --guard true|false overrides it.
    guardPass: args.guard === undefined ? src.guardPass : bool(args.guard, "--guard"),
    changed: args.changed,
    change: args.change === true ? null : args.change,
    evidence: readEvidence(args.evidence, state, dir),
  });
  const last = state.history.at(-1);
  const restored = settleSnapshot(dir, last?.decision);
  if (restored?.length) last.restored = restored;
  else if (last?.decision === "revert" && restored === null) {
    last.revertTodo = "no snapshot was taken: undo the change by reversing your own edit, never with git checkout or restore";
  }
}

function commandRecord(args) {
  const dir = requireDir(args);
  const state = loadState(dir);
  const before = state.history.length;
  const coverage = given(args.coverage) === undefined ? null : coverageVerdict(args.coverage);
  if (coverage && args.baseline === undefined && args.candidate === undefined) throw new Error("--coverage needs --baseline or --candidate");
  if (args.baseline !== undefined) {
    const src = recordedScore(args, "baseline", coverage, scoreSource);
    recordBaseline(state, { score: src.score, samples: args.samples, pass: src.pass === undefined ? undefined : src.pass === true });
  } else if (args.candidate !== undefined) {
    recordCandidateArgs(dir, state, args, coverage);
  } else {
    throw new Error("record needs --baseline or --candidate");
  }
  persist(dir, state);
  for (const entry of state.history.slice(before)) appendLog(dir, logLineFor(entry));
  for (const entry of state.history.slice(before)) appendMemory(dir, renderMemoryLine(entry));
  return { output: decision(state) };
}

const COMMANDS = {
  start: commandStart,
  record: commandRecord,
  snapshot: (args) => ({ output: { snapshot: takeSnapshot(requireDir(args), given(args.changed) ?? null) } }),
  status: (args) => {
    const state = loadState(requireDir(args));
    return { output: { state, ...decision(state) } };
  },
  verify: (args) => {
    const result = verify(loadState(requireDir(args)));
    return { output: result, exitCode: result.ok ? 0 : 1 };
  },
};

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  try {
    const run = COMMANDS[command];
    if (!run) throw new Error(`unknown command "${command}"`);
    const { output, exitCode = 0 } = run(parseArgs(rest));
    // exitCode, not exit(): the caller parses this document, and an exit here can cut it off mid-write.
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
