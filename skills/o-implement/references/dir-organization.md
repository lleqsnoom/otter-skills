# Directory Organization

Decide where a unit lives before writing it. What matters is ownership, not the folder names: a tree can have
`domain/`, `application/` and `infrastructure/` and still be one module with three addresses.

1. **Name the owner.** Which module protects the invariant this code belongs to? That module gets the file.
2. **One file per concern.** A file holds one role. When two callers need two different things from it, it is
   two files.
3. **Name the directory for the domain concept**, never for the file shape: `orders/`, `billing/`,
   `sessions/`. `models/`, `services/` and `controllers/` describe what the files look like, which the reader
   can see by opening one, and a bag name (`utils/`, `common/`, `shared/`, `helpers/`, `misc/`, `other/`,
   `tools/`) describes nothing at all.
4. **Group by capability once a capability is real**: it has its own vocabulary, its own failure modes, or a
   different rate of change from its neighbours. Keep local files with the feature and lift one only when a
   second feature needs it.
5. **Imports flow from volatile to stable and never cycle.** A module may depend on things steadier than
   itself; a cycle means the two modules are one module with a lint error.

If the task spec or the plan defines an architecture section, follow it. If not, match the codebase's existing
conventions before inventing new ones. Read `o-arch`'s pass card (`<skills>/o-arch/references/pass.md`) before the first new directory; when the repo has a
`.o-skills/config/arch.json`, that file declares the boundaries it has agreed on and
`o-arch-lint/scripts/arch-check.mjs` is the check that enforces them.

`<skills>` in this file is the folder that holds every o-* skill.
