# Otter PM

A suite of skills (`x-*`) for planning, building, reviewing and improving code, each one a
`SKILL.md` with its scripts, references and evals — plus a local project board over `.x-skills`
trees. The skills write the `.x-skills` runs the board reads, so both halves sit in one checkout.

## Install

Link the skills into your agents and register the board's MCP server:

```bash
npm run install
```

Or install the suite as a Claude Code plugin (no local linking):

```
/plugin marketplace add lleqsnoom/otter-pm
```

The board runs as a user service; open it with `oc-otter-pm open` (or `--browser`). Full setup for
the service, the desktop entries and the wrapper is in [`docs/install.md`](docs/install.md).

## Running it

```bash
oc-otter-pm open            # a chrome-less window on the board
oc-otter-pm open --browser  # the same board in a browser tab
oc-otter-pm port            # print the URL it is serving on
```

Keep it running as a user service: `systemctl --user start oc-otter-pm`. Develop it: `npm run dev`
(hot reload), `npm run serve`, `npm run build`, `npm test`.

## Skills

| Skill | What it does | Say when |
|---|---|---|
| `x-plan` | Three approaches → a layered spec, gated on your approval | "plan this feature", "what's the spec" |
| `x-decompose` | Cut an approved plan into triaged task files | "break this down into tasks" |
| `x-implement` | Build tasks test-first, review-clean, one commit each | "implement the tasks" |
| `x-fix` | Resolve a review's fix plan | "fix these findings" |
| `x-review` | Review code against principles and spec, running every pass | "review this diff" |
| `x-commit` | Write a conventional commit message | "commit this" |
| `x-release` | Write the PR body | "write the PR description" |
| `x-triage` | Structured intake for a bug or request | "a bug came in" |
| `x-investigate` | Root cause by ranked, tested hypotheses | "why is this failing" |
| `x-debug` | Reproduce, fix the root cause, verify | "debug this" |
| `x-reproduce` | Generate a minimal repro case | "make a repro" |
| `x-verify` | Mutation and property tests after a fix | "verify the fix" |
| `x-differential` | Review the diff hunk-by-hunk for regression risk | "what could this break" |
| `x-second-opinion` | Fresh-context re-review of a change | "second opinion before shipping" |
| `x-arch` | Placement, naming, responsibility, dependency direction | "where does this live" |
| `x-arch-lint` | Check the tree against the declared architecture | "prove the boundaries hold" |
| `x-floor` | Declare and enforce the quality floor | "set or check the quality bar" |
| `x-unbloat` | Cut code to what the task needs | "unbloat this" |
| `x-comments` | Comment hygiene: add why, remove noise | "clean up comments" |
| `x-refactor` | Refactoring suggestions with before/after | "suggest refactors" |
| `x-skill-lint` | Validate the repo's own skills | "lint the skills" |
| `x-test-gen` | Generate test stubs from code | "scaffold tests" |
| `x-ui` | Design and audit UIs | "audit this screen" |
| `x-browser` | Open the app in a real browser with devtools MCP | "open the app" |
| `x-parallel` | Run independent tasks in isolated worktrees | "parallelize these tasks" |
| `x-analyze` | Interactive analysis → thesis and three options | "analyze this" |
| `x-research` | Metric-driven iteration toward a number | "research or tune X" |
| `x-roast` | Critique a non-code artifact, scored by a script | "roast this" |
| `x-humanize` | Simplify text to a B2 reading level | "simplify this text" |
| `x-essay` | Write an article on a fixed critique loop | "write an article" |
| `x-api-draft` | Draft an API design from requirements | "draft the API" |
| `x-api-swagger` | API design draft → OpenAPI YAML | "make the OpenAPI" |
| `x-migrate` | Framework or dependency migration plan | "migrate to X" |
| `x-rollback` | Revert with multi-step confirmation | "roll this back" |
| `x-search` | Search indexed repos by meaning or identifier | "where is this defined" |
| `x-brief` | Write a handoff brief for the session | "hand off mid-work" |
| `x-domain` | Glossary and ADRs as repo artifacts | "record the terms or decision" |
| `x-interview` | Stress-test a decision with the user | "grill this decision" |
| `x-sketch` | Throwaway prototype to answer a question | "prototype this" |
| `x-walkthrough` | Script the human-only steps | "walk me through the manual steps" |
| `x-guide` | Route you to the right skill | "which skill fits" |
| `x-autoreflection` | Turn sessions into approved skill fixes | "reflect on sessions" |

## Autoreflection

`x-autoreflection` reads the sessions of a window and turns what they show into fixes you approve.

```bash
x-autoreflection 24h     # last day
x-autoreflection 7d      # last week
x-autoreflection 2w      # last fortnight
x-autoreflection         # no period: reflect on one session instead
```

It runs in three stages, and you stay in control:

1. **Analyze** — a script scans every session and writes a skill-health report and a fix plan.
   No judgement, no edits.
2. **Propose** — the agent turns each finding into an exact edit and offers them as one
   multi-select panel. You pick which to keep.
3. **Apply** — `heal.mjs` applies only what you picked, reverts on a failed check, and appends a
   per-skill ledger (`skills/<skill>/.heal-ledger.jsonl`).

A background pass can run stage 1 on a cadence (`hooks/background-reflection.mjs`, tunable via
`AUTOHARNESS_REFLECT_EVERY_N`); stages 2 and 3 are always human-triggered. For details see
`skills/x-autoreflection/SKILL.md`.

## The MCP server

`otter-pm-mcp` exposes the same repositories over stdio, so an agent can ask what a project's tasks,
documents and code say. `npm run install` writes the entry into each agent's config; installed
globally from this checkout, the whole entry is `{ "command": "otter-pm-mcp" }`.

```json
{ "mcpServers": { "otter-pm": { "command": "otter-pm-mcp" } } }
```

It takes no arguments and there is nothing to keep running — the client starts and stops it over
stdio. The same roots as the board decide what it can see.

| Tool | Answers |
|------|---------|
| `list_projects` | every repository this machine reads |
| `get_project` | one project's identity and paths |
| `list_epics` | a project's plans and epics with their tasks |
| `list_tasks` | tasks with state, epic and lane |
| `get_task` | one task in full |
| `list_docs` | a project's documents |
| `read_doc` | one document, with its drift report against the code |
| `search_code` | tracked source, as `path:line` |
| `read_code` | a tracked file, or a line range of it |
| `find_symbols` | where a name is declared |
| `search_knowledge` | tasks, documents and code by meaning |
| `find_related` | what is nearest a path |

Each project keeps its own database at `<repo>/.x-skills/knowledge.lance/`, derived and rebuildable:
deleting it costs the next fuzzy call a rebuild and nothing else. The server writes only its own
database, never a repository file.

## Endpoints

The board serves one HTTP surface and the MCP server is stdio-only; see `docs/install.md` for the
board's routes.
