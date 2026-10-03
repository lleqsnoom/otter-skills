---
name: o-rollback
description: Revert safely — preview exactly which commits and files a revert touches, get the user's approval for those, then make one revert each. Use when asked to roll back, revert, undo or back out a commit, a merge or a release.
version: 1.1.1
author: Community
tags: [git-revert, rollback, safety, confirmation, version-control]
user-invocable: true
---

# O-Rollback — Revert Exactly What Was Approved

A revert is the one git operation that is easy to aim at the wrong commit. This skill makes the target visible
first and asks for approval of *those* commits, so what gets reverted is what the user agreed to.

`<skill>` below is this skill's folder. Every script answers `--help` with its commands and flags.

## Procedure

1. **Preview.** Name the target and run a dry run:

   ```bash
   node <skill>/scripts/revert.mjs --last 1 --dry-run              # the most recent commit
   node <skill>/scripts/revert.mjs --last 3 --dry-run              # the three most recent, newest first
   node <skill>/scripts/revert.mjs --commit <sha> --dry-run        # a named commit (repeat --commit for more)
   ```

   It prints each target's SHA, subject and files, and a `confirmWith` line naming the exact approval.
2. **Ask.** Show the user the targets and ask with a `confirm` panel. Never revert on your own judgement.
3. **Revert, on yes:**

   ```bash
   node <skill>/scripts/revert.mjs --last 1 --yes --expect-sha <sha from the dry run>
   ```

   `--expect-sha` lists the dry run's SHAs (comma-separated, 7+ characters each). If `--last` now resolves to
   anything else — someone committed in between — the run refuses rather than reverting a commit nobody
   approved. In a real terminal without `--yes`, the script asks for the word `REVERT` itself.

Each target gets its own commit, `revert: <original subject>`, made through o-commit's script when it sits
beside this skill.

## Safety checks

| Check | On failure |
|-------|------------|
| Working tree clean | a revert exits 1 before anything changes; a dry run still previews and reports `blocked` |
| Target in the current branch's history | exit 1 — a SHA from another branch is not reverted here |
| Merge commit | exit 1 until `--mainline 1` says which parent to keep |
| No terminal and no matching `--yes --expect-sha` | exit 1, naming the approval to ask for |
| A revert conflicts | that revert is aborted, the earlier ones stay, and the JSON lists what landed |

## Definition of Done

- The dry run's targets were shown to the user and approved.
- `revert.mjs` exited 0 and printed `{ success: true, reverted: [...] }` with one revert SHA per target.
- `git log` shows one `revert:` commit per approved target, and nothing else changed.
