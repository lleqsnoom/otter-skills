// A one-layer run with one XS task, as o-decompose would leave it, in a node:test project.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
const RUN = ".o-skills/runs/2026-01-01-0000-R01-clamp";
git("init", "-q", "-b", "main");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
fs.mkdirSync("src");
fs.mkdirSync("test");
fs.mkdirSync(`${RUN}/E01-tasks`, { recursive: true });
fs.writeFileSync("package.json", `${JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
fs.writeFileSync(
  `${RUN}/E00-plan.md`,
  `# Plan — clamp

goal:         Values are kept inside a range.
contract:     clamp(value, min, max) returns value limited to [min, max].
invariant:    min <= clamp(value, min, max) <= max whenever min <= max.
test:         given 15 and the range 0..10, when clamped, then it is 10

## Layers

### L0 — clamp

**Goal:** clamp exists and is tested.
**Definition of Done:**
- [ ] clamp passes its tests
`,
);
fs.writeFileSync(
  `${RUN}/E01-tasks/L0-T1-clamp.md`,
  `---
type: task
title: "L0-T1 · clamp"
size: XS
complexity: clear
depends_on: []
---
# Task: clamp
**Layer:** 0 — clamp

## Goal
Export \`clamp(value, min, max)\` from \`src/clamp.mjs\`: the value limited to the range, and a \`RangeError\` when
\`min > max\`.

## Context
The project uses node:test; tests live in \`test/\` as \`<name>.test.mjs\`.

## Definition of Done
- [ ] \`test/clamp.test.mjs\` covers a value below, inside and above the range, and the RangeError, and \`node --test\` is green
- [ ] standing bar clear — o-implement's Definition of Done

## Test Plan
### Happy Path
- Given 15 and 0..10 → expect 10
### Error Paths
- Given min 5 and max 1 → expect a RangeError
`,
);
git("add", ".");
git("commit", "-qm", "docs: add the clamp run");
fs.writeFileSync(".git/otter-eval-base", execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }));
