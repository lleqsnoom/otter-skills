"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "o-autoreflection");
const HEAL = path.join(SKILL, "scripts", "heal.mjs");
const CHECK = path.join(SKILL, "scripts", "check-heal.mjs");

async function withTmpDir(prefix, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `xskills-${prefix}-`));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function analysis(findings = []) {
  return { schema: "o-autoreflection-analysis/1", stats: { sessions: 1 }, findings, portfolio: [] };
}

function finding(id, over = {}) {
  return { id, kind: "tool-failure", class: "doc-command-drift", skill: "o-epic", summary: "the documented flag does not match the script", severity: "high", recurrence: 2, count: 3, change: "fix it", evidence: [], ...over };
}

describe("o-autoreflection heal mint", async () => {
  const { mintPlan, SCHEMA } = await import(HEAL);

  it("mints one item per finding, with edit fields empty", () => {
    const plan = mintPlan(analysis([finding("F1"), finding("F2")]), { analysisPath: "E00-analysis.json" });
    assert.equal(plan.schema, SCHEMA);
    assert.equal(plan.analysis, "E00-analysis.json");
    assert.equal(plan.items.length, 2);
    assert.equal(plan.items[0].target, "skills/o-epic/SKILL.md");
    assert.equal(plan.items[0].find, "");
    assert.equal(plan.items[0].auto, false);
  });
});

describe("o-autoreflection heal apply", async () => {
  const { countOccurrences, applyItem, applyHeal } = await import(HEAL);

  it("counts literal occurrences", () => {
    assert.equal(countOccurrences("a b a", "a"), 2);
    assert.equal(countOccurrences("none", "z"), 0);
    assert.equal(countOccurrences("x", ""), 0);
  });

  it("skips a non-auto item", () => {
    const item = { id: "F1", auto: false, target: "f", find: "x", replace: "y", check: "" };
    assert.equal(applyItem(item).status, "skipped");
  });

  it("applies a unique find and reports applied", async () => {
    await withTmpDir("heal", async (dir) => {
      const file = path.join(dir, "target.md");
      fs.writeFileSync(file, "run --topic now\n");
      const item = { id: "F1", auto: true, target: "target.md", find: "--topic", replace: "--slug", check: "true" };
      const result = applyItem(item, { cwd: dir });
      assert.equal(result.status, "applied");
      assert.equal(fs.readFileSync(file, "utf8"), "run --slug now\n");
    });
  });

  it("reverts when the check fails", async () => {
    await withTmpDir("heal", async (dir) => {
      const file = path.join(dir, "target.md");
      fs.writeFileSync(file, "run --topic now\n");
      const item = { id: "F1", auto: true, target: "target.md", find: "--topic", replace: "--slug", check: "node -e \"process.exit(1)\"" };
      const result = applyItem(item, { cwd: dir });
      assert.equal(result.status, "reverted");
      assert.equal(fs.readFileSync(file, "utf8"), "run --topic now\n");
    });
  });

  it("reports stale and ambiguous without writing", async () => {
    await withTmpDir("heal", async (dir) => {
      const file = path.join(dir, "target.md");
      fs.writeFileSync(file, "run --slug now --slug again\n");
      const ambiguous = applyItem({ id: "F1", auto: true, target: "target.md", find: "--slug", replace: "x", check: "true" }, { cwd: dir });
      assert.equal(ambiguous.status, "ambiguous");
      const stale = applyItem({ id: "F1", auto: true, target: "target.md", find: "missing", replace: "x", check: "true" }, { cwd: dir });
      assert.equal(stale.status, "stale");
      assert.equal(fs.readFileSync(file, "utf8"), "run --slug now --slug again\n");
    });
  });

  it("dry-run leaves the file untouched", async () => {
    await withTmpDir("heal", async (dir) => {
      const file = path.join(dir, "target.md");
      fs.writeFileSync(file, "run --topic now\n");
      const item = { id: "F1", auto: true, target: "target.md", find: "--topic", replace: "--slug", check: "true" };
      const result = applyItem(item, { cwd: dir, dryRun: true });
      assert.equal(result.status, "would-apply");
      assert.equal(fs.readFileSync(file, "utf8"), "run --topic now\n");
    });
  });

  it("applies only the picked ids", async () => {
    await withTmpDir("heal", async (dir) => {
      const a = path.join(dir, "a.md");
      const b = path.join(dir, "b.md");
      fs.writeFileSync(a, "one --topic\n");
      fs.writeFileSync(b, "two --topic\n");
      const plan = {
        schema: "o-autoreflection-heal/1",
        analysis: "E00-analysis.json",
        items: [
          { id: "F1", auto: true, target: "a.md", find: "--topic", replace: "--slug", check: "true" },
          { id: "F2", auto: true, target: "b.md", find: "--topic", replace: "--slug", check: "true" },
        ],
      };
      const results = applyHeal(plan, ["F1"], { cwd: dir });
      assert.equal(results.length, 1);
      assert.equal(fs.readFileSync(a, "utf8"), "one --slug\n");
      assert.equal(fs.readFileSync(b, "utf8"), "two --topic\n");
    });
  });
});

describe("o-autoreflection check-heal", async () => {
  const { lintHeal } = await import(CHECK);

  it("accepts a well-shaped auto plan", () => {
    const plan = {
      schema: "o-autoreflection-heal/1",
      analysis: "E00-analysis.json",
      items: [{ id: "F1", skill: "o-epic", class: "doc-command-drift", issue: "tool-failure in 2 sessions", improvement: "tool-failure signals on o-epic: 3 across 2 sessions → none in the next 14 days", target: "skills/o-epic/SKILL.md", find: "--topic", replace: "--slug", check: "node lint", auto: true }],
    };
    assert.deepEqual(lintHeal(plan).violations, []);
  });

  it("fails an auto item missing find or check, or naming a non-auto class", () => {
    const plan = {
      schema: "o-autoreflection-heal/1",
      analysis: "E00-analysis.json",
      items: [
        { id: "F1", target: "f", auto: true, check: "x" },
        { id: "F2", target: "f", auto: true, find: "x", check: "" },
        { id: "F3", target: "f", auto: true, find: "x", replace: "y", check: "x", class: "missing-check" },
      ],
    };
    const { violations } = lintHeal(plan);
    assert.ok(violations.some((v) => v.rule === "item-find"));
    assert.ok(violations.some((v) => v.rule === "item-check"));
    assert.ok(violations.some((v) => v.rule === "auto-class"));
  });
});

describe("o-autoreflection heal — quality fixes and the separation of powers", async () => {
  const { QUALITY_CLASSES, mintPlan, applyItem } = await import(HEAL);
  const { lintHeal } = await import(CHECK);
  const plan = (items) => ({ schema: "o-autoreflection-heal/1", analysis: "E00-analysis.json", generatedAt: "t", items });
  const rules = (items) => lintHeal(plan(items)).violations.map((violation) => violation.rule);

  it("knows the six quality classes and never lets one be applied unattended", () => {
    assert.deepEqual([...QUALITY_CLASSES].sort(), ["depth-floor", "missing-expectation", "ritual-cost", "rule-not-applied", "silent-success", "unbacked-report"]);
    const item = { id: "F1", class: "depth-floor", target: "skills/o-research/SKILL.md", find: "a", replace: "b", check: "true", auto: true, watch: "o-research redo" };
    assert.ok(rules([item]).includes("auto-class"));
  });

  it("carries a watch field for a quality finding, and asks for it before the plan passes", () => {
    const minted = mintPlan({ findings: [{ id: "F1", kind: "user-redo", class: "missing-expectation", skill: "o-research", change: "c", evidence: [] }] });
    assert.equal(minted.items[0].watch, "");
    assert.equal(minted.items[0].skill_md, "");
    assert.equal(minted.items[0].global, false);
    const item = { ...minted.items[0], target: "skills/o-research/SKILL.md" };
    assert.ok(rules([item]).includes("item-watch"), "a quality item says which rate should move");
    assert.equal(rules([{ ...item, watch: "o-research user-redo per session, deepseek-v4-flash, 14 days" }]).includes("item-watch"), false);
  });

  it("prefills the SKILL.md delta a per-skill finding carries", () => {
    const mine = { id: "S1", class: "missing-expectation", skill: "o-ui", summary: "s", change: "write it this way", skill_line: "the old line", skill_new: false, evidence: [] };
    const plan = mintPlan({ findings: [mine] });
    assert.equal(plan.items[0].target, "skills/o-ui/SKILL.md");
    assert.equal(plan.items[0].find, "the old line");
    assert.equal(plan.items[0].replace, "write it this way");
    const added = mintPlan({ findings: [{ ...mine, id: "S2", skill_line: "", skill_new: true, change: "a new section" }] });
    assert.equal(added.items[0].find, "", "the file has no line for it, so the edit is an addition");
    assert.equal(added.items[0].replace, "a new section");
    const theme = mintPlan({ findings: [{ id: "I1", class: "missing-expectation", skill: "o-ui", summary: "s", change: "c", evidence: [] }] });
    assert.equal(theme.items[0].find, "", "a theme-level finding names no line, so nothing is prefilled");
  });

  it("refuses a quality fix that never names the SKILL.md it changes", () => {
    const only = { id: "F1", class: "missing-expectation", target: "skills/o-research/evals/expectations.json", issue: "i", improvement: "r", watch: "w", auto: false };
    assert.ok(rules([only]).includes("item-skill-md"), "an expectation alone leaves the instruction that failed unchanged");
    assert.equal(rules([{ ...only, skill_md: "skills/o-research/SKILL.md" }]).includes("item-skill-md"), false, "the SKILL.md line rides along in skill_md");
    assert.equal(rules([{ ...only, target: "skills/o-research/SKILL.md" }]).includes("item-skill-md"), false, "or the target is the SKILL.md itself");
    assert.equal(rules([{ ...only, target: "skills/o-research/references/rules.md" }]).includes("item-skill-md"), false, "a reference file is the skill's own document");
    assert.equal(rules([{ ...only, target: "/home/me/.config/crush/CRUSH.md", global: true }]).includes("item-skill-md"), false, "a finding no skill owns names the preferences file");
  });

  it("refuses an item whose check runs the file the item edits", () => {
    const item = { id: "F1", class: "missing-check", target: "test/o-research.test.cjs", find: "a", replace: "b", check: "node --test test/o-research.test.cjs", auto: false };
    assert.ok(rules([item]).includes("check-edits-itself"));
  });

  it("refuses a plan that edits a detector or gate and a skill it measures in one go", () => {
    const skill = { id: "F1", class: "rule-not-applied", target: "skills/o-plan/SKILL.md", watch: "w", auto: false };
    const detector = { id: "F2", class: "script-hardening", target: "skills/o-autoreflection/scripts/reactions.mjs", auto: false };
    const ownCheck = { id: "F3", class: "missing-check", target: "skills/o-plan/scripts/check-questions.mjs", auto: false };
    assert.ok(rules([skill, detector]).includes("measure-and-measured"), "the scanner that finds the gap is not edited with the fix");
    assert.ok(rules([skill, ownCheck]).includes("measure-and-measured"), "a skill and its own check are not edited together");
    assert.equal(rules([skill]).includes("measure-and-measured"), false);
    const autoDetector = { ...detector, class: "doc-command-drift", find: "a", check: "true", auto: true };
    assert.ok(rules([autoDetector]).includes("auto-measure"), "a detector is never edited unattended");
  });

  it("writes the watch into the ledger result", async () => {
    await withTmpDir("heal-watch", async (dir) => {
      fs.writeFileSync(path.join(dir, "f.md"), "old line\n");
      const result = applyItem({ id: "F1", auto: true, target: "f.md", find: "old", replace: "new", check: "true", watch: "o-plan redo" }, { cwd: dir });
      assert.equal(result.status, "applied");
      assert.equal(result.watch, "o-plan redo");
    });
  });
});
