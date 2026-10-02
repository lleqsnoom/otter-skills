"use strict";

/**
 * x-walkthrough generates an interactive bash script that walks a human
 * through steps only they can perform, shipping a shared template library the
 * skill's output must build on.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");
const TEMPLATE = path.join(SKILLS, "x-walkthrough", "references", "template.sh");

describe("x-walkthrough skill", () => {
  const text = fs.readFileSync(path.join(SKILLS, "x-walkthrough", "SKILL.md"), "utf8");

  it("exists with frontmatter naming the folder", () => {
    assert.ok(/name:\s*x-walkthrough\b/.test(text.split("---")[1]));
  });

  it("scopes the procedure to human-only steps", () => {
    for (const cue of ["human", "stage", "secret", "never invent", "bash -n"]) {
      assert.ok(text.includes(cue), `SKILL.md mentions ${cue}`);
    }
  });

  it("ships the shared template library as an executable script", () => {
    assert.ok(fs.existsSync(TEMPLATE), "references/template.sh exists");
    const mode = fs.statSync(TEMPLATE).mode & 0o777;
    assert.ok(mode & 0o111, "template is executable");
    assert.ok(fs.readFileSync(TEMPLATE, "utf8").includes("STAGES"), "template defines stages");
  });

  it("does not carry upstream naming", () => {
    for (const banned of ["ask-matt", "wizard"]) {
      assert.ok(!text.includes(banned), `no upstream name ${banned}`);
    }
  });

  it("ships trigger evals and a README row", () => {
    const triggers = JSON.parse(
      fs.readFileSync(path.join(SKILLS, "x-walkthrough", "evals", "triggers.json"), "utf8"),
    );
    assert.ok(triggers.queries.length >= 8);
    assert.ok(
      fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").includes("| `x-walkthrough` |"),
      "README lists x-walkthrough",
    );
  });
});