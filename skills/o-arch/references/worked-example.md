# o-arch — Worked Example

One run, end to end, on a tree small enough to check by eye. The scope is `src/`, the declaration is the one
`o-arch-lint`'s scaffold proposed and a human widened.

**The pain, in one sentence** (`src/utils/index.mjs:1`): a bag module that holds a date formatter, a retry
wrapper and two order checks, so nothing it holds is findable and every change to any of them is a change to the
same address.

**The units judged**, one row each, stop at the first question that fits:

| Unit | Group | Verdict | Reason | Evidence |
|------|-------|---------|--------|----------|
| `src/utils/index.mjs` | naming | violated | The name describes no domain concept, so no reader can say what may be added to it | `src/utils/index.mjs:1` |
| `src/utils/index.mjs` | responsibilities | violated | Two reasons to change: a date format and an order invariant | `src/utils/index.mjs:14` |
| `src/orders/retry.mjs` | dependencies | violated | The order policy imports the vendor client directly, so a vendor change reaches the rule | `src/orders/retry.mjs:3` |
| `src/orders/totals.mjs` | naming | ok | Named for the value it computes, and it holds nothing else | `src/orders/totals.mjs:1` |
| `src/legacy/frozen_export.mjs` | responsibilities | unrated | Excluded by the accepted-violation record in its header; the migration that removes it is owned elsewhere | `src/legacy/frozen_export.mjs:1` |
| `src/web/report_controller.mjs` | naming | unrated | Named by the framework's router, which will not load it under another name; the parsing behind it is a finding for another task | `src/web/report_controller.mjs:1` |

**The one change proposed.** A move, not a split and not a rename together with it: `formatOrderDate` goes to
`src/orders/order_date.mjs`, where the code that owns the concept already lives. Its two call sites are listed in
the row, and the retry wrapper stays until a second caller exists (the rule of three: today there is one).

**One unit it declined to act on.** `src/web/report_controller.mjs` is named for its role, which the naming rule
would rename and the responsibility rule would split. Both rules lose to `Where These Rules Do Not Apply`: the
framework's router resolves the file by that name, so the name is the platform's, and the parsing behind it is a
task rather than a step of this pass. The row says `unrated` and gives the reason, which is the other half of what
a record is for.

**The record written**, `<run folder>/E01-arch.md`:

```markdown
# Architecture pass — 2026-09-27

**Scope:** src/
**Declaration:** .o-skills/config/arch.json

| Unit | Group | Verdict | Reason | Evidence |
|------|-------|---------|--------|----------|
...
```

`node <skill>/scripts/verdicts.mjs --file <run folder>/E01-arch.md` is what tells you that record is finished: a
missing group, a verdict that is not one of the three, an evidence cell that does not resolve, or a `dependencies`
row marked `ok` in a run with no declaration all exit 1 with the row named.
