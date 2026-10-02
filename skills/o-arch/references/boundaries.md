# Boundaries

A boundary is where a change stops. If changing how orders are priced means opening the invoice renderer, the
boundary between orders and invoicing is not there yet, whatever the directories are called.

## Two tests

**The change test.** Name a business change ("refunds are now approved by a manager") and count the places it
touches. One place, or the feature's own directory plus a test, means the boundary holds. A dozen places across
technical folders means the code is one module with a dozen addresses, and there is no boundary to preserve
yet.

**The owner test.** Ask which module protects the invariant: which one refuses an illegal state. That module
owns the data, whether or not it is the one that reads it most often. A second module that writes the same
value is a second owner, and the two will disagree eventually.

## Grouping by capability

Group by what the code is about when the capability has any of these:

- its own vocabulary that does not translate cleanly (`shipment`, `settlement`, `entitlement`);
- its own failure modes and its own retry story;
- a different rate of change from its neighbours (billing rules move, the address book does not);
- a name the domain's own experts use in conversation.

Group by technical role only in a tree small enough that the reader holds all of it at once, and say so
deliberately rather than by default.

**Subdirectories.** When a capability grows past roughly a handful of files, give it a directory and stop
repeating the parent prefix inside it (`orders/refund.mjs`, not `orders/orders-refund.mjs`). Keep local files
with the feature; lift one only when the second real caller arrives.

**Local before shared.** A shared module with one caller is a feature module that lost its address and gained a
coupling. Lift on the second caller, and put it where the first caller can still reach it without reaching
through a stranger.

## The four kinds of layer

The circles are schematic: you may need more than four kinds, but these are the vocabulary the rule is written
in, and a declaration that uses them reads to anyone who knows the pattern.

| Kind | Holds | May depend on |
|------|-------|---------------|
| Entities | Enterprise-wide rules: the objects and invariants that would exist on paper without a computer. Change when the business changes, not when an application does. | Their own types |
| Use cases | Application rules: one action the application performs, orchestrating entities toward a goal. Change when the operation changes. | Entities, and its own ports |
| Interface adapters | Translation: controllers, presenters, gateways, serializers, mappers, between the use case's form and an external agency's form. | Use cases |
| Frameworks and drivers | Details: the web framework, the database, the queue, the vendor SDK, the clock. Mostly glue. | Everything inward |

Two consequences, and they are why the vocabulary is worth keeping:

- **The names are kinds, not folders.** Declare `layers` with the names the domain uses (`orders`, `billing`) or
  with these kinds; either way the declaration is about direction rather than directory names.
- **A layer's kind decides what may live in it.** A rule that decides money belongs in an entity or a use case,
  never in an adapter. A SQL string belongs in an adapter, never inward of one.

## Choosing a boundary

A boundary costs indirection, so it has to buy something. Four tests, in the order that usually pays back best:

| Test | The boundary earns its keep when |
|------|----------------------------------|
| Volatility | The two sides change at different rates, or for different reasons |
| Policy importance | The rule on the inside is one the business would defend on paper |
| Substitution value | A second implementation is planned, or a test needs to replace this one |
| Testability | The boundary is what lets the rule be tested without the framework, the database or the network |

When two options are otherwise equal, take the **lightest boundary that can enforce the rule**: an interface and
a build rule before a module, a module before a package, a package before a service, a service before a process.
A **partial boundary** is legitimate: a one-way interface, a dependency rule in a test, or a convention with a
checker is often enough, and it can be completed later without a rewrite.

**When not to draw one.** A boundary with one implementation, no substitution in sight and no test that uses it
is cost without benefit. Leave the call direct and revisit when the second case appears.

## Layer theater

Folder names are not architecture evidence. `domain/`, `application/` and `infrastructure/` prove nothing on
their own; a tree can carry all three and still have business rules in the controller. Before treating a
layering as real, look for what actually enforces it:

| Strong evidence | Weak evidence |
|-----------------|---------------|
| Module, package or build boundaries that make a wrong import impossible | Directory names |
| An import rule or architecture test that fails the build | A README diagram |
| A declared `allowed_dependencies` that `o-arch-lint` checks | A reviewer's memory of the convention |
| A public surface a consumer is forced through | A folder nothing but convention protects |

When a change would need a new layer, ask what it hides that the current shape does not. If the answer is
"nothing yet", the honest move is the smaller one, and the layer can arrive with its second reason.

## The composition root

Concrete implementations are wired in exactly one place: the entry point, a service bootstrap, or a container.
Everywhere else, a module receives what it needs rather than constructing it. Two consequences worth stating:

- A module that news up its own collaborator cannot be tested alone and cannot be swapped at a boundary.
- A composition root is the one place allowed to import both the policy and the edge, so it is the one place
  the dependency rule is deliberately suspended. Say so in a comment or in the declaration itself.

## Ports and adapters, briefly

When policy must reach the outside world (a database, a vendor API, a queue), define the port next to the
policy: the smallest interface the policy needs, in the policy's own vocabulary. Implement it at the edge, and
name the implementation for the technology it adapts (`PostgresOrders`, `StripePayments`), never for the port
(`OrdersRepositoryImpl`). The port is a boundary with a purpose; a port with one implementation and no test
that substitutes it is inventory, not architecture.

## Keep the adapters humble

An adapter's job is translation and nothing else. A controller, endpoint, presenter, gateway, listener or
hardware adapter:

- reads the external form and calls one use case, and decides nothing on the way;
- holds no rule about money, permission, state transitions or quota;
- does not reach past the use case into persistence to fetch what it needs;
- contains nothing that would survive a change of delivery mechanism.

The test: swap the delivery mechanism (HTTP for a CLI, a queue for a cron job) and count the rules you would
have to rewrite. Each one was a rule that belonged inward.

Business validation is the usual leak, and the split is worth stating: ordering, permission, quota and state
checks are policy, so they belong in the use case. Format checks (is this field present, is it a number, is it
too long) are the adapter's own and may stay.

## The declared architecture

A repo can write its boundaries down in `.x-skills/config/arch.json`: layers with their roots, the directions
allowed between them, and naming rules per layer. Once it is there, `o-arch-lint` reports a wrong-way import as
`file:line` with `rule: dependency-direction` and a naming rule violation as `boundaries`.

Two cautions, both from the same principle:

- **Declare what the code does, or change the code.** A declaration written from a diagram rather than from the
  tree produces a gate that blocks good code and gets disabled.
- **A declaration nobody ratified is worse than none.** Ratify it in review, date it, and check it in.
