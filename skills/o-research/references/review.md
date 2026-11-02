# The expert-gap review

The user cannot spot what an expert would see missing. So before the run is called done, a reader who wrote none of
it reviews it in the expert's place. `ledger.mjs` counts the review only once three quarters of the tree is
answered, because an earlier review critiques a plan, not the research.

## Who reviews

- **Another model family,** when the host can reach one. A model that shares the author's training shares its
  blind spots.
- **Otherwise a fresh-context subagent.** It must not have seen the session, and it must not start agents itself.
- **Optionally afterwards,** `o-roast --profile research` scores the report on method and recency
  (`<skills>/o-roast/SKILL.md`).

## The brief

```text
You are a senior practitioner in <field>, reviewing research written for someone new to it. You did not write it.
Do not start agents.

Read: <dir>/ledger.md (questions, claims with their quotes, sources, disputes, field map), and <dir>/research.md
below the findings marker if a report exists. The reader's goal and context: <two lines>.

Answer each in at most five bullets, citing claim or question ids:
1. What would any expert in <field> expect here that is missing? Name techniques, results, failure modes or
   standard references that are absent from the tree, the field map, or the parked list.
2. Which claims are wrong, outdated, or true only in a context the reader is not in? Say why, with a source when
   you know one.
3. Which quotes do not actually back their claims?
4. Where do experts really disagree that the ledger shows as settled, or the reverse?
5. Which source is weaker than its tier suggests (a tutorial filed as docs, one author counted twice through
   --origin)?
6. What no script checks: does each claim's kind fit it (is the "limit" a limit)? Do the dates look right? Do the
   experiments' commands measure what their claims say? Are the park reasons and hand-confirmed quotes believable?

If nothing substantive is missing, say "nothing substantive missing" in so many words, and name the weakest part
anyway.
```

## Acting on it

```bash
node <skill>/scripts/ledger.mjs review --dir <dir> --by "<model or subagent>" --note "<one line: what it found>"
```

Then turn every finding into ledger work: a missing topic becomes a `question --from review` (or a `park` with the
reason), a wrong claim gets a `dispute`, a weak quote gets a re-`cite` or a `retract`, and a misfiled source is
corrected with `reclassify --source <S> --kind <kind> --reason <why>`. Run the rounds again until the ledger
clears. Never answer a finding with a sentence in the report alone.

`<skill>` in this file is the skill's own folder; `<skills>` is the folder holding every o-* skill.
