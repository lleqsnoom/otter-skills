# Tool selection — one property tool and one mutation tool per language

The pass runs whatever the table in `scripts/verify.mjs` names, and the table names one tool per
language on purpose. Two mutation tools for the same language means two survivor formats, two
configs to keep honest and a gate nobody can reason about; the pick is a design call a person can
overturn by editing the table and this page together. Every pick below was checked against its
survivor output, which the parser reads — that contract, not the tool name, is what the skill
depends on.

## JavaScript / TypeScript

| Pass | Tool | Why this one |
|------|------|--------------|
| Property | `fast-check` | Property runners as a library inside the existing test suite, so a property is a test the runner already knows how to report. |
| Mutation | `Stryker` | The maintained standard for the JS/TS ecosystem: instrumenting builds, a report file, per-mutant statuses. |

Run: `npx stryker run`. Survivors are read from the JSON report Stryker writes — set
`htmlReporter`/`jsonReporter` output to `reports/mutation/stryker.json` in `stryker.conf.json`.
A survivor is any mutant whose `status` is `Survived` or `NoCoverage`; `Killed`, `Timeout` and
`RuntimeError` do not gate.

```json
{ "reporters": ["json", "html"], "jsonReporter": { "outputFile": "../reports/mutation/stryker.json" } }
```

## Python

| Pass | Tool | Why this one |
|------|------|--------------|
| Property | `hypothesis` | The property standard for Python; a property is a plain `pytest` test, so no runner wiring is needed. |
| Mutation | `mutmut` | One command, no config file, and `mutmut results` prints survivors with `path:line` — the only mutation tool here that names survivors in text. |

Run: `mutmut run`, then the pass reads `mutmut results`. A survivor is a result line carrying
`survived` with a `path:line` location. `mutmut` keeps its cache in a binary database, so there is
no file for a dry run to read: a dry run over Python reports the survivors half as unrated.

## Rust

| Pass | Tool | Why this one |
|------|------|--------------|
| Property | `proptest` | Shrinks minimal failing inputs into the test failure itself, the way `hypothesis` does, without leaving `cargo test`. |
| Mutation | `cargo-mutants` | Mutates the source tree directly with no test-rewriting step, scopes to a diff with `--in-diff`, and writes machine-readable outcomes. |

Run: `cargo mutants --in-diff <base> --output json`, where `<base>` is the same ref the pass
resolved as its merge base. Survivors are read from `mutants.out/outcomes.json`: an outcome is a
survivor when no run killed or caught it and it was neither a timeout nor unviable.

## Rejected alternates, and why

- **cosmic-ray** (Python) — a framework rather than a tool: a config format, a session store and a
  supervisor to keep alive, for the same survivors `mutmut` prints in one command.
- **Stryker4s / Stryker.NET** — the same engine for other ecosystems, listed here so nobody picks
  them for a JVM or .NET repo expecting the JS table to cover it; add a table entry first.
- **gremlins** (Go) — fine tool, unsupported survivors output at the time of the pick; Go is not in
  the table yet for the same reason, and adding it means adding a parser and fixtures, not a flag.
- **Writing our own mutator** — the point of the pass is that the mutants come from a tool a person
  chose, not from a generator whose blind spots nobody audited.
