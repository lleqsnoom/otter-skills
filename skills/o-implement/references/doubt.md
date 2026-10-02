# Doubt before you commit

A confident answer is not a correct one, and a long session turns assumptions into "facts" without announcing it.
This is the in-flight pass that tries to **disprove** a decision while changing it is still cheap. It runs before
`o-review`, which is a verdict on a finished artifact.

It applies to a **non-trivial** decision — one that:

- adds or changes branching logic,
- crosses a module or service boundary,
- asserts something the compiler cannot check (idempotence, ordering, thread safety, an invariant),
- or carries an irreversible blast radius (a migration, a public interface, a delete).

It does not apply to a rename, a format change, reading code, or following an unambiguous instruction. Doubt every
keystroke and nothing ships.

## The loop

```
- [ ] 1. CLAIM      — the decision in two lines, and why it matters
- [ ] 2. EXTRACT    — the smallest reviewable unit, plus the contract it must satisfy
- [ ] 3. DOUBT      — an adversarial review, biased to disprove
- [ ] 4. RECONCILE  — classify every finding against the artifact text
- [ ] 5. STOP       — bounded at three cycles
```

**1. CLAIM.** Write it in two lines. If it will not compress that far, you have a mood rather than a decision:

```
CLAIM: the retry guard is idempotent when the same batch is replayed after a timeout
WHY:   a duplicate here charges the customer twice and is not reversible
```

**2. EXTRACT.** Hand over the artifact and the contract, not the journey. The diff or the function — not the whole
file. The proposal in three to five sentences, plus the constraints it has to satisfy. Strip your reasoning.

**3. DOUBT.** Pass **ARTIFACT + CONTRACT only, never the CLAIM** — handing over your conclusion gets back
agreement with your conclusion.

```
Adversarial review. Find what is wrong with this artifact. Assume the author is overconfident.
Look for unstated assumptions, unhandled edge cases, hidden coupling or shared state, ways the
contract could be violated, conventions this breaks, and failure modes under unexpected input.
Do not validate. Do not summarise. Find issues, or state that you cannot find any after a
thorough examination.

ARTIFACT: <the diff or the function>
CONTRACT: <what it has to satisfy>
```

With a subagent to hand this to, hand it over. With none, rewrite artifact and contract as a fresh prompt and
answer it adversarially — then mark the result **degraded**, because you still carry your own context and this is
not a fresh-context review.

**4. RECONCILE.** The reviewer's output is data, not a verdict. Re-read the artifact against each finding before
classifying it, in this order — first matching class wins:

| # | Class | What to do |
|---|-------|------------|
| 1 | **Contract misread** — the finding exists because the contract you supplied was vague or incomplete | Fix the contract first, then re-classify on the next cycle. |
| 2 | **Valid and actionable** — a real issue needing a change to the artifact | Change it, re-loop. |
| 3 | **Valid trade-off** — real, but fixing it costs more than accepting it | Write the trade-off down where the next reader will see it. |
| 4 | **Noise** — correct under context the reviewer did not have | Note it, move on, and ask whether the contract should have carried that context. |

A fresh reviewer is wrong often, for lack of context. Rubber-stamping it is the same failure as ignoring it.

**5. STOP.** Stop when the next cycle returns only trivial or already-considered findings, or after three cycles,
or when the user says ship it. Do not lift the bound: three unresolved cycles is information about the artifact —
it is not ready — so say so rather than looping a fourth time alone. If three cycles is obviously insufficient,
the artifact is too large and belongs back at step 2, decomposed.

**Doubt theater, and how to catch it.** If across two or more cycles the reviewer raised substantive findings and
you classified none of them actionable, you are validating rather than doubting. Stop and escalate.

## Related

- `o-review` is the post-hoc verdict on the whole change; this is the per-decision check while it is cheap.
- `o-roast` critiques the reasoning in a written artifact; this critiques the artifact itself.
- A failing test is doubt made concrete. Where the claim is behavioral and TDD applies, RED already *is* the doubt
  step — do not pay for it twice.
