#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SKILL = "o-analyze";
export const REPORT_ROOT = ".x-skills/runs";
export const START_NODE = "intake";
export const STOPS = ["fix", "tasks", "plan", "investigate", "defer", "abandon"];
export const ROUTES = ["fix", "tasks", "plan", "investigate", "defer"];

const LINEAR = ["intake", "confirm_intent", "research", "clarify", "thesis", "mechanical_check", "confidence_gate", "propose"];
const ABANDON_EDGES = [...LINEAR, "route", ...ROUTES].map((from) => ({ from, to: "abandon", guards: [] }));

export const GRAPH = {
  nodes: [...LINEAR, "route", ...ROUTES, "abandon"],
  edges: [
    { from: "intake", to: "confirm_intent", guards: [] },
    { from: "confirm_intent", to: "research", guards: ["intent_confirmed"] },
    { from: "research", to: "clarify", guards: ["research_recorded"] },
    { from: "clarify", to: "clarify", guards: [] },
    { from: "clarify", to: "thesis", guards: ["no_open_questions", "evidence_cited"] },
    { from: "thesis", to: "mechanical_check", guards: ["evidence_cited"] },
    { from: "mechanical_check", to: "confidence_gate", guards: ["check_recorded"] },
    { from: "confidence_gate", to: "clarify", guards: [] },
    { from: "confidence_gate", to: "propose", guards: ["confidence_ok", "three_options"] },
    { from: "propose", to: "route", guards: ["decision_made"] },
    ...ROUTES.map((to) => ({ from: "route", to, guards: ["route_chosen"] })),
    ...ABANDON_EDGES,
  ],
};

function pad(value) {
  return String(value).padStart(2, "0");
}

export function stamp(now = new Date()) {
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}-${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function gate(pass, expected, actual) {
  return { actual, expected, pass };
}

// ── Run folders ──────────────────────────────────────────────────────

// #region run-folder
// Two digits, not more: a wider counter would sort E100 before E99.
const RUNS_ROOT = ".x-skills/runs";
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
 * Return the run folder for a slug, choosing in this order:
 * `fresh` mints a new R<nn>, `run` selects that R number, `marker` selects the
 * folder holding that artifact, one match is returned, none mints, and more
 * than one without a selector throws rather than guessing.
 */
function resolveRunDir(slug, { root = RUNS_ROOT, now = new Date(), marker = null, fresh = false, run = null } = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  const rootAbs = path.resolve(root);
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

export function createState({ slug, goal = null, topics = [], root = REPORT_ROOT, now = new Date(), fresh = false, run = null } = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  const when = now.toISOString();
  const runDirAbs = resolveRunDir(slug, { root, now, fresh, run });
  const reportAbs = path.join(runDirAbs, `${nextE(runDirAbs)}-analysis.md`);
  return {
    skill: SKILL,
    slug,
    goal,
    topics,
    createdAt: when,
    updatedAt: when,
    node: START_NODE,
    stops: STOPS,
    graph: GRAPH,
    guards: {},
    openQuestions: [],
    options: [],
    decision: null,
    intent: null,
    evidence: [],
    mechanicalCheck: { command: null, result: null, status: "pending", reason: null },
    confidence: "low",
    route: null,
    runDir: path.relative(process.cwd(), runDirAbs) || runDirAbs,
    report: path.basename(reportAbs),
    events: [],
  };
}

export function computeGuards(state, { reportText = "" } = {}) {
  const research = state.events.filter((event) => event.kind === "research");
  const answered = state.openQuestions.every((question) => question.status === "answered");
  const cited = state.evidence.some((item) => item.source);
  const check = state.mechanicalCheck;
  const checkRecorded = check.status === "run" || (check.status === "not-run" && Boolean(check.reason));
  return {
    intent_confirmed: gate(state.intent !== null, "a confirmation", state.intent ? "recorded" : "none"),
    research_recorded: gate(research.some((event) => event.status !== "not-run"), ">=1 research event", `${research.length} research`),
    no_open_questions: gate(answered, "all answered", `${state.openQuestions.filter((q) => q.status !== "answered").length} open`),
    evidence_cited: gate(cited, ">=1 cited evidence", state.evidence.length),
    check_recorded: gate(checkRecorded, "run or not-run with a reason", check.status),
    confidence_ok: gate(["high", "medium"].includes(state.confidence), "high or medium", state.confidence),
    three_options: gate(state.options.length >= 3, 3, state.options.length),
    decision_made: gate(state.decision !== null, "a decision", state.decision ? "recorded" : "none"),
    route_chosen: gate(state.route !== null, "a route", state.route || "none"),
    report_written: gate(Boolean(reportText.trim()), "a non-empty analysis", reportText.trim() ? "written" : "empty"),
  };
}

function answerQuestion(list, target, answer) {
  const index = target ? list.findIndex((question) => question.id === target) : list.findIndex((question) => question.status === "open");
  if (index < 0) return list;
  return list.map((question, i) => (i === index ? { ...question, status: "answered", answer } : question));
}

function withCapability(state, status) {
  return status === "not-run" ? { ...state, confidence: "low" } : state;
}

export function applyEvent(state, { kind, data = null, status = null, reason = null, target = null } = {}, now = new Date()) {
  const entry = { kind, data, status, reason, target, at: now.toISOString() };
  const base = { ...state, events: [...state.events, entry], updatedAt: entry.at };
  if (kind === "confirm") return { ...base, intent: data || "confirmed" };
  if (kind === "research") return withCapability(base, status);
  if (kind === "question") return { ...base, openQuestions: [...state.openQuestions, { id: `Q${state.openQuestions.length + 1}`, text: data, status: "open", answer: null }] };
  if (kind === "answer") return { ...base, openQuestions: answerQuestion(state.openQuestions, target, data) };
  if (kind === "evidence") return { ...base, evidence: [...state.evidence, { claim: data, source: target }] };
  if (kind === "check") return withCapability({ ...base, mechanicalCheck: { command: data, result: status === "not-run" ? null : reason, status: status || "run", reason: status === "not-run" ? reason : null } }, status);
  if (kind === "confidence") return { ...base, confidence: data };
  if (kind === "option") return { ...base, options: [...state.options, { id: `O${state.options.length + 1}`, summary: data, at: entry.at }] };
  if (kind === "decide") return { ...base, decision: { summary: data, at: entry.at } };
  if (kind === "route") return { ...base, route: data };
  return base;
}

export function findEdge(state, to) {
  return state.graph.edges.find((edge) => edge.from === state.node && edge.to === to) || null;
}

/** Name the moves that are legal from here, so a refusal says how to proceed instead of only what failed. */
function noEdgeError(state, to) {
  const legal = [...new Set(state.graph.edges.filter((edge) => edge.from === state.node).map((edge) => edge.to))];
  return `no edge ${state.node} -> ${to}; from ${state.node} you can go to: ${legal.join(", ") || "nothing, this is a stop"}`;
}


export function transition(state, to, { reportText = "" } = {}) {
  const edge = findEdge(state, to);
  if (!edge) return { ok: false, error: noEdgeError(state, to), state };
  const guards = computeGuards(state, { reportText });
  const failed = edge.guards.filter((name) => !guards[name].pass);
  if (failed.length) return { ok: false, error: `${failed[0]} failed`, failed, guards, state };
  return { ok: true, state: { ...state, node: to, guards, updatedAt: new Date().toISOString() } };
}

export function verifyState(state, { reportText = "" } = {}) {
  const guards = computeGuards(state, { reportText });
  const isStop = STOPS.includes(state.node);
  const required = ROUTES.includes(state.node) ? ["route_chosen", "report_written"] : [];
  const checks = required.map((name) => ({ name, ...guards[name] }));
  return { ok: isStop && checks.every((check) => check.pass), node: state.node, stop: isStop, checks, guards };
}

export function renderGraphMermaid(state) {
  const lines = ["```mermaid", "graph LR"];
  for (const edge of state.graph.edges) {
    lines.push(edge.guards.length ? `  ${edge.from} -->|${edge.guards.join(",")}| ${edge.to}` : `  ${edge.from} --> ${edge.to}`);
  }
  lines.push(`  classDef current stroke-width:3px,stroke:#f60`);
  lines.push(`  class ${state.node} current`);
  lines.push("```");
  return lines.join("\n");
}

export function renderMemoryLine(entry) {
  const detail = [entry.kind, entry.data, entry.status, entry.reason].filter((part) => part !== null && part !== undefined && part !== "").join(": ");
  return `- [${entry.at}] ${detail}`;
}

export function upsertScenario(text, mermaid) {
  const section = `## Scenario\n\n${mermaid}\n`;
  const pattern = /## Scenario[\s\S]*?(?=\n## |\s*$)/;
  if (pattern.test(text)) return text.replace(pattern, section);
  return `${text.trimEnd()}\n\n${section}`;
}

function loadState(dir) {
  const file = path.join(dir, "state.json");
  if (!fs.existsSync(file)) {
    throw new Error(`no state.json in ${dir}; run \`node scenario.mjs start --slug <slug>\` first`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * The analysis lives inside the run folder, so it is named, not located: `report` holds a file name and
 * the directory comes from the `--dir` the command was given. A cwd-relative path here made every
 * command depend on the directory it ran from, which is the one thing a run folder must not do.
 */
function reportTextFor(dir, state) {
  const file = path.join(dir, state.report);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function writeMemory(dir, state, fromIndex) {
  const file = path.join(dir, "memory.md");
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# Memory — ${state.slug}\n\n`);
  const lines = state.events.slice(fromIndex).map(renderMemoryLine).join("\n");
  if (lines) fs.appendFileSync(file, `${lines}\n`);
}

/** A path inside a `.x-skills` tree, from its root and without `.md` — the form Obsidian links by — or `null` outside one. */
function vaultNote(target) {
  const parts = path.resolve(target).split(path.sep);
  const at = parts.lastIndexOf(".x-skills");
  return at === -1 ? null : parts.slice(at + 1).join("/").replace(/\.md$/, "");
}

/** A run folder's topic: its name without the `YYYY-MM-DD-hhmm-R<nn>-` stamp. */
function runSlug(runDir) {
  return path.basename(path.resolve(runDir)).replace(/^\d{4}-\d{2}-\d{2}-\d{4}-R\d+-/, "");
}

/** An artifact's property block: its type, its title, the run hub of `runDir`, the artifacts it names by key, its tags. */
function propertyBlock(type, title, runDir, links = {}, topics = []) {
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
    ...(topics.length ? ["topics:", ...topics.map((topic) => `  - "[[tags/${topic}]]"`)] : []),
    "---",
    "",
  ].join("\n");
}

const TOPIC = /^(domain|area)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const usageError = (message) => Object.assign(new Error(message), { exitCode: 2 });

/** The run's topics from `--topics domain/a,area/b`: each `domain/<name>` or `area/<name>`, at most three domain ones. */
function parseTopics(value) {
  if (!value || value === true) return [];
  const topics = String(value)
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
  const bad = topics.find((topic) => !TOPIC.test(topic));
  if (bad) throw usageError(`topic "${bad}" is not domain/<name> or area/<name> in lower-case kebab-case`);
  if (topics.filter((topic) => topic.startsWith("domain/")).length > 3) throw usageError("at most three domain topics per run");
  return topics;
}

/** The shared base every tag note embeds: what links the note it is embedded in, which makes each tag its own index. */
const TAG_BASE = `filters:
  and:
    - file.hasLink(this.file)
views:
  - type: table
    name: Tagged
    groupBy:
      property: type
      direction: ASC
    order:
      - file.name
      - title
      - run
      - size
      - done
`;

const tagNote = (topic) => {
  const [kind, name] = topic.split("/");
  return `---\ntype: tag\ntitle: "${name} (${kind})"\n---\n# ${name}\n\n![[tag.base]]\n`;
};

/** Each tag note the topics need, and the shared base, created in the run's vault when missing; never rewritten. */
function ensureTagNotes(runDir, topics) {
  const parts = path.resolve(runDir).split(path.sep);
  const at = parts.lastIndexOf(".x-skills");
  if (at === -1 || !topics.length) return;
  const vault = parts.slice(0, at + 1).join(path.sep);
  const files = [["tag.base", TAG_BASE], ...topics.map((topic) => [`tags/${topic}.md`, tagNote(topic)])];
  for (const [rel, text] of files.filter(([rel]) => !fs.existsSync(path.join(vault, rel)))) {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  }
}

/**
 * The report is written before the memory and the state, so a write that fails leaves the node where it
 * was. Committing the state first reported failure for a transition that had already happened.
 */
function persist(dir, state, { fromIndex, writeReport }) {
  fs.mkdirSync(dir, { recursive: true });
  if (writeReport) {
    const text = reportTextFor(dir, state);
    const body = upsertScenario(text || `${propertyBlock("analysis", `Analysis · ${runSlug(dir)}`, dir, {}, state.topics ?? [])}# Analysis — ${state.slug}\n`, renderGraphMermaid(state));
    fs.writeFileSync(path.join(dir, state.report), body);
  }
  writeMemory(dir, state, fromIndex);
  fs.writeFileSync(path.join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      out[key] = i + 1 < args.length && !args[i + 1].startsWith("--") ? args[++i] : true;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function usage() {
  return [
    "o-analyze scenario — graph-driven diagnostic state machine.",
    "",
    "Usage:",
    "  node scenario.mjs start --slug <s> [--goal <text>] [--root <dir>]",
    "  node scenario.mjs status --dir <dir>",
    "  node scenario.mjs record --dir <dir> --event <kind> [--data <text>] [--target <id>] [--status <s>] [--reason <r>]",
    "  node scenario.mjs record --dir <dir> --to <node>",
    "  node scenario.mjs guard  --dir <dir> --gate <name>",
    "  node scenario.mjs verify --dir <dir>   # exit 0 iff the stop is justified",
    "",
  ].join("\n");
}

function commandStart(args) {
  if (!args.slug || args.slug === true) throw new Error("--slug is required");
  const root = args.root === true || !args.root ? REPORT_ROOT : args.root;
  const topics = parseTopics(args.topics);
  const state = createState({
    slug: args.slug,
    goal: args.goal === true ? null : args.goal,
    topics,
    root,
    fresh: args["new-run"] === true,
    run: args.run === undefined || args.run === true ? null : Number(args.run),
  });
  const dir = state.runDir;
  persist(dir, state, { fromIndex: 0, writeReport: true });
  ensureTagNotes(dir, topics);
  return { dir, state, node: state.node };
}

function commandRecord(args) {
  if (!args.dir || args.dir === true) throw new Error("--dir is required");
  const before = loadState(args.dir);
  let state = before;
  if (args.event !== undefined) {
    state = applyEvent(state, {
      kind: args.event,
      data: args.data === true ? null : args.data ?? null,
      status: args.status === true ? null : args.status ?? null,
      reason: args.reason === true ? null : args.reason ?? null,
      target: args.target === true ? null : args.target ?? null,
    });
  }
  if (args.to !== undefined) {
    const result = transition(state, args.to, { reportText: reportTextFor(args.dir, state) });
    if (!result.ok) throw new Error(result.error);
    state = result.state;
  }
  persist(args.dir, state, { fromIndex: before.events.length, writeReport: true });
  return { dir: args.dir, state, node: state.node };
}

function commandGuard(args) {
  if (!args.dir || args.dir === true) throw new Error("--dir is required");
  const state = loadState(args.dir);
  const verdict = computeGuards(state, { reportText: reportTextFor(args.dir, state) })[args.gate];
  if (!verdict) throw new Error(`unknown gate "${args.gate}"`);
  process.stdout.write(`${JSON.stringify({ gate: args.gate, ...verdict }, null, 2)}\n`);
  process.exit(verdict.pass ? 0 : 1);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    if (!command || command === "--help" || command === "-h") {
      process.stdout.write(usage());
      return;
    }
    if (command === "start") {
      process.stdout.write(`${JSON.stringify(commandStart(args), null, 2)}\n`);
      return;
    }
    if (command === "status") {
      if (!args.dir || args.dir === true) throw new Error("--dir is required");
      const state = loadState(args.dir);
      process.stdout.write(`${JSON.stringify({ dir: args.dir, state, node: state.node }, null, 2)}\n`);
      return;
    }
    if (command === "record") {
      process.stdout.write(`${JSON.stringify(commandRecord(args), null, 2)}\n`);
      return;
    }
    if (command === "guard") {
      commandGuard(args);
      return;
    }
    if (command === "verify") {
      if (!args.dir || args.dir === true) throw new Error("--dir is required");
      const state = loadState(args.dir);
      const result = verifyState(state, { reportText: reportTextFor(args.dir, state) });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(result.ok ? 0 : 1);
    }
    throw new Error(`unknown command "${command}"`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(err.exitCode ?? 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
