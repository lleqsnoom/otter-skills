---
name: x-arch-lint
description: Check a code tree against the architecture it declares — reads .x-skills/config/arch.json and reports every banned directory and file name, every wrong-way import across a declared layer boundary, and every place the declaration and the tree disagree, as file:line with a rule name. Detection only, never writes code, exit 1 on a violation. Use when asked to check layer boundaries, verify dependency direction, find utils/helpers/common sprawl, or prove a repo still matches its declared structure; x-review runs it on every review.
version: 1.0.0
author: Community
tags: [architecture, lint, boundaries, dependency-direction, naming, enforcement, parity]
user-invocable: true
---

# X-Arch-Lint — Is the Tree Still the Architecture It Declared?

A declaration that nothing checks is a wish. This skill compares the code to the architecture the repo wrote
down and reports the difference as `file:line`, so the argument is about the declaration rather than about a
reviewer's memory.

**Detection only.** It never rewrites code, renames a file, or moves a module. It opens no network connection
and runs no git command. Fixing a violation happens in a pull request, by a person, and wiring it into CI is a
deliberate separate step.

## When to use

- "Does this still match our architecture?", "check the layer boundaries", "is this import allowed?".
- Before a merge, or as the check `x-review` runs as part of every review.
- After `x-arch` reported a placement problem, to confirm the declaration says what you think it does.
- A repo that has a `.x-skills/config/arch.json` and a suspicious `utils/`.

The run covers the whole `--root`, deliberately: a violation that predates the branch still shows, so a review
sees the tree as it is rather than only the diff.

## Start a declaration

A repo with none can have a first one proposed from the tree as it is:

```bash
node ~/.agents/skills/x-arch-lint/scripts/scaffold.mjs --root .
node ~/.agents/skills/x-arch-lint/scripts/scaffold.mjs --root . --force   # replace an existing declaration
```

It prints a declaration to stdout and writes it only where nothing would be replaced, or with `--force`. One
layer per top-level code directory, with the directions the static relative imports already take, so a deeper
model (a `src/` that holds six layers) is then split by hand. **Read the note it prints before ratifying**: an
import built at run time, an absolute specifier and a re-export are invisible to it, so an empty list means
nothing was observed rather than nothing is imported. Widen each entry to what the layer may do, then commit it.

**Check that the commit takes.** A declaration under `.x-skills/` is ignored by any repo whose git config
ignores that tree, and `git check-ignore -v .x-skills/config/arch.json` prints the rule that does it. A
declaration no clone receives checks nothing, so either force-add it (`git add -f <path>`) or keep it where the
repo already tracks configuration, and say which in the note the team reads.

## Run it

```bash
node ~/.agents/skills/x-arch-lint/scripts/arch-check.mjs --root .
node ~/.agents/skills/x-arch-lint/scripts/arch-check.mjs --root . --config path/to/arch.json
node ~/.agents/skills/x-arch-lint/scripts/arch-check.mjs --root . --explain-coverage
node ~/.agents/skills/x-arch-lint/scripts/arch-check.mjs --self-test
```

A local install is `.agents/skills/x-arch-lint/scripts/arch-check.mjs`. `--root` and the file paths under it are
resolved from the working directory, so a relative path works from anywhere the script can be reached; there is
no install root to get right. `--config` defaults to `.x-skills/config/arch.json`, found by walking up from
`--root`.

| Exit | Means |
|------|-------|
| 0 | No violations, or nothing declared that could be violated |
| 1 | At least one violation; each is printed with its rule, `file`, and `line` |
| 2 | Usage error, an unreadable root, or a config that is not a JSON object |

An option the checker does not recognise is a usage error rather than a word to ignore, so a mistyped
`--explain-coverage` exits 2 instead of quietly reporting a clean tree without the list you asked for.

Output is JSON:

```json
{
  "root": "/abs/path",
  "config": "/abs/path/.x-skills/config/arch.json",
  "rated": ["naming", "dependency-direction", "boundaries"],
  "unrated": [],
  "unplaced": 0,
  "violations": [{ "rule": "naming", "file": "src/utils/", "line": 1, "message": "..." }]
}
```

`config` is the path it read, or `null`. `rated` names the rule groups that were actually checked, `unrated`
names the ones the declaration cannot cover, and `unplaced` counts the files no declared layer claims (a
root-level file such as a README or a lockfile is not a layer candidate, and neither is the declaration itself).
`--explain-coverage` adds `unplacedFiles`, the list behind that count.

## The rules it can check

| `rule` | Fires when |
|--------|-----------|
| `naming` | A path segment contains a banned word (`utils`, `date-utils`, `shared`), or a `naming` rule with `applies_to: "*"` or a layer name fails its `must_match` / `must_not_match` regex |
| `dependency-direction` | A file in one layer matches another layer's `import_markers` and that layer is not in its `allowed_dependencies`, or the declaration itself draws a cycle between layers |
| `boundaries` | A declared layer root is not on disk, or a `naming` rule targets a layer the config never declares — the declaration and the tree have drifted |

## What it cannot check, and where it can be blind

- **Composition over inheritance is not a regex.** A base class with one subclass, a hierarchy three levels
  deep, a subclass overriding a method to do nothing: all readable by a person and none of them detectable
  here. `x-arch` reports those under `[Architecture]`; this checker says nothing about them, and the absence of
  a `composition` line means nothing either way.
- **`import_markers` are regexes the declaration supplies**, matched line by line. An import style the
  declaration does not describe (a different relative form, a re-export, an aliased path) is a false negative
  no run can report; an import built at run time (`path.join(__dirname, "..", "src", ...)`) is invisible to any
  line-based check. `unplaced` is the partial answer: a file no layer claims was never checked for direction at
  all, so a non-zero count is a gap to read, not noise.
- **A cycle is checked in the declaration, not in the imports.** The acyclic rule reads `allowed_dependencies`,
  so it catches a cycle the declaration draws (`a` may use `b`, `b` may use `a`) and cannot catch one the markers
  fail to see. Import-level cycle detection would need a parser per language, which is the trade this tool makes
  deliberately rather than by omission.

## Rated and unrated: a partial declaration is reported, not obeyed

The point of a declaration is that nobody has to guess the standard. Where the config says nothing, the gate
says so instead of inventing one. `rated` and `unrated` are the two halves of that answer:

| Rule group | Rated when | With no config |
|------------|-----------|----------------|
| `naming` | always: the built-in banned list, plus any wildcard `naming` rules | rated |
| `boundaries` | the config declares `layers` | unrated |
| `dependency-direction` | the config declares `layers` **and** every declared layer has an `allowed_dependencies` entry | unrated |

**An unrated group is never a failure**: the run exits 0 and names the group, so a reader sees
`unrated: [dependency-direction, boundaries]` and knows the tree was checked for naming only. Report both lists
verbatim when a review runs it, because a green run over an undeclared tree is a much weaker statement than a
green run over a declared one.

The dependency group is deliberately all-or-nothing: one layer without an entry would leave its imports
unchecked while the run still read as verifiable.

## Config

`.x-skills/config/arch.json`. Every field is optional, so a partial declaration still runs. A repo with no
declaration starts by writing one from this schema: a `naming` block alone is a valid first step, and the layer
keys can follow when the boundaries are agreed.

```json
{
  "layers": {
    "domain":         { "roots": ["src/domain"],         "import_markers": ["from \"\\.\\./domain"] },
    "application":    { "roots": ["src/application"],    "import_markers": ["from \"\\.\\./application"] },
    "infrastructure": { "roots": ["src/infrastructure"], "import_markers": ["from \"\\.\\./infrastructure"] }
  },
  "allowed_dependencies": {
    "domain": [],
    "application": ["domain"],
    "infrastructure": ["application", "domain"]
  },
  "naming": [
    { "applies_to": "domain", "must_not_match": "controller", "message": "a controller belongs in the interface layer, not in domain" }
  ],
  "banned_names": ["utils", "helpers", "common", "shared", "misc", "tools", "other"],
  "exclude": ["node_modules", ".git", "dist", "generated"]
}
```

- `layers[L].roots` — path prefixes that put a file in layer L. A file is classified by the longest matching
  root, so `src/domain/events` can sit inside `src/domain`.
- `layers[L].import_markers` — regexes that mean "this file imports layer L". They are matched line by line, so
  detection needs no language parser and the reported line number is the real one.
- `allowed_dependencies[L]` — the whitelist layer L may depend on. `[]` means nothing outside its own layer.
  Same layer is always allowed.
- `naming[]` — `applies_to` is a layer name or `*`; `path_regex` narrows by relative path; `must_match` and
  `must_not_match` are basename regexes; `message` is what a reader sees when it fires.
- `banned_names` replaces the built-in seven. A name is banned when a listed word stands alone inside it, so
  `utils`, `date-utils` and `string_utils` all hit while `utilities` does not.
- `exclude` adds to the built-in list (`node_modules`, `.git`, `dist`, `.astro`, `vendor`, `.venv`, `.x-skills`). A path
  is skipped when it contains any fragment.

## Completion

`arch-check.mjs` exits 0, or exits 1 with every violation fixed or reported to the user. The report names
`rated` and `unrated` rather than presenting a green run as full coverage, and mentions `unplaced` when it is
non-zero. `--self-test` exits 0, which proves the fixtures it ships with still describe the rules it claims to
enforce, each pinned to its rule, file and line. Those cases are data in `evals/fixtures/arch-cases.json`, one
object per rule, so a change that moves a violation, a rated group or a line number fails there rather than in a
review, and a new case needs no change to the checker.

## Files

- `scripts/arch-check.mjs` — the checker: config loading, the tree walk, the rule groups, the coverage report,
  and `--self-test`.
- `scripts/scaffold.mjs` — the proposal: one layer per code directory with the observed directions, checked
  against `arch-check.mjs` by its own `--self-test`.
- `evals/fixtures/arch-cases.json` — the twelve cases `--self-test` runs, each with the tree, the declaration and
  the report expected of it.
- `references/python.md` — a declaration for a Python tree, the Go shape beside it, and what neither marker
  form can see.
