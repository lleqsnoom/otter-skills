"use strict";

/**
 * Language reference packs give x-review's Principles pass language-specific review criteria —
 * idioms, common footguns, test layout — so a review cites the pack for the language it read
 * instead of judging every language by generic principles.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REFS = path.join(ROOT, "skills", "x-review", "references");
const SKILL = path.join(ROOT, "skills", "x-review", "SKILL.md");

describe("x-review language reference packs", () => {
  it("routes language selection to the packs from SKILL.md", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    assert.ok(text.includes("lang-typescript.md"), "SKILL.md routes to the TypeScript pack");
    assert.ok(text.includes("lang-python.md"), "SKILL.md routes to the Python pack");
  });

  it("ships a TypeScript pack with language-specific criteria", () => {
    const text = fs.readFileSync(path.join(REFS, "lang-typescript.md"), "utf8");
    for (const cue of ["strict", "any", "async", "narrow", "type"]) {
      assert.ok(text.toLowerCase().includes(cue.toLowerCase()), `TypeScript pack mentions ${cue}`);
    }
  });

  it("ships a Python pack with language-specific criteria", () => {
    const text = fs.readFileSync(path.join(REFS, "lang-python.md"), "utf8");
    for (const cue of ["mutable default", "exception", "typing", "packaging"]) {
      assert.ok(text.toLowerCase().includes(cue.toLowerCase()), `Python pack mentions ${cue}`);
    }
  });
});