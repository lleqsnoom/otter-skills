"use strict";

/**
 * Inside x-implement's loops the agent runs the narrowest tests; the full suite runs once per task, before
 * COMMIT, and once after an x-parallel merge. These assertions pin that policy in the skill text, where the
 * agent reads it.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "skills", rel), "utf8");

/** The text of one numbered workflow step, from its `N. **NAME**` line to the next step. */
function step(text, name) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^\\d+\\. \\*\\*${name}`).test(line));
  assert.notEqual(start, -1, `step ${name} exists`);
  const end = lines.findIndex((line, i) => i > start && /^\d+\. \*\*/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("x-implement test policy", () => {
  const implement = read("x-implement/SKILL.md");

  it("defines the narrowest tests", () => {
    assert.match(implement, /\*\*Narrowest tests\*\*/);
  });

  it("runs only the narrowest tests in VERIFY", () => {
    const verify = step(implement, "VERIFY");
    assert.match(verify, /narrowest tests/);
    assert.doesNotMatch(verify, /full (regression )?suite/);
  });

  it("runs the full suite once, at COMMIT", () => {
    assert.match(step(implement, "COMMIT"), /full suite/);
  });

  it("keeps the full suite after an x-parallel merge", () => {
    assert.match(implement, /After an x-parallel batch merges, run the full test suite/);
  });
});

describe("x-fix test policy", () => {
  const fix = read("x-fix/SKILL.md");

  it("runs the narrowest tests after each fix", () => {
    assert.match(fix, /narrowest tests/);
  });

  it("runs the full suite once after the last fix", () => {
    assert.match(fix, /full suite once/);
  });
});
