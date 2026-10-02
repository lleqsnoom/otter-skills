// A task o-implement has written but not yet committed, and the review plan its VERIFY step produced: two
// issues in the same file as that uncommitted work.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
const RUN = ".o-skills/runs/2026-01-01-0000-R01-stats";

git("init", "-q");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
fs.mkdirSync("src");
fs.mkdirSync("test");
fs.writeFileSync("package.json", `${JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
fs.writeFileSync("src/stats.mjs", "export function sum(values) {\n  return values.reduce((total, value) => total + value, 0);\n}\n");
git("add", ".");
git("commit", "-qm", "feat: add sum");

fs.writeFileSync(
  "src/stats.mjs",
  [
    "export function sum(values) {",
    "  return values.reduce((total, value) => total + value, 0);",
    "}",
    "",
    "// average returns the average",
    "export function average(values) {",
    "  const unused = 42;",
    "  return sum(values) / values.length;",
    "}",
    "",
  ].join("\n"),
);
fs.writeFileSync(
  "test/stats.test.mjs",
  [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { sum, average } from "../src/stats.mjs";',
    "",
    'test("sum adds", () => assert.equal(sum([1, 2, 3]), 6));',
    'test("average divides the sum by the count", () => assert.equal(average([2, 4]), 3));',
    "",
  ].join("\n"),
);

fs.mkdirSync(RUN, { recursive: true });
fs.writeFileSync(
  `${RUN}/E01-review-plan.md`,
  `# Code Review — Fix Plan

**Scope:** src/stats.mjs, test/stats.test.mjs (uncommitted)

## [PRINCIPLE] — dead code

- [ ] **Severity:** MINOR
  - **File:** \`src/stats.mjs:7\`
  - **Issue:** \`unused\` is assigned and never read
  - **Suggestion:** delete the line

## [Comments] — pass 3 of the review

- [ ] **Severity:** MINOR
  - **File:** \`src/stats.mjs:5\`
  - **Issue:** the comment restates the function name
  - **Suggestion:** delete the comment

## [Bloat] — pass 4 of the review

none

## [Architecture] — pass 5 of the review

none

## [Floor] — pass 6 of the review

none

## [Spec] — pass 7 of the review

no spec available

## Summary

**Total issues:** 2 (critical 0, major 0, minor 2)
**Status:** 0/2 resolved
`,
);
