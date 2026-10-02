---
name: o-verify
description: After o-fix or an implementation, attack the change instead of trusting it — property-based tests over the changed functions with a per-language tool (fast-check, hypothesis, proptest) and a mutation pass over the diff (Stryker, mutmut, cargo-mutants), then gate on survivors-equals-zero-or-explained — every mutant no test killed ships only with an owner and a reason in .o-skills/config/verify.json. Reports a missing test runner and stops rather than inventing one. Use when asked to verify a fix beyond its tests, run a mutation pass, catch silent regressions before ship, or prove a change cannot break quietly; o-fix hands off to it.
version: 1.1.1
author: Community
tags: [verification, property-based-testing, mutation-testing, survivors, gate, quality]
user-invocable: true
---

# O-Verify — Trust the Change, Then Attack It

A fix and its tests were written by the same mind in the same hour, so a test that passes tells you
the code satisfies the test — not that it satisfies the change. Two checks break that circle. A
property test supplies inputs nobody wrote by hand, and a mutation pass breaks the code in small,
mechanical ways and asks whether any test notices.

`o-verify` runs both over the current diff and then holds one gate: **survivors equal zero, or each
survivor is explained.** A surviving mutant is behavior the change introduced that no test can tell
apart from its mutation. It is exactly the silent regression this pass exists to catch, and the only
honest way past the gate is to write the missing test or to name, with an owner and a reason, why
none is worth writing.

The pass never edits code, thresholds, or tests. It runs commands and reads reports.

## When to use

- "Is this fix actually fixed?", "run a mutation pass", "make sure nothing broke quietly".
- After `o-fix` closes a finding, before the change ships.
- A suite that is green but thin — new behavior with old tests that pass on a broken version too.
- Before a merge of a change whose failure would be silent: a clamp, a default, an off-by-one.

Not for generating test scaffolding (`o-test-gen`), reproducing one reported bug (`o-reproduce`), or
reviewing style and structure (`o-review`). This pass asks a different question: would *any* test
catch it if this code stopped working?

## Run it

```bash
node ~/.agents/skills/o-verify/scripts/verify.mjs --root .
node ~/.agents/skills/o-verify/scripts/verify.mjs --root . --base HEAD       # uncommitted work only
node ~/.agents/skills/o-verify/scripts/verify.mjs --root . --dry-run         # plan and gate, run nothing
node ~/.agents/skills/o-verify/scripts/verify.mjs --self-test
```

The base defaults to the first of `origin/main`, `origin/master`, `main`, `master` that resolves.

| Exit | Means |
|------|-------|
| 0 | No unexplained survivors, and the property pass held — or, in `--dry-run`, nothing to read yet |
| 1 | At least one violation: a surviving mutant with no explanation, or a failing property pass |
| 2 | The pass could not run: no test runner for a changed language, a missing mutation tool, no merge base, unreadable config |

**A 2 never reads as a 0.** A repo with no test runner for a language it changed is reported as
`no test runner configured for <language>; o-verify stops rather than inventing one` and exits 2 —
setting up the runner is a decision, and this pass does not make it. The same holds for a mutation
tool that is not installed.

## What the pass does

1. **Scope.** Every changed code file under the diff, grouped by language. Files no language claims
   are left alone — a renamed asset does not start a mutation run.
2. **Property pass.** Write the properties first — for each changed function, the invariant that
   must hold for *all* inputs, expressed in the language's property tool (`fast-check`, `hypothesis`,
   `proptest` — see `references/tool-choice.md`). The pass then runs the test suite as configured; a
   failing property is a `test-failed` violation. The pass runs the suite; it does not write the
   properties, because a property no one reasoned about verifies nothing.
3. **Mutation pass.** One mutation tool per language, run over the diff where the tool supports it,
   survivors read from where the tool already writes them. Every `Survived` or `NoCoverage` mutant
   is a survivor; `Killed` and `Timeout` are not.
4. **Gate.** Survivors are matched against the explanations in the config. Unexplained survivors are
   `survivor-unexplained` violations, each printed with its `file`, `line` and the mutator that
   produced it.

Output is JSON:

```json
{
  "root": "/abs/path",
  "base": "origin/main",
  "mode": "run",
  "changedFiles": ["src/clamp.js"],
  "languages": [{ "language": "javascript", "runner": "npm test", "mutationTool": "Stryker", "missingTools": [] }],
  "propertyPass": { "status": "passed", "command": "npm test" },
  "mutationPass": { "status": "passed", "command": "npx stryker run" },
  "rated": ["survivors:javascript"],
  "unrated": [],
  "survivors": [{ "file": "src/clamp.js", "line": 12, "mutator": "Block", "status": "Survived" }],
  "explained": [],
  "unexplained": [{ "file": "src/clamp.js", "line": 12, "mutator": "Block", "status": "Survived" }],
  "violations": [{ "rule": "survivor-unexplained", "file": "src/clamp.js", "line": 12, "detail": "Survived mutant by Block" }]
}
```

## The gate: survivors equal zero or explained

`.o-skills/config/verify.json`. Each entry matches a survivor's file — and its line, when the entry
names one — and must carry an owner and a reason; an entry whose expiry has passed explains nothing.

```json
{
  "explained": [
    {
      "file": "src/clamp.js",
      "line": 12,
      "owner": "tkwiatek",
      "reason": "defensive clamp for data the API never sends; a mutant here cannot change behavior",
      "expires": "2027-01-31"
    }
  ]
}
```

An explanation is a tracked decision, not a shrug. `line` omitted means every survivor in the file;
`expires` omitted means it never lapses — prefer naming one, so the explanation is re-litigated
instead of fossilizing. Report `rated` and `unrated` verbatim: a green run over a `dry-run` that
never read the survivors report is a much weaker statement than a green run over a real pass.

## What it cannot check, and where it can be blind

- **The property pass is only as good as the properties.** Running the suite verifies the tests that
  exist; it cannot know that a changed function has no property at all. A green pass over code with
  no new properties is a mutation pass, not a verification.
- **Survivors are tool-shaped.** Each parser is pinned to one output format by the fixtures in
  `evals/fixtures/verify-cases.json`; a tool version that changes its report shape fails `--self-test`
  rather than silently reading nothing. Check the versions in `references/tool-choice.md` when a parser
  disagrees with reality.
- **Equivalence is a judgment, not a parse.** Some mutants survive because they genuinely cannot
  change behavior (a comment string, a defensive branch) — that is what the explanation file is for.
  Others survive because the tests mirror the bug. Only a person can tell those apart, which is why
  the gate asks for a name and a reason rather than a threshold.
- **Scope is the diff.** Mutants that predate the branch are not this change's problem, and a merge
  base that cannot resolve stops the pass rather than widening it.
- **`--dry-run` runs nothing.** It reports the plan and gates on whatever survivors report already
  exists on disk. It is for review and planning; only a real run makes the gate a fact.

## Completion

The gate exits 0: no unexplained survivors, property pass passed. A survivor that survives review is
fixed with a test, not by deleting the mutant — the mutants come from a tool a person chose, and
editing code to make a mutant die is the gate working as intended. `--self-test` exits 0, proving the
fixtures still describe the survivor formats the parsers claim to read.

## Files

- `scripts/verify.mjs` — the pass: scoping, runner detection, the per-language tool table, the
  survivor parsers, the gate, and `--self-test`.
- `references/tool-choice.md` — the design call: one property tool and one mutation tool per language,
  with the rejected alternates and the survivors contract each parser reads.
- `evals/fixtures/verify-cases.json` — the cases `--self-test` runs over, pinning each parser and
  the gate's matching rules.
- `evals/expectations.json`, `evals/triggers.json` — accepted-behavior and description-tuning sets.
