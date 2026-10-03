---
name: o-test-gen
description: Generate test stubs from implementation — analyzes source code and creates scaffolded tests with happy path, error cases, and edge case placeholders. Use when asked to scaffold specs for untested functions.
version: 1.1.0
author: Community
tags: [testing, test-generation, scaffolding, coverage, tdd]
user-invocable: true
---

# O-Test-Gen — Failing Test Stubs for Untested Code

Scaffold one test file per source file, in the project's own framework, with a typical-input and an edge-case
test for every exported function. **Every stub fails until it is written**: a generated test that passes checks
nothing, and `o-floor` and `o-verify` exist to catch exactly that. The stubs are a to-do list the suite enforces.

`<skill>` below is this skill's folder.

## Run it

```bash
node <skill>/scripts/generate.mjs src/pricing.mjs              # one file
node <skill>/scripts/generate.mjs src/ --dry-run               # every source file under src/, writing nothing
node <skill>/scripts/generate.mjs src/ --output test/unit --framework vitest
```

It prints JSON: the framework and where it was detected from, each test file written (with the functions it
covers), and each source skipped with the reason. An existing test file is never overwritten — it is listed as
skipped.

| Detected from | Framework |
|---------------|-----------|
| `vitest.config.*`, or `vitest` in dependencies | Vitest |
| `jest.config.*`, `jest` in dependencies, or a `jest` field in `package.json` | Jest |
| `.mocharc.*`, or `mocha` in dependencies | Mocha |
| `node --test` in `scripts.test`, or nothing else found | the built-in `node:test` |
| `pytest.ini`, `conftest.py`, `[tool.pytest]` in `pyproject.toml`, or any Python file | pytest |

It reads functions and classes exported inline, through `export { a, b as c }` lists, as a default export, and
through CommonJS (`module.exports = { … }`, `exports.x = …`), in `.js .mjs .cjs .jsx .ts .mts .cts .tsx .py`.
The test file mirrors the source's extension and module system, sits in `test/`, `tests/` or `__tests__/` when
the project has one (beside the source otherwise), and imports the source by its real relative path.

## Then write the tests

1. Run the suite: every new stub fails with `TODO: write this test for <name>`. That is the to-do list.
2. Replace each stub's body with a real assertion about behaviour — the typical case, then the edge case or the
   error the function throws. Rename the test to say what it checks.
3. A stub you decide not to write is deleted, not skipped: a skipped test is a lowered bar (`o-floor`).

## Definition of Done

- `generate.mjs` exited 0, and its JSON lists the files written and every source skipped with a reason.
- The new stubs fail when the suite runs, each with its `TODO` message, and none fails on an import error.
- Before the work is called finished, no stub is left: each is a real test or deleted.
