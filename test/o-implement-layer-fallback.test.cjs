"use strict";

/**
 * status.mjs places a task in its layer by the body's **Layer:** line, and falls back to o-decompose's file name
 * (`L<N>-T<M>-<slug>.md`). An eval agent had to add the line by hand before L0 could close; the name already said it.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const STATUS = path.join(__dirname, "..", "skills", "o-implement", "scripts", "status.mjs");

describe("status.mjs task layer", () => {
  it("reads the **Layer:** line first, then the L<N>-T<M> file name, and nothing from a free-form name", async () => {
    const { parseTask } = await import(pathToFileURL(STATUS).href);
    const body = (layer) => `# Task\n${layer}\n## Definition of Done\n- [x] done\n`;
    assert.equal(parseTask("L1-T1-clamp.md", body("**Layer:** 2 — later")).layer, 2);
    assert.equal(parseTask("L1-T1-clamp.md", body("")).layer, 1);
    assert.equal(parseTask("clamp.md", body("")).layer, null);
  });
});
