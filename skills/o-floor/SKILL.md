---
name: o-floor
description: Set and enforce a repository's quality floor — declare the numbers that must hold (coverage, file size, dependency risk, accessibility) with a reason each in .o-skills/config/floor.json, then let floor-guard.mjs report every move that lowers the bar on the current diff: a weakened threshold, a silenced checker (@ts-ignore, eslint-disable, noqa), unfinished work, a test made easier, a deleted test, or a removed assertion. Detection only. Use when asked to set a quality bar, stop a test being weakened to go green, check coverage or complexity budgets, or prove a diff did not lower the standard.
version: 1.0.2
author: Community
tags: [quality, floor, constraints, guard, thresholds, suppression, coverage, enforcement, ratchet]
user-invocable: true
---

# O-Floor — The Bar, Written Down and Checked

An agent under pressure makes the test pass. It adds `@ts-ignore`, skips the failing case, deletes the assertion,
lowers the threshold, or files an exception with no owner. Every one of those is the same move: **lower the bar
instead of clearing it**. A bar that nothing checks is a wish, and this is the check.

`o-floor` is two things: the place a repository writes its quality floor down — each number with the reason for
it — and `floor-guard.mjs`, which reads the diff and reports the moves that lower it.

**Detection only.** It never edits a threshold, renames a file, or rewrites a test. It opens no network
connection and runs no build. Fixing a violation means fixing the code, or routing the move through a tracked
exception with an owner and an expiry.

## When to use

- "Set a quality bar", "our thresholds keep drifting", "stop tests being weakened to go green".
- "Is this diff reducing our standards?", before a merge.
- A green suite you do not believe — a `.skip`, a fresh `@ts-ignore`, or a deleted assertion is why.
- As the check `o-implement` runs before each commit and `o-review` runs on every review.

Not for a general code review (`o-review`) or an architecture boundary (`o-arch-lint`). This checks the *bar*,
not the code.

## Run it

```bash
node <skill>/scripts/floor-guard.mjs --root .
node <skill>/scripts/floor-guard.mjs --root . --base HEAD       # uncommitted work only
node <skill>/scripts/floor-guard.mjs --root . --config path/to/floor.json
node <skill>/scripts/floor-guard.mjs --self-test
```

`<skill>` is this skill's folder. `--root` and the paths under it resolve from
the working directory, so a relative path works from anywhere the script can be reached. The base defaults to the
first of `origin/main`, `origin/master`, `main`, `master` that resolves; the floor file defaults to
`.o-skills/config/floor.json`, read from the working tree and from the merge base.

| Exit | Means |
|------|-------|
| 0 | No violation, or nothing declared that could be lowered |
| 1 | At least one violation, each printed with its `rule`, `file` and `line` |
| 2 | The guard could not run: not a git repo, no merge base, an unreadable config, an unknown option |

**A 2 never reads as a 0.** A shallow clone with no merge base, a config that is not JSON, a mistyped
`--explain` — each stops the guard rather than reporting a clean tree it never examined.

Output is JSON:

```json
{
  "root": "/abs/path",
  "base": "origin/main",
  "mergeBase": "4f01080",
  "config": "/abs/path/.o-skills/config/floor.json",
  "ignore": ["skills/o-floor/**"],
  "filesTouched": 3,
  "rated": ["silenced-checker", "unfinished-work", "..."],
  "unrated": [],
  "violations": [{ "rule": "silenced-checker", "file": "src/a.ts", "line": 42, "detail": "eslint-disable" }]
}
```

`config` is the path it read, or `null`. `detail` names *what* fired — the checker label, the stub kind, the
threshold move — and never the source line it matched, so a suppression sitting beside a secret cannot leak
through the report.

## The rules it reports

The diff rules are always rated. They read added and removed lines in **code files only** — a suppression named
in a README or stored in a fixture is prose or data, not a checker someone silenced. Extend the list with
`codeExtensions` if your stack is missing.

| `rule` | Fires when |
|--------|-----------|
| `silenced-checker` | An added line carries a suppression: `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error`, `eslint-disable`, `biome-ignore`, `# noqa`, `# type: ignore`, `istanbul ignore`, `nosemgrep`, `gitleaks:allow`, `Stryker disable` |
| `unfinished-work` | An added line is a stub (`NotImplementedError`, a "not implemented" throw), an empty `catch`, or a bare `TODO` — one carrying `#123` or a URL is tracked work and passes |
| `test-made-easier` | An added line skips a test: `it.skip` / `test.todo` / `xit` / `xdescribe`, `@pytest.mark.skip`, `t.Skip(`, `#[ignore]` |
| `test-deleted` | The diff deletes a test file |
| `assertion-removed` | An `expect` / `assert` / `should` line is removed from a test file that still exists |

The declaration rules are rated once a floor file exists, on either side of the diff.

| `rule` | Fires when |
|--------|-----------|
| `threshold-loosened` | A rule in both declarations whose `value` moved the wrong way for its `direction`: a `min` fell, a `max` rose |
| `threshold-changed` | The `value` changed and `direction` is absent or unreadable, so the guard cannot tell tightening from loosening |
| `threshold-removed` | A rule present in both lost its `value` |
| `rule-removed` | A rule id at the base is gone from the declaration |
| `new-exception` | The declaration holds more exceptions than the base |
| `exception-extended` | An exception's `expires` moved later |

**Tightening is silent, loosening is loud.** Raising a minimum, lowering a maximum, adding a rule, dropping an
exception — none of them is reported. Only the moves that lower the bar are, which is what keeps the guard quiet
enough to run on every diff.

## What it cannot check, and where it can be blind

- **A threshold nobody measures is a number, not a floor.** The guard compares declarations; it does not run
  your coverage tool, your linter, or your dependency scanner. `tool` in a rule is documentation for the reader
  and the hook, and nothing here executes it.
- **The regexes are shallow on purpose.** A suppression assembled at run time, a skip written through a helper
  (`skipIf(flaky, …)`), an assertion deleted with the whole `describe` gone, or a test weakened by changing its
  input rather than removing a line — none of those is a line the guard can see. It catches the cheap road to
  green that agents actually take, not a person hiding a change.
- **A test that *tests* a pattern reads as the pattern.** A file holding `"// @ts-ignore"` as a fixture string
  is a `silenced-checker` finding, and this skill's own `test/o-floor-guard.test.cjs` is the standing example:
  nine findings, all fixture data. There is no way to tell that string from a real suppression without a parser
  per language, so the answer is `ignore`, not a cleverer regex — and it is why the diff guard suits a repo that
  has declared a floor and an ignore list, rather than being wired into CI blind.
- **Code files only.** Widening `codeExtensions` widens the net; leaving it narrow is what stops a README that
  *documents* `eslint-disable` from reading as a violation.
- **Only the diff.** A tree that already sits below its own floor is not reported. The guard is a ratchet: it
  stops the bar falling further, and says nothing about where it is now.

## Rated and unrated: a partial declaration is reported, not obeyed

A repo with no floor file is not failing — it is a repo that has not written the bar down yet. The guard runs the
diff rules, names the declaration rules in `unrated`, and exits 0, so a reader sees which half of the promise was
actually checked. Report `rated` and `unrated` verbatim when a review runs it: a green run over an undeclared
floor is a much weaker statement than a green run over a declared one.

## Declare the floor

`.o-skills/config/floor.json`. Only `rules` and `exceptions` matter to the guard; everything else is for the
reader. State the number and the reason together — a threshold without a rationale is deleted by the next person
who trips over it.

```json
{
  "rules": [
    {
      "id": "coverage-changed-lines",
      "statement": "Coverage of changed lines holds at or above 80%.",
      "direction": "min",
      "value": 80,
      "reason": "A new branch without a test is the defect this catches; a config line needs no test.",
      "tool": "npm run coverage:changed",
      "runsAt": ["ci", "post-edit"]
    },
    {
      "id": "file-lines",
      "statement": "No file grows past 1000 lines.",
      "direction": "max",
      "value": 1000,
      "reason": "A small diff into a huge file is still a huge file; decompose before adding.",
      "tool": null,
      "runsAt": ["review"]
    }
  ],
  "exceptions": [
    { "rule": "coverage-changed-lines", "owner": "tkwiatek", "expires": "2026-12-31", "reason": "generated client" }
  ],
  "ignore": ["skills/o-floor/**", "**/evals/fixtures/**"],
  "codeExtensions": ["heex"]
}
```

- `rules[].id` — stable, referenced by an exception. A rule without one cannot be compared across the diff.
- `rules[].direction` — `min` or `max`. The guard needs it to know which way is down; a rule without one has
  every move reported as `threshold-changed`, because staying quiet cannot be the default.
- `rules[].value` — the number. `tool` and `runsAt` say where it is measured, and are not executed here.
- `exceptions[]` — a `rule`, an `owner`, an `expires` date and a `reason`. An exception is a tracked decision;
  an untracked one is a loosened rule, which is why adding or extending one is reported.
- `ignore` — globs, matched against the repo-relative path. `*` stays inside a path segment, `**` crosses one.
- `codeExtensions` — added to the built-in code list, for a stack the guard does not know.

### Sane defaults

Chosen to be reachable by most codebases on day one. Adopt the ones you measure; adopting one you do not measure
is a number, not a floor.

| Rule | Default | Why this number |
|------|---------|-----------------|
| Coverage of changed lines (`min`) | 80 | Forces a test for new behavior, allows a config line through |
| File length (`max`) | 1000 | Where a file stops being readable in one sitting |
| Dependency vulnerabilities (`max`) | 0 at high or above | Below that is mostly noise |
| Exception lifetime (`max`) | 90 days | Long enough to plan the fix, short enough to remember |

**A declaration under `.o-skills/` can be invisible to a clone.** A repo whose git config ignores that tree
commits nothing, so the floor ships to nobody: `git check-ignore -v .o-skills/config/floor.json` prints the rule
that did it, and the answer is `git add -f`, or keeping the file where the repo already tracks configuration.

## Completion

`floor-guard.mjs` exits 0, or exits 1 with every violation fixed or routed through an exception that has an owner
and an expiry — never with the threshold lowered, which is the violation. A repo with no floor file is reported
as `unrated` rather than as clean. `--self-test` exits 0, which proves the fixtures the skill ships still
describe the rules it claims to enforce: those cases live in `evals/fixtures/floor-cases.json`, one object per
rule, so a change that moves a finding fails there rather than in a review.

## Files

- `scripts/floor-guard.mjs` — the guard: base resolution, the diff walk, the two rule sets, the coverage report,
  and `--self-test`.
- `evals/fixtures/floor-cases.json` — the cases `--self-test` runs over, each pinning a rule to its file, line
  and detail. Read by that path beside the script, so install the skill whole rather than copying one file out.
- `evals/triggers.json` — labelled should/should-not-trigger queries for description tuning.
