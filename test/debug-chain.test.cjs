"use strict";

/**
 * The debugging skills hand each other files, and a handoff that drifts stops the next skill at step 0. This pins
 * the contract in `o-fix/references/plan-format.md` against the scripts and skills that write and read it:
 * o-triage writes `E<nn>-intake.md`, o-debug the `E<nn>-verify.<ext>` reproduction and an `E<nn>-fix-plan.md`
 * whose only checkboxes are fixes, o-investigate the same plan, and o-fix reads it.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");
const read = (rel) => fs.readFileSync(path.join(SKILLS, rel), "utf8");

describe("debug chain handoffs", () => {
  it("o-debug's fix plan carries no checkbox until a fix is known, so o-fix never works a hypothesis", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "chain-"));
    const run = spawnSync(process.execPath, [path.join(SKILLS, "o-debug", "scripts", "analyze.mjs"), "--error", "TypeError: Cannot read properties of null (reading 'x')", "--slug", "chain"], { cwd, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const plan = fs.readFileSync(JSON.parse(run.stdout).fixPlanPath, "utf8");
    assert.equal(/^\s*- \[ \]/m.test(plan), false, plan);
  });

  it("o-investigate ranks the error wording a current Node prints, from the library o-debug shares", () => {
    const run = spawnSync(process.execPath, [path.join(SKILLS, "o-investigate", "scripts", "hypothesize.mjs"), "--error", "TypeError: Cannot read properties of undefined (reading 'id')"], { encoding: "utf8" });
    assert.deepEqual(JSON.parse(run.stdout).map((h) => h.id), ["undefined-reference"]);
    assert.equal(read("o-debug/scripts/error-patterns.mjs"), read("o-investigate/scripts/error-patterns.mjs"));
  });

  it("every writer and reader names the files the contract names", () => {
    const contract = read("o-fix/references/plan-format.md");
    for (const name of ["E<nn>-review-plan.md", "E<nn>-fix-plan.md", "E<nn>-verify.<ext>", "E<nn>-intake.md"]) assert.ok(contract.includes(name), name);
    assert.match(read("o-triage/SKILL.md"), /E<nn>-intake\.md/);
    assert.match(read("o-investigate/SKILL.md"), /E<nn>-verify\.<ext>/);
    assert.match(read("o-investigate/SKILL.md"), /E<nn>-fix-plan\.md/);
    assert.doesNotMatch(read("o-investigate/SKILL.md"), /repro-<platform>|- \[ \] Rejected/);
    assert.match(read("o-fix/SKILL.md"), /plan-format\.md/);
  });

  it("every platform o-triage offers has a reproduction recipe in o-debug", () => {
    const recipes = read("o-debug/references/reproduction-recipes.md");
    const table = fs.readFileSync(path.join(SKILLS, "o-triage", "scripts", "route.mjs"), "utf8");
    for (const [, recipe] of table.matchAll(/reproduction: "([^"]+)"/g)) assert.ok(recipes.includes(`## ${recipe}`), recipe);
  });
});
