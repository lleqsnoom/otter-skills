#!/usr/bin/env node
/**
 * o-autoreflection hunt-issues — ask a model which skill behaviours keep going wrong.
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
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hostById } from "./hosts/index.mjs";
import { hostContext, listHostSessions, normalizeSession, parseArgs, selectedHosts } from "./read-session.mjs";
import { ownerAt, ownerTimeline, requestOf, userTurns } from "./reactions.mjs";
import { redact } from "./redact.mjs";
import { skillNamesOnDisk } from "./scan-session.mjs";

export const SCHEMA = "o-autoreflection-issues/1";

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
  "A skill is an instruction file the agent follows (o-plan, o-fix, o-ui, o-commit, o-analyze, o-review, o-research, ...). Each session header names the skills that were loaded in it.",
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
  '{"issue":"...","skill":"o-plan","refs":["crush:abc123#12","claude:def456#3"],"evidence":[{"ref":"crush:abc123#12","quote":"..."}],"instead":"...","severity":"high"}',
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
  const loaded = (session.skills ?? []).map((skill) => skill.name);
  // A turn belongs to the skill whose step produced the reply the user reacted to, not to every skill the
  // session happened to load — the same attribution the scanner uses, so a per-skill prompt carries that
  // skill's turns instead of every turn of a session it merely appeared in.
  const timeline = ownerTimeline(messages, (names) => names.filter((name) => /^o-[a-z0-9-]+$/.test(name)));
  const fallback = loaded.length === 1 ? loaded[0] : null;
  const turns = userTurns(messages)
    .filter((turn) => turn.index > (request?.message ?? -1) && turn.text.split(/\s+/).filter(Boolean).length >= MIN_WORDS)
    .filter((turn) => !INJECTED.test(turn.text))
    .slice(0, MAX_TURNS_PER_SESSION)
    // Redacted here, once: the prompts, the index on disk and the quote check all read these strings, so a model
    // never sees a pasted secret and a quote of the redacted text still verifies.
    .map((turn) => ({
      message: turn.index,
      user: redact(turn.text.slice(0, TURN_CHARS)),
      before: redact(replyBefore(messages, turn.index)),
      owner: ownerAt(timeline, turn.index, fallback),
    }));
  return {
    key: `${session.source?.host ?? "?"}:${session.source?.id ?? session.source?.uuid ?? "?"}`,
    model: session.model ?? null,
    skills: loaded,
    request: request ? redact(request.text) : null,
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
 * The window inverted, and the pass the skill exists for: improve the `SKILL.md` of the skills the window
 * actually used. The session-first rubric asks what recurs; this one puts one skill's own instruction file
 * in the model's hands beside the turns where that skill was in play, and asks which line should say
 * something else. That makes the fix a delta on a file instead of a theme nobody owns, and `--read`
 * checks it the same way: the quoted line must really be in that `SKILL.md`, and every ref must come from
 * a session where the skill was used.
 */
export const SKILL_RUBRIC = [
  "You are improving ONE skill's instruction file, using transcripts of an AI coding agent that followed it.",
  "The file is given in full below, then every turn of the sessions where this skill was in play: what the agent had just said, and what the human said in reply.",
  "Your job is the file. Find the places where the human had to correct, restate or work around the agent's behaviour — the turns where the file should have said something it does not — and propose the line that would have prevented it.",
  `A proposal needs at least ${MIN_SESSIONS} different sessions. One bad afternoon is not a rule.`,
  "Prefer the smallest change: an existing line rewritten, or one line added where the file already has a section for it.",
  "Quote the line you are changing EXACTLY as it appears in the file, or set \"new\": true when the file has no line for it at all.",
  "Ignore anything that is not this skill's business: one-off tasks, environment failures, the user's own typos, and answers that were merely long.",
  "Answer as JSON lines and nothing else, one object per line:",
  '{"skill":"o-review","issue":"the complaint in one sentence","line":"the exact line from the file","new":false,"refs":["crush:abc123#12","claude:def456#3"],"evidence":[{"ref":"crush:abc123#12","quote":"..."}],"instead":"the instruction to write in its place","severity":"high"}',
].join("\n");

/**
 * Which skills the window used, and the turns each one was in charge of. A turn belongs to the skill in
 * charge of it, and to any skill the user named in it — "run o-review again" is direct evidence about
 * which file the complaint is for. A turn with no owner (a session with several skills loaded and nothing
 * to say which step produced the reply) belongs to no prompt: it would otherwise appear under every skill
 * the session touched, and each file would be read against turns that have nothing to do with it.
 */
export function usageBySkill(digests) {
  const usage = new Map();
  for (const entry of digests) {
    for (const turn of entry.turns ?? []) {
      const owners = new Set([turn.owner, ...String(turn.user ?? "").match(/\bo-[a-z0-9-]+\b/g) ?? []].filter(Boolean));
      for (const owner of owners) {
        if (!usage.has(owner)) usage.set(owner, { skill: owner, sessions: new Set(), turns: [] });
        const bucket = usage.get(owner);
        bucket.sessions.add(entry.key);
        bucket.turns.push({ key: entry.key, message: turn.message, user: turn.user, before: turn.before });
      }
    }
  }
  return usage;
}

const skillFile = (name, skillsDir) => path.join(skillsDir, name, "SKILL.md");

/** One skill's prompt: the file, then the turns, grouped by session. */
export function buildSkillPrompt(usage, { skillsDir = "skills" } = {}) {
  const file = skillFile(usage.skill, skillsDir);
  const body = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "(the file is missing)";
  const blocks = [];
  for (const turn of usage.turns) {
    if (!blocks.length || blocks[blocks.length - 1].key !== turn.key) blocks.push({ key: turn.key, turns: [] });
    blocks[blocks.length - 1].turns.push(turn);
  }
  const used = blocks
    .map((block) =>
      [
        `### session ${block.key}`,
        ...block.turns.map(
          (turn) => `   [${turn.key}#${turn.message}] the agent had just said: "${turn.before.replace(/"/g, "'")}"\n      I SAID: ${turn.user}`
        ),
      ].join("\n")
    )
    .join("\n\n");
  return `${SKILL_RUBRIC}\n\n## the file under review — ${file}\n\n\`\`\`markdown\n${body}\n\`\`\`\n\n## how it was used — ${usage.sessions.size} session(s) had ${usage.skill} in play\n\n${used}\n`;
}

/** The skills worth a prompt: used in at least two sessions, most-used first, and really on disk. */
export function skillPrompts(digests, { skillsDir = "skills", limit = 12 } = {}) {
  return [...usageBySkill(digests).values()]
    .filter((usage) => usage.turns.length && usage.sessions.size >= MIN_SESSIONS && fs.existsSync(skillFile(usage.skill, skillsDir)))
    .sort((a, b) => b.sessions.size - a.sessions.size || a.skill.localeCompare(b.skill))
    .slice(0, limit)
    .map((usage) => ({ skill: usage.skill, sessions: [...usage.sessions].sort(), prompt: buildSkillPrompt(usage, { skillsDir }) }));
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
/** Every turn of the window by its `session#message`, which is what an answer's refs are resolved against. */
function turnIndex(digests) {
  const index = new Map();
  for (const entry of digests) {
    for (const turn of entry.turns) index.set(`${entry.key}#${turn.message}`, { session: entry.key, ...turn });
  }
  return index;
}

export function verifyIssues(issues, digests, { knownSkills = null, minSessions = MIN_SESSIONS } = {}) {
  const index = turnIndex(digests);
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

/**
 * The skill-first bar. Same rules as the session pass — the refs exist, the quotes are verbatim, two
 * sessions show it — plus the two this pass is for: every ref comes from a session where the skill was
 * actually in play, and the line the fix changes is really in that skill's `SKILL.md` (unless the answer
 * says `new`, meaning the file has nothing for it). An accepted issue is therefore a delta on a file.
 */
export function verifySkillIssues(issues, digests, { skillsDir = "skills", knownSkills = null, minSessions = MIN_SESSIONS } = {}) {
  const index = turnIndex(digests);
  const usage = usageBySkill(digests);
  const kept = [];
  const dropped = [];
  for (const issue of issues) {
    const name = typeof issue.skill === "string" ? issue.skill.trim() : "";
    const refs = [...new Set((issue.refs ?? []).map(String))];
    const checks = (issue.evidence ?? []).map((item) => {
      const turn = index.get(String(item?.ref ?? ""));
      if (!turn) return { ref: String(item?.ref ?? ""), ok: false, why: "not a turn in this window" };
      const quote = normalize(item?.quote);
      const ok = quote.length >= 12 && normalize(`${turn.user} ${turn.before}`).includes(quote);
      return { ref: String(item.ref), ok, why: ok ? null : "the quote is not in that turn" };
    });
    const badQuotes = checks.filter((check) => !check.ok);
    const unknown = refs.filter((ref) => !index.has(ref));
    const bucket = name ? usage.get(name) ?? null : null;
    const sessions = [...new Set(refs.filter((ref) => index.has(ref)).map((ref) => index.get(ref).session))];
    const offSkill = bucket ? sessions.filter((session) => !bucket.sessions.has(session)) : [];
    const file = name ? skillFile(name, skillsDir) : null;
    const body = file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const line = String(issue.line ?? "").trim();
    if (!name) dropped.push({ issue: issue.issue, why: "no skill named" });
    else if (knownSkills && !knownSkills.includes(name)) dropped.push({ issue: issue.issue, why: `unknown skill "${name}"` });
    else if (!bucket) dropped.push({ issue: issue.issue, why: `${name} was not used in this window` });
    else if (unknown.length) dropped.push({ issue: issue.issue, why: `ref not in the window: ${unknown.slice(0, 3).join(", ")}` });
    else if (offSkill.length) dropped.push({ issue: issue.issue, why: `${offSkill.length} ref(s) come from a session where ${name} was not in play: ${offSkill.slice(0, 3).join(", ")}` });
    else if (badQuotes.length) dropped.push({ issue: issue.issue, why: `${badQuotes.length} quote(s) unverified: ${badQuotes.map((check) => check.ref).join(", ")}` });
    else if (sessions.length < minSessions) dropped.push({ issue: issue.issue, why: `only ${sessions.length} session(s) shows it` });
    else if (issue.new !== true && (!line || !normalize(body).includes(normalize(line)))) {
      dropped.push({ issue: issue.issue, why: line ? `the quoted line is not in ${file}` : "no SKILL.md line quoted" });
    } else if (!String(issue.instead ?? "").trim()) dropped.push({ issue: issue.issue, why: "no instruction proposed in its place" });
    else kept.push({ ...issue, skill: name, line, refs, sessions, checks });
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
    ...(issue.line !== undefined || issue.new !== undefined ? { skill_line: String(issue.line ?? ""), skill_new: issue.new === true } : {}),
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
  const skillsDir = skills.dir ?? "skills";
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
  const dir = path.resolve(args.out ?? path.join(".o-skills", "runs"));
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, "E00-issues-prompt");
  const files = chunk(digests).map((group, i) => writeIfRoom(base, i + 1, buildPrompt(group)));
  const skillFiles = skillPrompts(digests, { skillsDir }).map((entry) => {
    const file = path.join(dir, `E00-skill-${entry.skill}-prompt.md`);
    fs.writeFileSync(file, entry.prompt);
    return { skill: entry.skill, sessions: entry.sessions, file };
  });
  const index = path.join(dir, "E00-issues-index.json");
  fs.writeFileSync(
    index,
    `${JSON.stringify({ schema: SCHEMA, generatedAt: new Date().toISOString(), hours, sessions: digests.length, prompts: files, skillPrompts: skillFiles, digests }, null, 2)}\n`
  );
  return {
    prompts: files,
    skillPrompts: skillFiles,
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
  const bySkill = args["by-skill"] === true;
  const { kept, dropped } = bySkill
    ? verifySkillIssues(issues, digests, { skillsDir: skills.dir ?? "skills", knownSkills: skills.names })
    : verifyIssues(issues, digests, { knownSkills: skills.names });
  const findings = kept.map((issue, i) => toFinding(issue, { id: `${bySkill ? "S" : "I"}${i + 1}` }));
  const out = path.join(dir, bySkill ? "E00-skill-issues.json" : "E00-issues.json");
  fs.writeFileSync(out, `${JSON.stringify({ schema: SCHEMA, source: args.read, mode: bySkill ? "skill" : "session", prompts, findings, dropped, unreadable }, null, 2)}\n`);
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

/** One prompt through the model command, prompt on stdin, answer from stdout, bounded in time. */
function askModel(command, promptFile, answerFile) {
  const result = spawnSync(command, {
    shell: true,
    input: fs.readFileSync(promptFile, "utf8"),
    encoding: "utf8",
    timeout: MODEL_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`model command failed on ${path.basename(promptFile)}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`model command exited ${result.status} on ${path.basename(promptFile)}: ${String(result.stderr).slice(0, 300)}`);
  fs.writeFileSync(answerFile, result.stdout);
  return answerFile;
}

const MODEL_TIMEOUT_MS = 15 * 60 * 1000;

/** The model pass end to end: build, ask the model once per prompt, verify both kinds of answer. */
function runAll(args) {
  const command = args["model-cmd"];
  if (typeof command !== "string" || !command.trim()) throw new Error("--run needs --model-cmd \"<command that reads a prompt on stdin>\"");
  const built = runBuild(args);
  const dir = path.dirname(built.index);
  const ask = (files, name) => {
    const answers = files.map((file) => askModel(command, file, file.replace(/-prompt(-\d+)?\.md$/, "-answers$1.md")));
    const combined = path.join(dir, name);
    fs.writeFileSync(combined, answers.map((file) => fs.readFileSync(file, "utf8")).join("\n\n"));
    return combined;
  };
  const session = built.prompts.length ? runRead({ ...args, dir, read: ask(built.prompts, "E00-issues-answers.md"), "by-skill": false }) : null;
  const skill = built.skillPrompts.length
    ? runRead({ ...args, dir, read: ask(built.skillPrompts.map((entry) => entry.file), "E00-skill-answers.md"), "by-skill": true })
    : null;
  return { build: built, session, skill, issues: [session?.out, skill?.out].filter(Boolean) };
}

function usage() {
  return [
    "o-autoreflection hunt-issues — assemble the window's turns, then verify what a model made of them.",
    "",
    "Usage:",
    "  node hunt-issues.mjs --run --model-cmd \"claude -p\" [--hours 240] [--out <run dir>]   # build, ask, verify",
    "  node hunt-issues.mjs --build [--hours 240] [--max 60] [--out <run dir>]",
    "  node hunt-issues.mjs --read <answers.md> [--dir <run dir>] [--index <file>] [--by-skill]",
    "",
    "Flags:",
    "  --run            --build, then send every prompt to --model-cmd and verify the answers (both passes)",
    "  --model-cmd <c>  A shell command that reads a prompt on stdin and prints the answer: claude -p, codex exec -",
    "  --build          Walk the window's sessions and write the prompt(s), the per-skill prompts and the index",
    "  --read <file>    Verify a model's answers against the index and write E00-issues.json (E00-skill-issues.json with --by-skill)",
    "  --by-skill       Read answers to the per-skill prompts: the SKILL.md pass, where a fix must quote the line it changes",
    "  --hours <n>      Window to assemble (default: 240)",
    "  --max <n>        Sessions to read (default: 60)",
    "  --dir <dir>      Run folder holding the index (default: .)",
    "  --out <dir>      Where --build writes (default: .o-skills/runs)",
    "  --help           Show this help",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    booleans: ["build", "run", "help", "by-skill"],
    known: ["build", "run", "model-cmd", "read", "dir", "index", "out", "hours", "max", "host", "skills-dir", "by-skill", "help"],
  });
  try {
    if (args.unknown.length) throw new Error(`Unknown argument "${args.unknown[0]}"`);
    if (args.help || (!args.build && !args.run && typeof args.read !== "string")) return process.stdout.write(usage());
    const result = args.run ? runAll(args) : args.build ? runBuild(args) : runRead(args);
    return process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
