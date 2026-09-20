#!/usr/bin/env node
/**
 * x-autoreflection hunt-issues — ask a model which skill behaviours keep going wrong.
 *
 * A script cannot find these: nobody knows in advance what a user will have to correct. The scanner's
 * lexicons catch the phrasings someone thought of; a model reading every user turn next to what the
 * agent did before it catches the rest — and it is the only thing that can name a theme no one listed.
 *
 * This script does what no model can do for itself: it assembles the material from the real transcripts
 * (each user turn, the reply before it, the skills in flight, and the exact session#message to cite),
 * and it verifies the model's answer back against those transcripts before the report can use it. A
 * claim whose quote is not in the transcript, or that only one session makes, is dropped with a reason.
 *
 * Usage:
 *   node hunt-issues.mjs --build --hours 240 --out <run dir>   # writes <run dir>/E<nn>-issues-prompt*.md
 *   <model> < <run dir>/E<nn>-issues-prompt-01.md > answers.md # any model; the host owns the choice
 *   node hunt-issues.mjs --read answers.md --dir <run dir>     # verifies, writes E<nn>-issues.json
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hostById } from "./hosts/index.mjs";
import { hostContext, listHostSessions, normalizeSession, parseArgs, selectedHosts } from "./read-session.mjs";
import { requestOf, userTurns } from "./reactions.mjs";
import { skillNamesOnDisk } from "./scan-session.mjs";

export const SCHEMA = "x-autoreflection-issues/1";

const BEFORE_CHARS = 400;
const TURN_CHARS = 600;
const SESSIONS_PER_CHUNK = 10;
const MIN_WORDS = 3;
const MIN_SESSIONS = 2;
const MAX_TURNS_PER_SESSION = 40;

const INJECTED =
  /^(Base directory for this skill:|<|\[|\(Re-invocation|You label user messages|Caveat:|Continue from where you left off)/;

/**
 * The prompt. It carries no list of known problems on purpose: naming the kinds is the model's job, and
 * a list would make it find what the list says instead. What the prompt does fix is the evidence bar —
 * every issue cites a session, a message number and a quote that is really there — and that a theme
 * counts only when more than one session shows it, so one bad afternoon is not a finding.
 */
export const RUBRIC = [
  "You review transcripts of an AI coding agent working with a human, to find SKILL BEHAVIOURS that keep going wrong.",
  "A skill is an instruction file the agent follows (x-plan, x-fix, x-ui, x-commit, x-analyze, x-review, x-research, ...). Each session header names the skills that were loaded in it.",
  "Read every USER turn with the end of the agent's reply before it. Look for the same complaint, correction or instruction appearing in MORE THAN ONE SESSION — the user having to repeat themselves is the signal. Weigh especially:",
  "- the user correcting the agent's output or its behaviour (wrong, incomplete, not what was asked, too long, too eager, ignores a rule),",
  "- the user stating a rule the agent should already have followed, or restating one from a previous session,",
  "- the user having to intervene because the agent stalled, blocked, or asked for something it did not need,",
  "- the user asking for work the agent had already been told to do in an earlier session.",
  "Report ONE issue per theme. A theme is one thing going wrong, stated the way the user states it, not a category of problem.",
  "For each issue give: the theme in one sentence; the skill to fix (the one whose instructions caused it, from the header or the agent's command — use null if truly none); the refs it appears in; a short VERBATIM quote for each ref; what the skill should do instead; severity high|medium|low.",
  `An issue needs at least ${MIN_SESSIONS} different sessions. One session is not a recurring issue, however loud.`,
  "Ignore anything that is not about how the agent or a skill behaves: one-off tasks, environment failures, the user's own typos, and the agent's final answers being merely long.",
  "Answer as JSON lines and nothing else, one object per line:",
  '{"issue":"...","skill":"x-plan","refs":["crush:abc123#12","claude:def456#3"],"evidence":[{"ref":"crush:abc123#12","quote":"..."}],"instead":"...","severity":"high"}',
].join("\n");

/** The reply the user is reacting to: the last assistant turn before their message. */
function replyBefore(messages, index) {
  const reply = messages
    .slice(0, index)
    .filter((message) => message.role === "assistant" && textOf(message))
    .pop();
  return reply ? textOf(reply).slice(-BEFORE_CHARS) : "";
}

function textOf(message) {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One session's material: who it was, which skills were in flight, and every user turn that reacts to
 * the agent (the opening request is the task, not a correction, so it is left out).
 */
export function digest(session) {
  const messages = session.messages ?? [];
  const request = requestOf(messages);
  const turns = userTurns(messages)
    .filter((turn) => turn.index > (request?.message ?? -1) && turn.text.split(/\s+/).filter(Boolean).length >= MIN_WORDS)
    .filter((turn) => !INJECTED.test(turn.text))
    .slice(0, MAX_TURNS_PER_SESSION)
    .map((turn) => ({
      message: turn.index,
      user: turn.text.slice(0, TURN_CHARS),
      before: replyBefore(messages, turn.index),
    }));
  return {
    key: `${session.source?.host ?? "?"}:${session.source?.id ?? session.source?.uuid ?? "?"}`,
    model: session.model ?? null,
    skills: session.skills?.map((skill) => skill.name) ?? [],
    request: request?.text ?? null,
    turns,
  };
}

export function buildPrompt(digests) {
  const blocks = digests
    .filter((entry) => entry.turns.length)
    .map((entry) => {
      const header = `## session ${entry.key}  (model ${entry.model ?? "?"}; skills in play: ${entry.skills.join(", ") || "none named"})`;
      const request = entry.request ? `   opening request: ${entry.request.replace(/\s+/g, " ").slice(0, 300)}` : "";
      const turns = entry.turns
        .map(
          (turn) =>
            `   [${entry.key}#${turn.message}] agent said: "${turn.before.replace(/"/g, "'")}"\n      USER: ${turn.user}`
        )
        .join("\n");
      return [header, request, turns].filter(Boolean).join("\n");
    });
  return `${RUBRIC}\n\nSessions:\n\n${blocks.join("\n\n")}\n`;
}

export function chunk(digests, size = SESSIONS_PER_CHUNK) {
  const withTurns = digests.filter((entry) => entry.turns.length);
  const chunks = [];
  for (let i = 0; i < withTurns.length; i += size) chunks.push(withTurns.slice(i, i + size));
  return chunks.length ? chunks : [[]];
}

/**
 * The model's answer as issue objects. Anything that is not one parseable JSON line with the required
 * fields is reported, not silently dropped: a model that answered in prose must be visible as that.
 */
export function parseIssues(text) {
  const issues = [];
  const unreadable = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("{")) {
      if (unreadable.length < 20) unreadable.push(trimmed.slice(0, 120));
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed.issue || !Array.isArray(parsed.refs)) {
        unreadable.push(trimmed.slice(0, 120));
        continue;
      }
      issues.push(parsed);
    } catch {
      unreadable.push(trimmed.slice(0, 120));
    }
  }
  return { issues, unreadable };
}

const normalize = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Keep only what the window can prove: the ref must exist, its quote must be in that session's turn or
 * in the reply the user was reacting to, and the theme must span at least two sessions. Everything else
 * comes back as `dropped` with the rule it broke, so the report can say what the model claimed and why
 * it did not count — the alternative is a confident report built on quotes nobody checked.
 */
export function verifyIssues(issues, digests, { knownSkills = null, minSessions = MIN_SESSIONS } = {}) {
  const index = new Map();
  for (const entry of digests) {
    for (const turn of entry.turns) {
      index.set(`${entry.key}#${turn.message}`, { session: entry.key, ...turn });
    }
  }
  const kept = [];
  const dropped = [];
  for (const issue of issues) {
    const refs = [...new Set((issue.refs ?? []).map(String))];
    const unknown = refs.filter((ref) => !index.has(ref));
    const checks = (issue.evidence ?? []).map((item) => {
      const turn = index.get(String(item?.ref ?? ""));
      if (!turn) return { ref: String(item?.ref ?? ""), ok: false, why: "not a turn in this window" };
      const quote = normalize(item?.quote);
      const where = normalize(`${turn.user} ${turn.before}`);
      const ok = quote.length >= 12 && where.includes(quote);
      return { ref: String(item.ref), ok, why: ok ? null : "the quote is not in that turn" };
    });
    const sessions = [...new Set(refs.filter((ref) => index.has(ref)).map((ref) => index.get(ref).session))];
    const badQuotes = checks.filter((check) => !check.ok);
    if (unknown.length) dropped.push({ issue: issue.issue, why: `ref not in the window: ${unknown.slice(0, 3).join(", ")}` });
    else if (badQuotes.length) dropped.push({ issue: issue.issue, why: `${badQuotes.length} quote(s) unverified: ${badQuotes.map((check) => check.ref).join(", ")}` });
    else if (sessions.length < minSessions) dropped.push({ issue: issue.issue, why: `only ${sessions.length} session(s) shows it` });
    else if (knownSkills && issue.skill && !knownSkills.includes(issue.skill)) dropped.push({ issue: issue.issue, why: `unknown skill "${issue.skill}"` });
    else kept.push({ ...issue, refs, sessions, checks });
  }
  return { kept, dropped };
}

/** A kept issue in the shape the report's findings use, so the two mix without a second renderer. */
export function toFinding(issue, { id, improvement = null } = {}) {
  return {
    id,
    kind: "recurring-issue",
    class: issue.skill ? "missing-expectation" : "rule-not-applied",
    skill: issue.skill ?? null,
    severity: ["high", "medium", "low"].includes(issue.severity) ? issue.severity : "medium",
    recurrence: issue.sessions.length,
    count: issue.evidence?.length ?? issue.sessions.length,
    summary: String(issue.issue).slice(0, 300),
    change: String(issue.instead ?? "").slice(0, 300),
    sessions: issue.sessions,
    evidence: (issue.evidence ?? []).map((item) => ({ session: String(item.ref).split("#")[0], message: Number(String(item.ref).split("#")[1]), excerpt: String(item.quote).slice(0, 300) })),
    detector: "model",
    ...(improvement ? { improvement } : {}),
  };
}

function writeIfRoom(base, index, text) {
  const file = `${base}-${String(index).padStart(2, "0")}.md`;
  fs.writeFileSync(file, text);
  return file;
}

function runBuild(args) {
  const hours = Number(args.hours ?? 240) || 240;
  const max = Number(args.max ?? 60) || 60;
  const ctx = hostContext({ hours });
  const listed = listHostSessions({ only: selectedHosts(args.host ?? null), ctx });
  const skills = skillNamesOnDisk(typeof args["skills-dir"] === "string" ? args["skills-dir"] : null);
  const digests = [];
  const warnings = [];
  for (const session of listed.sessions.slice(0, max)) {
    const adapter = hostById(session.host);
    if (!adapter) continue;
    try {
      digests.push(digest(normalizeSession(adapter.read(session, ctx), { limit: 600 })));
    } catch (err) {
      if (warnings.length < 20) warnings.push({ session: `${session.host}:${session.id}`, reason: String(err.message).slice(0, 120) });
    }
  }
  const dir = path.resolve(args.out ?? path.join(".x-skills", "runs"));
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, "E00-issues-prompt");
  const files = chunk(digests).map((group, i) => writeIfRoom(base, i + 1, buildPrompt(group)));
  const index = path.join(dir, "E00-issues-index.json");
  fs.writeFileSync(
    index,
    `${JSON.stringify({ schema: SCHEMA, generatedAt: new Date().toISOString(), hours, sessions: digests.length, prompts: files, digests }, null, 2)}\n`
  );
  return {
    prompts: files,
    index,
    sessions: digests.length,
    turns: digests.reduce((sum, entry) => sum + entry.turns.length, 0),
    skills: skills.names.length,
    warnings,
  };
}

function runRead(args) {
  const dir = path.resolve(args.dir ?? ".");
  const indexFile = typeof args.index === "string" ? args.index : path.join(dir, "E00-issues-index.json");
  const { digests, prompts } = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  const skills = skillNamesOnDisk(typeof args["skills-dir"] === "string" ? args["skills-dir"] : null);
  const { issues, unreadable } = parseIssues(fs.readFileSync(args.read, "utf8"));
  const { kept, dropped } = verifyIssues(issues, digests, { knownSkills: skills.names });
  const findings = kept.map((issue, i) => toFinding(issue, { id: `I${i + 1}` }));
  const out = path.join(dir, "E00-issues.json");
  fs.writeFileSync(out, `${JSON.stringify({ schema: SCHEMA, source: args.read, prompts, findings, dropped, unreadable }, null, 2)}\n`);
  return {
    out,
    claims: issues.length,
    kept: findings.length,
    dropped: dropped.length,
    unreadable: unreadable.length,
    findings: findings.map((finding) => ({ id: finding.id, skill: finding.skill, severity: finding.severity, recurrence: finding.recurrence, summary: finding.summary })),
    reasons: dropped.map((entry) => entry.why),
  };
}

function usage() {
  return [
    "x-autoreflection hunt-issues — assemble the window's turns, then verify what a model made of them.",
    "",
    "Usage:",
    "  node hunt-issues.mjs --build [--hours 240] [--max 60] [--out <run dir>]",
    "  node hunt-issues.mjs --read <answers.md> [--dir <run dir>] [--index <file>]",
    "",
    "Flags:",
    "  --build          Walk the window's sessions and write the prompt(s) + the index",
    "  --read <file>    Verify a model's answers against the index and write E00-issues.json",
    "  --hours <n>      Window to assemble (default: 240)",
    "  --max <n>        Sessions to read (default: 60)",
    "  --dir <dir>      Run folder holding the index (default: .)",
    "  --out <dir>      Where --build writes (default: .x-skills/runs)",
    "  --help           Show this help",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2), { booleans: ["build", "help"], known: ["build", "read", "dir", "index", "out", "hours", "max", "skills-dir", "help"] });
  try {
    if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
    if (args.help || (!args.build && typeof args.read !== "string")) return process.stdout.write(usage());
    const result = args.build ? runBuild(args) : runRead(args);
    return process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
