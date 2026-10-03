"use strict";

/**
 * o-research and o-tune run the same bounded loop: one state machine, shipped in both skills because a skill
 * may not import another's script. The copies must not drift, and a revert must put the files back.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SKILLS = path.join(__dirname, "..", "skills");

describe("o-tune and o-research share one loop", () => {
  it("ship byte-identical state machines", () => {
    assert.equal(fs.readFileSync(path.join(SKILLS, "o-tune", "scripts", "state.mjs"), "utf8"), fs.readFileSync(path.join(SKILLS, "o-research", "scripts", "state.mjs"), "utf8"));
  });

  it("restores a snapshot when the decision is revert, and only drops it on keep", async () => {
    const { takeSnapshot, settleSnapshot } = await import(pathToFileURL(path.join(SKILLS, "o-tune", "scripts", "state.mjs")).href);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "otune-"));
    const dir = path.join(root, "run");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(root, "a.txt"), "before\n");
    takeSnapshot(dir, "a.txt,b.txt", root);
    fs.writeFileSync(path.join(root, "a.txt"), "experiment\n");
    fs.writeFileSync(path.join(root, "b.txt"), "new\n");
    assert.deepEqual(settleSnapshot(dir, "revert"), ["a.txt", "b.txt"]);
    assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "before\n");
    assert.equal(fs.existsSync(path.join(root, "b.txt")), false, "a file the experiment created is removed");

    takeSnapshot(dir, "a.txt", root);
    fs.writeFileSync(path.join(root, "a.txt"), "kept\n");
    assert.deepEqual(settleSnapshot(dir, "keep"), []);
    assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "kept\n");
    assert.equal(settleSnapshot(dir, "revert"), null, "the snapshot is gone after it settles");
  });
});
