"use strict";

/**
 * o-interview is the standalone whole-session interviewing skill; o-brief
 * compacts a conversation into a handoff document. Both follow otter anatomy
 * and carry no upstream naming.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");

describe("o-interview skill", () => {
  const text = fs.readFileSync(path.join(SKILLS, "o-interview", "SKILL.md"), "utf8");

  it("exists with frontmatter naming the folder", () => {
    const fm = text.split("---")[1];
    assert.ok(/name:\s*o-interview\b/.test(fm));
  });

  it("is the frontier-round interview with decisions reserved for the user", () => {
    for (const cue of ["frontier", "design tree", "recommended answer", "sub-agent"]) {
      assert.ok(text.includes(cue), `SKILL.md mentions ${cue}`);
    }
  });

  it("does not carry upstream naming", () => {
    for (const banned of ["ask-matt", "grill-me", "grilling", "wait-what"]) {
      assert.ok(!text.includes(banned), `no upstream name ${banned}`);
    }
  });

  it("ships trigger evals", () => {
    const triggers = JSON.parse(
      fs.readFileSync(path.join(SKILLS, "o-interview", "evals", "triggers.json"), "utf8"),
    );
    assert.ok(triggers.queries.length >= 8);
  });
});

describe("o-brief skill", () => {
  const text = fs.readFileSync(path.join(SKILLS, "o-brief", "SKILL.md"), "utf8");

  it("exists with frontmatter naming the folder", () => {
    const fm = text.split("---")[1];
    assert.ok(/name:\s*o-brief\b/.test(fm));
  });

  it("defines the handoff document rules", () => {
    const lower = text.toLowerCase();
    for (const cue of ["suggested skills", "redact", "next agent", "path or link"]) {
      assert.ok(lower.includes(cue), `SKILL.md mentions ${cue}`);
    }
  });

  it("does not carry upstream naming", () => {
    for (const banned of ["handoff doc skill", "claude-handoff"]) {
      assert.ok(!text.includes(banned));
    }
  });

  it("ships trigger evals", () => {
    const triggers = JSON.parse(
      fs.readFileSync(path.join(SKILLS, "o-brief", "evals", "triggers.json"), "utf8"),
    );
    assert.ok(triggers.queries.length >= 8);
  });
});