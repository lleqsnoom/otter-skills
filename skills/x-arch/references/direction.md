# Dependency Direction

A dependency is a promise to change when the other module changes. Direction decides who is allowed to make
someone else rewrite.

## Volatile depends on stable, never the reverse

Policy (the rules that would still exist on paper without a computer) is stable. Transport, storage, frameworks,
vendor SDKs and clocks are volatile. So:

- Core policy imports its own types, its ports, and the standard library. Nothing else.
- Edges import the core. A repository imports the domain type; the domain type never imports the repository.
- Wiring imports everything. The composition root is the one place allowed to, and it is deliberately code-free
  of business rules.

If a stable module needs a volatile one, something is missing: define the port beside the policy, and let the
edge implement it (`boundaries.md`).

**Stability is measured, not felt.** A module is stable when many others depend on it and it depends on few:

```
instability = fan-out / (fan-in + fan-out)
```

0 is maximally stable (many dependents, no dependencies) and 1 is maximally unstable (no dependents, many
dependencies). The rule then becomes checkable rather than rhetorical: if A depends on B, B must be no more
unstable than A. Policy and mechanism is the usual shorthand for the same thing and a good first guess, but it
is wrong whenever a policy module has few dependents and a wide dependency list, which is exactly the case where
computing the ratio is worth the minute it takes.

If you have run the numbers and the ratio is on the wrong side, the fix is one of two: move the shared piece
down into a steadier module, or invert the edge with a port.

## Cycles

A cycle between two modules means they are one module with a lint error. Two ways to break it, in order of
preference:

1. **Move the shared piece down.** Extract the value or function both need into a third module below them, and
   let both import that.
2. **Invert one edge.** Give the caller a port it defines and a parameter it receives, so the arrow points the
   other way.

Do not break a cycle by making one side lazy or by reaching through a global. That hides the cycle in the call
graph while keeping the coupling.

## Third-party types stay at the edge

The vendor's client, its error class, its pagination cursor and its retry semantics do not belong in the core.
Map them at the boundary:

- One adapter owns the vendor import; nothing else in the tree names it.
- The core sees the port's vocabulary (`Money`, `PaymentRefusal`), never `StripeError`.
- Translate at the boundary in both directions, including the error, so a vendor swap is one file.

A dependency is not only a library. A framework's base class, a decorator from an ORM, and a global injected by
a test runner are all edges pointing inward at the wrong time.

## What may cross a boundary

Data that crosses a boundary is simple and isolated, in the form most convenient for the *inner* layer:

- **Plain structures in the inner vocabulary.** A request or response value, or the arguments of a call. The
  use case does not receive the web's request object, the ORM's row, the queue's envelope or the vendor's
  response type: the adapter maps into an inner type first.
- **Never an entity outward as a transfer format.** An entity is not a data-transfer mechanism; letting an
  outer layer consume one lets that layer's needs reshape the invariant.
- **Never a generated format inward.** A schema-generated model, a framework's context object and a row
  structure each carry an outer layer's assumptions, and the rule that forbids naming an outer layer forbids
  carrying its shape.
- **Map at the seam in both directions**, errors included, so a vendor swap stays one file.

The test: would the inner layer still compile and its tests still pass if the outer format changed tomorrow? If
not, the format crossed the boundary.

## Writing the declaration

`.x-skills/config/arch.json` states the direction the repo has agreed on:

```json
{
  "layers": {
    "domain":         { "roots": ["src/domain"],         "import_markers": ["from \"\\.\\./domain"] },
    "application":    { "roots": ["src/application"],    "import_markers": ["from \"\\.\\./application"] },
    "infrastructure": { "roots": ["src/infrastructure"], "import_markers": ["from \"\\.\\./infrastructure"] }
  },
  "allowed_dependencies": {
    "domain": [],
    "application": ["domain"],
    "infrastructure": ["application", "domain"]
  }
}
```

- `roots` classify a file by longest matching prefix.
- `import_markers` are regexes, matched line by line, that mean "this file imports that layer", so detection
  needs no language parser.
- `allowed_dependencies` is a whitelist: `domain: []` says domain may import its own layer and nothing else.
- A layer with no entry leaves the whole group unrated, and `x-arch-lint` says so rather than passing silently.

Keep the declaration to the boundaries a person would defend in review. A four-layer diagram invented for a
script with two files is layer theater, and it will be deleted within a month (`boundaries.md`).

## Finding a violation quickly

- **The wrong-way import**: grep the layer for the outward layer's name (`rg "infrastructure" src/domain`).
- **The cycle**: build the import graph and look for a strongly connected component; two modules that import
  each other are the common case and a grep for each other's names finds them.
- **The hidden edge**: look for global singletons, module-level instantiation, and framework decorators that
  read configuration at import time. Those are dependencies with no import line.
- **The god module**: anything a large fraction of the tree imports is load-bearing for the wrong reason; check
  whether it holds policy (fine) or a junk drawer (not fine).
