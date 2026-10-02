# Otter Skills

A suite of skills (`o-*`) for planning, building, reviewing and improving code, each one a
`SKILL.md` with its scripts, references and evals — plus an MCP server (`otter-skills-mcp`) that
exposes a project's `.o-skills` tasks, documents and code over stdio.

## Install

Link the skills into your agents and register the MCP server:

```bash
npm run install
```

Or install the suite as a Claude Code plugin (no local linking):

```
/plugin marketplace add lleqsnoom/otter-skills
```

## Skills

| Skill | What it does | Say when |
|---|---|---|
| `o-plan` | Three approaches → a layered spec, gated on your approval | "plan this feature", "what's the spec" |
| `o-decompose` | Cut an approved plan into triaged task files | "break this down into tasks" |
| `o-implement` | Build tasks test-first, review-clean, one commit each | "implement the tasks" |
| `o-fix` | Resolve a review's fix plan | "fix these findings" |
| `o-review` | Review code against principles and spec, running every pass | "review this diff" |
| `o-commit` | Write a conventional commit message | "commit this" |
| `o-release` | Write the PR body | "write the PR description" |
| `o-triage` | Structured intake for a bug or request | "a bug came in" |
| `o-investigate` | Root cause by ranked, tested hypotheses | "why is this failing" |
| `o-debug` | Reproduce, fix the root cause, verify | "debug this" |
| `o-reproduce` | Generate a minimal repro case | "make a repro" |
| `o-verify` | Mutation and property tests after a fix | "verify the fix" |
| `o-differential` | Review the diff hunk-by-hunk for regression risk | "what could this break" |
| `o-second-opinion` | Fresh-context re-review of a change | "second opinion before shipping" |
| `o-arch` | Placement, naming, responsibility, dependency direction | "where does this live" |
| `o-arch-lint` | Check the tree against the declared architecture | "prove the boundaries hold" |
| `o-floor` | Declare and enforce the quality floor | "set or check the quality bar" |
| `o-unbloat` | Cut code to what the task needs | "unbloat this" |
| `o-comments` | Comment hygiene: add why, remove noise | "clean up comments" |
| `o-refactor` | Refactoring suggestions with before/after | "suggest refactors" |
| `o-skill-lint` | Validate the repo's own skills | "lint the skills" |
| `o-test-gen` | Generate test stubs from code | "scaffold tests" |
| `o-ui` | Design and audit UIs | "audit this screen" |
| `o-browser` | Open the app in a real browser with devtools MCP | "open the app" |
| `o-parallel` | Run independent tasks in isolated worktrees | "parallelize these tasks" |
| `o-analyze` | Interactive analysis → thesis and three options | "analyze this" |
| `o-research` | Metric-driven iteration toward a number | "research or tune X" |
| `o-roast` | Critique a non-code artifact, scored by a script | "roast this" |
| `o-humanize` | Simplify text to a B2 reading level | "simplify this text" |
| `o-essay` | Write an article on a fixed critique loop | "write an article" |
| `o-api-draft` | Draft an API design from requirements | "draft the API" |
| `o-api-swagger` | API design draft → OpenAPI YAML | "make the OpenAPI" |
| `o-migrate` | Framework or dependency migration plan | "migrate to X" |
| `o-rollback` | Revert with multi-step confirmation | "roll this back" |
| `o-search` | Search indexed repos by meaning or identifier | "where is this defined" |
| `o-brief` | Write a handoff brief for the session | "hand off mid-work" |
| `o-domain` | Glossary and ADRs as repo artifacts | "record the terms or decision" |
| `o-interview` | Stress-test a decision with the user | "grill this decision" |
| `o-sketch` | Throwaway prototype to answer a question | "prototype this" |
| `o-walkthrough` | Script the human-only steps | "walk me through the manual steps" |
| `o-guide` | Route you to the right skill | "which skill fits" |
| `o-autoreflection` | Turn sessions into approved skill fixes | "reflect on sessions" |

## Autoreflection

`o-autoreflection` reads the sessions of a window and turns what they show into fixes you approve.

```bash
o-autoreflection 24h     # last day
o-autoreflection 7d      # last week
o-autoreflection 2w      # last fortnight
o-autoreflection         # no period: reflect on one session instead
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
`skills/o-autoreflection/SKILL.md`.

## The MCP server

`otter-skills-mcp` exposes a project's tasks, documents and code over stdio, so an agent can ask what
it says. `npm run install` writes the entry into each agent's config; installed globally from this
checkout, the whole entry is `{ "command": "otter-skills-mcp" }`.

```json
{ "mcpServers": { "otter-skills": { "command": "otter-skills-mcp" } } }
```

It takes no arguments and there is nothing to keep running — the client starts and stops it over
stdio. Roots come from `otter-skills.config.json`, Orca's project list, `--root` flags,
`$OTTER_SKILLS_ROOTS`, discovery, or the current directory, and decide what it can see.

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

Each project keeps its own database at `<repo>/.o-skills/knowledge.lance/`, derived and rebuildable:
deleting it costs the next fuzzy call a rebuild and nothing else. The server writes only its own
database, never a repository file.
