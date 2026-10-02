"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "x-autoreflection");
const HEAL = path.join(SKILL, "scripts", "heal.mjs");
const METRICS = path.join(SKILL, "scripts", "metrics.mjs");

function withTmpDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `xskills-${prefix}-`));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("x-autoreflection lifecycle — per-skill ledger", async () => {
  const { writePerSkillLedgers, perSkillLedgerPath } = await import(HEAL);

  it("writes a line for an applied result with a skill and skips a global one", () => {
    withTmpDir("ledger", (dir) => {
      fs.mkdirSync(path.join(dir, "skills", "x-foo"), { recursive: true });
      const results = [
        { id: "F1", status: "applied", skill: "x-foo", target: "skills/x-foo/SKILL.md", evidence: ["s3:m2"] },
        { id: "F2", status: "applied", skill: null, target: "", evidence: [] },
      ];
      writePerSkillLedgers(results, { cwd: dir, at: new Date("2026-01-01T00:00:00Z") });

      const ledger = fs.readFileSync(perSkillLedgerPath("x-foo", dir), "utf8");
      const line = JSON.parse(ledger.trim().split("\n").pop());
      assert.equal(line.id, "F1");
      assert.equal(line.skill, "x-foo");
      assert.equal(line.target, "skills/x-foo/SKILL.md");
      assert.deepEqual(line.evidence, ["s3:m2"]);
      assert.equal(fs.existsSync(perSkillLedgerPath("x-none", dir)), false);
    });
  });
});

describe("x-autoreflection lifecycle — summary and marker", async () => {
  const { writeSummary, markSelfAuthored } = await import(HEAL);

  it("writes the last run's landed and rejected names", () => {
    withTmpDir("summary", (dir) => {
      writeSummary(
        [
          { id: "F1", status: "applied", skill: "x-foo" },
          { id: "F2", status: "reverted", skill: "x-bar" },
        ],
        { cwd: dir, at: new Date("2026-01-01T00:00:00Z") },
      );
      const summary = JSON.parse(fs.readFileSync(path.join(dir, ".x-skills", "runs", "last-heal-summary.json"), "utf8"));
      assert.deepEqual(summary.landed, ["F1"]);
      assert.deepEqual(summary.rejected, ["F2"]);
    });
  });

  it("writes the self-authored marker once and never overwrites it", () => {
    withTmpDir("marker", (dir) => {
      const marker = path.join(dir, "skills", "x-foo", ".self-authored.json");
      markSelfAuthored([{ id: "F1", status: "applied", skill: "x-foo" }], { cwd: dir, at: new Date("2026-01-01T00:00:00Z") });
      assert.equal(JSON.parse(fs.readFileSync(marker, "utf8")).skill, "x-foo");
      const first = fs.readFileSync(marker, "utf8");
      markSelfAuthored([{ id: "F2", status: "applied", skill: "x-foo" }], { cwd: dir, at: new Date("2026-01-02T00:00:00Z") });
      assert.equal(fs.readFileSync(marker, "utf8"), first);
    });
  });
});

describe("x-autoreflection lifecycle — portfolio", async () => {
  const { applyPortfolio } = await import(HEAL);

  it("records the absorber on a merge", () => {
    const results = applyPortfolio([{ id: "PF1", action: "merge", skills: ["x-old", "x-new"], target: "x-new", reason: "same scenario" }], ["PF1"], { dryRun: true });
    assert.equal(results[0].status, "applied");
    assert.equal(results[0].absorbed_by, "x-new");
  });

  it("skips a merge with no absorber", () => {
    const results = applyPortfolio([{ id: "PF1", action: "merge", skills: [], reason: "x" }], ["PF1"], { dryRun: true });
    assert.equal(results[0].status, "skipped");
  });

  it("archives a delete instead of removing, and reports a missing target", () => {
    withTmpDir("archive", (dir) => {
      fs.mkdirSync(path.join(dir, "skills", "x-dead"), { recursive: true });
      fs.writeFileSync(path.join(dir, "skills", "x-dead", "SKILL.md"), "x");
      const results = applyPortfolio([{ id: "PF2", action: "delete", skills: ["x-dead"], reason: "unused" }], ["PF2"], { cwd: dir, at: new Date("2026-01-01T00:00:00Z") });
      assert.equal(results[0].status, "applied");
      assert.equal(fs.existsSync(path.join(dir, "skills", ".archive", "x-dead", "SKILL.md")), true);
      assert.equal(fs.existsSync(path.join(dir, "skills", "x-dead")), false);
      const stale = applyPortfolio([{ id: "PF3", action: "delete", skills: ["x-ghost"] }], ["PF3"], { cwd: dir });
      assert.equal(stale[0].status, "stale");
    });
  });
});

describe("x-autoreflection lifecycle — metrics signal", async () => {
  const { tallySessions, neverLoaded } = await import(METRICS);

  it("flags a skill observed but never loaded, and spares one that loaded", () => {
    const rows = tallySessions([
      { id: "a", skills: { loaded: [], used: ["x-plan"] } },
      { id: "b", skills: { loaded: ["x-review"], used: ["x-review"] } },
    ]);
    const names = neverLoaded(rows).map((f) => f.skill);
    assert.deepEqual(names, ["x-plan"], "x-plan was named but never loaded; x-review loaded");
  });

  it("returns nothing when every observed skill loaded", () => {
    const rows = tallySessions([{ id: "a", skills: { loaded: ["x-plan"], used: ["x-plan"] } }]);
    assert.deepEqual(neverLoaded(rows), []);
  });
});