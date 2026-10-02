---
name: o-debug
description: Evidence-based debugging — reproduce, hypothesize, fix root cause, verify
version: 1.0.0
author: Community
tags: [debugging, root-cause, reproduction, verification]
user-invocable: true
---

# X-Debug — Reproduce → Hypothesize → Fix → Verify

Do not suppress errors, disable reporting, or add try/catch that swallows them. Fix the cause and verify with the reproduction script.

## Critical: Run analyze.mjs First (Always)

**Before any analysis, hypothesis testing, or fixing begins**, execute `analyze.mjs` with the user's bug description as the error text:

```bash
node <path-to>/scripts/analyze.mjs --error "<user's bug description>" --context .
```

This creates:
- `<run folder>/E<nn>-debug.md` — debug session doc (required for o-fix handoff)
- `<run folder>/E<nn>-fix-plan.md` — fix plan (required input for o-fix skill)

Both start with a property block: the session is `type: debug` and links the brief or review named by `--fixes`, and
the fix plan is `type: fix` and links the session it was written from — so the run reads as one chain in Obsidian.

**Never skip this step.** It is required even for behavioral bugs with no stack trace (e.g., "SSE event not triggered", "wrong value displayed"). analyze.mjs will create empty hypothesis lists in that case, but the docs MUST exist before any further work.

## Usage

```bash
node <path-to>/scripts/analyze.mjs --error "TypeError: Cannot read property 'foo' of undefined" [--file src/main.js]
node <path-to>/scripts/analyze.mjs --context . [--session-id my-session]
node <path-to>/scripts/analyze.mjs --no-reproduce --error "..."  # skip auto-reproduction
node <path-to>/scripts/analyze.mjs --error "..." --fixes <run folder>/E<nn>-triage.md  # link the brief or review this session answers
```

**Output**: Debug session and fix plan as `E<nn>-` artifacts in one run folder under `.x-skills/runs/`.

## Workflow (4 Steps)

### 0. Initialize — Run analyze.mjs
Execute `analyze.mjs` with the bug description. This is mandatory and must complete before Step 1. The generated docs are the handoff contract for o-fix later. If auto-reproduction fails, write one manually — never proceed without it.

### 1. Reproduce Locally
`analyze.mjs` generates `repro-*.js` for known error patterns. Run it to confirm the error triggers locally. If auto-reproduction fails, write one manually — never proceed without it.

**The loop is the skill.** A tight pass/fail signal that goes red on *this* bug is what every later step consumes, so treat the repro as a product: tighten it (faster, sharper assertion, more deterministic), and for a flaky bug raise the reproduction rate until it is debuggable instead of chasing a clean repro. Name one command that you have already run and that goes red, before Step 2. Pick the construction and the tightening moves from `references/feedback-loops.md`; when no loop can be built, stop and ask for artifacts or instrumentation — never hypothesise without one.

### 2. Hypothesize & Test
The script lists hypotheses ranked by likelihood. For each, run the proposed test and mark `[ ]` → `[x] Confirmed` or `[ ] Rejected` in the run's `E<nn>-debug.md`. Eliminate until one cause remains.

### 3. Fix Root Cause (NOT Silence)
Apply a targeted fix that eliminates the error condition:
- **DO** ensure the error can no longer occur
- **DO NOT** add try/catch wrappers that swallow errors silently
- **DO NOT** disable error reporting or set `process.exit(0)` on failure paths
- **DO NOT** use `console.error` as a substitute for fixing

### 4. Verify
Run the run folder's `E<nn>-verify.js` after applying the fix. Issue is NOT resolved until verification exits 0. If it fails, go back to Step 2.

## Related Skills

- **o-fix** — Reads fix plans from the run folder and applies fixes with verification
- **o-review** — Static code quality analysis (complexity, SOLID violations), not runtime errors

## Definition of Done

- [ ] Reproduction script triggers the same error locally
- [ ] The repro loop is tight and red-capable: one named command, already run, that goes red on this bug
- [ ] Root cause identified through hypothesis elimination
- [ ] Fix applied (not silenced)
- [ ] Verification script passes (exit 0)
