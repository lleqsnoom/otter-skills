---
name: x-review
description: Review code against engineering principles — small functions, SOLID, KISS, DRY — with automated AST-based complexity analysis across 30+ languages including Python, C, C++, Java, JavaScript, TypeScript, Go, Rust, Ruby, PHP, Swift, Kotlin, and more
version: 2.1.0
author: Community
tags: [code-review, solid, kiss, dry, single-responsibility, cyclomatic-complexity, code-quality]
user-invocable: true
auto-trigger:
  on-file-pattern: "*.ts,*.tsx,*.js,*.jsx,*.py,*.go,*.java,*.rb,*.rs,*.hx,*.c,*.cpp,*.cs,*.swift,*.kt,*.lua,*.dart,*.scala,*.hs,*.ex,*.erl,*.clj,*.fs,*.zig,*.jl,*.pl,*.r,*.groovy,*.adb"
  not-when:
    - path-matches: "node_modules/**"
    - file-size-above: 5242880  # Skip files > 5MB
---

# X-Review — Code Review Against Engineering Principles

## Scripts

All scripts self-resolve via `__dirname` — run from any working directory by passing the full path:

```bash
# Run from anywhere (use whichever script path is available):
node <path-to>/scripts/analyze-complexity.mjs --all       # AST-based complexity, length, params per function
node <path-to>/scripts/check-duplication.mjs --all         # duplicated blocks (>5 lines)
node <path-to>/scripts/save-plan.mjs --slug <topic>   # create plan file with all analysis results
```

**Auto-discovery**: Scripts resolve config and sibling scripts relative to the directory they sit in (ESM has no `__dirname`; it is derived from `import.meta.url`), so they work whether installed globally (`~/.agents/skills/x-review/scripts/`) or locally (`.agents/skills/<project>/x-review/scripts/`).

**What To Do:** When invoked, determine the user's scope (single file, directory, or full project) and execute these commands. Do not ask the user what to do.

1. **Create plan file with all analyses**: `node <path-to>/scripts/save-plan.mjs --slug <topic>` — this runs complexity analysis (AST-based via tree-sitter), duplication check, AND refactor pattern detection in one step. It writes `E<nn>-review-plan.md` into the run folder.
2. The script prints the full path. Open that file with `edit` or `write`, then insert your review content directly into it using the format below.
3. **Run the comments pass (always, using x-comments)** — apply the rules in the x-comments skill's `SKILL.md` (`~/.agents/skills/x-comments/SKILL.md` for a global install, `.agents/skills/x-comments/SKILL.md` for a local one) to every reviewed file. Report comment issues under a `[Comments]` heading in the plan: comments that restate code, obvious comments, and paragraph-long explanations that should be a named function. Route comment issues to `x-comments` in Next Steps.
4. **Run the bloat pass (always, using x-unbloat)** — apply the ladder in the x-unbloat skill's `SKILL.md` (`~/.agents/skills/x-unbloat/SKILL.md` for a global install, `.agents/skills/x-unbloat/SKILL.md` for a local one) to every reviewed file. Report findings under a `[Bloat]` heading in the plan, each naming the ladder rung it fails and the unbloated version: speculative abstractions (one-implementation interfaces, single-use factories, pass-through wrappers) are MAJOR; dead code, unused options, and re-implemented stdlib are MINOR. A branch for a state the types or the internal callers rule out is reported here too, with the narrower representation named as the fix (x-unbloat's *Bloat, Unless…* row; the rule is *Make the Bad State Impossible* in x-implement's `SKILL.md`) — MAJOR when a caller must handle a failure the type could have excluded, MINOR when the check is only redundant, and never flagged where the input crosses a trust boundary. Never flag what x-unbloat's *Never Cut* list or a *Keep it if* exception protects. Report only: the cuts are x-fix's job.
5. **Run the architecture pass (always, using x-arch and x-arch-lint)** — apply the rules in the x-arch skill's `SKILL.md` (`~/.agents/skills/x-arch/SKILL.md` for a global install, `.agents/skills/x-arch/SKILL.md` for a local one) to every reviewed file, and run `node ~/.agents/skills/x-arch-lint/scripts/arch-check.mjs --root .` (`.agents/skills/x-arch-lint/scripts/arch-check.mjs` for a local install). Report findings under an `[Architecture]` heading: a bag name, a crossed boundary, a misplaced responsibility or a wrong-way import is MAJOR. Give the heading one row per unit the pass judged, naming the group, the verdict, the reason and a `file:line`, and copy the checker's `rated` and `unrated` lists in so a green run over an undeclared tree is not read as full coverage. Report only: the moves are x-fix's job.

The complexity script auto-installs tree-sitter if missing (global install). Each script prints JSON, and the keys mislead on first read — `functions` is nested inside a file, and `duplicatedBlocks` is a **count**, not the list:

```
analyze-complexity.mjs   { files: [ { file, functionCount, functions: [ { name, line, length, complexity, paramCount, issues[] } ] } ],
                          summary: { totalFiles, totalFunctions, highComplexity, longFunctions, tooManyParams, language, thresholds } }
check-duplication.mjs    { totalFiles, duplicatedBlocks, duplicates: [ { file, lines, occurrences[], sample } ] }
analyze-patterns.mjs     { results, totalFiles, message }
```

`summary.language` says which engine ran: `tree-sitter (AST-based)` or `regex fallback`. Regex metrics have no parameter counts and approximate line numbers, so say which engine you reviewed with when it is not the AST one.

A count in the plan is a measurement, and an unmeasured count is not a zero. When an analysis script fails, `save-plan.mjs` writes `unknown — <script> failed, so this was not measured` and an "Analysis incomplete" note naming the reason. Carry that into the review: never report a failed analysis as a clean result.

For engineering principles definitions and violation patterns, see `references/principles.md`.

**After running the scripts:** The plan file path is printed by `save-plan.mjs`. Open that file with `view` or `edit`, then write your review content directly into it using the format below. **Do not use MCP resources to read/write plan files — they don't exist.**

## Related Skills

- **x-refactor** — Use after reviewing this plan to get automated refactoring suggestions (extract method, rename variables, replace conditionals). Run `x-refactor` on flagged files for before/after comparisons. Note: `x-refactor` provides analysis only; apply changes manually based on its suggestions.
- **x-debug** — For runtime errors or behavioral issues that require hypothesis-driven investigation rather than static code analysis.
- **x-unbloat** — Required on every review. Finds code that does not need to exist: speculative abstractions, pass-through wrappers, unused options, dead code, re-implemented stdlib. Route bloat findings to `x-fix`, which applies them per x-unbloat's rules.
- **x-arch** — Required on every review, with **x-arch-lint**. Judges where a unit lives, what it is called, what its one responsibility is and which way its dependencies point; `x-arch-lint` checks the same tree against `.x-skills/config/arch.json` and reports `file:line` violations. Route architecture findings to `x-fix`.
- **x-comments** — Required on every review. Enforces commentary rules (remove obvious comments, refactor over-commented blocks into named functions, keep only `why` comments). Route comment findings here.

## Severity

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Violates SRP or introduces bug risk | Must fix before merge |
| MAJOR | Clear SOLID/KISS/DRY violation | Should fix |
| MINOR | Style or minor optimization | Nice to have |

**CRITICAL SRP note:** a function that interleaves phases (fetch, validate, probe, decrypt) with inline reporting (`push` to a shared results array inside each branch) is an orchestrator-with-interleaved-reporting violation — always CRITICAL. Verify with the two extract tests in `references/principles.md` (one-sentence test, reporting test).

## Output Format

Produce a review and save it into the run folder. Use `save-plan.mjs` to create the directory and generate a numbered plan file:

```bash
node <path-to>/scripts/save-plan.mjs --slug <topic>
```

The script prints the full path. Open that file with `edit` or `write`, then insert your review content using this format:

```markdown
# Code Review — Fix Plan

**Date:** YYYY-MM-DD-hhmm
**Counts below:** repo-wide (`--all`), so they describe the whole repository, not the scope you were asked to review.
**Files analyzed:** N
**Functions with complexity > 5:** N
**Functions longer than 20 lines:** N
**Duplicated blocks found:** N

---

## [PRINCIPLE] — Brief description

- [ ] **Severity:** CRITICAL / MAJOR / MINOR
  - **File:** `path/to/file.js:42`
  - **Issue:** What's wrong (one sentence)
  - **Suggestion:** How to fix it (concrete, actionable)

---

## Summary

**Total issues:** N (**critical:** N, **major:** N, **minor:** N)
**Status:** 0/N resolved | Review issues manually or run `x-refactor <file>` for automated suggestions.
```

Apply fixes manually based on review findings. Track progress by updating checkboxes `[ ]` → `[x]`.

A plan without a `[Comments]` section is **incomplete, not clean**: the comments pass is step 3 of every
review, including a re-run, and its findings belong under that heading (say so plainly when it found
nothing). `[Bloat]` and `[Architecture]` are the same: steps 4 and 5 run on every review, so a plan missing
either heading is incomplete rather than clean. On a re-run, carry each earlier finding forward as resolved or
still open, and list pre-existing findings apart from the ones this branch introduced, so the counts describe
the change under review.

## Next Steps — Which Skill to Use

After saving the plan file, recommend the appropriate next skill based on what was found:

| Review finding | Recommended skill | Why |
|----------------|-------------------|-----|
| Any issues that need fixing (complexity, SOLID violations, duplication) | `x-fix` | Reads your plan and actually edits source files to resolve each issue |
| Structural refactoring suggestions without applying changes | `x-refactor` | Analysis-only — produces before/after comparisons but doesn't edit code |
| Behavioral bugs or runtime errors that need investigation | `x-debug` | Hypothesis-driven debugging — reproduce, isolate root cause, then fix with x-fix |
| Bloat — speculative abstractions, wrappers, unused options, dead code | `x-unbloat` | Walks the ladder, cuts one thing at a time, and keeps what the *Never Cut* list protects |
| Architecture — a bag name, a crossed boundary, a misplaced responsibility, a wrong-way import | `x-arch` | Judges placement and naming by hand, and `x-arch-lint` checks the declaration for `file:line` violations |
| Comment noise, obvious comments, over-commented blocks | `x-comments` | Removes noisy comments and refactors over-explained blocks into named functions |

For most review workflows: **use `x-fix`** to resolve issues from your plan. Use `x-refactor` only when you want suggestions without applying changes.
