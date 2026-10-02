"use strict";

/**
 * Behavioral expectations are the eval surface of a skill: `evals/expectations.json` states what the
 * skill must do in claims checkable from run artifacts. This test pins the shape for the skills that
 * carry it — the claim list is grounded, so every file names its SKILL.md sections in `source` — and
 * is the runner L2-T2 extends to demand one file per skill.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SKILLS = ["x-plan", "x-implement", "x-research", "x-review"];

describe("behavioral expectations", () => {
  for (const skill of SKILLS) {
    it(`${skill} ships evals/expectations.json with grounded claims`, () => {
      const file = path.join(ROOT, "skills", skill, "evals", "expectations.json");
      assert.equal(fs.existsSync(file), true, `missing ${skill}/evals/expectations.json`);
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
  }
});