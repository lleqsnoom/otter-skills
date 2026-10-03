---
name: o-parallel
description: Run several coding tasks at the same time — each in its own git worktree with its own background agent (Claude Code, Codex, Crush or any CLI) holding the parent's project rights, then merge the committed results back or leave them on branches for review. Use when asked to run tasks in parallel, fan out a task folder to workers, or parallelize independent tasks.
version: 1.3.1
author: Community
tags: [parallel, agents, background, worktree, concurrency, dispatch]
user-invocable: true
---

# O-Parallel — Parallel Background Coding Agents

Runs independent coding tasks concurrently. Each task is executed in an isolated git worktree by a full agent process — Claude Code, Codex, Crush, or any CLI you name — holding the same project rights as you. Committed results are merged back into your current branch, or left on review branches with `--no-merge`. Use it to parallelize o-decompose output, batch fixes, or multi-file refactors.

`<skill>` below is this skill's folder, and `<skills>` the folder that holds it and every other o-* skill. Every script answers `--help` with its commands and flags.

## Requirements

- The worker CLI on PATH: `claude`, `codex` or `crush` (`command -v claude`), or any command you pass with `--agent-cmd`.
- Task files are markdown, one per file, self-contained (o-decompose format or any md).
- Run from a git repo on a normal branch with a **clean working tree**.

## Usage

```bash
node <skill>/scripts/parallel.mjs --tasks <task-dir> [options]
```

| Option | Default | Meaning |
|--------|---------|---------|
| `--tasks <dir>` | (required) | Task directory; all `*.md` recursively are tasks |
| `--parallel N` | 4 | Max concurrent agents |
| `--retries N` | 1 | Extra attempts per task after the first failure (each starts from a clean worktree, with escalating backoff) |
| `--timeout-min N` | 30 | Kill an agent (and its whole process group) after N minutes. Every agent run is time-bounded; never run unbounded. |
| `--agent crush\|claude\|codex` | the first of these on PATH | Worker preset: `crush run <prompt>`, `claude -p <prompt> --permission-mode acceptEdits` (file tools, git, the package manager, and the build tools the project's own files name — `make`, `cargo`, `go`, `python`/`pytest`, `mvn` and the like), or `codex exec --full-auto <prompt>` |
| `--agent-cmd "<cmd>"` | — | Any other worker: a shell command where `{prompt}` stands for the prompt (passed through `$OTTER_PROMPT`, never parsed by the shell) |
| `--no-merge` | off | Leave each finished task on its `xp/<slug>` branch for review instead of merging it |
| `--rights inherit\|none` (alias `--no-rights`) | inherit | `inherit` copies your untracked project config into each worktree (Crush's `crush.json` family, Claude Code's `.claude/settings.local.json`) so the worker holds the same rights as you; `none` leaves the worker on its tracked and global config only |
| `--keep-worktrees` | off | Keep worktrees after run for inspection |
| `--dry-run` | off | Print the wave plan, spawn nothing |
| `--prompt "<text>"` | default | Override the worker instruction (default below) |
| `--wait <min>` | 9 | Block until the current run finishes, at most `<min>` minutes; exit 0 finished clean, 3 still running, 1 failed or died |
| `--status` | — | Print the current run's `run.json` (each task's state, the summary) without waiting |

**Stay with the run.** The work is done when the run says so, not when it starts. Where the shell lets a command
run as long as the workers (`--timeout-min` × attempts), run it in the foreground. Where it does not — Claude Code
stops a foreground command at ten minutes — start it in the background and then call
`node <skill>/scripts/parallel.mjs --wait 9` until it exits 0 or 1; 3 means still running, so wait again. Never end
your turn while a worker runs: a non-interactive session (`claude -p`, `codex exec`, CI) ends with your turn, and the
workers end with it.

## How It Works

1. **Discover tasks** — collect every `*.md` under `--tasks`, sorted. Task id = basename.
2. **Dependencies** — a task with front matter `depends_on` (o-decompose writes it) depends on exactly the sibling tasks it lists, and `depends_on: []` means none. A task without front matter depends on each sibling task basename its body mentions.
3. **Waves** — a task enters a wave when all its dependencies are in earlier waves. Tasks sharing a declared file are not scheduled into the same wave (serialized to avoid conflicts).
4. **Run each wave** — for every task up to `--parallel`, with retries:
   - attempt the task (worktree + agent run). If it fails, retry up to `--retries` more times, each retry starting from a clean worktree and branch, with escalating backoff
   - `git worktree add <repo>/.o-skills/worktrees/<slug> -b xp/<slug>`
   - write the task file to `<worktree>/TASK.md` (ignored via `.git/info/exclude`, never merged)
   - inherit your rights: copy each project config file (`.crushrc`, `crushrc`, `.crush.json`, `crush.json`) found between the repo root and your cwd into the worktree root, and exclude them from git so they never reach a commit
   - spawn the worker with `cwd = <worktree>` and the prompt, output to `.o-skills/parallel-logs/<slug>.log`
   - success = exit code 0 AND `git status --porcelain` empty in the worktree (uncommitted leftovers are committed through o-commit's script as `feat: complete <task>`; a message it rejects fails the task)
   - a task only counts as failed after all attempts are exhausted
5. **Merge successes** — after each wave, merge every successful branch into your branch: `git merge --no-ff xp/<slug> -m "xp: <slug>"`. On conflict: `git merge --abort`, mark the task conflicted for manual resolution, continue. With `--no-merge`, each finished branch is left as it is and listed with the `git diff` to review it.
6. **Cleanup** — remove merged worktrees and delete their branches. Failed or conflicted tasks keep their `xp/<slug>` branch (worktree removed) so you can inspect and fix by hand.

## Worker Prompt (default)

```
You are one parallel coding agent working in an isolated copy of the
repository. Read TASK.md at the repository root: it contains your complete
task, including the test seams already agreed with the user. Implement it
test-first: a failing test at those seams, the least code that passes it,
then a refactor. You cannot ask the user anything; if the task leaves a
decision open that the code cannot settle, stop and state it in your final
answer instead of guessing. Do not modify files outside the task's scope.
Run the narrowest tests after each change and the full test suite once at
the end. Commit with `node <skills>/o-commit/scripts/commit.mjs "<message>"`
— never with git commit directly. Leave the working tree clean, with no
uncommitted changes. If you cannot complete the task, still leave the tree
clean and state what is missing in your final answer.
```

The script fills in o-commit's path from its own location. A worker cannot ask the user anything, so whatever
needs the user — the test seams, an open design choice — is settled and written into each task file before
dispatch.

## Rules

- The working tree must be clean before dispatch; the script refuses to run otherwise.
- **Workers hold your rights by default.** A worktree has your tracked files, but not your untracked local config: without the copies a worker would miss the permissions, hooks and MCP servers you set locally. Pass `--rights none` only when you want a deliberately isolated worker.
- **Each worker is a full agent session, and they run at once.** N workers spend N sessions' tokens; start with a small `--parallel` on a big batch.
- Two tasks that write the same file must not run concurrently. If the script cannot detect overlap, a merge conflict results; resolve it manually.
- Do not edit files inside another task's worktree.
- **Always time-bound agent runs.** Every spawned agent is killed (process group) after `--timeout-min`. Do not change this to "wait forever".
- Exit 0 only when every task was merged. Non-zero exit means failures or conflicts; read the summary.

## Output

The script prints a per-wave progress table and a final summary: `success / conflicted / failed`, plus log file paths for inspection.
