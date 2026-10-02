---
name: o-commit
description: Write single-line conventional commit messages — one authoritative type map, imperative mood, no description body
version: 1.1.0
author: Community
tags: [conventional-commits, git, commit-messages, commit-changes]
user-invocable: true
---

# X-Commit — Conventional Commits (Message Only)

Make a conventional commit that states what the current change does. One sentence. Authoritative tone. Do not add co-authors or info that it was made with AI.

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory:

```bash
# Suggest a type + scope from the staged changes
node <path-to>/scripts/suggest-type.mjs

# Validate AND commit atomically
node <path-to>/scripts/commit.mjs "<message>"
```

**Auto-discovery**: Scripts resolve their own location via `__dirname`, so they work whether installed globally (`~/.agents/skills/o-commit/scripts/`) or locally (`.agents/skills/o-commit/scripts/`).

## Workflow

1. Run `node <path-to>/scripts/suggest-type.mjs` to analyze staged changes and suggest a type + scope.
2. Pick the best suggestion, or override if context demands it.
3. Draft the **complete** commit message in imperative mood: `type[(scope)]: description`.
4. Run `node <path-to>/scripts/commit.mjs "<message>"` — this script validates AND commits atomically, and **you** run it: never hand the user a `git commit` command to paste, and never end a turn with the message drafted and the commit waiting for a go-ahead. The one exception is a tree holding someone else's uncommitted work — then name your own files and ask before staging them.
   - If it prints the commit confirmation and commits → done.
   - If it prints `ERROR:` and exits non-zero → **do not commit manually**. Show the error to the user and ask for a corrected message. Repeat from step 3.

## Rules

- **One line only** — no description body, no blank lines inside the message. The **only** exception is the `BREAKING CHANGE:` footer described below.
- **Imperative mood** — "add", not "added" or "adds".
- **No trailing period**.
- **No AI attribution** — never mention tools, models, or assistants.
- **No co-authors or sign-offs**.
- Scope is optional; use it when the change touches a clearly bounded area (e.g. `feat(auth): ...`).
- **Breaking changes** — signal with a `!` before the colon (`feat(api)!: ...`) or, when the impact needs a sentence of its own, a single `BREAKING CHANGE:` footer separated from the subject by one blank line. That footer is the *single allowed exception* to the one-line rule, used only for a breaking change whose impact the subject cannot carry.
