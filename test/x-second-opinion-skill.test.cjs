"use strict";

/**
 * x-second-opinion is the fresh-context re-review pass: a reviewer with no memory of the
 * implementation critiques the change against its spec, so the confirmation bias a
 * same-context review carries gets an outside check.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-second-opinion", "SKILL.md");

describe("x-second-opinion skill", () => {
  it("exists with parseable frontmatter whose name matches the folder", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    const fm = text.split("---")[1];
    assert.ok(/name:\s*x-second-opinion\b/.test(fm), "frontmatter names x-second-opinion");
    assert.ok(/version:/.test(fm), "frontmatter carries a version");
  });

  it("states the fresh-context protocol and the verdict contract", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    for (const cue of ["fresh context", "diff", "spec", "objection", "file:line", "clean"]) {
      assert.ok(text.toLowerCase().includes(cue.toLowerCase()), `SKILL.md mentions ${cue}`);
    }
    assert.ok(/at least one/.test(text), "the review must surface at least one objection or an explicit clean verdict");
  });

  it("forbids the reviewer from receiving the implementation history", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    assert.ok(/never.*(session|conversation|memory)|no memory/.test(text.toLowerCase()),
      "the protocol denies the reviewer the session's memory");
  });

  it("ships trigger evals, behavioral expectations, and a README row", () => {
    const triggers = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "skills", "x-second-opinion", "evals", "triggers.json"), "utf8"),
    );
    assert.ok(triggers.queries.length >= 8, "at least 8 labelled queries");
    const expectations = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "skills", "x-second-opinion", "evals", "expectations.json"), "utf8"),
    );
    assert.equal(expectations.skill, "x-second-opinion");
    assert.ok(expectations.expected_behavior.length >= 3, "at least three expected behaviors");
    assert.ok(
      fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").includes("| `x-second-opinion` |"),
      "README lists x-second-opinion",
    );
  });
});