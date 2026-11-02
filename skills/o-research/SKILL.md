---
name: o-research
description: Deep research on a topic the user may not know — map the field from its surveys, textbooks and courses first, grow a question tree from that map, and answer every question to a depth bar a script scores (independent sources, a primary one, how it works, where it fails, quotes checked against the page, disputes settled), stopping only when new sources add nothing; the report teaches the field and its best answers. Use for "research X", "deep dive into Y", "what are the best methods for Z", "compile sources on W", or filling the gaps in what we know; to tune a number, use o-tune.
version: 3.0.0
author: Community
tags: [research, deep-research, sources, citations, literature, survey, primary-sources]
user-invocable: true
---

# O-Research — Know the Field, Not Just the Links

The user is often not an expert in the topic, so they cannot tell a shallow answer from a deep one. The run must
tell them. It maps the field first from the field's own sources, so the questions come from how experts divide the
topic and not from a first guess. Then it answers each question to a depth bar that `scripts/ledger.mjs` measures:
independent sources, a primary one, how it works, where it fails, a quote found on its page, and no open dispute.
It stops only when every question clears the bar and new sources have stopped adding anything. The report teaches
what was learned. To move a number one change at a time, use `o-tune`.

`<skill>` below is this skill's folder; `<skills>` is the folder holding every o-* skill.

## Rules

1. **A gate that asks wins.** A host pause for permission or approval stops the run until it is answered.
2. **Every claim rests on words you can check.** A claim enters the ledger only with a verbatim quote from a
   source you opened in full: a fetched page, a paper, a `file:line`, an experiment's output. A search snippet,
   an abstract or memory is a lead, not evidence. `check-quotes` fetches each source and looks for its quote; a
   quote that is not there invalidates the citation until you fix it or retract the claim.
3. **The source that owns the claim.** Trace every claim to the spec, paper, vendor doc, source code or
   measurement it comes from. A source's tier follows from its kind, and an article or forum post never answers a
   question alone (`references/depth.md`).
4. **The field picks the questions.** Ask the user about their goal, context and constraints, never about the
   domain. Map the field before choosing questions, and add every question the reading raises, citing what raised it.
5. **Depth is measured, not felt.** A question is answered when `ledger.mjs` says it clears the bar. Never write
   "complete", "deep" or "verified" without the ledger behind it. Reading more about an answered question is
   progress, not a wasted step.
6. **Disagreement is a finding.** When sources conflict, record the dispute. Settle it with stronger evidence or an
   experiment, or report it as an open debate with both sides cited. Never silently pick one side.
7. **Every named input is read, or the gap comes first.** Register each URL or file the user named with `input`.
   One you could not open is reported at the top of your next message and asked for. Never work around it, and
   never leave it as a closing caveat.
8. **Bounded, always.** `--cap` limits the rounds. Hitting it with gaps open ends in an escalation that names them.

## Depth

| Depth | When | Bar per question | Run gates |
|-------|------|------------------|-----------|
| `deep` (default) | a topic the user must understand to decide or build | 3 independent sources (one from outside the project), 1 primary, a mechanism and a limit claim, a tier A or B source from the last 5 years; only quotes found on their page or confirmed by hand count, and at least one must be found by `check-quotes` | field map (6 topics asked as questions, from surveys, textbooks, courses or talks by 2 authors), the newest sources by 5 authors add nothing new, every quote checked, a review, the full report |
| `standard` | a bounded comparison the user can judge | 2 independent sources (one from outside the project), 1 primary, a mechanism claim | map (3 topics from 1 such author), 3 authors add nothing new, quotes checked, a review, a shorter report |
| `quick` | one narrow fact ("does this API retry on 429?") | 1 tier A or B source | the answer and its evidence |

A question marked `--quantitative` also needs a number backed by a tier A source. The project's own files count as
one voice, and so do all of the run's experiments. `ledger.mjs --help` lists every command; `references/depth.md`
explains the bar and what no script can check.

## Procedure

1. **Frame.** Run the research pass (`references/research-first.md`), then ask the user what the answer is for:
   their goal, platform, scale, constraints, what "good" means, and what they will do with the answer. Use panel
   rounds (`references/questions.md`), and put a recommended answer on every question. Pick the depth. Search
   earlier runs (`.o-skills/runs/*/E*-research/ledger.jsonl`, and the index `search_knowledge`); when one covers
   the topic, start from it with `init --from`.
2. **Start, from the project root.** The run is the record the user keeps, so it belongs in the project's
   `.o-skills/runs/`, never in a temp or scratch folder.

   ```bash
   node <skill>/scripts/state.mjs start --slug shader-optimization --goal "optimize our Godot particle shaders" \
     --metric research_depth --evaluator "ledger.mjs score" --policy pass_only --target 1 --cap 12 \
     --candidates branches.md
   node <skill>/scripts/ledger.mjs init --dir <dir> --depth deep
   node <skill>/scripts/ledger.mjs input --dir <dir> --ref <each URL or file the user named>
   ```

   `branches.md` lists the first three branches to pursue. If `start` warns that the run landed outside a project,
   run it again from the project root with the same slug; never move the folder by hand.
3. **Map the field** (`references/map.md`). Read surveys, textbooks, course syllabi, canonical talks and official
   docs' tables of contents. Record their topics with `topic`, then turn them into a question tree with
   `question --topic`, and `park` what is out of scope, with the reason. Show the tree to the user in one panel
   round so they can choose the branches that matter for their goal.
4. **Baseline:** `node <skill>/scripts/ledger.mjs score --dir <dir> | node <skill>/scripts/state.mjs record --dir <dir> --baseline -`.
5. **Each round:**
   - Read `ledger.mjs status --dir <dir>`: every open question lists exactly what it still lacks.
   - Send one branch researcher per open branch, in parallel, with the brief in `references/branches.md`. On a
     host without subagents, work the branches yourself, one at a time.
   - Run an experiment when a claim is cheap to test: `ledger.mjs experiment --command "<cmd>"` runs it and keeps
     what it printed (`references/depth.md`).
   - Record disputes as they appear, then run `check-quotes` and fix every miss.
   - Record the round, then follow `next`: `iterate`, `done` or `escalate`.

   ```bash
   node <skill>/scripts/ledger.mjs score --dir <dir> | node <skill>/scripts/state.mjs record --dir <dir> --candidate - --change "round 3: mobile GPU branch"
   ```

   A round that added questions lowers the score, and the step is still kept.
6. **Expert-gap review.** Once three quarters of the tree is answered, have a reader who wrote none of it review it
   against the field, with the brief in `references/review.md`. Use another model family when the host can reach
   one, or else a fresh-context subagent. Record it with `review --by`. Each gap they name becomes a question or a
   dispute, and the rounds continue.
7. **Write the report** below the findings marker in `research.md`, following `references/report.md`. Then run
   `render` (which writes `ledger.md`) and `check-report`. A final `score | record` reaches `done` only when the
   report passes too.
8. **Verify and report:** `node <skill>/scripts/state.mjs verify --dir <dir>` and
   `node <skill>/scripts/ledger.mjs verify --dir <dir>` both exit 0 only for a justified stop. The second one
   re-scores the ledger itself, since `state.mjs` records whatever it is piped. The last message carries the
   evidence block below.

## Report with evidence

- **Answer:** the best current answer for the user's situation, in a few lines, with how sure it is.
- **Read:** the number of sources by tier, and the load-bearing ones by URL or `file:line`.
- **Not read:** every input the user named that could not be opened, and why.
- **Judged by:** "ledger.mjs (depth `<depth>`, k/n questions at the bar, quotes checked: found/unverifiable)",
  plus the reviewer of step 6.
- **Open:** the questions and debates still open, and what would settle each.

## Files

- `scripts/ledger.mjs`: the evidence the run is scored by (questions, sources, quoted claims, disputes, map,
  reviews, inputs), with quote checks, the score, `ledger.md` and the report check.
- `scripts/state.mjs`: the bounded loop that records each round; the same file o-tune ships, kept identical by a test.
- `references/depth.md`: the bar, source tiers, independence, quotes, disputes, saturation, experiments.
- `references/map.md`: framing the user's goal and mapping the field before choosing questions.
- `references/branches.md`: the brief for a branch researcher.
- `references/review.md`: the brief for the expert-gap reviewer.
- `references/report.md`: the report that teaches the field.
- `references/loop.md`: the loop's gates and states. `references/running-unattended.md`: how each host repeats it.
- `references/questions.md`, `references/research-first.md`: the shared question and research rules.
