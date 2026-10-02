# o-arch — pass card

Read this when another skill runs o-arch as a pass. A standalone run, when the user asks about placement, naming,
boundaries or inheritance, reads `SKILL.md` and runs every step.

## Per host

No record of its own, and uncommitted work is the task, not a reason to stop. The host's scope is the scope.

- **o-review** (reports only): all five groups over the files under review. Each finding goes under
  `[Architecture]` in the review plan with its group, verdict, reason and `file:line`.
- **o-implement** (edits): naming and placement before GREEN, to decide where the new unit goes and what it is
  called; all five groups in REFACTOR. Move and rename only what the current task wrote.
- **o-decompose** (does not edit): naming and direction before cutting a layer. A candidate that would cross a
  declared boundary is triaged as a run of its own, not one task's step.
- **o-fix** (edits): the groups named in each `[Architecture]` finding of the review plan.

When the repo has `.x-skills/config/arch.json`, it declares the allowed directions and banned names; a group it
says nothing about is `unrated`, not `ok`. `o-arch-lint/scripts/arch-check.mjs --root .` checks the declaration.
With no `.x-skills/config/arch.json`, naming is the only group enforced: the other four are `unrated`, and a
suspected boundary or direction problem is reported as unrated, never as a violation.

## Rules

1. **Naming.** A name says the domain concept it owns. Banned: `utils`, `helpers`, `misc`, `other`, `common`,
   `shared`, `tools`, `Base*`/`Abstract*`, `*Manager`/`*Helper`/`*Util`/`*Processor`, `data`/`info`/`handle`.
   Route, do not rename: decide which concept owns the code. Framework-chosen and published names are never
   violations.
2. **Boundaries.** One business change should edit one place (change test). The module that protects an
   invariant owns the data (owner test). Group by capability, keep code with the feature that uses it, and lift
   it only when a second feature needs it.
3. **Responsibilities.** One role per module, file and class. Methods grouped by role mean two classes. A
   function that does a job and reports on it becomes phase helpers that return data. Two writers of one field
   need one owner. Past roughly 400 lines per file or 200 per class, split by responsibility.
4. **Dependencies.** Volatile depends on stable: policy inward, I/O at the edges. No cycles. A stable module
   never imports a volatile one; define a port beside the policy instead. Third-party types stop at the edge.
5. **Composition over inheritance.** A base with one subclass, depth beyond one level, an override that does
   nothing, or reaching into protected state: compose instead. A type `switch` becomes a strategy map. Rule of
   three: duplicate twice, extract on the third caller.

**Never cut:** published or exported names, framework-mandated names and classes, test seams, trust-boundary
validation, a cheap boundary that hides something, anything the user asked for.

**Does not apply to:** a tree of two or three files (naming still holds), static data or generated files, a
framework-mandated base or directory, a published surface (that is a migration task), a module nobody will
change again.

**Accepting a violation** is a one-sentence record in the module header: what, why, and what would make the fix
possible. Never silence the checker for it.

**Ownership:** whether a unit should exist is `o-unbloat`; the responsibility extract tests are `o-review`;
comments are `o-comments`. Report a shared finding once, under its owner. A change bigger than one task is a
finding, not an edit.

## Full rules

Open `SKILL.md` only when a case is unclear: `## 1. Naming` through `## 5. Composition Over Inheritance`,
`## Where These Rules Do Not Apply`, and `## Worked Example`.
