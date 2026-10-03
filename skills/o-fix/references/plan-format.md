# Plan format — what o-fix reads

Every skill that hands work to o-fix writes its plan in this shape, so o-fix needs no per-skill parser and never
mistakes a note for a task.

## Names

| File | Written by |
|------|------------|
| `<run folder>/E<nn>-review-plan.md` | o-review |
| `<run folder>/E<nn>-fix-plan.md` | o-debug, o-investigate |
| `<run folder>/E<nn>-verify.<ext>` | o-debug — the reproduction; o-fix runs it after each fix when it exists |
| `<run folder>/E<nn>-intake.md` | o-triage — the bug brief the debugging skills start from |

o-fix also takes any plan path the user names, as long as the plan follows the rules below.

## Rules

1. **A checkbox is a change to make.** Every `- [ ]` line is one fix; nothing else in the plan carries a
   checkbox. Hypotheses, logs and notes are plain bullets or prose.
2. **Each item names its change:** severity (CRITICAL / MAJOR / MINOR), the `file:line` (or files, when one root
   cause needs a coordinated change), the issue in one sentence, and the fix.
3. **Done is `- [x]`.** o-fix ticks an item only after its narrowest tests passed; an item it could not resolve
   stays `- [ ]` with a one-line note under it.

```markdown
## Fixes
- [ ] **Severity:** MAJOR
  - **File:** `src/cart.mjs:3`
  - **Issue:** the loop starts at 1, so the first item is never added
  - **Fix:** start the loop at 0
```
