// A file with comments that restate the code, beside ones that must stay: a licence header, a linter directive,
// and a comment that says why.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
git("init", "-q", "-b", "main");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
fs.mkdirSync("src");
fs.mkdirSync("test");
fs.writeFileSync("package.json", `${JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
fs.writeFileSync(
  "src/price.mjs",
  `// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Example Ltd.

// This function rounds a price
export function roundPrice(value) {
  // Round half to even: the payment provider settles that way, and half-up drifts a cent on large batches.
  const cents = value * 100;
  // get the floor
  const floor = Math.floor(cents);
  // compute the difference
  const diff = cents - floor;
  // eslint-disable-next-line no-nested-ternary
  const rounded = diff > 0.5 ? floor + 1 : diff < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
  // return the result
  return rounded / 100;
}
`,
);
fs.writeFileSync(
  "test/price.test.mjs",
  'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { roundPrice } from "../src/price.mjs";\n\ntest("rounds half to even", () => {\n  assert.equal(roundPrice(0.125), 0.12);\n  assert.equal(roundPrice(0.135), 0.14);\n  assert.equal(roundPrice(1.006), 1.01);\n});\n',
);
git("add", ".");
git("commit", "-qm", "feat: add price rounding");
