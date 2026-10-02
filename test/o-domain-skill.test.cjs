"use strict";

/**
 * o-domain persists the project's domain model as repo artifacts (GLOSSARY.md
 * and ADRs) and is listed in the README skills table like every other skill.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "o-domain", "SKILL.md");

describe("o-domain skill", () => {
  it("exists with parseable frontmatter whose name matches the folder", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    const fm = text.split("---")[1];
    assert.ok(/name:\s*o-domain\b/.test(fm), "frontmatter names o-domain");
    assert.ok(/version:/.test(fm), "frontmatter carries a version");
  });

  it("defines the glossary and ADR discipline", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    for (const cue of ["GLOSSARY.md", "docs/adr/", "GLOSSARY-MAP.md", "edge-case", "contradiction"]) {
      assert.ok(text.includes(cue), `SKILL.md mentions ${cue}`);
    }
    assert.ok(/lazily/i.test(text), "files are created lazily");
  });

  it("does not carry upstream naming", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    for (const banned of ["ask-matt", "grill-me", "wayfinder", "wizard"]) {
      assert.ok(!text.includes(banned), `no upstream name ${banned}`);
    }
  });

  it("ships trigger evals and a README row", () => {
    const triggers = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "skills", "o-domain", "evals", "triggers.json"), "utf8"),
    );
    assert.ok(triggers.queries.length >= 8, "at least 8 labelled queries");
    assert.ok(
      fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").includes("| `o-domain` |"),
      "README lists o-domain",
    );
  });
});