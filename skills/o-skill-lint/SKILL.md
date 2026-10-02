---
name: o-skill-lint
description: Validate the repo's own skills — frontmatter, referenced scripts and references, stray template tokens, symlink-safe main guards, evals and the README skills table — and measure trigger rank-1 and description collisions. Use when adding or editing a skill, before shipping the repo, or when a skill is not triggering.
version: 1.1.2
author: Community
tags: [lint, validation, skills, frontmatter, repo-hygiene, discovery]
user-invocable: true
---

# O-Skill-Lint — Validate the Repo's Own Skills

Catch the whole class of "documented command that cannot run" defects before they ship: a skill
that names a script file that does not exist, a frontmatter `name` that disagrees with its folder,
a stray template token, or a skill missing from the README table. Run it after editing any
`skills/*/SKILL.md` and before a release.

`<skill>` below is this skill's folder.

## When to use

- You added or edited a skill in this repo.
- A skill's documented command raised "file not found".
- Before shipping: prove the corpus is self-consistent.

## Run it

```bash
node <skill>/scripts/lint.mjs            # lint the repo this script lives in
node <skill>/scripts/lint.mjs --root .   # lint a different repo root
```

Output is JSON: `{ root, skills, violations: [...] }`. Exit **0** when clean, **1** when any
violation is found, **2** on a usage error. Each violation names the `skill` and a `rule`.

## Rules checked

| Rule | Meaning |
|------|---------|
| `missing-skill-md` | A directory under `skills/` has no `SKILL.md`. |
| `frontmatter` | `SKILL.md` has no parseable `---` frontmatter block. |
| `name-mismatch` | Frontmatter `name` does not equal the folder name. |
| `description` | Frontmatter has no `description`. |
| `stray-token` | The body contains a stray authoring token — a leftover closing tag from a template. |
| `missing-ref` | A same-skill `scripts/…` or `references/…` path does not exist on disk. |
| `cross-skill-ref` | A citation of another skill's `scripts/…`, `references/…` or `SKILL.md` — in any of the three install forms — names a file that skill does not ship. |
| `unknown-skill-ref` | A citation names an `o-…` that is not a skill in this repo, so a rename left the reference behind. |
| `readme` | The skill is missing from the README skills table. |
| `cross-skill-import` | A skill's script imports another skill's script — skills must stay standalone. |
| `copy-drift` | A file shared across skills differs byte-for-byte between copies. |
| `card-budget` | A pass card (the `pass.md` in a skill's references folder) is over 600 words. A card is what a host reads instead of the skill's whole body, so its length is the cost of every pass. |
| `pass-ref` | A skill's `SKILL.md` or reference files name another skill's `SKILL.md` while that skill ships a pass card. The violation gives the `file:line` and the card path to name instead. |
| `fragile-main-guard` | A script compares `import.meta.url` to `process.argv[1]` without `realpathSync`, so it does nothing when run through a symlinked install. |
| `commonjs-script` | A `scripts/**/*.js` file uses `require(` or `module.exports` while the lint root's `package.json` declares `"type": "module"`, so the script throws before it runs — and it throws for whoever installed the skill, because an installed skill is a symlink into that root. Fix it by renaming the file to `.mjs` with `import` and `export`; `.cjs` is the escape hatch for a tree that must stay CommonJS. |
| `expectations-shape` | An optional `evals/expectations.json` names another skill, holds no or more than seven `expected_behavior` lines, or lacks a `source` list. |
| `triggers-shape` | An optional `evals/triggers.json` names another skill, has a query without text or a non-boolean `should_trigger`, or holds fewer than four should-trigger or four should-not-trigger queries. |

A line naming *another* skill is skipped by the same-skill rule, so a cross-skill hop is never reported as local
breakage — `cross-skill-ref` and `unknown-skill-ref` are the other half, checking that citation against the skill
it names instead.

Shared files that must stay byte-identical wherever they appear: `scripts/check-questions.mjs`,
`references/questions.md`, `references/research-first.md`. Edit one copy, then copy it over the
rest before running the lint.

## Tune the descriptions — trigger rate

The lint proves a `evals/triggers.json` is usable. It cannot say whether the description above it actually
routes: a skill whose description is missing the words users say will not fire, and two descriptions that say the
same thing cannot be told apart. Both are measurable without spending a token:

```bash
node <skill>/scripts/trigger-rate.mjs                 # report; exits 0
node <skill>/scripts/trigger-rate.mjs --json          # the raw measurement
node <skill>/scripts/trigger-rate.mjs --min-rank1 95  # gate on it; exits 1 below the floor
```

It scores every should-trigger query against every skill's description (stemmed tf-idf cosine over the
description plus the skill's own name), reports the **rank-1 rate** — the share whose own skill came first, not
merely top-k — and names each miss with the skill that beat it and the runner-up. A rank-1 miss usually means
**fix the description, not the query**: the query is how a user actually talks, and if the description does not
carry that vocabulary, the description is what is wrong. It also compares descriptions pairwise and warns from
`0.5` similarity, erroring at `0.75`, because two near-identical descriptions are what makes routing ambiguous.

It is a **lexical approximation of routing, not routing**: a query can rank the wrong skill because the right
one's description states the capability in different words, and a semantically correct answer is invisible to it.
Read a miss as a question — is this description missing the user's vocabulary, or is the query's wording the
outlier? — rather than as a verdict. Reporting is the default, and no floor is enforced unless `--min-rank1` is
passed: the number is the point, and each repo sets its own floor once it knows the baseline. Never lower the
floor to make a regression pass; raise it as routing improves.

Measured on this corpus (32 skills, 9 with trigger sets): **74.6% rank-1 over 67 should-trigger queries, 4/72
should-not-trigger queries firing the wrong skill**. The misses cluster where two skills genuinely overlap in
vocabulary — `o-arch` against `o-arch-lint`, `o-roast` against `o-essay` — which is the ambiguity the measurement
exists to expose rather than a defect it can fix. CI runs it at `--min-rank1 70`: below the baseline, so an
unrelated description edit does not turn the build red, and raised only as the number improves.

## Completion

`node <skill>/scripts/lint.mjs` exits 0. If it exits 1, fix each listed violation and re-run —
do not ship with an open violation. One exception, and only while it is being worked: converting a
skill's scripts to `.mjs` makes `commonjs-script` red for every script not yet converted, so that
violation stands open until the last one lands. Any other open violation is a defect.
