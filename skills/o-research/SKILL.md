---
name: o-research
description: Research a topic toward cited coverage — name the sub-questions it must answer, read real sources for each, and count a question answered only when an opened source answers it; a bounded loop with a memory file and a report, critiqued by a fresh reviewer before it is called done. Use for "research X", "compile/summarise sources on Y", the options for Z with citations, or filling the gaps in what we know; to tune a number, use o-tune.
version: 2.0.2
author: Community
tags: [research, sources, citations, coverage, literature, comparison]
user-invocable: true
---

# O-Research — Cited Coverage, Not a Feeling of Done

Research is done when every question it set out to answer is answered by a source someone can open — not when
the text reads well. The run names N criteria (sub-questions, requirements, sources to find), and each iteration
adds evidence until every criterion is met with a citation, a hard cap stops it, or it escalates with the gaps
named. To move a number one change at a time, use `o-tune`.

`<skill>` below is this skill's folder.

## Rules

1. **A gate that asks wins.** A host pause for permission or approval stops the run until it is answered.
2. **Coverage is cited, not typed.** A criterion is met only when a source you actually opened answers it — a
   fetched page, a paper read, a `file:line`, a command run. A search snippet, an abstract or memory is a lead,
   not evidence. `record` refuses coverage the evidence file does not cite.
3. **Depth is what was asked.** For "deep", "thorough" or "several rounds", every iteration adds evidence — a new
   primary source read in full, a check against real data, or a critique answered — never only a rewrite.
4. **Every named input is read, or the gap comes first.** A URL or file the user named that you could not open
   is reported at the top of your next message and asked for — never worked around, never a closing caveat.
5. **Bounded, always.** `--cap` limits the iterations; hitting it with criteria unmet escalates with them named.

## Procedure

1. **Research before asking** (`references/research-first.md`), then define the criteria — the sub-questions the
   answer must settle — and confirm them with the user in one panel round (`references/questions.md`).
2. **Start:**

   ```bash
   node <skill>/scripts/state.mjs start --slug vector-search-options --goal "compare vector search options for our scale" \
     --metric criteria_coverage --evaluator agent --criteria criteria.md --candidates candidates.md --cap 12
   ```

   `criteria.md` holds one criterion per line; `candidates.md` the first three angles to pursue. Both are read
   once, so they can live anywhere. **Run `start` from the project root:** the run is the record the user keeps, and
   it belongs in the project's `.o-skills/runs/`, never in a temp or scratch folder; `start` warns when it lands
   there. If it did, run `start` again from the project root with the same slug — never copy the folder and
   rewrite its paths by hand. `--root` names the folder that holds run folders, not the project root.
   `node <skill>/scripts/state.mjs --help` lists every command and flag.
3. **Baseline:** what is already answered — `record --dir <dir> --baseline --coverage <k/n>`.
4. **Each iteration:** read one more source, add what it answers to `research.md`, and record the coverage with
   its evidence — one line per met criterion, `C2: <URL or path:line> — what it says`:

   ```bash
   node <skill>/scripts/state.mjs record --dir <dir> --candidate --coverage 3/5 --evidence evidence.md \
     --changed research.md --change "pgvector benchmarks at 10M rows"
   ```

   It prints `next`: `iterate`, `done` (every criterion cited) or `escalate` (cap reached).
5. **Critique before done.** Have the report read by a reviewer who did not write it — `o-roast --profile
   research` run by another model family when the host can reach one, or else a fresh-context subagent — and
   answer what holds up. A self-graded "complete" is the result users most often send back.
6. **Verify and report:** `node <skill>/scripts/state.mjs verify --dir <dir>` exits 0 only for a justified stop.
   The last message carries the evidence block below.

## Report with evidence

- **Read:** how many sources were opened, and the load-bearing ones by URL or `file:line`.
- **Not read:** every input the user named that could not be opened, and why.
- **Judged by:** "agent (self-judged coverage, k/n cited)", plus the reviewer of step 5.
- **Open:** the criteria still unmet, and what would settle each.

Never write "complete", "verified" or "deep" without the source behind it on the same screen.

## Files

- `scripts/state.mjs` — the bounded loop state machine; the same file o-tune ships, kept identical by a test.
- `references/loop.md` — the gates, the policies and the state diagram.
- `references/running-unattended.md` — how each host repeats the loop.
- `references/questions.md`, `references/research-first.md` — the shared question and research rules.
