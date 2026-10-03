<img src="docs/brand/svg/otter-skills-banner.svg" alt="Otter Skills" width="640">

# Otter Skills

A suite of skills (`o-*`) for planning, building, reviewing and improving code, each one a
`SKILL.md` with its scripts, references and evals — plus an MCP server (`otter-skills-mcp`) that
exposes a project's `.o-skills` tasks, documents and code over stdio.

## Why Otter

**Your agent says "done". Otter checks.**

40 skills that take a change from idea to merged PR — plan, build test-first, review, fix, commit — with scripts
at the gates, so the work is measured instead of taken on the agent's word.

### The pitch

Coding agents are fast, confident, and they grade their own homework. When a test refuses to pass, the easy way to
green is a skipped test, a looser threshold or an `@ts-ignore`. A skill made only of instructions never sees it.
Otter ships the checks with the instructions:

- **Gates are scripts, not promises.** A plan cannot hand off until its gate exits 0. A review measures the code
  your change touched from its syntax tree. `o-floor` catches the cheap ways to lower the bar: a weakened
  threshold, a silenced checker, a skipped test, a deleted assertion.
- **One chain, idea to merge.** `o-plan → o-decompose → o-implement → o-review → o-fix → o-commit → o-release`,
  each writing what the next one reads. Bugs get their own chain: `o-triage → o-debug → o-investigate`.
- **Tested like software, because it is software.** 881 tests. 10 evals where Claude Code runs a skill on a sample
  project and a script checks what it did. Routing measured on 259 queries. Tests, lint and the routing floor gate
  every merge in CI.
- **It learns from how you work.** `o-autoreflection` reads your sessions from 12 coding-agent CLIs, finds where
  a skill caused friction, and proposes fixes. You pick them; each one is checked and rolled back if the check
  fails.
- **Small work stays small.** An XS task skips the heavy passes. The full loop is saved for work that earns it.

### How it compares

These projects are all good, and they solve different problems:

| | What it is | Pick it when |
|---|---|---|
| **Otter Skills** | 40 skills, with scripts that gate and measure the work from plan to PR, plus debugging, research and writing | you want the agent's work checked by scripts, in one chain from idea to merge |
| [Superpowers](https://github.com/obra/superpowers) | A lean methodology: about 15 skills that trigger on their own and steer brainstorm → plan → TDD → review | you want a proven workflow with almost no setup, on many different agents |
| [Spec Kit](https://github.com/github/spec-kit) | GitHub's toolkit of structured processes — spec-driven development, bug fixing, idea assessment — with a `specify` CLI | your team works from specifications and wants GitHub's templates |
| [BMad Method](https://github.com/bmad-code-org/BMAD-METHOD) | Agile AI-driven development: briefs, specifications and architecture carried from idea to delivery | you want a full agile process around the code |
| [Anthropic skills](https://github.com/anthropics/skills) | Anthropic's example skills and the document skills (docx, pdf, pptx, xlsx) | you need documents, or a reference for writing your own skills |

### Try it on work you already have

```
/plugin marketplace add lleqsnoom/otter-skills
/plugin install otter-skills@otter-skills
```

Then run `/otter-skills:o-review` on the branch you are on. It reviews only what you changed, and one run will
tell you whether Otter earns a place in your workflow. Not sure where to start? Ask `/otter-skills:o-guide`.

**Fair warning:** Otter is young and built Claude Code first. The scripts need Node 22+. The plugin's semantic
search installs about 1.8 GB in the background the first time it starts. And Otter is opinionated: it would
rather stop and ask than guess.

## Install

Link the skills into your agents and register the MCP server:

```bash
npm run install
```

Or install the suite as a Claude Code plugin (no local linking):

```
/plugin marketplace add lleqsnoom/otter-skills
/plugin install otter-skills@otter-skills
```

The plugin brings the skills, the four loop commands and the hooks; plugin skills are namespaced, so `o-plan` runs
as `/otter-skills:o-plan`. It also starts the MCP server, installing its packages into the plugin's data
directory on first start — the exact tools at once, the semantic index (about 1.8 GB) in the background; see
[docs/install.md](docs/install.md). Pick one route per machine — both at once installs every skill twice.

### Hooks

The plugin registers three hooks (`hooks/hooks.json`):

| Event | Script | Does |
|---|---|---|
| `SessionStart` | `session-start-summary.mjs` | prints one line on the last heal and the last background report, when there is one |
| `PostToolUse` on a write | `review-plan-gate.mjs` | tells the agent when an `*-review-plan.md` is missing one of the six pass headings |
| `Stop` | `background-reflection.mjs` | counts turns and runs autoreflection's report-only stage every N — only in a project that already keeps a `.o-skills/` tree |

With `npm run install` instead, add the same entries to your Claude Code settings yourself, pointing at this
checkout's `hooks/` (see [docs/install.md](docs/install.md)).

## Skills

| Skill | What it does | Say when |
|---|---|---|
| `o-plan` | The approaches weighed → a layered spec, gated on your approval | "plan this feature", "what's the spec" |
| `o-decompose` | Cut an approved plan into triaged task files | "break this down into tasks" |
| `o-implement` | Build tasks test-first, review-clean, one commit each | "implement the tasks" |
| `o-fix` | Resolve a review's fix plan | "fix these findings" |
| `o-review` | Review code against principles and spec, running every pass | "review this diff" |
| `o-commit` | Write a conventional commit message | "commit this" |
| `o-release` | Write the PR body | "write the PR description" |
| `o-triage` | Structured intake for a bug or request | "a bug came in" |
| `o-investigate` | Root cause by ranked, tested hypotheses | "why is this failing" |
| `o-debug` | Reproduce, fix the root cause, verify | "debug this" |
| `o-verify` | Mutation and property tests after a fix | "verify the fix" |
| `o-differential` | Review the diff hunk-by-hunk for regression risk | "what could this break" |
| `o-second-opinion` | Fresh-context re-review of a change | "second opinion before shipping" |
| `o-arch` | Placement, naming, responsibility, dependency direction | "where does this live" |
| `o-arch-lint` | Check the tree against the declared architecture | "prove the boundaries hold" |
| `o-floor` | Declare and enforce the quality floor | "set or check the quality bar" |
| `o-unbloat` | Cut code to what the task needs | "unbloat this" |
| `o-comments` | Comment hygiene: add why, remove noise | "clean up comments" |
| `o-refactor` | Measure a module and route each refactor to the skill that owns it | "what should I refactor?" |
| `o-skill-lint` | Validate the repo's own skills | "lint the skills" |
| `o-test-gen` | Generate test stubs from code | "scaffold tests" |
| `o-ui` | Design and audit UIs | "audit this screen" |
| `o-browser` | Open the app in a real browser with devtools MCP | "open the app" |
| `o-parallel` | Run independent tasks in isolated worktrees | "parallelize these tasks" |
| `o-analyze` | Interactive analysis → thesis and the options weighed | "analyze this" |
| `o-research` | Research a topic toward cited coverage of its questions | "research X with sources" |
| `o-tune` | Move a number toward a target, one measured change at a time | "optimize X until Y" |
| `o-roast` | Critique a non-code artifact, scored by a script | "roast this" |
| `o-humanize` | Simplify text to a B2 reading level | "simplify this text" |
| `o-essay` | Write an article on a fixed critique loop | "write an article" |
| `o-migrate` | Framework or dependency migration plan | "migrate to X" |
| `o-rollback` | Revert with multi-step confirmation | "roll this back" |
| `o-search` | Find code, tasks and docs by identifier or meaning, across repos | "where is this defined" |
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

A background pass can run stage 1 on a cadence (`hooks/background-reflection.mjs`, a `Stop` hook, tunable via
`AUTOHARNESS_REFLECT_EVERY_N`; it only runs in a project that already keeps a `.o-skills/` tree); stages 2 and 3
are always human-triggered. For details see
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
`$OTTER_SKILLS_ROOTS`, discovery, or the current directory, and decide what it can see. A tool called without
`project` answers for the repository the client was started in.

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

## Checks and evals

`npm test` runs the unit tests and the skill validator; CI adds the skill lint, the floor guard's self-test and
the trigger-rate floor. None of that runs an agent.

`npm run eval` does: each case under `skills/<skill>/evals/cases/<case>/` builds a fixture repository, runs
Claude Code on its `prompt.md` with every skill installed, and checks what the agent left behind with
`check.mjs`. It spends tokens, so it runs on demand, not in CI — `npm run eval -- --skill o-fix` runs one skill's
cases, `--keep` keeps the fixture for inspection, and `OTTER_EVAL_AGENT_CMD` swaps in another agent command.
A case the host refused to start — a usage or rate limit — is reported as NOT RUN, not as a failure.

`node skills/o-skill-lint/scripts/route-check.mjs --model-cmd "claude -p"` asks a model which skill each trigger
query should load: the meaning-level check beside the lexical trigger rate, also on demand.
