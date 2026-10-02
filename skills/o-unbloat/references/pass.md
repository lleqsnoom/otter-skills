# o-unbloat — pass card

Read this when another skill runs o-unbloat as a pass. A standalone run, when the user asks to unbloat or
simplify, reads `SKILL.md` and runs all nine steps.

## Per host

No record of its own; uncommitted work is the task. The host's scope is the scope.

- **o-review** (reports only): the ladder and table on every reviewed unit. List findings under `[Bloat]`,
  each with the rung or row it fails. Needless abstraction is MAJOR; dead code and unused options are MINOR.
- **o-refactor** (suggests only): the ladder and the table. Prefer deleting and inlining to extracting; a new
  layer must name the second caller that needs it.
- **o-implement** (edits): the ladder before GREEN. In REFACTOR, the ladder and the table, then check callers
  and cut one thing at a time, testing after each cut. Cut only what the task wrote; report older bloat.
- **o-fix** (edits): per `[Bloat]` finding, check every call site, cut one thing at a time, test after each
  cut, and revert a cut that fails.

## Rules

**The ladder** — stop at the first rung that holds:

1. Not asked for and not needed → do not write it.
2. Already in the codebase → reuse it.
3. The standard library does it → use it.
4. The platform does it → use it (CSS over JS, a DB constraint over app code).
5. An installed dependency does it → use it. Never add one for what 3–4 cover.
6. It fits in one readable line → write one line.
7. Only then write the minimum that works for today's inputs.

**Bloat, unless** — the fix, then when to keep it:

- One-implementation interface, base or factory → the concrete thing; keep a test seam or published boundary.
- Pass-through wrapper → call the target; keep one that isolates a third-party API.
- Stateless one-method class → a function; keep it if the framework needs a class.
- Option or parameter no caller passes → delete; keep it if code outside the repo calls it.
- Config value that never changes → a constant; keep it if it varies per environment.
- Manager/helper/util layer used once → inline; keep it with more than one caller.
- Own version of a built-in → the built-in; keep it if the supported runtime lacks it.
- New dependency for a few lines → write the lines; keep it for crypto, file formats or time zones.
- Dead or commented-out code → delete; keep it if code outside the repo uses it.
- Check for a state the types or internal callers rule out → remove it, or narrow the type so the state cannot
  be built; keep it where input crosses a trust boundary.
- Variable whose name adds nothing → use the value; keep it if the name labels a step.
- Hook for a future case (a registry with one entry) → remove; keep it if the second case is in this task.

Extracting is fine when the same logic is in two or more places.

**Never cut:** trust-boundary validation, error handling that prevents data loss, security (auth, escaping,
secrets, permissions), accessibility, anything the user asked for, tests. Unsure why code exists? Find out
first (`git blame`, callers, tests).

**Ownership:** this pass decides whether a unit should exist. Where it lives and what it is called belong to the
o-arch pass; report a finding both could claim once, under its owner.

## Full rules

Open `SKILL.md` when a case is unclear: `## Bloat, Unless…`, `## Never Cut`, `## Steps`.
