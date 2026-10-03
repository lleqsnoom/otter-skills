---
name: o-fix
description: Resolve issues from fix plans — read, edit, verify, mark complete, issue by issue, never discarding the uncommitted changes around a fix. Use when asked to fix review findings or resolve a fix plan.
version: 1.4.0
author: Community
tags: [code-quality, debugging, refactoring]
user-invocable: true
---

# O-Fix — Resolve Issues Iteratively

**Prerequisites:** A plan in the shape of `references/plan-format.md` — `E<nn>-review-plan.md` from o-review, `E<nn>-fix-plan.md` from o-debug or o-investigate, or any plan path the user names. Every `- [ ]` line in it is one change to make.

`<skills>` below is the folder that holds this skill's folder and every other o-* skill.

## The uncommitted work is not yours to drop

Inside o-implement, o-fix runs at VERIFY, before COMMIT: the files under review hold the task's uncommitted
work, and earlier fixes in the same plan sit uncommitted beside it. Never run `git checkout -- <file>`,
`git restore`, `git stash` or `git reset` on a file named in the plan — each one throws that work away. To undo a
fix, reverse your own edit and nothing else.

## Workflow

1. Read the plan the user named, or else the most recent `E<nn>-fix-plan.md` or `E<nn>-review-plan.md` in the run folder.
2. Run `git status --short` once and note which files already carry uncommitted changes: that is the baseline every fix builds on.
3. Find the next unchecked `[ ]` issue (CRITICAL → MAJOR → MINOR).
4. For each issue:
   - Read ±20 lines around the reported location, as the file is now
   - Make the fix as one small, targeted edit, so it can be reversed on its own
   - Run the language's syntax or type check for the file (e.g. `node --check`, `tsc --noEmit`, `python -m py_compile`) and the narrowest tests for the changed files
   - **Verify**: run the run folder's `E<nn>-verify` command if it has one — the issue is NOT resolved until it exits 0
   - Mark `[ ]` → `[x]` in the plan file
5. Print one-line summary per fix. Repeat until all done.

## Rules

- **One issue at a time** — never batch fixes
- **Run the narrowest tests after every fix** — if they fail, reverse your own edit, then retry or leave the issue unchecked with a note
- **NEVER silence errors** — do NOT add try/catch wrappers that swallow errors, do NOT disable error reporting. Fix the root cause so the error cannot occur. Where the root cause is a state the design allows and should not, make the state impossible rather than handle it: follow *Make the Bad State Impossible* in `<skills>/o-implement/SKILL.md`, narrow the representation, and keep the check only where the input crosses a trust boundary.
- **Minimal changes** — only modify what's needed to resolve the specific issue
- **`[Comments]` issues follow o-comments' pass card** (`<skills>/o-comments/references/pass.md`): delete a comment that restates code, and extract a block that needs a paragraph of explanation into a named function instead of documenting it; removing comments must never change behavior, so run the tests after any refactor
- **`[Bloat]` issues follow o-unbloat's pass card** (`<skills>/o-unbloat/references/pass.md`): check every call site before inlining or deleting, and keep what its *Keep it if* column or *Never Cut* list protects
- **`[Architecture]` issues follow o-arch's pass card** (`<skills>/o-arch/references/pass.md`): one change per finding — a move, a split, a rename or a repointed dependency, never two at once — check every call site before moving or deleting, and keep what its *Never Cut* list protects. When the repo declares `.o-skills/config/arch.json`, finish with `node <skills>/o-arch-lint/scripts/arch-check.mjs --root .` to confirm the fix did not cross another boundary
- **If ambiguous**, make smallest reasonable fix and note uncertainty

## Definition of Done

A fix is done when the issue is resolved **and** the standing bar in `o-implement`'s `SKILL.md` is still clear for
the files you touched. Resolving an issue while lowering the bar around it is not a fix: a new `@ts-ignore`, a
deleted assertion, a skipped test, an emptied `catch` or a stubbed function is the failure the bar exists to
catch, and `o-floor`'s guard reports each of them on the diff. After the last fix, run the guard and the full suite once (inside o-implement, its COMMIT step owns that run) —
`E<nn>-verify` exits 0 where the run folder has one — and leave every issue you did not resolve unchecked
rather than marking it done. The uncommitted changes you found at step 2 are all still there.
