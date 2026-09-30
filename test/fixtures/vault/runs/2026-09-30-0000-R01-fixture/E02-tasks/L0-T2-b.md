---
type: task
run: "[[runs/2026-09-30-0000-R01-fixture/index]]"
plan: "[[runs/2026-09-30-0000-R01-fixture/E00-plan|the plan]]"
depends_on:
  - "[[runs/2026-09-30-0000-R01-fixture/E02-tasks/L0-T1-a]]"
  - "[[runs/2026-09-30-0000-R01-fixture/E02-tasks/L0-T9-never-written]]"
size: M
complexity: complicated
complexity_why: two ways to hand the result on
created: 2026-09-30T00:00
done: false
tags:
  - x/task
  - area/fixture
---
# Task: b

**Layer:** 0
**Files:** src/b.ts (new), src/c.ts (new), src/d.ts (new), src/e.ts (mod)

## Definition of Done
- [ ] b works
