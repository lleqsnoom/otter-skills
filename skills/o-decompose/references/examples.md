# Layer-to-Task Examples

Worked decompositions for four shapes of plan. Every one is test-first: the test that proves a task names the
behaviour, and the code that passes it comes after.

## Web Page Project
```
Layer 0 — Skeleton (2 tasks):
  Task 0.1: A test that loads the page through the real build, then the setup and placeholder page that pass it
  Task 0.2: The build and serve scripts the next layers run, each with the check that proves it

Layer 1 — Real content, one flow (2 tasks):
  Task 1.1: The home page renders real copy and nav links from the content source
  Task 1.2: A visitor can follow the first nav link to a page that renders its own content

Layer 2 — Interactivity (2 tasks):
  Task 2.1: The contact form submits through the real endpoint and shows the response
  Task 2.2: An invalid submission shows the field errors, test first

Layer 3 — Polish (1 task):
  Task 3.1: Styling, responsive design and accessibility across the flows above
```

## Data Pipeline (SQS + Lambda)
```
Layer 0 — Skeleton (2 tasks):
  Task 0.1: An integration test of send → queue → handler, then the sender and mock queue that pass it
  Task 0.2: The Lambda stub returning a fixed response, behind the same test

Layer 1 — Real Processing (2 tasks):
  Task 1.1: A test image comes back resized, then the resize logic in the Lambda that passes it
  Task 1.2: The real processor wired in, proven by the end-to-end test with that image

Layer 2 — Resilience (2 tasks):
  Task 2.1: A failing message lands in the dead-letter queue, test first
  Task 2.2: A transient failure is retried with exponential backoff, test first

Layer 3 — Observability (1 task):
  Task 3.1: Each processed message emits a metric and a structured log line, asserted in the test
```

## Existing codebase (brownfield)

A plan for a system that already runs has no skeleton to build: L0 is the **seam**, not a prototype. Cut it so the
new behaviour lands behind something that keeps today's behaviour until the last layer switches it on.

```
L0 — Seam:
  L0-T1  task    characterization tests pin what checkout totals do today, discounts included
  L0-T2  task    the pricing call goes through one function the new rules can replace (no behaviour change)

L1 — New rules, off by default:
  L1-T1  task    tiered discounts behind a flag, tested against the characterization cases
  L1-T2  plan    tax by region — own contract with the tax provider, child run "tax-regions"

L2 — Switch over:
  L2-T1  task    the flag defaults on; the old pricing path and its flag are deleted
```

Wide mechanical changes inside a brownfield plan follow rule 9 (expand–contract), not this shape.

## Platform Game (triaged, not component-sliced)
```
L0 — Walking skeleton:
  L0-T1  task    one level, one sprite, arrow keys move it, a test proves it renders and moves

L1 — Real movement:
  L1-T1  plan    gravity, collision resolution, tilemap format — child run "platform-physics"
  L1-T2  task    pause menu on top of the skeleton

L2 — Enemies and score:
  L2-T1  plan    enemy behaviour, spawn rules, pathing, damage — child run "enemy-ai"
  L2-T2  analyze leaderboard storage — child run "leaderboard-backend"
```
