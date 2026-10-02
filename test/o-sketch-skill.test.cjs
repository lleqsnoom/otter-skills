"use strict";

/**
 * o-sketch answers a design question with a throwaway prototype instead of a
 * spec debate, and is listed in the README skills table like every other skill.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "o-sketch", "SKILL.md");

describe("o-sketch skill", () => {
  it("exists with parseable frontmatter whose name matches the folder", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    const fm = text.split("---")[1];
    assert.ok(/name:\s*o-sketch\b/.test(fm), "frontmatter names o-sketch");
    assert.ok(/version:/.test(fm), "frontmatter carries a version");
  });

  it("defines the two branches and the throwaway rules", () => {
    const text = fs.readFileSync(SKILL, "utf8").toLowerCase();
    for (const cue of ["logic", "ui variants", "throwaway", "one command", "surface the state", "verdict"]) {
      assert.ok(text.includes(cue), `SKILL.md mentions ${cue}`);
    }
  });

  it("does not carry upstream naming", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    for (const banned of ["ask-matt", "grill-me", "wayfinder", "wizard"]) {
      assert.ok(!text.includes(banned), `no upstream name ${banned}`);
    }
  });

  it("ships trigger evals and a README row", () => {
    const triggers = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "skills", "o-sketch", "evals", "triggers.json"), "utf8"),
    );
    assert.ok(triggers.queries.length >= 8, "at least 8 labelled queries");
    assert.ok(
      fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").includes("| `o-sketch` |"),
      "README lists o-sketch",
    );
  });
});