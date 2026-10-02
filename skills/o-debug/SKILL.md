---
name: o-debug
description: Evidence-based debugging — reproduce, hypothesize, fix root cause, verify: a reproduction that goes red on the bug, ranked hypotheses tested until one cause remains, and a fix that never silences it. Use when a crash, stack trace or wrong value has to be debugged.
version: 1.1.0
author: Community
tags: [debugging, root-cause, reproduction, verification]
user-invocable: true
---

# O-Debug — Reproduce → Hypothesize → Fix → Verify

Do not suppress errors, disable reporting, or add try/catch that swallows them. Fix the cause and verify with the reproduction.

`<skill>` below is this skill's folder.

## Step 0: open the session with analyze.mjs

Before any analysis, run `analyze.mjs` with the user's bug description as the error text:

```bash
node <skill>/scripts/analyze.mjs --error "<user's bug description>"
```

This creates, in one run folder under `.o-skills/runs/`:
- `E<nn>-debug.md` — the debug session: the error, a Reproduction section, first hypotheses, tests, root cause
- `E<nn>-fix-plan.md` — the fix plan o-fix reads

Both start with a property block: the session is `type: debug` and links the brief or review named by `--fixes`, and
the fix plan is `type: fix` and links the session it was written from — so the run reads as one chain in Obsidian.

The script only writes those two files. It runs nothing and reproduces nothing: the hypotheses it lists are
ranked from the error text alone (it recognizes the common null, undefined, not-callable, recursion, syntax,
missing-module and connection errors), and a bug with no stack trace gets an empty list for you to fill.

```bash
node <skill>/scripts/analyze.mjs --error "TypeError: Cannot read properties of undefined (reading 'foo')" [--file src/main.js]
node <skill>/scripts/analyze.mjs --error "..." --fixes <run folder>/E<nn>-triage.md  # link the brief or review this session answers
```

## Step 1: build the reproduction

**The loop is the skill.** A tight pass/fail signal that goes red on *this* bug is what every later step
consumes, so treat the repro as a product: tighten it (faster, sharper assertion, more deterministic), and for a
flaky bug raise the reproduction rate until it is debuggable instead of chasing a clean repro. It must run the
project's own code — a snippet that throws the same kind of error somewhere else proves nothing.

Save it in the run folder as `E<nn>-verify.<ext>` (a test file or a script in the project's language), record
the command that runs it under the session's Reproduction heading, and run it: it must go red before Step 2. Pick
the construction and the tightening moves from `references/feedback-loops.md`; when no loop can be built, stop
and ask for artifacts or instrumentation — never hypothesise without one.

## Step 2: hypothesize and test

Start from the session's hypotheses, add your own, and rank them by likelihood. For each, run the test that would
tell it apart and mark `[ ]` → `[x] Confirmed` or `[ ] Rejected` in `E<nn>-debug.md`. Eliminate until one cause remains.

## Step 3: fix the root cause (not the symptom)

Apply a targeted fix that eliminates the error condition:
- **DO** ensure the error can no longer occur
- **DO NOT** add try/catch wrappers that swallow errors silently
- **DO NOT** disable error reporting or set `process.exit(0)` on failure paths
- **DO NOT** log the error as a substitute for fixing it

## Step 4: verify

Run the reproduction again. The issue is NOT resolved until it exits 0; if it does not, go back to Step 2.

## Related Skills

- **o-fix** — reads fix plans from the run folder and applies fixes, running `E<nn>-verify` after each
- **o-investigate** — hypothesis-driven root cause analysis when the first look explains nothing
- **o-review** — static code quality analysis (complexity, SOLID violations), not runtime errors

## Definition of Done

- [ ] The reproduction runs the project's own code and went red on this bug before the fix
- [ ] The repro loop is tight and red-capable: one named command, already run, that goes red on this bug
- [ ] Root cause identified through hypothesis elimination
- [ ] Fix applied (not silenced)
- [ ] The reproduction exits 0 after the fix
