#!/usr/bin/env node
/**
 * Behavioural evals: run a real agent on a fixture repository and check what it left behind.
 *
 * `evals/expectations.json` says what a skill must do; nothing there runs. A case under
 * `skills/<skill>/evals/cases/<case>/` does: `setup.mjs` builds the fixture in an empty directory, `prompt.md` is
 * what the agent is asked, and `check.mjs` inspects the directory afterwards and exits 0 only when the behaviour
 * happened. Every skill is copied into the fixture's `.claude/skills/` (with `.agents/skills/` pointing at it), so
 * the agent finds them the way a project install would — and the cases themselves stay out of its sight.
 *
 * Runs spend model tokens, so this is not part of `npm test`. The agent's tools are limited to file edits and a
 * short list of shell commands, inside a throwaway directory.
 *
 * Usage: node scripts/eval-run.mjs [--skill <name>] [--case <name>] [--keep] [--list]
 *   OTTER_EVAL_AGENT_CMD="<shell command>" replaces the agent; it runs in the fixture with the prompt in
 *   $OTTER_EVAL_PROMPT (the tests use it to drive a scripted agent).
 * Exit: 0 every case passed · 1 a case failed · 2 usage error or no case matched
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = path.join(ROOT, "skills");
const CASE_TIMEOUT_MS = 15 * 60 * 1000;

/** The environment every child gets. A run started inside `node --test` must not make the case's own test runs report to it. */
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

// File edits plus the commands the cases need; anything else is refused in a non-interactive run.
const CLAUDE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Skill", "Bash(git:*)", "Bash(node:*)", "Bash(npm test:*)", "Bash(ls:*)", "Bash(cat:*)"];

function parseArgs(argv) {
  const args = { skill: null, case: null, keep: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skill") args.skill = argv[++i];
    else if (argv[i] === "--case") args.case = argv[++i];
    else if (argv[i] === "--keep") args.keep = true;
    else if (argv[i] === "--list") args.list = true;
    else {
      process.stderr.write(`eval-run: unknown argument ${argv[i]}\n`);
      process.exit(2);
    }
  }
  return args;
}

/** Every case on disk: a directory holding setup.mjs, prompt.md and check.mjs. */
export function findCases(skillsDir = SKILLS) {
  return fs
    .readdirSync(skillsDir)
    .flatMap((skill) => {
      const dir = path.join(skillsDir, skill, "evals", "cases");
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).map((name) => ({ skill, name, dir: path.join(dir, name) }));
    })
    .filter(({ dir }) => ["setup.mjs", "prompt.md", "check.mjs"].every((file) => fs.existsSync(path.join(dir, file))))
    .sort((a, b) => `${a.skill}/${a.name}`.localeCompare(`${b.skill}/${b.name}`));
}

/**
 * A copy, not a link: a sandboxed agent may not read outside its working directory, and a skill that cannot reach
 * its sibling's script is not the skill a project install runs. `.agents/skills` links to the copy beside it.
 */
function installSkills(fixture) {
  const copy = path.join(fixture, ".claude", "skills");
  fs.cpSync(SKILLS, copy, { recursive: true, filter: (source) => !source.includes(`${path.sep}evals${path.sep}cases`) });
  fs.mkdirSync(path.join(fixture, ".agents"), { recursive: true });
  fs.symlinkSync(path.join("..", ".claude", "skills"), path.join(fixture, ".agents", "skills"));
  const exclude = path.join(fixture, ".git", "info", "exclude");
  if (fs.existsSync(path.dirname(exclude))) fs.appendFileSync(exclude, "\n.claude/\n.agents/\n");
}

function runAgent(fixture, prompt, transcript) {
  const custom = process.env.OTTER_EVAL_AGENT_CMD;
  const [command, args, shell] = custom
    ? [custom, [], true]
    : // --strict-mcp-config with no --mcp-config: the agent gets none of the user's MCP servers, so a case passes or
      // fails on the skill and not on whoever's machine ran it.
      ["claude", ["-p", prompt, "--permission-mode", "acceptEdits", "--strict-mcp-config", "--allowedTools", ...CLAUDE_TOOLS], false];
  const result = spawnSync(command, args, {
    cwd: fixture,
    shell,
    env: childEnv({ OTTER_EVAL_PROMPT: prompt }),
    encoding: "utf8",
    timeout: CASE_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.writeFileSync(transcript, `${result.stdout ?? ""}\n--- stderr ---\n${result.stderr ?? ""}`);
  if (result.error) return { problem: `the agent could not run: ${result.error.message}` };
  if (result.status === 0) return { problem: null };
  const limit = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(USAGE_LIMIT);
  return limit ? { problem: `the agent never started: ${limit[0]}`, notRun: true } : { problem: `the agent exited ${result.status}` };
}

/**
 * A host that refuses to run — a usage or rate limit — says nothing about the skill, so a case it stops is reported
 * as not run, never as failed: a FAIL there sends someone hunting a bug in a skill that was never exercised.
 */
const USAGE_LIMIT = /hit your (?:session|usage|weekly|daily) limit[^\n]*|usage limit (?:reached|exceeded)[^\n]*|rate limit(?:ed| exceeded)[^\n]*/i;

/** One case, start to finish: a fresh fixture, the agent, the check. Returns what the check said. */
export function runCase(entry, { keep = false } = {}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), `otter-eval-${entry.skill}-`));
  const transcript = path.join(os.tmpdir(), `${path.basename(fixture)}.log`);
  const node = (script, env = {}) =>
    spawnSync(process.execPath, [path.join(entry.dir, script)], { cwd: fixture, encoding: "utf8", env: childEnv(env) });

  const setup = node("setup.mjs");
  if (setup.status !== 0) return { ...entry, passed: false, detail: `setup failed: ${setup.stderr.trim()}`, fixture };
  installSkills(fixture);

  const agent = runAgent(fixture, fs.readFileSync(path.join(entry.dir, "prompt.md"), "utf8"), transcript);
  if (agent.notRun) return { ...entry, passed: false, notRun: true, detail: agent.problem, fixture, transcript };
  const agentProblem = agent.problem;
  const check = node("check.mjs", { OTTER_EVAL_TRANSCRIPT: transcript });
  const passed = check.status === 0;
  const detail = [agentProblem, check.stdout.trim(), check.stderr.trim()].filter(Boolean).join("\n");
  if (passed && !keep) fs.rmSync(fixture, { recursive: true, force: true });
  return { ...entry, passed, detail, fixture: passed && !keep ? null : fixture, transcript };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = findCases().filter((c) => (!args.skill || c.skill === args.skill) && (!args.case || c.name === args.case));
  if (args.list) {
    for (const c of cases) process.stdout.write(`${c.skill}/${c.name}\n`);
    return;
  }
  if (!cases.length) {
    process.stderr.write("eval-run: no case matched\n");
    process.exit(2);
  }

  const results = cases.map((entry) => {
    process.stderr.write(`eval-run: ${entry.skill}/${entry.name} ...\n`);
    const result = runCase(entry, args);
    const verdict = result.passed ? "PASS" : result.notRun ? "NOT RUN" : "FAIL";
    process.stderr.write(`eval-run: ${verdict} ${entry.skill}/${entry.name}\n${result.passed ? "" : `${result.detail}\n`}`);
    return result;
  });
  const summary = results.map(({ skill, name, passed, notRun, detail, fixture, transcript }) => ({ case: `${skill}/${name}`, passed, ...(notRun ? { notRun } : {}), detail, fixture, transcript }));
  const notRun = results.filter((r) => r.notRun).length;
  process.stdout.write(`${JSON.stringify({ passed: results.filter((r) => r.passed).length, notRun, total: results.length, results: summary }, null, 2)}\n`);
  // 1 a case failed · 2 none failed but some never ran · 0 every case passed.
  if (results.some((r) => !r.passed && !r.notRun)) process.exitCode = 1;
  else if (notRun) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
