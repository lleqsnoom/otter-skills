"use strict";

/**
 * x-release shapes a PR body; x-guide routes the user to the right skill.
 * Both follow otter anatomy and carry no upstream naming.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");

const noUpstreamNaming = (text, banned) => {
  for (const name of banned) {
    assert.ok(!text.includes(name), `no upstream name ${name}`);
  }
};

describe("x-release skill", () => {
  const text = fs.readFileSync(path.join(SKILLS, "x-release", "SKILL.md"), "utf8");

  it("exists with frontmatter naming the folder", () => {
    assert.ok(/name:\s*x-release\b/.test(text.split("---")[1]));
  });

  it("defines the PR body template", () => {
    for (const cue of ["Summary", "Evidence", "Merge Danger", "Blast Radius", "one-way", "two-way"]) {
      assert.ok(text.includes(cue), `SKILL.md mentions ${cue}`);
    }
  });

  it("does not carry upstream naming", () => {
    noUpstreamNaming(text, ["ask-matt", "show-me", "humanlayer"]);
  });

  it("ships trigger evals", () => {
    const triggers = JSON.parse(
      fs.readFileSync(path.join(SKILLS, "x-release", "evals", "triggers.json"), "utf8"),
    );
    assert.ok(triggers.queries.length >= 8);
  });
});

describe("x-guide skill", () => {
  const text = fs.readFileSync(path.join(SKILLS, "x-guide", "SKILL.md"), "utf8");

  it("exists with frontmatter naming the folder", () => {
    assert.ok(/name:\s*x-guide\b/.test(text.split("---")[1]));
  });

  it("maps the main flow and the on-ramps", () => {
    for (const cue of ["main flow", "on-ramp", "x-plan", "x-implement", "x-review"]) {
      assert.ok(text.includes(cue), `SKILL.md mentions ${cue}`);
    }
  });

  it("does not carry upstream naming", () => {
    noUpstreamNaming(text, ["ask-matt", "ask otter", "wayfinder"]);
  });

  it("ships trigger evals", () => {
    const triggers = JSON.parse(
      fs.readFileSync(path.join(SKILLS, "x-guide", "evals", "triggers.json"), "utf8"),
    );
    assert.ok(triggers.queries.length >= 8);
  });
});
describe("x-guide drift check", () => {
  it("names every skill in the repo, and only skills that exist", () => {
    const map = fs.readFileSync(path.join(SKILLS, "x-guide", "SKILL.md"), "utf8");
    const named = new Set([...map.matchAll(/x-[a-z0-9-]+/g)].map((m) => m[0]));
    const dirs = fs.readdirSync(SKILLS).filter((d) => d.startsWith("x-"));
    for (const d of dirs) assert.ok(named.has(d), `the map is missing ${d}`);
    for (const n of named) assert.ok(fs.existsSync(path.join(SKILLS, n, "SKILL.md")), `map names nonexistent ${n}`);
  });
});
