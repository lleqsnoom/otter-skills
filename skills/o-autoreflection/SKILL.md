---
name: o-autoreflection
description: Turn sessions into approved skill fixes — `o-autoreflection <period>` (24h, 7d, 2w) reads every session transcript of that window across every CLI, extracts the friction, writes one skill-health report and a fix plan, and proposes each fix as one multi-select option, applying only what is picked with a revert-on-failure ledger; without a period it reflects on the current one. Use for "reflect on this session", "what went wrong above", "retro", "analyze my last week of sessions", "what has been failing across my skills", "heal the skills from that report".
version: 1.5.2
author: Community
tags: [reflection, retrospective, self-improvement, transcript, session, analysis, batch, healing, skills]
user-invocable: true
---

# O-Autoreflection — Sessions In, Approved Skill Fixes Out

A session is a test run of the skills it used; many sessions are a test suite. This skill reads them
and turns what it finds into fixes a human approves.

One period, one command, three stages:

| Stage | What happens | Who decides |
|-------|--------------|-------------|
| **Analyze** | `improve.mjs` traverses the period across every CLI, scans each session, and writes the report (`E<nn>-analysis.json` + `.md`) and a fix plan (`E<nn+1>-heal.json`) | the script — mechanical, no judgement |
| **Propose** | the agent opens each finding's target, writes the exact edit, gates the plan, asks whether an auto-heal session is wanted at all, then offers the shaped fixes as one multi-select panel | the agent shapes, **you pick** |
| **Apply** | `heal.mjs --apply` edits each picked item, runs its check, reverts on failure, and appends `heal-ledger.jsonl` | the script, on your picks only |

Two kinds of evidence feed all of it, both found by a **script, not a feeling**. **Friction** is a step
that failed, repeated, or was corrected. **Quality anchors** are what a clean-but-weak session leaves
instead: the user asked for the work again, handed it to another agent, refused a skill's step, or a
skill script "succeeded" without printing anything. `scan-session.mjs` extracts both, so two agents
reading the same sessions start from the same evidence.

A **stalled run** is the one defect that shows in both, and it is read first: the agent waited on a
command that was never going to finish (a dev server, a watcher), the wait came back still running, and
the turn could only end when the user broke it ("you are stuck on one step for 20 minutes", "running the
app with no time limit", "add some timeout"). `blocking-wait` is that wait; `user-stuck` is the user
saying it. Neither needs the other, and either one is a finding that outranks a failed step.

`<skill>` below is this skill's folder.

## When to use

- **A period** — "analyze the last day/week of sessions", "what has been failing across my skills",
  "give me a skill-health report", "heal the skills from that report", "improve the skills based on
  what happened".
- **One session** — "reflect on this session", "what went wrong above", "retro", "retrospective",
  "improve the skills based on what just happened", or a skill that felt wrong while you used it.
- Before a release: a period run over the last few days shows the shape of the window.
- For one artifact use `o-roast`; for source code use `o-review`. This skill reviews **sessions**,
  which is the only thing that shows a skill's instructions failing in practice.

## The window run

### 1. Confirm the period, then run it

Ask one panel before running — the window is the only input that changes what the report says.

| Panel | Shape | Options |
|-------|-------|---------|
| Period | `single` | last hour (`1h`) · last 24 hours (`24h`) · last 7 days (`7d`) · last 30 days (`30d`) |

A free-answer field lets the user type their own period. Host scope is a flag, not a question: default
to every detected host, and mention `--host crush,codex` if they want to narrow it.

```bash
node <skill>/scripts/improve.mjs 7d
node <skill>/scripts/improve.mjs 24h --host crush,codex --max 40
node <skill>/scripts/improve.mjs 24h --no-plan      # report only, for a window the user wants to read first
```

A period is `24`, `24h`, `7d` or `2w`; minutes are not a window, they are a session (`--session last`).
One command does the mechanical half — traverse, scan, report, gate, mint the plan — and prints one JSON
line: the run folder, the report paths, the plan path, the report's numbers, and the plan's items with
each one's issue, rate, class and scores. A window with no o-skill sessions still writes a report that
says so: a quiet day is a result, not a failure.

For a window that is too slow to re-traverse, `--max <n>` caps the sessions scanned (default 60) and
`--scans <dir>` aggregates `*-signals.json` files already on disk.

### 2. Run the model pass over the window

No script can find the issues worth fixing: nobody knows in advance what a user will have to correct, so
a lexicon only finds the phrasings someone listed. A model reads the window's real turns instead, and
`hunt-issues.mjs` does what the model cannot do for itself — it assembles the material from the
transcripts and checks the answer back against them. Two passes, and both are worth running: the
**session pass** asks what recurs across the window, and the **per-skill pass** — the one the healing
stage feeds on — puts one used skill's own `SKILL.md` in the model's hands beside the turns where that
skill was in play, and asks which line should say something else.

```bash
node <skill>/scripts/hunt-issues.mjs --build --hours 240 --out <run folder>   # writes E00-issues-prompt*.md and E00-skill-<name>-prompt.md
<model> < <run folder>/E00-issues-prompt-01.md > answers.md                   # any model; the host chooses
<model> < <run folder>/E00-skill-o-review-prompt.md > answers-o-review.md     # one per skill the window used
node <skill>/scripts/hunt-issues.mjs --read answers.md --dir <run folder>     # verifies, writes E00-issues.json
node <skill>/scripts/hunt-issues.mjs --read answers-o-review.md --dir <run folder> --by-skill   # writes E00-skill-issues.json
node <skill>/scripts/improve.mjs 240h --issues <run folder>/E00-issues.json,<run folder>/E00-skill-issues.json
```

Each claim is dropped unless its quote is really in the turn it cites and the theme spans at least two
sessions; a dropped claim is reported with the rule it broke. The per-skill pass adds two rules of its
own: every ref has to come from a session where that skill was in play, and the line the fix changes has
to be in that skill's `SKILL.md` — quoted verbatim, or declared new because the file has nothing for it.
An accepted per-skill finding therefore arrives as a delta on a file, with the quoted line prefilled into
the plan's `find`. `references/issue-hunt.md` has the rules the model follows and the bar its answers must
clear.

### 3. Read the report

Open the markdown. It opens with **Read first** (the sessions ranked by their quality anchors, one per
owning skill, plus one quiet session to audit) and **Asked again in a later session**, then **Skills in
use**, **Findings** (ranked, recurrence first), **Portfolio** (structural moves) and **Notes**. Say out
loud what the numbers are: how many sessions, which skills, how many high signals, and what failed.

`references/window-report.md` has the artifact's schema, what each section means, how findings and
portfolio items are derived, and the heal rulebook. Read it before touching the plan.

### 4. Ask whether to heal at all

The report is a result on its own. Before any plan work, ask one `confirm` panel: whether to start an
auto-heal session from this report. Say what it costs — the agent opens each flagged skill and edits it,
and the user will be asked to pick the fixes — and that the report stays on disk either way.

On **no**: stop here, say where the report is, and offer the period again with a narrower window. Do not
mint a plan, do not touch a skill file.

### 5. Turn the findings into exact edits

The plan already exists (unless `--no-plan` was used — then run
`node <skill>/scripts/heal.mjs --mint "<run folder>/E<nn>-analysis.json"`). It carries one item per
finding, with `issue`, `severity`, `recurrence`, `count`, `scores`, the `improvement` rate and the
`change` hint filled, and `target`, `find`, `replace`, `check`, `auto`, `watch`, `skill_md` left for you.

Work down the findings in rank order (recurrence first). For each, **open the target file** and fill the
item: the smallest `find`/`replace` that answers it, a `check` that exits 0 once the fix is in, and
`auto: true` only for the four mechanical classes. **A quality finding gets the instruction it was
missing**: `skill_md` names the `SKILL.md` line (or the reference file) the fix changes, and the same
behaviour goes to `evals/expectations.json` as its copy — a plan that writes only the expectation leaves
the instruction that failed untouched, and `check-heal.mjs` refuses it. A finding no skill owns sets
`global: true` and targets the user's own preferences file. The rules — the auto whitelist, the six
quality classes that always name a `watch`, `expectations.json`, why a measure is never edited with what
measures it — are in `references/window-report.md`. A finding you drop after reading its file is
**deleted from the plan**, not left empty.

### 6. Gate the plan

```bash
node <skill>/scripts/check-heal.mjs --file "<run folder>/E<nn>-heal.json"
```

Exit **0** clean, **1** when an item lacks a target, an issue, a rate or (for `auto`) a find or a check,
names a class outside the auto whitelist, gives a quality fix no `watch` or no `SKILL.md` line, or edits a
measure beside the skill it measures; **2** on a usage error. Fix each violation and re-run.

### 7. Offer the fixes, one selectable option each

Render a `multi` panel from the plan's items — one option per fix, and each option carries the three
lines the user is deciding on:

| Line | What the user reads |
|------|---------------------|
| **Issue** | the finding: `kind` and `summary`, its `severity`, `recurrence` × `count`, the owning skill, and the session/message the evidence came from |
| **Fix** | `target`, then `find` → `replace`, and the `check` that proves it landed; for a quality fix, the `skill_md` line it adds and the expectation it writes beside it |
| **Expected improvement** | the `improvement` rate, plus the skill's `scores` as they stand now (`sessions`, `loaded`, `used`, `unused`, `high/medium/low`) |

Include the `auto` items as selectable options. Quality items are listed too, marked as proposals the
script will never apply: they name their `watch`, because whoever lands one needs to know which number
to read in the coming days. Portfolio items (create/merge/split/delete) are shown as decisions, never as
edits. Say which items you dropped and why — a dropped finding is a result.

### 8. Apply the picks, then report the ledger

```bash
node <skill>/scripts/heal.mjs --plan "<run folder>/E<nn>-heal.json" --apply F1,F3 --dry-run
node <skill>/scripts/heal.mjs --plan "<run folder>/E<nn>-heal.json" --apply F1,F3
```

Only the picked ids are applied, and only `auto` ones; each edit runs its check and **reverts** if the
check fails, so a skill is never left broken. The ledger line lands in `heal-ledger.jsonl` beside the
plan, and every skill-level line also lands in that skill's own `skills/<name>/.heal-ledger.jsonl`, so a
skill's edit history is one append-only trail. A first applied edit also writes
`skills/<name>/.self-authored.json`, and the run's landed/rejected names are written to
`.o-skills/runs/last-heal-summary.json` for the next session to read. Portfolio `merge` records which
skill absorbed which, and portfolio `delete` archives the directory to `skills/.archive/` rather than
removing it, so a fold and a prune stay distinguishable and revivable. Report one line each for applied,
reverted, stale, skipped, and the quality proposals left with their `watch` — a revert is a result to
read, not silence: the check disagreed, so the fix was wrong and the report stays as the evidence.

## The single-session reflection

When the friction is still fresh, or a window report flagged one session worth reading properly: pick a
session, scan it, verify each signal against the real file, write the reflection, gate it, and route the
proposals.

```bash
node <skill>/scripts/read-session.mjs --session last --out /tmp/session.json
node <skill>/scripts/scan-session.mjs --input /tmp/session.json --out /tmp/signals.json
node <skill>/scripts/save-reflection.mjs --slug <slug> --session "<title>"
node <skill>/scripts/check-reflection.mjs --file "<run folder>/E<nn>-reflection.md" --scan /tmp/signals.json --transcript /tmp/session.json
```

The full procedure — how to pick a session, what the scan reports, how to judge a quality anchor, the
reflection format — is in `references/session-reflection.md`. Read it before reflecting; the gates below
are the summary, not the method.

### The environment, not only the skills

A session that went sideways is often the agent's environment, not a skill file. Scan for those candidates
too, beside the skill signals, across seven categories:

- **Navigation** — the agent took long to find a file; a navigation pointer would have cut the detour.
- **Automated checks** — a mistake a lint, typecheck, test or filesystem linter could have caught; an existing
  check that sits unwired or silently broken is itself the finding, and a repo with no guardrail is a standing
  missed opportunity.
- **Coding standards** — a mistake the reviewer should enforce. Classify it first: a **mechanical** violation
  (fixed syntactic pattern, banned API, import shape, file location) becomes a deterministic check — a lint
  rule, a pre-commit hook, a CI job, whichever is cheapest; a **judgment** call becomes a written standard.
  Default to building the check over writing the rule.
- **Steering files** — instructions that no longer modify behavior are no-ops; prune them, and move standards
  out of oversized steering files into the standards doc they belong in.
- **Tool economy** — an expensive tool call that custom tooling or an MCP would make cheap.
- **Information access** — a decision made blind because a log, an endpoint or a read-only view was not
  available; tee it.

Environment findings route like any other proposal (fix, spec, or tasks), and carry the same evidence bar: a
`file:line`, a command, or a message index.

## Gates

| Gate | Passes when | Checked by |
|------|-------------|-----------|
| `session_loaded` | a transcript was read and has at least one user message and one tool call | `read-session.mjs` reports non-zero counts |
| `signals_recorded` | `scan-session.mjs` ran and its JSON is in the reflection | `check-reflection.mjs` (empty `Signals` section) |
| `signals_verified` | every high signal was checked against the real file and kept, re-graded, or dropped | *contract* — the checker sees a verdict, not the reading |
| `no_open_questions` | every question was asked as a panel and answered | *contract* — `check-questions.mjs` checks the questions, not the session |
| `proposals_shaped` | each proposal has a `Signal`, `Target`, `Change`, and `Check` line | `check-reflection.mjs` (`proposal-shape`) |
| `high_signals_answered` | every `high` signal has a keep / re-grade / drop verdict, and a kept one is cited by a proposal | `check-reflection.mjs` (`unanswered-high`, `kept-without-proposal`) |
| `scan_is_evidence` | the scan reports messages and tool calls, so it is a session and not a stub | `check-reflection.mjs` (`scan-not-evidence`) |
| `quality_anchored` | every kept quality anchor has a `## Quality` line whose quote is in the transcript and whose skill line exists, and its proposal names a `Watch:` rate | `check-reflection.mjs --transcript` (`quality-unanchored`, `quality-quote`, `quality-skill-line`, `quality-watch`) |
| `reflection_checked` | `check-reflection.mjs` exits 0 | the exit code |
| `route_chosen` | the user picked which proposals to pursue | *contract* — recorded in `Routes` |
| `report_shaped` | every finding cites a session and a message, and every portfolio item is shaped | `check-analysis.mjs` (`no-evidence`, `portfolio-action`) |
| `skill_delta` | every per-skill proposal quotes a line really in that skill's `SKILL.md` (or declares it new) and cites only sessions where the skill was in play | `hunt-issues.mjs --read --by-skill` (`the quoted line is not in`, `was not in play`) |
| `plan_shaped` | every item names its target, its issue and its rate; every `auto` item a find and a check; every quality item a `watch` and the `SKILL.md` line it changes | `check-heal.mjs` (`item-issue`, `item-improvement`, `item-find`, `item-check`, `item-skill-md`) |
| `measure_separated` | no detector, gate or taxonomy is edited in the same plan as a skill it measures | `check-heal.mjs` (`measure-and-measured`, `auto-measure`) |
| `heal_chosen` | the user picked the fixes, and only those were applied | `heal.mjs --apply` takes the ids, the ledger records them |
| `proof_or_revert` | every applied edit passed its check or was reverted | `heal.mjs` reverts on a failed check |

The starred rows are contracts, not commands: nothing can verify that you read a file or rendered a
panel. Keep them honest yourself, and do not let the machine-checked rows imply the others.

## Panels

Define the four shapes inline at first use: `single` (one of several), `multi` (several at once), `open`
(free text), `confirm` (yes/no). Ask in a panel, never in prose, and never bury a question in a
paragraph. This skill asks at most three: the period, whether to heal, and which fixes to take. Build the
options from the artifacts — the report's rankings and the plan's items — not from memory, and let
`scripts/check-questions.mjs` check the questions first.

## Constraints

1. **Evidence or silence.** Every proposal quotes a message index, a `file:line`, or a command. No "the
   skill could be clearer", and nothing the scan did not see.
2. **Recurrence, not volume.** A finding's strength is how many sessions share it, never how many
   signals one session produced. A count that ran 174 times and one that ran 6 are not comparable.
3. **The script finds, you judge.** Verify a signal before it becomes a finding; a `high` signal is a
   lead, not a proven defect.
4. **Never propose a change to a skill you did not open.** Read the file before naming a line.
5. **Mechanical classes only, and reversible.** `auto` is four classes; everything else is a proposal.
6. **The human triggers healing.** The script applies only the ids picked in the panel — and the
   auto-heal question comes before any plan work, so a user who wants only the report gets only the report.
7. **Deltas, not rewrites.** Every edit is the smallest `find`/`replace` that answers the finding.
8. **The measure is not edited with the measured.** Detectors, gates, taxonomies and a skill's own
   checks change only on their own, reviewed, never in a plan that also edits the skills they grade.
9. **Never silence the failure.** A reverted item stays reverted and named, not wrapped so the check passes.
10. **A shortfall outranks friction.** Read the `Read first` sessions before any friction-only one.
11. **A regression is a model change until proven otherwise.** Check the model mix under a skill before
    aiming a fix at the skill.
12. **One artifact, two files.** The report's markdown is rendered from its JSON; never edit it by hand.
13. **The instruction is the deliverable.** A window that ends with better detectors, reports or plans and
    no new `SKILL.md` line has improved nothing the agent reads: every accepted finding lands a line in
    the file it was aimed at, and the panel names that file. A whole window without one is a finding about
    this skill.

## Anti-patterns

- Reporting the scanner's output as the analysis, or re-deriving the report by hand
- Healing without asking: minting a plan, or editing a skill, before the auto-heal question is answered
- Asking the period in prose, or guessing it when the user implied a different span
- Applying every finding at once — heal the few most important, defer the rest
- Marking `script-hardening` or `missing-check` as `auto` to get more through, or a quality class at all
- A `check` that is a re-read rather than a command that exits 0
- A `find` that was never read, a `replace` that rewrites a whole section, or a `find` that is not unique
- Loosening a check, a lint rule or a detector in the same plan as the edit it would have caught
- Proposing a portfolio `delete` as an edit — it is a decision to ask, never to auto-apply
- Leaving a dropped finding in the plan as an empty item
- Comparing skills by raw signal count, or comparing two models across different tasks
- Treating model-read `user-pushback` as proven — it is a lead until verdicts validate it
- Filing an `interrupt` as a gap on its own, or arguing a quality anchor away with "every command exited 0"
- Reflecting on a session you never read, from memory or from a summary

## Files

- `scripts/improve.mjs` — the one command for a period: analyze → gate → mint the fix plan, printing the artifacts and the proposal cards.
- `scripts/analyze.mjs` — traverse, scan and aggregate the window into `E<nn>-analysis.{json,md}`.
- `scripts/check-analysis.mjs` — fail while a finding lacks evidence or a portfolio item is unshaped.
- `scripts/heal.mjs` — mint a plan from the report, then apply the picked ids with a revert-on-failure ledger.
- `scripts/check-heal.mjs` — fail while an item is unshaped, names a non-auto class, or edits a measure beside what it measures.
- `scripts/hunt-issues.mjs` — the two model passes: assemble the window's turns (and one file-in-hand prompt per used skill), then verify the answers against the transcripts, each skill's `SKILL.md`, and the sessions it was used in.
- `scripts/read-session.mjs` — lists and exports a session transcript as normalized JSON.
- `scripts/scan-session.mjs` — extracts friction signals, quality anchors, suspect skills, and run folders.
- `scripts/reactions.mjs` — the quality anchors: redo, handoff, rejected tool call, interrupt, silent skill script, and the owner of each moment.
- `scripts/classify-turns.mjs` — builds the prompt a model answers about each user turn, and reads its answers back for `--turns`.
- `scripts/anchors.mjs` — across sessions: requests asked again, the reading order, and the day's audit pick.
- `scripts/save-reflection.mjs` — writes `<run folder>/E<nn>-reflection.md`.
- `scripts/check-reflection.mjs` — fails while a proposal is unshaped or a high signal has no verdict.
- `scripts/check-questions.mjs` — enforces the panel rules on your questions file.
- `scripts/metrics.mjs` — scores every skill in a window of packs: five rates, published weights, a sample floor, and the day-by-day `history.jsonl` that outlives a pruned pack.
- `scripts/derive.mjs` — the movement, the calendar and the bands the report UI reads. Data only: the app under `tools/report-app/` draws, this decides what is true.
- `references/window-report.md` — the report's schema and sections, how findings and portfolio items are derived, and the heal rulebook.
- `references/session-reflection.md` — the single-session procedure: picking, scanning, verifying, the reflection format.
- `references/issue-hunt.md` — the rules the model pass follows, and the evidence bar its answers must clear.
- `references/gap-taxonomy.md` — signal kind → the improvement that answers it.
- `references/quality-judge.md` — how to judge a quality anchor: one narrow question, quoted evidence, a `## Quality` line.
- `references/questions.md` — how to ask as a panel, and when to stop asking.
