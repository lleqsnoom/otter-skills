#!/usr/bin/env node
/**
 * O-Parallel — Parallel Background Coding Agents
 *
 * Dispatches independent markdown tasks to full background agent processes,
 * each in an isolated git worktree. Merges committed results back into the
 * current branch. Zero dependencies (node built-ins only).
 *
 * Usage: node parallel.mjs --tasks <dir> [--parallel N] [--timeout-min N]
 *                          [--agent crush|claude|codex | --agent-cmd "<command with {prompt}>"]
 *                          [--keep-worktrees] [--no-merge] [--dry-run]
 *                          [--rights inherit|none] [--prompt "<text>"]
 */

import { spawn, execSync, execFileSync } from "node:child_process";
import { readdir, readFile, writeFile, mkdir, rm, appendFile, copyFile } from "node:fs/promises";
import { existsSync, createWriteStream, realpathSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename, dirname, resolve, delimiter } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function arg(name, def) {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1];
  }
  return def;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const TASK_DIR = arg("tasks", "");
const PARALLEL = parseInt(arg("parallel", "4"), 10);
const TIMEOUT_MIN = parseInt(arg("timeout-min", "30"), 10);
const AGENT_ARG = arg("agent", "");
const AGENT_CMD = arg("agent-cmd", "");
const NO_MERGE = hasFlag("no-merge");
const KEEP_WORKTREES = hasFlag("keep-worktrees");
const DRY_RUN = hasFlag("dry-run");
const RETRIES = parseInt(arg("retries", "1"), 10); // extra attempts after the first failure
const RIGHTS = hasFlag("no-rights") ? "none" : arg("rights", "inherit");
const RIGHTS_MODES = ["inherit", "none"];
const TASK_FILE = "TASK.md";
// Crush discovers project config by walking up from cwd, never past the git
// working-tree root. A worktree is its own root, so a worker only sees global
// config unless these files travel with it.
const PARENT_CONFIG_NAMES = [".crushrc", "crushrc", ".crush.json", "crush.json"];

/**
 * How each worker CLI takes a prompt and which untracked project files carry the user's rights for it. A tracked
 * config is already in every worktree; only the local, untracked ones need copying.
 */
export const AGENT_PRESETS = {
  crush: { command: "crush", args: (prompt) => ["run", prompt], configs: PARENT_CONFIG_NAMES },
  claude: {
    command: "claude",
    args: (prompt) => [
      "-p", prompt, "--permission-mode", "acceptEdits",
      "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash(git:*)", "Bash(node:*)", "Bash(npm:*)", "Bash(npx:*)", "Bash(pnpm:*)", "Bash(yarn:*)",
    ],
    configs: [".claude/settings.local.json"],
  },
  codex: { command: "codex", args: (prompt) => ["exec", "--full-auto", prompt], configs: [] },
};

/** On PATH, without a shell: `command -v` would need one, so each directory is checked instead. */
function onPath(command, pathVar = process.env.PATH ?? "") {
  return pathVar.split(delimiter).some((dir) => dir && existsSync(join(dir, command)));
}

/** The first worker CLI this machine has, in preset order; crush when none is found, so the error names a CLI. */
export function defaultAgent(has = onPath) {
  return Object.keys(AGENT_PRESETS).find((name) => has(AGENT_PRESETS[name].command)) ?? "crush";
}

/**
 * The process a worker runs as. `--agent-cmd` is a shell template where `{prompt}` stands for the prompt; the
 * prompt itself travels in $OTTER_PROMPT, so nothing in it is ever parsed by the shell.
 */
export function agentInvocation({ agent = "crush", agentCmd = "", prompt }) {
  if (agentCmd) {
    return { command: agentCmd.replaceAll("{prompt}", '"$OTTER_PROMPT"'), args: [], shell: true, env: { OTTER_PROMPT: prompt }, configs: [...PARENT_CONFIG_NAMES, ".claude/settings.local.json"] };
  }
  const preset = AGENT_PRESETS[agent];
  if (!preset) throw new Error(`unknown --agent ${agent}: one of ${Object.keys(AGENT_PRESETS).join(", ")}, or pass --agent-cmd`);
  return { command: preset.command, args: preset.args(prompt), shell: false, env: {}, configs: preset.configs };
}

// Sibling skills sit beside this one in every install, so the worker is handed o-commit's script by absolute path.
const COMMIT_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "o-commit", "scripts", "commit.mjs");

export const defaultPrompt = (commitScript = COMMIT_SCRIPT) =>
  `You are one parallel coding agent working in an isolated copy of the repository. Read TASK.md at the repository root: it contains your complete task, including the test seams already agreed with the user. Implement it test-first: a failing test at those seams, the least code that passes it, then a refactor. You cannot ask the user anything; if the task leaves a decision open that the code cannot settle, stop and state it in your final answer instead of guessing. Do not modify files outside the task's scope. Run the narrowest tests after each change and the full test suite once at the end. Commit with \`node ${commitScript} "<type(scope): description>"\` — never with git commit directly. Leave the working tree clean, with no uncommitted changes. If you cannot complete the task, still leave the tree clean and state what is missing in your final answer.`;

const PROMPT = arg("prompt", defaultPrompt());
const AGENT = AGENT_ARG || defaultAgent();
const WORKER = agentInvocation({ agent: AGENT, agentCmd: AGENT_CMD, prompt: PROMPT });

const run = (cmd) =>
  execSync(cmd, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();

let repoRoot;
let curBranch;
let WT_BASE;
let LOG_DIR;

// --- Repo sanity -----------------------------------------------------------
function validateRepo() {
  if (!TASK_DIR) {
    console.error("ERROR: --tasks <dir> is required.");
    process.exit(2);
  }
  if (!existsSync(TASK_DIR)) {
    console.error(`ERROR: task directory not found: ${TASK_DIR}`);
    process.exit(2);
  }
  try {
    repoRoot = run("git rev-parse --show-toplevel");
  } catch {
    console.error("ERROR: not inside a git repository.");
    process.exit(2);
  }
  curBranch = run("git branch --show-current");
  if (!curBranch) {
    console.error("ERROR: run from a normal branch, not detached HEAD.");
    process.exit(2);
  }
  if (!RIGHTS_MODES.includes(RIGHTS)) {
    console.error(`ERROR: --rights must be one of ${RIGHTS_MODES.join(", ")} (got ${RIGHTS}).`);
    process.exit(2);
  }
  const dirty = run("git status --porcelain");
  if (dirty && !DRY_RUN) {
    console.error("ERROR: working tree is not clean. Commit or stash first.");
    process.exit(2);
  }
  WT_BASE = join(repoRoot, ".o-skills", "worktrees");
  LOG_DIR = join(repoRoot, ".o-skills", "parallel-logs");
}

// --- Run status ------------------------------------------------------------
// A run outlives one shell command: Claude Code caps a foreground command at ten minutes, and a worker may take
// thirty. So the run keeps its state in run.json, and `--wait <min>` blocks on it for at most that long — the agent
// starts the run in the background and waits in foreground calls, never ending its turn while a worker runs.

export const statusFile = (root) => join(root, ".o-skills", "parallel-logs", "run.json");

function writeStatus(patch) {
  const file = statusFile(repoRoot);
  const current = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

const processAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The run as run.json records it; a run still marked running whose process is gone is reported as died. */
export function readRunStatus(root, { alive = processAlive } = {}) {
  let status;
  try {
    status = JSON.parse(readFileSync(statusFile(root), "utf8"));
  } catch {
    return { phase: "none" };
  }
  return status.phase === "running" && !alive(status.pid) ? { ...status, phase: "died" } : status;
}

/** Block until the run leaves `running` or `minutes` pass, polling every few seconds. */
export async function waitForRun(root, minutes, { alive = processAlive, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const deadline = now() + minutes * 60_000;
  for (;;) {
    const status = readRunStatus(root, { alive });
    if (status.phase !== "running" || now() >= deadline) return status;
    await sleep(5000);
  }
}

/** finished and clean 0 · still running 3 · finished with failures, died or never started 1. */
export const waitExitCode = (status) => (status.phase === "running" ? 3 : status.phase === "finished" && status.ok ? 0 : 1);

// --- Task discovery --------------------------------------------------------
async function collectMarkdown(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await collectMarkdown(p, out);
    else if (entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

export function parseFiles(content) {
  const m = content.match(/(?:^|\n)\*\*Files?:?\*\*:?\s*(.+)$/m);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/\s*\((new|mod)\)/, ""))
    .filter((s) => s.includes("."));
}

/**
 * The ids a task's front matter `depends_on` names (o-decompose writes them as wikilinks to sibling task files),
 * or null when the task has no such field. `depends_on: []` is an answer — no dependencies — not a missing one.
 */
export function parseDependsOn(content) {
  const front = content.match(/^---\n([\s\S]*?)\n---/);
  if (!front) return null;
  const block = front[1].match(/^depends_on:[ \t]*(\[\s*\])?[ \t]*\n?((?:[ \t]+-.*\n?)*)/m);
  if (!block) return null;
  if (block[1]) return [];
  return [...block[2].matchAll(/-\s*"?\[?\[?([^\]"\n]+?)\]?\]?"?\s*$/gm)].map((m) => basename(m[1].trim()).replace(/\.md$/, ""));
}

export function detectDependencies(tasks) {
  const deps = {};
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const declared = parseDependsOn(t.content);
    if (declared) {
      deps[t.id] = declared.filter((id) => ids.has(id) && id !== t.id);
      continue;
    }
    // No front matter: a task depends on any sibling task basename appearing in its body.
    deps[t.id] = tasks.filter((other) => other.id !== t.id && new RegExp(`\\b${escapeRegExp(other.id)}\\b`).test(t.content)).map((other) => other.id);
  }
  return deps;
}

async function loadTasks() {
  const paths = await collectMarkdown(TASK_DIR);
  paths.sort();
  const tasks = [];
  for (const p of paths) {
    const content = await readFile(p, "utf8");
    const id = basename(p, ".md");
    const title = content.match(/^#\s*.{0,80}/m)?.[0].slice(2).trim() || id;
    tasks.push({ id, title, path: p, content, files: parseFiles(content), deps: [], wave: -1, status: "pending" });
  }
  const depMap = detectDependencies(tasks);
  for (const t of tasks) t.deps = depMap[t.id];
  return tasks;
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Wave scheduling -------------------------------------------------------
export function buildWaves(tasks, limit) {
  const waves = [];
  const done = new Set();
  const remaining = [...tasks];
  let guard = 0;
  while (remaining.length > 0 && guard++ < tasks.length + 1) {
    const wave = [];
    const waveFiles = new Set();
    const deferred = [];
    for (const t of remaining) {
      const depsOk = t.deps.every((d) => done.has(d));
      const fileOk = t.files.every((f) => !waveFiles.has(f));
      if (depsOk && fileOk && wave.length < limit) {
        wave.push(t);
        t.files.forEach((f) => waveFiles.add(f));
      } else {
        deferred.push(t);
      }
    }
    if (wave.length === 0) {
      // Deadlock (cycle) or forced serialization: run the first eligible task alone.
      const solo = deferred.find((t) => t.deps.every((d) => done.has(d))) ?? deferred[0];
      wave.push(solo);
      deferred.splice(deferred.indexOf(solo), 1);
    }
    waves.push(wave);
    wave.forEach((t) => done.add(t.id));
    remaining.splice(0, remaining.length, ...deferred);
  }
  return waves;
}

// --- Parent rights ---------------------------------------------------------
export function configSearchDirs(cwd, root) {
  const stop = resolve(root);
  const dirs = [];
  let dir = resolve(cwd);
  while (true) {
    dirs.push(dir);
    if (dir === stop) break;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root: root was never an ancestor
    dir = parent;
  }
  return dirs;
}

// Nearest occurrence wins per file name, mirroring Crush's closer-to-cwd rule.
export function findProjectConfigs(cwd, root, names = PARENT_CONFIG_NAMES) {
  const found = new Map();
  for (const dir of configSearchDirs(cwd, root)) {
    for (const name of names) {
      const path = join(dir, name);
      if (found.has(name) || !existsSync(path)) continue;
      found.set(name, path);
    }
  }
  return [...found.values()];
}

export async function ensureExcluded(excludePath, names) {
  let current = "";
  try {
    current = await readFile(excludePath, "utf8");
  } catch {
    return [];
  }
  const present = new Set(current.split("\n").map((line) => line.trim()));
  const missing = names.filter((name) => !present.has(name));
  if (missing.length === 0) return [];
  const prefix = current === "" || current.endsWith("\n") ? "" : "\n";
  await appendFile(excludePath, `${prefix}${missing.join("\n")}\n`);
  return missing;
}

function gitExcludePath(worktree) {
  return resolve(worktree, run(`git -C ${quote(worktree)} rev-parse --git-path info/exclude`));
}

// Give the worker the parent's project config so it holds the same rights:
// permissions, hooks, MCP servers, options. The copies live in the worktree
// root, where the worker's own config walk starts, and never reach a commit.
export async function inheritProjectRights({
  worktree,
  cwd,
  root,
  mode = "inherit",
  names = PARENT_CONFIG_NAMES,
  excludePath = null,
}) {
  const copied = [];
  if (mode !== "none") {
    for (const source of findProjectConfigs(cwd, root, names)) {
      const name = names.find((candidate) => source.endsWith(candidate)) ?? basename(source);
      await mkdir(dirname(join(worktree, name)), { recursive: true });
      await copyFile(source, join(worktree, name));
      copied.push(name);
    }
  }
  await ensureExcluded(excludePath ?? gitExcludePath(worktree), [TASK_FILE, ...copied]);
  return copied;
}

// --- Worktree lifecycle ----------------------------------------------------
export const slugOf = (id) => id.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);

async function createWorktree(task) {
  const slug = slugOf(task.id);
  const branch = `xp/${slug}`;
  const wt = join(WT_BASE, slug);
  await mkdir(WT_BASE, { recursive: true });
  if (existsSync(wt)) {
    console.error(`  ✗ worktree exists: ${wt}`);
    return null;
  }
  try {
    try {
      run(`git worktree add ${quote(wt)} -b ${quote(branch)}`);
    } catch {
      // Rerun after a failed attempt: branch already exists, reuse it.
      run(`git worktree add ${quote(wt)} ${quote(branch)}`);
    }
    await writeFile(join(wt, "TASK.md"), `# Task: ${task.title}\n\nSource: ${task.id}\n\n---\n\n${task.content}\n`);
    // The dispatcher's own files (task file, inherited config) are never agent work.
    const inherited = await inheritProjectRights({ worktree: wt, cwd: process.cwd(), root: repoRoot, mode: RIGHTS, names: WORKER.configs });
    return { slug, branch, wt, inherited };
  } catch (err) {
    console.error(`  ✗ worktree creation failed for ${task.id}: ${err.message.split("\n")[0]}`);
    return null;
  }
}

// --- Agent spawn -----------------------------------------------------------
function runAgent(task, wt) {
  return new Promise((resolve) => {
    const logPath = join(LOG_DIR, `${slugOf(task.id)}.log`);
    const commitWork = () => {
      // Commit anything the agent left behind (never TASK.md) through o-commit's validation, without a shell.
      try {
        execFileSync("git", ["-C", wt, "add", "-A"], { stdio: "ignore" });
        if (!execFileSync("git", ["-C", wt, "diff", "--cached", "--name-only"], { encoding: "utf8" }).trim()) return true;
        const message = `feat: complete ${slugOf(task.id).replace(/-/g, " ")}`;
        if (existsSync(COMMIT_SCRIPT)) execFileSync(process.execPath, [COMMIT_SCRIPT, message], { cwd: wt, stdio: "ignore" });
        else execFileSync("git", ["-C", wt, "commit", "-m", message, "--quiet"], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };
    mkdir(LOG_DIR, { recursive: true }).then(() => {
      const log = createWriteStream(logPath);
      const child = spawn(WORKER.command, WORKER.args, {
        cwd: wt,
        shell: WORKER.shell,
        env: { ...process.env, ...WORKER.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true, // own process group so the timeout can kill children too
      });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
        resolve({ ok: false, code: null, reason: `timeout after ${TIMEOUT_MIN}m`, log: logPath });
      }, TIMEOUT_MIN * 60_000);
      child.stdout.pipe(log);
      child.stderr.pipe(log);
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, code: null, reason: err.message, log: logPath });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const status = () => {
          try { return run(`git -C ${quote(wt)} status --porcelain`); } catch { return "?"; }
        };
        if (code === 0) {
          if (status() !== "") commitWork(); // agent forgot to commit
          const clean = status() === "";
          resolve({ ok: clean, code, clean, reason: clean ? "done" : "uncommitted changes remain", log: logPath });
        } else {
          commitWork(); // preserve partial work on the branch
          resolve({ ok: false, code, clean: false, reason: `exit ${code}`, log: logPath });
        }
      });
    });
  });
}

// --- Merge back ------------------------------------------------------------
function mergeBranch(slug) {
  try {
    run(`git merge --no-ff xp/${quote(slug)} -m "xp: ${slug.replace(/-+$/, "")}"`);
    return true;
  } catch {
    try { run("git merge --abort"); } catch {}
    return false;
  }
}

// --- Worktree removal (register + dir) -------------------------------------
async function removeWorktree(wt) {
  try {
    run(`git worktree remove --force ${quote(wt)}`);
  } catch {
    await rm(wt, { recursive: true, force: true }).catch(() => {});
    try { run(`git worktree prune`); } catch {}
  }
}

// --- Retry handling --------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Drop any leftover worktree + branch so the next attempt starts from main.
async function resetTask(task) {
  const slug = slugOf(task.id);
  const wt = join(WT_BASE, slug);
  if (existsSync(wt)) await removeWorktree(wt);
  try { run(`git branch -D xp/${quote(slug)} 2>/dev/null`); } catch {}
}

const totalAttempts = RETRIES + 1;

async function runWithRetries(task, cleanup) {
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (attempt > 1) {
      console.log(`  ↻ ${task.id}: retry ${attempt - 1}/${RETRIES} (backoff ${5 * attempt}s)`);
      await sleep(5_000 * attempt);
    }
    await resetTask(task);
    const info = await createWorktree(task);
    if (!info) {
      task.status = "failed";
      return { task, outcome: "failed", note: "no worktree", attempts: attempt };
    }
    if (KEEP_WORKTREES) cleanup.push(info);
    const res = await runAgent(task, info.wt);
    if (res.ok) {
      task.status = "merged";
      console.log(`  ✓ ${task.id}: done (attempt ${attempt})`);
      return { task, info, outcome: "done", attempts: attempt };
    }
    if (!KEEP_WORKTREES) await removeWorktree(info.wt);
    if (attempt === totalAttempts) {
      task.status = "failed";
      console.log(`  ✗ ${task.id}: ${res.reason} (log: ${res.log})`);
      return { task, outcome: "failed", note: res.reason, attempts: attempt };
    }
  }
}

// --- Main ------------------------------------------------------------------
function describeRights() {
  if (RIGHTS === "none") return " (workers keep global config only)";
  const names = findProjectConfigs(process.cwd(), repoRoot, WORKER.configs).map((p) => basename(p));
  return names.length ? ` (${names.join(", ")})` : " (no project config to inherit)";
}

const USAGE = `Usage: node parallel.mjs --tasks <dir> [options]
  --parallel N           max concurrent workers (default 4)
  --retries N            extra attempts per failed task (default 1)
  --timeout-min N        kill a worker after N minutes (default 30)
  --agent claude|codex|crush   worker preset (default: the first on PATH)
  --agent-cmd "<cmd>"    any other worker; {prompt} is passed through $OTTER_PROMPT
  --no-merge             leave finished tasks on their branches for review
  --rights inherit|none  copy your untracked agent config into each worktree (default inherit)
  --keep-worktrees       keep worktrees after the run
  --dry-run              print the wave plan and spawn nothing
  --prompt "<text>"      override the worker instruction
       node parallel.mjs --wait [min]   block until the run finishes, at most min minutes (default 9); exit 0 clean,
                                        3 still running, 1 failed or died
       node parallel.mjs --status       print the run's state without waiting`;

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  if (hasFlag("wait") || hasFlag("status")) {
    const root = run("git rev-parse --show-toplevel");
    const status = hasFlag("status") ? readRunStatus(root) : await waitForRun(root, Number(arg("wait", "9")) || 9);
    console.log(JSON.stringify(status, null, 2));
    process.exitCode = waitExitCode(status);
    return;
  }
  validateRepo();
  console.log(`\nO-Parallel — ${AGENT_CMD ? "custom" : AGENT} workers, limit ${PARALLEL}, timeout ${TIMEOUT_MIN}m${NO_MERGE ? ", no merge" : ""}`);
  console.log(`Rights: ${RIGHTS}${describeRights()}`);
  const tasks = await loadTasks();
  if (tasks.length === 0) {
    console.error("No *.md task files found under", TASK_DIR);
    process.exit(1);
  }
  const waves = buildWaves(tasks, PARALLEL);
  console.log(`Tasks: ${tasks.length} | Waves: ${waves.length}\n`);
  const taskState = Object.fromEntries(tasks.map((task) => [task.id, "queued"]));

  if (DRY_RUN) {
    waves.forEach((w, i) => {
      console.log(`Wave ${i + 1}: ${w.map((t) => t.id).join(", ")}`);
      for (const t of w) if (t.deps.length) console.log(`   deps(${t.id}): ${t.deps.join(", ")}`);
    });
    process.exit(0);
  }

  let failed = 0;
  let conflicted = 0;
  let merged = 0;
  const ready = [];
  const cleanup = [];

  writeStatus({ pid: process.pid, phase: "running", startedAt: new Date().toISOString(), branch: curBranch, tasks: taskState, summary: null, ok: null });
  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i];
    console.log(`Wave ${i + 1}/${waves.length} (${wave.length} task${wave.length > 1 ? "s" : ""})`);
    for (const task of wave) taskState[task.id] = "running";
    writeStatus({ tasks: taskState });
    const results = await Promise.all(
      wave.map(async (task) => {
        const r = await runWithRetries(task, cleanup);
        if (r.outcome !== "done") failed++;
        return r;
      }),
    );

    for (const [index, task] of wave.entries()) taskState[task.id] = results[index].outcome;
    writeStatus({ tasks: taskState });
    for (const r of results) {
      if (r.outcome !== "done" || !r.info) continue;
      if (NO_MERGE) {
        await removeWorktree(r.info.wt);
        ready.push(r.info.branch);
        console.log(`  ✓ ${r.info.slug} ready on ${r.info.branch} — review with: git diff ${curBranch}...${r.info.branch}`);
        continue;
      }
      if (mergeBranch(r.info.slug)) {
        merged++;
        console.log(`  ↔ merged ${r.info.slug} into ${curBranch}`);
        if (!KEEP_WORKTREES) {
          await removeWorktree(r.info.wt);
          run(`git branch -d xp/${quote(r.info.slug)}`);
        }
      } else {
        conflicted++;
        console.log(`  ⚠ ${r.info.slug}: merge conflict, left for manual resolution`);
      }
    }
  }

  writeStatus({ phase: "finished", summary: { merged, ready, conflicted, failed }, ok: conflicted === 0 && failed === 0 });
  console.log("\n=============================================");
  console.log(`Summary: ${merged} merged, ${ready.length} ready for review, ${conflicted} conflicted, ${failed} failed`);
  console.log(`Logs: ${LOG_DIR}`);
  if (conflicted > 0 || failed > 0) {
    console.log("Inspect failed tasks' branches (xp/<slug>) or resolve conflicts manually.");
    process.exit(1);
  }
  console.log("=============================================\n");
}

const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err) => {
    if (repoRoot) writeStatus({ phase: "finished", ok: false, error: String(err?.message ?? err) });
    console.error("O-Parallel failed:", err);
    process.exit(1);
  });
}
