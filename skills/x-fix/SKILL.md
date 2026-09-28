---
name: x-fix
description: Resolve issues from fix plans — read, edit, verify, mark complete
version: 1.1.0
author: Community
tags: [code-quality, debugging, refactoring]
user-invocable: true
---

# X-Fix — Resolve Issues Iteratively

**Prerequisites:** A fix plan in the run folder under `.x-skills/runs/<stamp>-R<nn>-<slug>/`, from x-debug (`E<nn>-fix-plan.md`), x-review (`E<nn>-review-plan.md`), or manual creation.

## Workflow

1. Read the most recent `E<nn>-fix-plan.md` or `E<nn>-review-plan.md` in the run folder (`.x-skills/runs/<stamp>-R<nn>-<slug>/`). x-debug writes the first kind; x-review writes the second.
2. Find next unchecked `[ ]` issue (CRITICAL → MAJOR → MINOR).
3. For each issue:
   - **Reset**: `git checkout -- <file>` for clean baseline
   - Read ±20 lines around reported location
   - Apply fix using `edit` only (never `multiedit`)
   - Run syntax check (`node -c <file>`) and tests
   - **Verify**: Run the run folder's `E<nn>-verify.js` if available — issue NOT resolved until exit 0
   - Mark `[ ]` → `[x]` in plan file
4. Print one-line summary per fix. Repeat until all done.

## Rules

- **One issue at a time** — never batch fixes
- **Prefer `edit` over `multiedit`** — easier recovery from failures
- **Start from clean checkout** — `git checkout -- <file>` before each fix
- **Test after every fix** — revert if tests fail
- **NEVER silence errors** — do NOT add try/catch wrappers that swallow errors, do NOT disable error reporting. Fix the root cause so the error cannot occur. Where the root cause is a state the design allows and should not, make the state impossible rather than handle it: follow *Make the Bad State Impossible* in x-implement's `SKILL.md` (`~/.agents/skills/x-implement/SKILL.md` for a global install, `.agents/skills/x-implement/SKILL.md` for a local one), narrow the representation, and keep the check only where the input crosses a trust boundary.
- **Minimal changes** — only modify what's needed to resolve the specific issue
- **`[Bloat]` issues follow x-unbloat** (`~/.agents/skills/x-unbloat/SKILL.md` for a global install, `.agents/skills/x-unbloat/SKILL.md` for a local one): check every call site before inlining or deleting, and keep what its *Keep it if* column or *Never Cut* list protects
- **`[Architecture]` issues follow x-arch** (`~/.agents/skills/x-arch/SKILL.md` for a global install, `.agents/skills/x-arch/SKILL.md` for a local one): one change per finding — a move, a split, a rename or a repointed dependency, never two at once — check every call site before moving or deleting, and keep what its *Never Cut* list protects. When the repo declares `.x-skills/config/arch.json`, finish with `x-arch-lint`'s `arch-check.mjs --root .` to confirm the fix did not cross another boundary
- **If ambiguous**, make smallest reasonable fix and note uncertainty
