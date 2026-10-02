"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOOK = path.join(__dirname, "..", "hooks", "background-reflection.mjs");
const START = path.join(__dirname, "..", "hooks", "session-start-summary.mjs");

function withTmpDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xskills-${prefix}-`));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("x-autoreflection background trigger", async () => {
  const { shouldReflect, advance, writeReportPointer, callsFrom } = await import(HOOK);

  it("decides deterministically at the threshold", () => {
    assert.deepEqual(shouldReflect(49, 50), { reflect: false, next: 49 });
    assert.deepEqual(shouldReflect(50, 50), { reflect: true, next: 0 });
    assert.deepEqual(shouldReflect(51, 50), { reflect: true, next: 0 });
  });

  it("advances the counter and resets it on reflection", () => {
    assert.deepEqual(advance({ count: 48 }, 1, 50), { count: 49, reflect: false, previous: 49 });
    assert.deepEqual(advance({ count: 49 }, 1, 50), { count: 0, reflect: true, previous: 50 });
  });

  it("counts tool calls from a payload and falls back to one", () => {
    assert.equal(callsFrom({ tool_input: { tool_uses: [1, 2, 3] } }), 3);
    assert.equal(callsFrom(null), 1);
  });

  it("writes a report pointer the next session can read", () => {
    withTmpDir("pointer", (dir) => {
      const file = writeReportPointer({ report: "runs/R1/report.md", analysis: "runs/R1/analysis.json" }, { cwd: dir, at: new Date("2026-01-01T00:00:00Z") });
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.equal(parsed.report, "runs/R1/report.md");
      assert.equal(parsed.analysis, "runs/R1/analysis.json");
    });
  });
});

describe("x-autoreflection session-start summary", async () => {
  const { readSummary, readReportPointer, renderLine } = await import(START);

  it("renders one line naming landed, rejected and the report path", () => {
    withTmpDir("start", (dir) => {
      fs.mkdirSync(path.join(dir, ".x-skills", "runs"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".x-skills", "runs", "last-heal-summary.json"), JSON.stringify({ landed: ["F1"], rejected: ["F2"] }));
      fs.writeFileSync(path.join(dir, ".x-skills", "runs", "last-background-report.json"), JSON.stringify({ report: "runs/R2/report.md" }));
      const line = renderLine({ summary: readSummary(dir), report: readReportPointer(dir) });
      assert.ok(line.includes("landed 1"));
      assert.ok(line.includes("rejected 1"));
      assert.ok(line.includes("runs/R2/report.md"));
    });
  });

  it("renders nothing when neither file exists", () => {
    withTmpDir("empty", (dir) => {
      assert.equal(renderLine({ summary: readSummary(dir), report: readReportPointer(dir) }), "");
    });
  });
});