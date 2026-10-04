# Strict decomposition

Strict mode applies when the plan says `mode: strict` or the user asks for it. It is for work where a task that
quietly hides a subsystem is expensive, such as auth, money, personal data, migrations, or a public contract.
Everything in `SKILL.md` still holds; this file adds the steps below.

## 1. Cut every layer up front

Draft candidates for every layer before writing any file, so the user approves the whole task list at once.

## 2. Triage every candidate into a ledger

Every candidate gets a recorded verdict, including the plainly-a-task ones. `references/triage-rules.md` has the
signals, the bounds and a worked example.

```bash
node <skill>/scripts/triage.mjs start  --dir <run folder> [--source <plan|epic artifact>]
node <skill>/scripts/triage.mjs add    --dir <run folder> --task L0-T1 --title "<candidate>"
node <skill>/scripts/triage.mjs decide --dir <run folder> --task L0-T1 --verdict task --why "one change, one check, size S"
node <skill>/scripts/triage.mjs decide --dir <run folder> --task L1-T1 --verdict plan \
  --why "own contract: gravity, collision, tilemap format" --evidence "src/game/loop.js:1" --child platform-physics
node <skill>/scripts/triage.mjs verify --dir <run folder>   # exit 0 only when triage is complete
```

- **Start the child run before a `plan` or `analyze` verdict** with
  `node <skills>/o-plan/scripts/scenario.mjs start --slug <child>` (or o-analyze's). `decide` refuses those
  verdicts while the child folder is empty.
- **Ask with panels only for verdicts other than `task`**: one `single` panel per candidate, at most four per
  round, never in prose.
- **More than half the candidates come back `plan`?** The layers were written as a component list. Re-cut them,
  or tell the gate why you will not.
- **One ledger per decomposition.** A second decomposition in the same run gets its own ledger and tasks
  folder. Reach the older one with `--source <artifact>`.

`verify` prints `{ dir, ledger, source, candidates, taskFiles, tasksDir, violations }` and exits 1 on any of these:

| Violation | Raised when |
|-----------|-------------|
| `undecided` / `no-reason` | a candidate has no verdict, or no reason for it |
| `no-evidence` / `no-child` | a `plan` or `analyze` verdict cites no `file:line` or URL, or names no child |
| `child-run-missing` | the child run has no folder, or the folder holds no artifact |
| `task-file-missing` / `task-file-duplicate` / `orphan-task-file` / `verdict-not-task` | the task files and the `task` verdicts do not match one for one |
| `bad-name` | a task file is not named `L<N>-T<M>-<slug>.md` |
| `no-tasks-dir` / `no-report` | the tasks folder or `E<nn>-triage.md` is missing |
| `no-size` / `bad-size` / `no-complexity` / `bad-complexity` | the property block has no size or complexity, or one off the scale |
| `unjustified-l` / `oversize` | `size: L` without `complexity_why`, or `size: XL` |

The script owns the `## Verdicts` and `## Handoffs` blocks of `E<nn>-triage.md`. Notes written anywhere else in
that file survive.

## 3. Self-contained task files

Each task holds everything its implementer needs, so it can go to a worker in a fresh worktree:

- `## Context` inlines the config, data shapes, formulas, business rules and APIs the task uses. It never says
  "see the plan".
- A `## Preconditions` section describes the codebase state the task starts from. It describes the state, never
  the task or run that produced it: "the physics module is present and its tests pass".
- The Test Plan lists every error path, not just the main ones.

## 4. Gate

Before handing off to o-implement, confirm the triage report and the full task list with the user in a
`confirm` panel.
