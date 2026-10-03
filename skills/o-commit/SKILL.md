---
name: o-commit
description: "Commit the work with one conventional message — `type(scope): what it does`, imperative mood, checked by a script that then makes the commit; a short body only for a large change. Use when the user says commit, commit this or commit the staged changes, or whenever work is ready to land in git."
version: 1.2.2
author: Community
tags: [conventional-commits, git, commit-messages, commit-changes]
user-invocable: true
---

# O-Commit — Conventional Commits (Message Only)

Make a conventional commit that states what the current change does. One sentence. Authoritative tone. Do not add co-authors or info that it was made with AI.

## Scripts

Run the scripts from any working directory. `commit.mjs` calls git without a shell, so quotes, `$(…)` and backticks in a message are text.

```bash
# Suggest a type + scope from the staged changes
node <skill>/scripts/suggest-type.mjs

# Validate AND commit atomically
node <skill>/scripts/commit.mjs "<message>"

# A large change (10+ files or 400+ changed lines) may carry one short paragraph of why
node <skill>/scripts/commit.mjs "<message>" --body "<why, in one paragraph>"
```

`<skill>` is this skill's folder; its scripts find their own files from there, so run them from any directory. Every script answers `--help` with its commands and flags.

## Workflow

1. Run `node <skill>/scripts/suggest-type.mjs` to analyze staged changes and suggest a type + scope.
2. Pick the best suggestion, or override if context demands it.
3. Draft the **complete** commit message in imperative mood: `type[(scope)]: description`.
4. Run `node <skill>/scripts/commit.mjs "<message>"` — this script validates AND commits atomically, and **you** run it: never hand the user a `git commit` command to paste, and never end a turn with the message drafted and the commit waiting for a go-ahead. The one exception is a tree holding someone else's uncommitted work — then name your own files and ask before staging them.
   - If it prints the commit confirmation and commits → done.
   - If it prints `ERROR:` and exits non-zero → **do not commit manually**. Show the error to the user and ask for a corrected message. Repeat from step 3.

## Rules

- **One line only** — no description body, no blank lines inside the message. Two exceptions: the `BREAKING CHANGE:` footer described below, and a `--body` paragraph on a large change, which says *why* in at most 600 characters. The script refuses a body on anything smaller.
- **Imperative mood** — "add", not "added" or "adds".
- **No trailing period**.
- **No AI attribution** — never mention tools, models, or assistants.
- **No co-authors or sign-offs**.
- Scope is optional; use it when the change touches a clearly bounded area (e.g. `feat(auth): ...`).
- **Breaking changes** — signal with a `!` before the colon (`feat(api)!: ...`) or, when the impact needs a sentence of its own, a single `BREAKING CHANGE:` footer separated from the subject by one blank line. That footer is the *single allowed exception* to the one-line rule, used only for a breaking change whose impact the subject cannot carry.
