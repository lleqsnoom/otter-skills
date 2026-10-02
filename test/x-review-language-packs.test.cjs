"use strict";

/**
 * The remaining two priority language packs (Go, Rust) and the named pipeline table: x-review
 * routes to the packs, and x-implement documents the skill chains by task type, naming only
 * skills that actually exist.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REFS = path.join(ROOT, "skills", "x-review", "references");
const SKILL = path.join(ROOT, "skills", "x-review", "SKILL.md");
const PIPELINES = path.join(ROOT, "skills", "x-implement", "references", "pipelines.md");

const skills = () =>
  fs.readdirSync(path.join(ROOT, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);

describe("x-review Go and Rust packs", () => {
  it("routes to the Go and Rust packs from SKILL.md", () => {
    const text = fs.readFileSync(SKILL, "utf8");
    assert.ok(text.includes("lang-go.md"), "SKILL.md routes to the Go pack");
    assert.ok(text.includes("lang-rust.md"), "SKILL.md routes to the Rust pack");
  });

  it("ships a Go pack with language-specific criteria", () => {
    const text = fs.readFileSync(path.join(REFS, "lang-go.md"), "utf8");
    for (const cue of ["error", "goroutine", "interface", "test"]) {
      assert.ok(text.toLowerCase().includes(cue.toLowerCase()), `Go pack mentions ${cue}`);
    }
  });

  it("ships a Rust pack with language-specific criteria", () => {
    const text = fs.readFileSync(path.join(REFS, "lang-rust.md"), "utf8");
    for (const cue of ["unwrap", "unsafe", "clippy", "trait"]) {
      assert.ok(text.toLowerCase().includes(cue.toLowerCase()), `Rust pack mentions ${cue}`);
    }
  });
});

describe("x-implement pipeline table", () => {
  it("names only skills that exist", () => {
    const text = fs.readFileSync(PIPELINES, "utf8");
    const known = new Set(skills());
    for (const match of text.matchAll(/\b(x-[a-z0-9-]+)\b/g)) {
      assert.ok(known.has(match[1]), `pipeline table names a missing skill: ${match[1]}`);
    }
  });
});