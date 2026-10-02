# Naming

A name is the smallest piece of design in a codebase and the one a reader meets first. Naming a unit is
deciding what it is; if the name will not come, the responsibility has not been settled yet.

## The ban, and where the code goes instead

A banned word is not banned for being short. It is banned because it makes no promise: `utils` cannot fail,
which means it also cannot be reviewed, replaced or deleted one piece at a time.

| Banned | What it really says | Where it goes |
|--------|--------------------|---------------|
| `utils`, `helpers`, `misc`, `other`, `common`, `shared` | "I did not decide." | The module that owns the behaviour, named for the concept: `pricing.mjs`, `date-range.mjs`, `retry-policy.mjs` |
| `tools` | "This is a scripts folder with a domain name." | `scripts/` for developer tooling; a module named for the command it implements |
| `Base*`, `Abstract*` | "Read the hierarchy to find out what this is." | The concrete concept, or a composed delegate |
| `*Manager`, `*Helper`, `*Util`, `*Processor`, `*Handler` | A role, not a responsibility. | What it holds or decides: `SessionStore`, `RetryPolicy`, `InvoiceTotals` |
| `*Impl` | "There is one, and it is this one." | The concrete name for what it does: `PostgresOrders`, not `OrdersRepositoryImpl` |
| `data`, `info`, `model`, `object`, `item`, `thing` | The shape of the value, never its meaning. | The domain noun: `OrderLines`, `RefundDecision`, `ShipmentWindow` |
| `handle`, `process`, `doStuff`, `run` (as the only verb) | Says there is work, not what changes. | The verb of the domain: `settle`, `reconcile`, `dispatch`, `expire` |

`Service` is not on the list, but be suspicious of it. `OrderService` is fine when it owns the order use cases
and nothing else. `UserService` that creates, validates, emails and caches is four modules sharing a name, and
the fix is the split rather than a better word.

## Compound names are still bags

`date-utils.mjs` fails the same way `utils.mjs` does, and it is more dangerous because it looks specific.
The test is the same: name a change to the file that a reader could predict from the name. If the honest answer
is "any date thing", it is a bag. Split by the concept a caller asks for: `date-range.mjs`, `weekend.mjs`,
`business-days.mjs`. Each has one reason to change.

## Directory names

A directory name is a domain noun, plural when it holds many of them: `orders/`, `billing/`, `sessions/`,
`invoices/`. A role name (`models/`, `services/`, `controllers/`, `providers/`) describes the shape of the
files, which the reader can see by opening one.

Role folders are not banned and are fine in a small tree. They become a problem when one business change edits
all of them: at that point they are one module with four addresses and the split is hiding the boundary rather
than drawing it. See `boundaries.md`.

A directory that exists to hold one file is a missing decision. Inline it, or let the file's name carry its
purpose.

## What is not a violation

| Kind | Why |
|------|-----|
| `index.mjs`, `main.py`, `App.vue`, `__init__.py`, `mod.rs` | The platform or framework chooses these names |
| A migration or generated file (`0007_add_orders.py`, `schema.generated.ts`) | Generated names are a tool's contract, not the repo's |
| A published or exported name | A rename is a breaking change; report it and leave it |
| A test fixture named for its scenario (`empty_cart.json`) | Data, not architecture |
| A vendored tree under `vendor/`, `node_modules/`, `third_party/` | Not the repo's design |

## Check before you rename

1. **Does the call site read better?** Read the rename at three call sites, not at the declaration.
2. **Does the name predict what changes?** If the file gains a second reason to change, the name was wrong or
   the file is two files.
3. **Is it published?** A rename of an exported name needs a deprecation path, so it is a task, not a pass.
4. **Is the split coming first?** Do not rename a module that is about to become three. Split, then name.
