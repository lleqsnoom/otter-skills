"use strict";

/**
 * o-plan and o-analyze ask their clarify questions in frontier rounds: each
 * round carries every question whose prerequisites are settled, with a
 * recommended answer beside it, so the user answers in batches and the tree
 * reshapes between rounds.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");
const PAIRS = [
  ["o-plan", "questions.md"],
  ["o-analyze", "questions.md"],
];

describe("clarify frontier rounds", () => {
  for (const [skill, ref] of PAIRS) {
    it(`${skill} references define the frontier mechanic`, () => {
      const text = fs.readFileSync(path.join(SKILLS, skill, "references", ref), "utf8");
      assert.ok(text.includes("frontier"), `${skill}/${ref} defines the frontier`);
      assert.ok(text.includes("recommended answer"), `${skill}/${ref} requires a recommended answer`);
      assert.ok(text.includes("sub-agent"), `${skill}/${ref} sends fact-finding to a sub-agent`);
    });

    it(`${skill} SKILL.md wires the frontier into its clarify step`, () => {
      const text = fs.readFileSync(path.join(SKILLS, skill, "SKILL.md"), "utf8");
      assert.ok(/frontier/i.test(text), `${skill}/SKILL.md mentions frontier rounds`);
    });
  }
});