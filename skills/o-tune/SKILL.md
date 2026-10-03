---
name: o-tune
description: Tune a measurable number toward a target — bundle size, page load time, latency, a test's pass rate, a prompt's judge score — one atomic change per experiment to code, config or a prompt, each scored by a command and kept only when the numbers improve; reverted changes are restored from a snapshot, and a hard cap stops the loop. Use when asked to optimize, tune, or drive a metric (latency, size, load time) down or up until it reaches a target.
version: 1.0.1
author: Community
tags: [optimize, tune, metric, experiment-loop, benchmark, performance]
user-invocable: true
---

# O-Tune — One Measured Change at a Time

Drive a number toward a target instead of a feeling. You name the metric, its direction and the target; each
experiment makes **one atomic change**, a command scores it, and the change stays only if the numbers say so:

```
baseline → [ snapshot → ONE change → evaluate → keep, or restore the snapshot → record ]
             stop when the metric meets the target AND the evaluator (and guard) pass
             at the hard cap, escalate with the remaining gap instead of looping forever
```

This is a loop **contract**, not a runner: each invocation runs one experiment and returns. Repetition is the
host's (`references/running-unattended.md`), and the host's permission and approval gates always win — the loop
never asks for them to be skipped. For research toward cited coverage of questions rather than a number, use
`o-research`.

`<skill>` below is this skill's folder.

## Rules

1. **A gate that asks wins.** A host pause for permission or approval stops the loop until it is answered.
2. **One atomic change per experiment.** `--changed` names the paths it touched; more than one path fails the
   atomicity gate and the change is reverted.
3. **A revert restores the files.** Run `snapshot` before each experiment; a `revert` decision puts the
   snapshotted files back and removes files the experiment created. Without a snapshot the record says so, and
   you reverse your own edit — never `git checkout` or `git restore`, which also drop work that is not yours.
4. **Bounded, always.** `--cap` limits the experiments; hitting it without the target escalates with the gap.
5. **The numbers decide.** `score_improvement` keeps a passing candidate that beats the best by at least
   `--min-delta`; `pass_only` keeps any passing candidate. `verify` re-derives the stop from the recorded numbers.

## The contract

| Part | Meaning | Flag |
|------|---------|------|
| metric, direction, target | the number, `maximize` or `minimize`, and where the run ends | `--metric`, `--direction`, `--target` |
| evaluator | a command printing `{"pass": bool, "score": number}` (or a bare number) | `--evaluator` |
| guard | a command whose exit 0 gates a keep (usually the test suite) | `--guard` |
| policy | `score_improvement` or `pass_only` | `--policy` |
| noise | samples per evaluation, and the smallest gain worth keeping | `--noise-runs`, `--min-delta` |
| search space | globs a change may and may not touch | `--allow`, `--forbid` |
| timeout, cap | per-experiment limit, hard experiment limit | `--timeout`, `--cap` |

## Procedure

1. **Start**, with three candidate changes researched first (`references/research-first.md`):

   ```bash
   node <skill>/scripts/state.mjs start --slug bundle-size --goal "ship the smallest JS bundle" \
     --metric bundle_kb --direction minimize --target 120 --policy score_improvement --min-delta 0.5 \
     --noise-runs 3 --cap 12 --timeout 30000 --evaluator "node tools/measure-bundle.mjs --json" \
     --guard "npm test --silent" --allow "src/**,vite.config.*" --forbid "**/*.test.*" --candidates candidates.md
   ```

   Run it from the project root, so the run lands in the project's `.o-skills/runs/` and not in a scratch folder
   (`start` warns when it does). `node <skill>/scripts/state.mjs --help` lists every command and flag.

2. **Baseline:** run the evaluator once and record it — `record --dir <dir> --baseline <score|file>`.
3. **Each experiment:**

   ```bash
   node <skill>/scripts/state.mjs snapshot --dir <dir> --changed src/icons.ts
   # make the one change
   node <skill>/scripts/evaluate.mjs --command "<evaluator>" --timeout 30000 --guard "<guard>" > cand.json
   node <skill>/scripts/state.mjs record --dir <dir> --candidate cand.json --changed src/icons.ts --change "inline the icon map"
   ```

   `record` prints `next` (`iterate`, `done` or `escalate`) and, after a revert, the `restored` paths.
4. **Stop:** `node <skill>/scripts/state.mjs verify --dir <dir>` exits 0 only when the stop is justified; an
   escalation is a reported stop, never a success.
5. **Report** the metric baseline → best, the kept changes, the evidence commands, and on escalation the gap left.
   The trail is in the run folder: `research.md`, `research_log.md`, `results.tsv`, `final_report.md`.

## Files

- `scripts/state.mjs` — the numeric loop state machine (`start`, `snapshot`, `record`, `status`, `verify`); the
  same file o-research ships, kept identical by a test.
- `scripts/evaluate.mjs` — runs the evaluator and guard with a hard timeout and prints `{ pass, score }`.
- `references/loop.md` — the gates, the two policies and the state diagram.
- `references/running-unattended.md` — how each host repeats the loop.
- `references/questions.md`, `references/research-first.md` — the shared question and research rules.
