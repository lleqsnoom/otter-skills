"use strict";

/**
 * Task breakdowns declare what blocks what and sequence wide refactors
 * expand-contract; the retro proposes agent-environment improvements, not only
 * skill fixes.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");

describe("decompose blocking edges", () => {
  it("o-decompose declares blockers on task files", () => {
    const text = fs.readFileSync(path.join(SKILLS, "o-decompose", "SKILL.md"), "utf8");
    assert.ok(/blocker/i.test(text), "SKILL.md names blockers");
  });

  it("o-decompose sequences wide refactors expand-contract", () => {
    const text = fs.readFileSync(path.join(SKILLS, "o-decompose", "SKILL.md"), "utf8");
    assert.ok(/expand/i.test(text) && /contract/i.test(text), "SKILL.md carries expand-contract");
    assert.ok(/tracer|vertical slice/i.test(text), "SKILL.md keeps slices vertical");
  });
});

describe("environment retro", () => {
  it("o-autoreflection proposes environment improvements", () => {
    const text = fs.readFileSync(path.join(SKILLS, "o-autoreflection", "SKILL.md"), "utf8");
    assert.ok(/environment/i.test(text), "SKILL.md names the agent environment");
    assert.ok(/deterministic check/i.test(text), "mechanical violations become checks");
    assert.ok(/judg/i.test(text), "judgment calls become standards");
  });
});