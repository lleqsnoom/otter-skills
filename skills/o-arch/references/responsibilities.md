# Responsibilities

One module, one role. The reader should be able to say what a file is for without reading its body, and a
change to that role should touch that file and no other.

The definition of a responsibility violation, the one-sentence test and the extract tests belong to `o-review`'s
`references/principles.md`. This file is about what this skill does with a split once it is agreed: where the
pieces go, who owns the data, and when a big file is fine.

## Role, not size

A module has one role when every function in it exists for the same reason. `order_totals.mjs` holds totals
arithmetic and nothing else: it grows when the arithmetic changes and never because a report gained a column.

A role is narrower than a topic. `orders.mjs` that creates, validates, persists, prices and emails is one topic
and five roles, and each caller pays for the four it does not use.

## Data ownership

For every value that outlives a request, name the module that protects its invariant. Then:

- Only that module writes it. Everyone else sends it a message and reads what it returns.
- If two modules must write it, one of them owns a derived value and should say so in its name (`OrderSummary`,
  `DailyTotal`), or the two are one module.
- A cache, a search index, an analytics copy and a summary are derived state. They get their own owner and an
  explicit rebuild path, and they never become the place an invariant is enforced.
- The owner is the module that *refuses an illegal state*, which is not always the module that reads the value
  most often.

## Doing and reporting

A function that both performs a phase and appends to a shared results list has two responsibilities per branch,
and neither is testable alone. Extract the phase into a named helper that returns its data, and collect the
report in exactly one place. The test: delete the reporting call from a phase. If the phase becomes unusable,
the phase was never a unit.

## Size conventions

These are symptoms, not rules. Each one fires when a responsibility is already unsettled, so use it as a prompt
to look rather than as the finding itself.

| Signal | Convention | What it usually means |
|--------|-----------|----------------------|
| Function length | Roughly 20 lines | Several steps sharing a body rather than named helpers |
| Cyclomatic complexity | Above about 5 | Branching that a lookup table or a strategy map would replace |
| Parameters | More than 3 | A group of values that belongs in one named type |
| Class size | Roughly 200 lines, 10 methods | Two roles sharing state they do not both need |
| File size | Roughly 400 lines | Several roles in one address |

`o-review`'s scripts measure the first three per function; use its numbers rather than re-deriving them.

## When a big file is right

- A table of static data, a generated file, or a long literal list is not a responsibility problem.
- A module whose functions share one piece of state and one reason to change stays together even when it is
  long. Splitting it would force the state to be passed around instead of owned.
- A file with a deep call graph and few responsibilities (a router, a schema definition) is dense, not bloated.
  Read it before prescribing a split; the density often is the design.

## Where the pieces go

Once the split is agreed:

1. Name each piece after the role it will hold, not after the file it came from.
2. Put it where the code that owns the behaviour lives, not where the extraction was easiest.
3. Check the callers: if only one caller uses a piece, it belongs beside that caller (`boundaries.md`).
4. Split in one commit and rename in another, so a review can tell which change broke behaviour.
