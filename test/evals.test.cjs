"use strict";

/**
 * Behavioral expectations are the eval surface of a skill: `evals/expectations.json` states what the
 * skill must do in claims checkable from run artifacts, and o-autoreflection's quality judge reads them
 * against real sessions. This runner demands one file per skill — a skill without expectations is a
 * skill nobody has said how to check — and pins the shape. A claim must be a whole sentence in its own
 * words: a line lifted out of SKILL.md, or cut off mid-sentence, gives the judge nothing the skill file
 * does not already say.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SKILLS_DIR = path.join(ROOT, "skills");

const skills = () =>
  fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

describe("behavioral expectations", () => {
  it("every skill ships evals/expectations.json", () => {
    const missing = skills().filter(
      (skill) => !fs.existsSync(path.join(SKILLS_DIR, skill, "evals", "expectations.json")),
    );
    assert.deepEqual(missing, [], "skills missing evals/expectations.json");
  });

  for (const skill of skills()) {
    it(`${skill} expectations parse and stay grounded`, () => {
      const file = path.join(SKILLS_DIR, skill, "evals", "expectations.json");
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));

      assert.equal(parsed.skill, skill, `the skill field must name ${skill}`);
      assert.ok(Array.isArray(parsed.expected_behavior) && parsed.expected_behavior.length >= 3,
        `${skill} must state at least three expected behaviors`);
      for (const claim of parsed.expected_behavior) {
        assert.equal(typeof claim, "string", "every claim must be a sentence");
        assert.ok(claim.trim().length > 20, `a claim this short is not checkable: ${claim}`);
      }
      assert.ok(Array.isArray(parsed.source) && parsed.source.length > 0,
        `${skill} must cite the SKILL.md sections its claims trace to`);
    });

    it(`${skill} expectations say what a run does, in their own words`, () => {
      const parsed = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, skill, "evals", "expectations.json"), "utf8"));
      const body = flat(fs.readFileSync(path.join(SKILLS_DIR, skill, "SKILL.md"), "utf8"));
      for (const claim of parsed.expected_behavior) {
        assert.match(claim.trim(), /[.!?]["')`]?$/, `a claim is one or more whole sentences, not a fragment: ${claim}`);
        assert.ok(!body.includes(flat(claim)), `a claim copied out of SKILL.md checks nothing the file does not already say: ${claim}`);
      }
    });
  }
});

/** Text without emphasis marks and with whitespace runs collapsed, so a line re-wrapped or un-bolded is still the same text. */
function flat(text) {
  return text.replace(/\*/g, "").replace(/\s+/g, " ").trim();
}