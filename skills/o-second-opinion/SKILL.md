---
name: o-second-opinion
description: An independent re-review of a change from a fresh context — a reviewer who never saw the session critiques the diff against its spec, and must either name a substantive objection or say clean in so many words. Use before shipping a change that a same-context review already passed, when the change touches an invariant or a contract, or whenever the feeling of "looks good" is the only evidence nothing is wrong.
version: 1.0.0
author: Community
tags: [review, verification, independence, shipping, critique]
user-invocable: true
---

# X-Second-Opinion — The Reviewer Who Wasn't There

The reviewer who wrote the code and the reviewer who shares its context are the same reviewer.
This pass removes the context: a fresh reviewer sees the change and its spec, nothing else, and
critiques it from outside the reasoning that produced it.

## What the reviewer receives

Three things, and nothing more:

1. **The diff** — the exact change, not the branch summary.
2. **The spec** — the task file, plan, or issue the change claims to implement.
3. **The question** — what does this get wrong?

The reviewer is never given the session, the conversation, or the memory that produced the
implementation. Not the rationalizations, not the reasoning, not why the earlier review passed
it. A reviewer who can see the author's reasoning reviews the reasoning, not the code — and
agreeing with reasoning is the rubber stamp this pass exists to prevent.

## The verdict contract

Every review produces exactly one of:

- **An objection list** — at least one substantive objection, each grounded as `file:line`
  with what is wrong and why it matters. An objection without a line number is an opinion.
- **A clean verdict** — the words "clean", in so many words, with what was checked to say it.

A review that returns neither — praise, a summary, "mostly fine" — is not a verdict, and the
pass runs again. At least one objection or an explicit clean: silence is not a pass.

## Procedure

1. Collect the diff and the spec it implements.
2. Open a fresh context (a new agent session, a second model, a colleague who has not seen the
   branch) and hand it the three inputs above.
3. Ask for objections against the spec: where does the diff fail to implement it, implement
   more than it, or break something the spec promised to protect?
4. Record the verdict in the run folder as `E<nn>-second-opinion.md`: the reviewer, the inputs,
   every objection with its `file:line`, and the verdict.
5. Route: objections land as findings for `o-fix`; a clean verdict unblocks the ship step.
   The pass records — it never edits code itself.

## Rules

- **Never soften an objection.** Summarizing a reviewer's finding "in your own words" is how
  severity gets laundered; the objection ships as written.
- **Never shop for a second opinion.** One fresh reviewer, once. Re-rolling until the verdict
  is clean is not independence, it is patience.
- **The spec is the ground truth.** A reviewer who dislikes the spec's design files a design
  objection, clearly labeled; the diff is judged against the spec as agreed, not as the
  reviewer would have written it.
- **A clean verdict is checkable.** It names what was checked, so a later reader can tell a
  review from a glance.

## Output format

```markdown
# Second opinion — <run topic>

**Reviewer:** <fresh context identity> · **Scope:** <diff summary, one line>
**Spec:** <the task or plan this change implements>

## Objections
- `<file>:<line>` — <what is wrong, why it matters>

## Verdict
<objections above, or clean with what was checked>
```

## Files

- `evals/expectations.json` — the verdict contract as checkable claims.
- `evals/triggers.json` — labelled queries for trigger testing.