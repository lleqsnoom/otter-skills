# The issue hunt — what a model looks for, and what its answer must prove

A skill's instructions fail in ways nobody enumerated: the user has to correct an answer, restate a rule
from an earlier session, or explain again what "done" means. A lexicon finds the phrasings someone
thought to list, so it misses exactly the issues worth fixing. The model pass exists for that: it reads
the window's real turns and names the themes. This file is what it looks for, and the bar its answer has
to clear before the report may use it.

## What the model is given

`hunt-issues.mjs --build` assembles the material from the scanned sessions, in two shapes.

**The session pass** — one prompt per ten sessions (several prompts when the window is large). Per
session: the host, the model, the skills that were in play, the opening request, then every user turn that
reacts to the agent — each with the end of the reply it answers and its exact `session#message` ref. Turns
injected by a host (skill bodies, task notifications, classifier prompts, "continue from where you left
off") are left out: they are not the user.

**The per-skill pass** — the one the healing stage feeds on, because what gets fixed is an instruction file.
One prompt per skill the window used, holding that skill's own `SKILL.md` in full and then the turns of
the sessions where it was in play. The question is not "what recurs" but "given this file and how it was
used, which line should say something else"; the answer has to quote the line it changes, or say `new`
when the file has nothing for it.

## What it looks for

One thing going wrong per theme, stated the way the user states it — not a category of problem. Weigh:

- the user correcting the agent's output or behaviour: wrong, incomplete, not what was asked, too long,
  too eager, a rule the skill already carries and was skipped;
- the user stating a rule the agent should already have followed, or restating one from a previous
  session — the repetition is the defect;
- the user intervening because the agent stalled, blocked, or asked for something it did not need;
- the user asking again for work an earlier session was already told to do.

Ignore one-off tasks, environment failures, the user's own typos, and answers that are merely long.

## The bar every answer clears

`--read` verifies each claim against the same transcripts before the report sees it, because a confident
theme built on a quote nobody checked is worse than no finding:

1. **The ref must exist** — a turn the window actually holds.
2. **The quote must be verbatim** — after whitespace and punctuation are normalized, it has to appear in
   that turn's text or in the reply the user was reacting to. A paraphrase fails; copy it character for
   character, apostrophes included.
3. **At least two sessions** must show the theme. One session is not a recurring issue, however loud.
4. **A named skill must exist** on disk.

The per-skill pass (`--read --by-skill`) adds two more, because its answer is an edit to a file:

5. **Every ref must come from a session where that skill was in play** — the fix is for the skills the
   window used, so a complaint from a session the skill never touched is not its business.
6. **The line must be in that skill's `SKILL.md`** — quoted verbatim (whitespace and punctuation
   normalized), or `new: true` when the file has nothing for it. A proposal that quotes a line the file
   does not contain is dropped: it would be a wish, not a delta.

Everything else is dropped with the rule it broke, and the report carries the dropped list beside the
findings: what the model claimed, and why it did not count. The kept issues enter the report as
`recurring-issue` findings — `missing-expectation` when a skill owns the behaviour, `rule-not-applied`
when none does — ranked with the stalled runs, above every failed step. A per-skill finding also carries
the quoted line, so the plan arrives with the `find` already filled and the panel can show the exact
delta on the file.

## What the fix is

A recurring issue is a behaviour, so it is cured in the instruction that should have carried it: the
`SKILL.md` line (or the reference file it belongs in) that would have prevented the finding. The same
behaviour then goes into the owner's `skills/<owner>/evals/expectations.json` (`expected_behavior`, in the
user's words, with the finding id in `source`) — that is the judge's copy, so a fix that writes only the
expectation has changed nothing the run itself reads. Both lines are proposed together, `o-skill-lint`
checks the file's shape, and `heal.mjs` records the accepted ones with a revert-on-failure ledger like any
other fix. An issue no skill owns — a rule that belongs to every skill at once — goes to the user's own
preferences file, named in the item's target with `global: true`.
