# The o-research loop

The loop is a state machine over numbers. Every transition is a comparison of two
recorded values, so the stop can be re-derived from `state.json` alone.

## States

```
baseline ──record baseline──► iterate
iterate ──candidate kept/reverted──► iterate        (metric gap remains, under cap)
iterate ──candidate──► done                          (metric meets target + evaluator + guard pass)
iterate ──candidate──► escalate                      (cap reached, target unmet)   ── STOP
done / escalate = STOP_PHASES
```

`start` → `baseline`. One `record --baseline` → `iterate`. Each
`record --candidate` advances one experiment.

## Evaluator kinds

The machine consumes one normalized shape per iteration: `{ pass, score }`. It is
produced either by a command or by the agent's own judgment.

| Kind | `--evaluator` | Per-iteration input | `score` | `pass` |
|------|---------------|---------------------|---------|--------|
| command | `"<cmd>"` | the command's JSON | the command's `score` | the command's `pass` |
| agent | `agent` (+ `--criteria <n\|file>`) | `--coverage <k/n>` | `k/n` | `k === n` (all met) |

- **command** is the mode o-research uses: `ledger.mjs score` prints the JSON, and you pipe it in
  (`ledger.mjs score --dir <dir> | state.mjs record --dir <dir> --candidate -`). Start the run with
  `--policy pass_only --target 1`. `pass` is the ledger's integrity, and `score` is answered questions
  plus passed gates over their total, reaching 1 only when every question clears the depth bar and every
  gate holds (`references/depth.md`). `state.mjs` records whatever JSON it is piped, so a run is finished only
  when `ledger.mjs verify` also exits 0: it re-scores the ledger and checks that the loop stopped in `done`.
  o-tune uses the same mode for a number a command prints.
- **agent** is the older mode, where the agent judges `k/n` coverage of fixed criteria. It cannot grow
  its questions, and it stops at one citation per criterion, so a deep run does not use it. It stays in
  the shared machine for o-tune and older runs.

Both kinds feed the identical gates below; nothing downstream distinguishes them.

## Gates (all numbers)

| Gate | Comparison | On fail |
|------|-----------|---------|
| metric vs target | `score >= target` (maximize) or `score <= target` (minimize) | keep looping |
| evaluator pass | `pass === true` | revert the candidate |
| guard pass (optional) | guard exit code `0` | revert the candidate |
| improvement (policy `score_improvement`) | `delta >= min_delta` | revert the candidate |
| noise | `samples >= noise_runs` | revert the candidate |
| atomicity | `changed.length === 1` | revert the candidate |
| evidence (agent mode) | criteria cited in `--evidence` ≥ criteria claimed met | revert the candidate; it cannot stop the run |
| search | every path allowed ∧ none forbidden | revert the candidate |
| cap | `iteration >= cap` | escalate |

Each is written into the history entry as `{ actual, expected, pass }`. `verify`
recomputes the metric, evaluator, and guard gates for the held-best entry and exits
0 only when all pass — i.e. only a genuine `done` is justified.

## Keep vs revert

The held state (`state.best`) only moves forward:

- `pass_only` — keep a candidate iff the evaluator passes (the guard, noise,
  atomicity, and search gates still apply).
- `score_improvement` — keep a candidate iff it passes **and** its metric beats the
  held best by at least `min_delta`. A change smaller than `min_delta` counts as
  noise and is reverted.
- **Agent mode** — a candidate that raises coverage is kept as progress under either
  policy, even while some criteria are unmet: its text stays in the research file, so
  the trail must say `keep`. Coverage the `--evidence` file does not cite is not
  coverage: such a candidate is reverted and can never stop the run. A run started
  with `--no-evidence` skips this gate and records that it did.

- **o-research** runs `pass_only`: a round is kept whenever the ledger is intact, even when it lowered
  the score by adding questions, because a bigger tree is progress. A round is reverted only when the
  ledger is broken (a hand edit, an unknown id); fix the ledger rather than restoring files.

A reverted experiment is still recorded — full history, kept and reverted alike.

## Why a cap and an escalation

A metric loop can plateau. The cap turns "keep trying" into a bounded budget; when
it runs out without the target, the loop **escalates**: it writes `final_report.md`
with the remaining gap and stops. That is a reported outcome, not a failure to hide.

## Reading the audit trail

- `research.md` — the config and the human-readable history table, rewritten by every `record`; below the
  findings marker, the agent's findings, which every `record` keeps.
- `memory.md` — started by `start` with the candidates; append to it, never rewrite it.
- `research_log.md` — append-only, one line per event.
- `results.tsv` — machine-readable rows: `iteration, kind, score, pass, guard_pass,
  delta, decision, change`.
- `final_report.md` — written at stop only.
- `ledger.jsonl` — the research evidence, one event per line (`ledger.mjs`), safe for parallel writers.
- `ledger.md` — the evidence appendix `ledger.mjs render` writes from it, which the report links.
