---
name: o-rollback
description: Automated git revert with multi-step confirmation — identifies target commits, analyzes impact, requires approval, creates properly formatted revert commits via o-commit integration. Use when asked to roll back, revert or undo a commit or release.
version: 1.0.2
author: Community
tags: [git-revert, rollback, safety, confirmation, version-control]
user-invocable: true
---

# O-Rollback — Automated Git Revert with Safety Checks

Automates safe git reverts with multi-step confirmation to prevent accidental rollbacks. Integrates with o-commit for proper revert commit formatting.

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory:

```bash
# Revert a specific commit by SHA
node <skill>/scripts/revert.mjs --commit abc123def456

# Revert last N commits
node <skill>/scripts/revert.mjs --last 1

# Dry-run mode (show what would happen without reverting)
node <skill>/scripts/revert.mjs --commit abc123def456 --dry-run
```

`<skill>` is this skill's folder; its scripts find their own files from there, so run them from any directory.

## Safety Checks

1. **Clean working tree required** — exits early with error if uncommitted changes exist
2. **SHA verification** — confirms target commit exists in current branch history
3. **Impact analysis** — shows affected files before confirmation
4. **Explicit approval** — requires user to confirm revert action

## Definition of Done

A rollback run is done when `revert.mjs` delivers:

- **Refuses a dirty tree** — any uncommitted change makes it exit 1 with a "working tree is not clean" message on stderr, before touching anything.
- **Resolves exactly one target** — `--commit <sha>` or `--last N` selects a single commit; a missing or ambiguous target exits 1 with a usage error.
- **Shows impact before acting** — `--dry-run` prints a JSON plan to stdout (`dryRun: true` plus `sha`, `message`, `files`, `stats`) and creates **no** revert commit; HEAD is unchanged.
- **Requires explicit confirmation** — in an interactive terminal it waits for the literal `REVERT`; any other answer cancels with exit 0.
- **Commits the revert** — on confirmation it creates a `revert: "…"` commit (via o-commit when available, falling back to `git commit`) and prints `{ success: true, revertSha, message }` to stdout.

Failure modes — each prints a message to stderr and exits 1:

- No `--commit` / `--last` target → usage error.
- Commit SHA not in current history → "not found".
- Revert fails mid-way → aborts with `git revert --abort` and reports the error.
