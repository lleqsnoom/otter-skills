"use strict";

/**
 * Hard-bug diagnosis builds and tightens a named feedback loop before any
 * hypothesis is tested, and TDD work confirms its test seams with the user
 * before any test is written.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");
const LOOPS = path.join(SKILLS, "o-debug", "references", "feedback-loops.md");
const LOOP_KINDS = ["failing test", "replay", "bisect", "fuzz", "differential", "HITL"];

describe("feedback-loop discipline", () => {
  it("ships the loop taxonomy reference", () => {
    const text = fs.readFileSync(LOOPS, "utf8");
    for (const kind of LOOP_KINDS) {
      assert.ok(text.toLowerCase().includes(kind.toLowerCase()), `feedback-loops.md names ${kind}`);
    }
    assert.ok(/tighten/i.test(text), "the taxonomy tells how to tighten a loop");
    assert.ok(/reproduction rate|flake/i.test(text), "non-deterministic bugs raise the rate");
  });

  it("o-debug refuses to hypothesize without a tight loop", () => {
    const skill = fs.readFileSync(path.join(SKILLS, "o-debug", "SKILL.md"), "utf8");
    assert.ok(/feedback-loops\.md/.test(skill), "SKILL.md points at the taxonomy");
    assert.ok(/tight/i.test(skill), "SKILL.md demands a tight loop");
    assert.ok(/red-capable|goes red/i.test(skill), "SKILL.md demands a loop that goes red");
  });

  it("o-investigate routes loop building before hypotheses", () => {
    const skill = fs.readFileSync(path.join(SKILLS, "o-investigate", "SKILL.md"), "utf8");
    assert.ok(/feedback-loops\.md/.test(skill), "SKILL.md points at the taxonomy");
    assert.ok(/without a (tight )?loop|loop before/i.test(skill), "hypotheses wait for a loop");
  });

  it("o-implement confirms test seams with the user before writing tests", () => {
    const skill = fs.readFileSync(path.join(SKILLS, "o-implement", "SKILL.md"), "utf8");
    assert.ok(/seam/i.test(skill), "SKILL.md names the seams under test");
    assert.ok(/confirm/i.test(skill), "SKILL.md confirms the seams with the user");
  });
});