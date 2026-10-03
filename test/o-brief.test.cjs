"use strict";

/** A brief is only useful if the next session finds it: it lands at a fixed name, and the session-start hook names it. */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SAVE = path.join(__dirname, "..", "skills", "o-brief", "scripts", "save-brief.mjs");
const START = path.join(__dirname, "..", "hooks", "session-start-summary.mjs");

describe("o-brief handoff", () => {
  it("writes the six-section brief at the next E<nn> and a pointer the session-start hook prints", async () => {
    const { saveBrief } = await import(pathToFileURL(SAVE).href);
    const { readBriefPointer, renderLine } = await import(pathToFileURL(START).href);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "obrief-"));
    const run = path.join(".o-skills", "runs", "2026-01-01-0900-R01-board");
    fs.mkdirSync(path.join(root, run), { recursive: true });
    fs.writeFileSync(path.join(root, run, "E00-plan.md"), "# plan\n");

    const out = saveBrief({ slug: "board", dir: run, root });
    assert.equal(out.brief, `${run.split(path.sep).join("/")}/E01-brief.md`);
    const text = fs.readFileSync(path.join(root, out.brief), "utf8");
    for (const section of ["Do next", "Where this stands", "Settled", "Open", "Suggested skills", "Sources"]) assert.match(text, new RegExp(`## ${section}`));
    assert.match(renderLine({ brief: readBriefPointer(root) }), /last brief: .*E01-brief\.md/);
  });

  it("numbers a topic's second brief R02, not R01 again", async () => {
    const { saveBrief } = await import(pathToFileURL(SAVE).href);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "obrief-runs-"));
    const first = saveBrief({ slug: "handoff", root, now: new Date(2026, 0, 1, 9, 0) });
    const second = saveBrief({ slug: "handoff", root, now: new Date(2026, 0, 2, 9, 0) });
    const other = saveBrief({ slug: "other", root, now: new Date(2026, 0, 2, 9, 0) });
    assert.match(first.brief, /-R01-handoff\//);
    assert.match(second.brief, /-R02-handoff\//);
    assert.match(other.brief, /-R01-other\//);
  });
});
