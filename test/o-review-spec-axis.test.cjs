"use strict";

/**
 * o-review reviews a change against its originating spec as well as against
 * engineering principles: a diff that passes every quality floor but ships the
 * wrong thing must not read as clean.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "o-review", "SKILL.md");
const CARD = path.join(__dirname, "..", "skills", "o-review", "references", "pass.md");

describe("o-review spec axis", () => {
  it("declares a Spec pass in the passes table", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    assert.match(text, /\*\*Spec\*\*/);
    assert.match(text, /\[Spec\]/);
  });

  it("states the spec-source resolution order", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    for (const cue of ["commit messages", "no spec available"]) {
      assert.ok(text.includes(cue), `SKILL.md mentions ${cue}`);
    }
  });

  it("carries the Spec pass on the VERIFY pass card", () => {
    const text = fs.readFileSync(CARD, "utf8");
    assert.match(text, /\[Spec\]/);
  });
});