# Components

A module is a file; a **component** is a unit of release: a package, a jar, a gem, an npm package, a deployable.
The rules here are the principles of `boundaries.md` one level up. They govern what goes inside a component and
which way components may point.

## As abstract as it is stable

A component many others depend on is hard to change, so it has to offer something to extend rather than
something to edit. It should be as abstract as it is stable. Two measures, both cheap to estimate:

```
instability   I = fan-out / (fan-in + fan-out)    0 = stable ... 1 = unstable
abstractness  A = abstract types / all types      0 = concrete ... 1 = abstract
```

Plot `I` across and `A` up. The line from (0, 1) to (1, 0) is the **Main Sequence**: the stable-and-abstract
corner joined to the unstable-and-concrete corner. Two corners away from it are where designs hurt:

| Corner | What it looks like | Why it hurts |
|--------|--------------------|--------------|
| **Zone of pain** (I low, A low) | A concrete component everything depends on: a database schema, a shared enum, a `core` package of helpers | Hard to change and impossible to extend without editing it, so every dependent pays for every edit |
| **Zone of uselessness** (I high, A high) | Abstract interfaces nobody implements or depends on | Dead weight wearing a pattern's clothes: delete it, or give it a dependent |

Distance from the line is `D = |A + I - 1|`. A component far from it warrants a look, not automatically a change:
a small, frozen component is allowed to sit anywhere.

**The one question worth asking** is about the component the rest of the tree leans on: is it concrete? If it
is, either it should be abstract (interfaces its dependents can extend) or the dependents should not all be
leaning on it. A stable concrete component is the usual shape of the dependency magnet described below.

## What belongs in one component

Three principles decide it, and they pull against each other:

| Principle | Rule | Pulls toward |
|-----------|------|--------------|
| Reuse/release equivalence | The granule of reuse is the granule of release: everything in a component is versioned and released together, so the component needs one coherent theme | Larger |
| Common closure | Gather what changes for the same reasons at the same times, and separate what changes for different reasons | Larger |
| Common reuse | Do not force a user of the component to depend on parts it does not need | Smaller |

**Early, favour common closure.** Grouping co-changing code by its reason to change keeps releases rare while
the design is still moving. **Later, favour common reuse.** Once the system settles, the classes nobody uses
become pure coupling. The test for reuse is quick: for each type in the component, ask whether anyone who
depends on the component would notice if it were removed. If not, it belongs elsewhere.

**The one-sentence test** applies to the whole component, the same way the naming rule applies it to a file:
write one sentence saying what the component is for. If you cannot, it has no coherent theme, and its users will
be made to upgrade for changes they do not care about.

## The dependency magnet

The common failure is a component everyone depends on and nobody uses more than a piece of: `utils`, `common`,
`shared`, `core`, `base`, `types`. It fails all three principles at once. Someone changes one helper and every
dependent is revalidated; someone needs one more type and the component grows a section unrelated to its name.

The cure is not to make it abstract. It is to split it by who needs what, and let each piece live with its
owners. Where a piece is genuinely shared, name it for the concept (`Money`, `DateRange`, `RetryPolicy`) so it
can be versioned and reasoned about on its own.

## Testing the boundary

The dependency rule is not decoration: it is what makes policy testable, and the tests are how you can tell
whether the rule is real rather than drawn.

- **Every entity and use-case test runs without the framework, the database, the network, the clock and the
  queue.** If a business-rule test needs one of them, a dependency points the wrong way, and the test is the
  cheapest place to notice it.
- **Substitute at the port.** A use case is tested against an in-memory implementation of its own port: no
  mocking framework needed, and no vendor type in the test.
- **Test adapters separately, at the seam.** One test per adapter, and its assertions are about translation,
  the external form becoming that inner call, never about business rules.
- **A boundary nobody tests is a boundary that will be crossed.** The first change that finds the substitute
  inconvenient is the one that imports the real thing inward.

Test count is a poor proxy here. What matters is that the suite covering policy would still pass if the delivery
mechanism, the persistence choice and the vendor were all swapped, and the only tests that fail are the
adapters' own.
