# Brief format

Worked shape. Copy the shape, not the content.

```markdown
# Brief — <one-line name for the work>

## Do next
1. Run `npm test` — the suite was red on `test/board/render.test.cjs` when this session stopped.
2. Fix the render cache miss that commit <sha> introduced (suspect: the key ignores the locale).
3. Re-run the suite, then land on the `fix/board-render` branch.

## Where this stands
Goal: the board renders saved views without refetching. Branch `fix/board-render`, 3 of 4 tasks
ticked in `.o-skills/runs/2026-09-30-0900-R02-board-render/E02-tasks/`. Last green: commit <sha>.

## Settled
- The cache key must include the locale — sorting is locale-dependent (decided after the first
  flake report).
- Render goes through `views.js`; no component reads the store directly.

## Open
- Whether the cache should invalidate on window focus — needs a product call.

## Suggested skills
- o-implement for the fix task; o-review + o-fix before landing.

## Sources
- Spec: `.o-skills/runs/2026-09-30-0900-R02-board-render/E00-plan.md`
- Task list: `.o-skills/runs/2026-09-30-0900-R02-board-render/E02-tasks/`
- The flake report: issue #412
```

Length: one screen. A brief past one screen is duplicating a source it should point at.
