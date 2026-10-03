---
name: o-arch
description: Fix where code lives and which way it depends — a utils or helpers folder everything imports, directories that do not follow features, a layer importing what it should not, domain code tangled with infrastructure, a base class that should be composition. Bans role-shaped names (utils, helpers, common, misc), points dependencies from volatile to stable, and waits for three uses before extracting. Use when asked to restructure directories, sort out boundaries, name a module, or decide where new code belongs; o-implement, o-decompose, o-review and o-fix run it as a pass.
version: 1.2.1
author: Community
tags: [architecture, naming, boundaries, responsibilities, dependency-direction, composition, solid, placement]
user-invocable: true
---

# O-Arch — Where Code Lives and What It Is Called

Architecture is not a folder list. It is five decisions a reader can check: where a unit lives, what it is
called, what its one responsibility is, which way its dependencies point, and what it grows from. Get those
right and almost any layout works; get them wrong and the most fashionable layout will not save it.

**This skill is never satisfied by moving files into new folders.** Folder names are not evidence of anything:
a tree can have `domain/`, `application/` and `infrastructure/` and still be one module with four addresses.
Judge a structure by whether one change stays in one place, not by what the directories are called.

**Name the improvement in one sentence before proposing it.** If you cannot say what a reader will no longer
have to hold in their head, there is nothing to propose.

`<skill>` below is this skill's folder. Every script answers `--help` with its commands and flags.

## When to use

- "Where should this live?", "what should this be called?", "why is this class like this?".
- A directory called `utils`, `helpers`, `common`, `shared`, `tools`, `misc` or `other`.
- A class named `*Manager`, `*Helper`, `*Util`, or `Base*` with one subclass.
- A layer claim to check: "is this allowed to import that?", "does this boundary still hold?".
- A file or class that has grown a second reason to change.

Not for these: "should this exist at all" is `o-unbloat`; a specific behaviour-preserving refactor is
`o-refactor`; the definition of the single-responsibility extract tests is `o-review`; a bug is `o-debug`.

## Two Ways It Runs

**As a pass inside another skill:** read `references/pass.md`; it owns the per-host steps.

**On its own**, when the user asks about placement, naming, boundaries or inheritance: run every step. When the
user asked for the change itself ("move these into feature folders", "rename this module"), make it — one move,
split, rename or repoint at a time, call sites updated and the tests run after each — instead of handing back a
report. Report-only is the rule for the pass inside another skill, not for a direct request.

## 1. Naming

A name is for the reader who arrives knowing the domain, not for the writer who could not decide. A word that
fits every module describes none of them.

| Name | Why it fails | Route it instead |
|------|--------------|------------------|
| `utils`, `helpers`, `misc`, `other` | A bag. It has no invariant, so nobody can know what may be added or removed. | The module that owns the behaviour: `pricing.mjs`, `date-range.mjs`, `retry-policy.mjs` |
| `common`, `shared` | Two features' code in one folder. Every change to either feature now edits a third place. | The feature that owns it, or a module named for the concept both need. A workspace package (`packages/shared`) with a stated purpose in its `package.json` description and an owner is a published boundary, not a bag — judge what it holds, not its name |
| `tools` | A scripts directory wearing a domain name. | `scripts/` for developer tooling, or the command it implements |
| `Base*`, `Abstract*` | Names the position in a hierarchy, which is the one thing the caller does not need. | The concrete concept, or a composed delegate |
| `*Manager`, `*Helper`, `*Util`, `*Processor` | A role, not a responsibility. A reader cannot say what it does. | What it holds or decides: `SessionStore`, `RetryPolicy`, `InvoiceTotals` |
| `data`, `info`, `handle`, `process`, `doStuff` | Says the shape of the problem, never the point of it. | The domain noun the value is: `OrderLines`, `RefundDecision` |

**Route, do not rename.** A banned name is a missing decision, and the fix is deciding: which domain concept
owns this code? If two concepts equally do, the unit is doing two jobs and the split comes before the name.

Two things are never a violation: a name the platform or framework chooses (`index.mjs`, `main.py`, `App.vue`,
`__init__.py`, migrations), and a published name, which is a contract rather than a preference. Report a
published name and leave it. Depth, including how to name a directory and what role folders are worth, is in
`references/naming.md`.

## 2. Boundaries

Decide which code owns which behaviour, then let the directories follow. Two tests, both cheap:

- **The change test.** Does one business change edit one place, or a dozen? A change scattered across
  `models/`, `services/` and `controllers/` means those four folders are one module, and splitting it by
  technical role has hidden the boundary rather than drawn it.
- **The owner test.** Which module protects the invariant? That module owns the data, whether or not it is the
  one that reads it most often. The invariant belongs in that module's type rather than in a check every reader
  repeats: a value another module can build wrongly is a value whose owner has not been decided.

Group by capability when a capability has its own vocabulary, its own failure modes, or changes at its own
rate: `orders/`, `billing/`, `sessions/`. Keep code local to the feature that uses it, and lift it only when a
second feature genuinely needs it. A shared folder with one caller is a feature folder that lost its address.

`references/boundaries.md` has the composition root, ports for third parties, and the layer-theater warning in
full.

## 3. Responsibilities

One role per module and per file. A class that persists, validates and orchestrates is three classes sharing a
name.

| Signal | The fix |
|--------|---------|
| A file is the only place that imports three unrelated concerns | Split by role; each role takes its own address |
| A class's methods group by role rather than by shared state | Split the class along the grouping |
| A function both does a job and reports on it (a `push` into a shared results list inside each branch) | Named phase helpers that return data; collect the report in one place |
| Two modules write the same stored field | Name the single owner; the others send it a message |
| A file has grown past roughly 400 lines, or a class past roughly 200 with more than 10 methods (working conventions, not measurements) | Split by responsibility, not by line count |

The line counts above are this repo's working conventions rather than measurements; for the thresholds that are
computed per function, quote `o-review`'s numbers instead. The definition of a responsibility violation, and the
extract tests that settle it, belong to `o-review`, not here: this skill decides **where the pieces go** once
the split is agreed. `references/responsibilities.md` covers data ownership and the size conventions.

## 4. Dependencies

Dependencies point from volatile to stable: policy inward, I/O at the edges. That is the Stable Dependencies
Principle (Robert C. Martin, *Agile Software Development*, part V): depend in the direction of stability, so a
module may depend on things steadier than itself and never on things less steady. A module that knows what a
database, a framework or a vendor API is, is at the edge. The instability metric the principle turns on is
quoted with its source in the dependency-cruiser rules reference:
<https://github.com/sverweij/dependency-cruiser/blob/918d9193edfae3fe1fb76cfe3d06cc0624539b91/doc/rules-reference.md>.

- **No cycles.** A cycle means the two modules are one module with a lint error.
- **A stable module never imports a volatile one.** If it must, the abstraction is missing: define the port
  next to the policy and let the edge implement it.
- **Third-party types belong at the edge.** The vendor's client, its error class and its pagination cursor do
  not reach the core; map them at the boundary.
- **A declared boundary is checkable.** If the repo has `.o-skills/config/arch.json`, the allowed directions
  are written there and `o-arch-lint` enforces them. Read the declaration before advising; do not invent a
  layering the repo never agreed to.

Depth: `references/direction.md`.

## 5. Composition Over Inheritance

Inheritance hard-wires one axis of variation and the subclass inherits every other decision too. Composition
lets a caller take exactly the parts it needs.

| Signal | Verdict |
|--------|---------|
| A base class with one subclass | Composition, or the concrete class: the hierarchy is a placeholder |
| Depth beyond one level | Flatten it, unless the skeleton is genuinely shared and no protected state is involved: one level survives as the template method in `references/composition.md` |
| A subclass overrides a method only to do nothing | Delete the override and the method; the base was too broad |
| A subclass reaches into protected state of the base | Compose a delegate the subclass can hold instead |
| A shared bit of behaviour in two siblings | Move it to a collaborator both compose, not to a deeper base |
| A `switch` or type check selecting behaviour | A map of strategies; the map is the composition |

**The rule of three** (Don Roberts, quoted by Martin Fowler in *Refactoring*, ch. 2; the passage as
reproduced at <https://github.com/jemmy512/book-notes/blob/ea362ce121a8f62449b0ebb74fc7058c201221eb/se/refactoring-2.md>).
Two call sites may duplicate; the third is when a shared abstraction pays. Before that,
copy the code: an abstraction extracted from two examples usually guesses the axis of variation wrong, and a
wrong abstraction costs more than the duplication it removed. When you find one that was stretched with flags
and conditionals to fit a case it did not expect, the repair is to inline it back into each caller and delete
the parts each caller does not need. `references/composition.md` works an example.

## Where These Rules Do Not Apply

Three things sit outside the rules above: what they never authorise cutting, the trees they were not written for,
and the violations accepted on purpose. They are one section because one reader asks all three, usually as "may
I do this?", and one answer is easier to find than three.

**Never cut**, whatever else a pass decided:

- A published or exported name: it is a contract, not a preference.
- A framework- or platform-mandated name, and a framework-required class.
- A test seam, or a boundary with exactly one implementation that exists so a test can substitute it.
- Validation at a trust boundary, whatever file it sits in.
- A module boundary that costs nothing and hides something: depth is the point of a module.
- Anything the user asked for. Suggest the smaller option instead.

**The advice does not apply to:**

- **A tree of two or three files.** A bag module is honest at that size; splitting it costs more than it saves.
  The naming rule still holds, because a name costs nothing to get right.
- **A table of static data, a generated file, or a long literal list.** Length is not a responsibility, and a
  role folder holding data rather than behaviour is not a boundary.
- **A framework that mandates a base class or a directory.** The platform's contract outranks this preference.
  Say so where the code is written, so the next reader does not reopen the same question.
- **A published surface.** Renaming an exported symbol is a migration with a deprecation path, so it is a task
  rather than a pass.
- **A module nobody will change again.** Architecture pays back over edits; a frozen module does not earn a
  refactor.

**Accepting a violation.** Some cannot be fixed today: a framework that will not invert, a table another team
owns, a deadline the business set. Accepting one is a decision, and an undocumented decision quietly becomes the
convention.

- **Record it where the code is**, in the module header, in one sentence: what is violated, why it is accepted,
  and what would have to change for the fix to become possible.
- **Keep it at the outermost layer.** A compromise in an adapter is a compromise about a detail; the same
  compromise inside a use case is a rule bent for a mechanism.
- **Never silence the checker with it.** An `allowed_dependencies` entry that exists only to permit a mistake
  turns a gate into a shrug. Where the declaration must carry an exception, it carries a reason beside it.
- **Keep the path back.** The record names the change that removes it, so the next reader can act instead of
  re-deriving the decision.
- **Report it up.** An accepted violation goes in the pass's record and in the review plan, so it is known debt
  rather than an unnoticed one.

## Steps

Every step ends on a criterion you can check, so a half-finished run is visible rather than arguable.

1. **Name the pain.** One sentence: a bag directory, a role-shaped name, two reasons to change, a wrong-way
   import, a hierarchy nobody asked for.
   **Completion:** the pain is one sentence and it names a unit and a `file:line`, not a feeling. When you
   cannot name it, the completion is a question to the user.
2. **Take the scope.** What the user pointed at, or `git diff --name-only main...HEAD` (use `master` if that is
   the default).
   **Completion:** the scope is a list of files and every one of them has been read, with its callers.
3. **Read the declaration, if there is one.** `.o-skills/config/arch.json` decides which directions are allowed
   and which names are banned here. Where it says nothing, the group is unrated rather than judged. A repo with
   no declaration runs `o-arch-lint`'s scaffold to have one proposed from the tree, ratifies it by hand, and
   commits it, checking that the commit takes: `.o-skills/` is ignored in some repos, and a declaration no clone
   receives enforces nothing. Until there is one, the naming group is the whole of what this skill may enforce.
   **Completion:** the declaration has been read, or the run is recorded as naming-only.
4. **Judge each unit** against its group. Stop at the first question that fits: one responsibility? named for a
   concept? living with the code that owns it? depending inward?
   **Completion:** every unit in scope has a verdict row.
5. **Check callers before proposing a change.** If code outside the repo uses the unit, report it and keep it.
   **Completion:** every `change` row names its call sites, or says none.
6. **Propose the smallest change that fixes the named pain.** A move is one change, a split is one change, a
   rename is one change.
   **Completion:** each proposal is exactly one of move, split, rename or repoint, and none bundles two.
7. **Say what you did not do.** A finding too large for the current task is reported, not performed.
   **Completion:** every row reported instead of performed carries the reason, against the task-size cap
   `o-decompose` uses (M: up to 10 files in one module, no contract change).
8. **Write the record.** A pass inside `o-review` writes its rows into that review's plan under `[Architecture]`.
   A standalone run writes `<run folder>/Enn-arch.md`: a `**Scope:**` line, a `**Declaration:**` line naming the
   declaration it read or `none`, then one row per unit in scope — unit, group, verdict, reason, and the evidence
   that verdict rests on (`file:line`, or `-` for an unrated row). The shape is shown in the worked example above.
   **Completion:** `node <skill>/scripts/verdicts.mjs --file <record>` exits 0 on a standalone record. That is the check
   rather than a reading: every group named, every verdict one of `ok`, `violated` or `unrated`, every evidence
   cell resolving to a real line, and no `ok` claimed for a group a `none` declaration left unrated. A pass
   inside `o-review` has no such file, and its completion is the rows in that plan.

## Worked Example

`references/worked-example.md` runs the whole method once, on a tree small enough to check by eye: a `utils` bag
module and the units judged one row each. Read it before a first run on an unfamiliar tree.

## Rules

- Inside another skill, report only: `o-fix` applies the finding from the review plan. On a direct request, make
  the change one move at a time.
- Never restate a rule a sibling owns: `o-unbloat` decides whether a unit should exist, `o-review` defines the
  responsibility tests, `o-comments` owns commentary. A finding two of them could claim is reported once, by
  whichever owns it.
- A change that needs more than one task is a finding, not a task. `o-decompose` caps a task at size M — up to 10
  files in one module, with no contract change.
- Follow the repo's own style where it differs from an example here, and say so when you do.

## References

- `scripts/verdicts.mjs` — the record checker: `--file <record>` exits 0 on a finished record, 1 with the row
  that is not, and `--self-test` proves the thirteen cases it ships with still describe the shape it enforces.
  Those cases are read from `evals/fixtures/verdict-cases.json` beside this file, so install the skill whole
  rather than copying the script on its own.
- `references/naming.md` — the routing table, directory names, and names that are not yours to change.
- `references/boundaries.md` — the four layer kinds, capability grouping, the composition root, ports, how to
  choose a boundary, humble adapters, and layer theater.
- `references/components.md` — the component principles: as abstract as it is stable, what belongs in one
  component, the dependency magnet, and testing the boundary.
- `references/responsibilities.md` — one role per module, data ownership, and the size conventions.
- `references/direction.md` — volatile depends on stable, stability measured as fan-in, cycles, what may cross a
  boundary, and mapping third-party types.
- `references/composition.md` — composition over inheritance, the rule of three, and repairing a wrong abstraction.
- `references/worked-example.md` — the method run once, end to end, on a small tree.
