"use strict";

/**
 * Skills grew back to four to nine times their trimmed size, one appended rule per fix. A `budget` in the
 * frontmatter caps a SKILL.md body in words, so growth fails the lint instead of passing silently.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const LINT = path.join(__dirname, "..", "skills", "o-skill-lint", "scripts", "lint.mjs");
const load = () => import(pathToFileURL(LINT).href);
const skill = (body) => `---\nname: o-x\ndescription: one two three four\nbudget: 5\n---\n${body}\n`;

describe("skill-budget", () => {
  it("counts the body only, not the frontmatter", async () => {
    const { budgetProblem } = await load();
    assert.equal(budgetProblem(skill("one two three four five"), "5"), null);
  });

  it("names the count and the budget when the body is over it", async () => {
    const { budgetProblem } = await load();
    assert.equal(budgetProblem(skill("one two three four five six"), "5"), "SKILL.md body has 6 words; its budget is 5");
  });

  it("leaves a skill without a budget unchecked, and refuses a budget that is not a word count", async () => {
    const { budgetProblem } = await load();
    assert.equal(budgetProblem(skill("a ".repeat(5000)), undefined), null);
    assert.match(budgetProblem(skill("a"), "lots"), /not a positive word count/);
    assert.match(budgetProblem(skill("a"), "0"), /not a positive word count/);
  });

  it("holds every budgeted skill in this repo to its budget", async () => {
    const { lintRepo } = await load();
    assert.deepEqual(lintRepo().violations.filter((violation) => violation.rule === "skill-budget"), []);
  });
});
