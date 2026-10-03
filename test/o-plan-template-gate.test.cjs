"use strict";

/**
 * o-plan's layer template and its worked example used Goal / What works / What's mocked, while the layers_complete
 * gate requires Objective / Scope in / Scope out / Prerequisite / Definition of Done — so a spec written exactly as
 * the skill showed failed the skill's own gate. Both are checked against the gate here.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SKILL = path.join(__dirname, "..", "skills", "o-plan");
const STATE = { events: [], openQuestions: [], options: [] };

describe("o-plan's layer template passes its own gate", () => {
  it("the SKILL.md template", async () => {
    const { computeGuards } = await import(pathToFileURL(path.join(SKILL, "scripts", "scenario.mjs")).href);
    const template = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8").split("```markdown\n## Layers")[1].split("```")[0];
    const gate = computeGuards(STATE, { reportText: `## Layers${template}` }).layers_complete;
    assert.equal(gate.pass, true, gate.actual);
  });

  it("the worked example", async () => {
    const { computeGuards } = await import(pathToFileURL(path.join(SKILL, "scripts", "scenario.mjs")).href);
    const example = fs.readFileSync(path.join(SKILL, "references", "examples", "design-spec.md"), "utf8");
    const gate = computeGuards(STATE, { reportText: example }).layers_complete;
    assert.equal(gate.pass, true, gate.actual);
  });
});
