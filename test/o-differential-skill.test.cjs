"use strict";

/**
 * o-differential reviews a change the narrow way: each hunk against the behavior it replaced,
 * rated for regression risk, rather than re-reviewing the whole module. The output is a
 * risk table, not a verdict.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "o-differential", "SKILL.md");

describe("o-differential skill", () => {
  it("exists with parseable frontmatter whose name matches the folder", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    const fm = text.split("---")[1];
    assert.ok(/name:\s*o-differential\b/.test(fm), "frontmatter names o-differential");
    assert.ok(/version:/.test(fm), "frontmatter carries a version");
  });

  it("states the per-hunk regression-risk discipline", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    for (const cue of ["hunk", "replaced", "regression", "risk", "caller", "spec"]) {
      assert.ok(text.toLowerCase().includes(cue.toLowerCase()), `SKILL.md mentions ${cue}`);
    }
    assert.ok(/every (hunk|change)|per hunk|each hunk/.test(text.toLowerCase()), "the pass reads one hunk at a time");
  });

  it("names the callers a changed region puts at risk", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    assert.ok(/caller|call site|callers/.test(text), "the pass lists affected callers");
  });

  it("ships trigger evals, behavioral expectations, and a README row", () => {
    const triggers = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "skills", "o-differential", "evals", "triggers.json"), "utf8"),
    );
    assert.ok(triggers.queries.length >= 8, "at least 8 labelled queries");
    const expectations = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "skills", "o-differential", "evals", "expectations.json"), "utf8"),
    );
    assert.equal(expectations.skill, "o-differential");
    assert.ok(expectations.expected_behavior.length >= 3, "at least three expected behaviors");
    assert.ok(
      fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").includes("| `o-differential` |"),
      "README lists o-differential",
    );
  });
});