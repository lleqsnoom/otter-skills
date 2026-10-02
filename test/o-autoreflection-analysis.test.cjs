"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILL = path.join(__dirname, "..", "skills", "o-autoreflection");
const ANALYZE = path.join(SKILL, "scripts", "analyze.mjs");
const CHECK = path.join(SKILL, "scripts", "check-analysis.mjs");

async function withTmpDir(prefix, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `xskills-${prefix}-`));
  try {
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function scan(id, signals = [], skills = { loaded: [], used: [], unused: [] }) {
  return {
    source: { host: "crush", id, uuid: id, title: `session ${id}` },
    stats: { toolCalls: 3, toolFailures: 1, panels: 0, proseQuestions: 0, repeats: 0 },
    skills,
    signals,
  };
}

function signal(kind, { severity = "high", suspect = null, summary = "x", count = 1, message = 3 } = {}) {
  return {
    id: "S1",
    kind,
    severity,
    summary,
    count,
    suspects: suspect ? [suspect] : [],
    evidence: [{ message, excerpt: summary }],
  };
}

describe("o-autoreflection analyze aggregate", async () => {
  const { aggregate } = await import(ANALYZE);

  it("groups the same gap across sessions into one finding with recurrence", () => {
    const scans = [
      scan("s1", [signal("tool-failure", { suspect: "o-epic" })], { loaded: ["o-epic"], used: ["o-epic"] }),
      scan("s2", [signal("tool-failure", { suspect: "o-epic" })], { loaded: ["o-epic"], used: ["o-epic"] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    assert.equal(report.stats.sessions, 2);
    assert.equal(report.stats.findings, 1);
    assert.equal(report.findings[0].recurrence, 2);
    assert.equal(report.findings[0].skill, "o-epic");
    assert.equal(report.findings[0].class, "doc-command-drift");
  });

  it("gives each quality anchor its improvement class, and keeps an interrupt out of the findings", () => {
    const scans = [
      scan("s1", [
        signal("user-redo", { suspect: "o-research" }),
        signal("user-handoff", { suspect: "o-research" }),
        signal("tool-rejected", { suspect: "o-analyze" }),
        signal("skill-script-silent", { suspect: "o-plan" }),
        signal("interrupt", { severity: "low", suspect: "o-analyze" }),
      ]),
    ];
    const report = aggregate(scans, { hours: 24 });
    const classOf = Object.fromEntries(report.findings.map((finding) => [finding.kind, finding.class]));
    assert.deepEqual(classOf, {
      "user-redo": "missing-expectation",
      "user-handoff": "missing-expectation",
      "tool-rejected": "ritual-cost",
      "skill-script-silent": "silent-success",
    });
    assert.ok(report.findings.every((finding) => finding.change), "every quality class carries a change hint");
  });

  it("adds the retries and the reading order the anchors script computed", async () => {
    const { withAnchors, renderMarkdown } = await import(ANALYZE);
    const report = withAnchors(aggregate([scan("s1")], { hours: 24 }), {
      retries: [{ earlier: "crush:s1", later: "claude:s2", hours: 0.4, overlap: 0.97, excerpt: "do a deep research" }],
      select: [{ session: "crush:s1", reason: "cross-session-retry", owner: "o-research", model: "deepseek-v4-pro", anchors: [{ kind: "cross-session-retry", owner: "o-research", message: 2 }] }],
      recurring: [],
      audit: null,
    });
    assert.equal(report.retries.length, 1);
    const markdown = renderMarkdown(report);
    assert.match(markdown, /## Read first/);
    assert.match(markdown, /crush:s1.*cross-session-retry.*o-research/);
    assert.match(markdown, /## Asked again in a later session/);
  });

  it("names every signal kind and improvement class the code emits in gap-taxonomy.md", async () => {
    const { CLASS_BY_KIND } = await import(ANALYZE);
    const taxonomy = fs.readFileSync(path.join(SKILL, "references", "gap-taxonomy.md"), "utf8");
    const kinds = [...Object.keys(CLASS_BY_KIND), "skill-unused", "expected-exit", "interrupt", "cross-session-retry"];
    for (const name of [...kinds, ...new Set(Object.values(CLASS_BY_KIND))]) {
      assert.ok(taxonomy.includes(`\`${name}\``), `gap-taxonomy.md does not name ${name}`);
    }
  });

  it("drops expected-exit as a non-gap", () => {
    const scans = [scan("s1", [signal("expected-exit", { severity: "low" })], { loaded: [], used: [] })];
    const report = aggregate(scans, { hours: 24 });
    assert.equal(report.stats.findings, 0);
  });

  it("turns skill-unused into a delete portfolio item", () => {
    const scans = [
      scan("s1", [signal("skill-unused", { severity: "low", suspect: "o-triage" })], { loaded: ["o-triage"], used: [], unused: ["o-triage"] }),
      scan("s2", [signal("skill-unused", { severity: "low", suspect: "o-triage" })], { loaded: ["o-triage"], used: [], unused: ["o-triage"] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    const deletes = report.portfolio.filter((item) => item.action === "delete");
    assert.equal(deletes.length, 1);
    assert.deepEqual(deletes[0].skills, ["o-triage"]);
  });

  it("gates delete at two sessions, and groups skill-unused per skill", () => {
    const unusedSignal = (suspects) => ({ id: "S1", kind: "skill-unused", severity: "low", summary: "unused", count: suspects.length, suspects, evidence: [] });
    const scans = [
      scan("s1", [unusedSignal(["o-a", "o-b"])], { loaded: ["o-a", "o-b"], used: [], unused: ["o-a", "o-b"] }),
      scan("s2", [unusedSignal(["o-a"])], { loaded: ["o-a"], used: [], unused: ["o-a"] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    const deletes = report.portfolio.filter((item) => item.action === "delete");
    assert.equal(deletes.length, 1, "only o-a recurs across two sessions");
    assert.deepEqual(deletes[0].skills, ["o-a"]);
    assert.equal(deletes[0].reason, "loaded but never used in 2 session(s)");
  });

  it("proposes a create item for a recurring failure no skill names", () => {
    const scans = [
      scan("s1", [signal("tool-failure", { suspect: null })], { loaded: [], used: [] }),
      scan("s2", [signal("tool-failure", { suspect: null })], { loaded: [], used: [] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    assert.ok(report.portfolio.some((item) => item.action === "create"));
  });

  it("does not auto-emit split from a skill spanning many friction kinds", () => {
    const scans = [
      scan(
        "s1",
        [
          signal("tool-failure", { suspect: "o-plan" }),
          signal("user-correction", { suspect: "o-plan" }),
          signal("prose-question", { suspect: "o-plan", severity: "medium" }),
        ],
        { loaded: ["o-plan"], used: ["o-plan"] }
      ),
    ];
    const report = aggregate(scans, { hours: 24 });
    assert.ok(!report.portfolio.some((item) => item.action === "split"), "split is a manual observation, not a mechanical one");
  });

  it("ranks findings recurrence first", () => {
    const scans = [
      scan("s1", [signal("tool-failure", { suspect: "o-a" })], { loaded: ["o-a"], used: ["o-a"] }),
      scan("s2", [signal("tool-failure", { suspect: "o-a" })], { loaded: ["o-a"], used: ["o-a"] }),
      scan("s3", [signal("tool-failure", { suspect: "o-a" })], { loaded: ["o-a"], used: ["o-a"] }),
      scan("s1", [signal("tool-failure", { suspect: "o-b" })], { loaded: ["o-b"], used: ["o-b"] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    assert.equal(report.findings[0].skill, "o-a");
    assert.equal(report.findings[0].recurrence, 3);
    assert.equal(report.findings[1].skill, "o-b");
  });
});

describe("o-autoreflection analyze report writing", async () => {
  const { aggregate, renderMarkdown, writeReport } = await import(ANALYZE);

  it("writes one JSON and one markdown from the same object", async () => {
    await withTmpDir("analysis", async (dir) => {
      const report = aggregate([scan("s1", [signal("tool-failure", { suspect: "o-epic" })], { loaded: ["o-epic"], used: ["o-epic"] })], { hours: 24 });
      const { jsonPath, mdPath } = writeReport(report, dir);
      assert.ok(fs.existsSync(jsonPath));
      assert.ok(fs.existsSync(mdPath));
      const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      assert.equal(json.stats.sessions, 1);
      const md = fs.readFileSync(mdPath, "utf8");
      assert.ok(md.includes("## Findings"));
      assert.ok(md.includes("o-epic"));
    });
  });

  it("renders markdown that names the finding", () => {
    const report = aggregate([scan("s1", [signal("tool-failure", { suspect: "o-epic" })], { loaded: ["o-epic"], used: ["o-epic"] })], { hours: 24 });
    const md = renderMarkdown(report);
    assert.ok(md.includes("F1"));
    assert.ok(md.includes("doc-command-drift"));
  });

  it("classes a stalled run as a missing bound, with the change that answers it", () => {
    const report = aggregate([scan("s1", [signal("blocking-wait", { severity: "high", summary: "the agent waited on a command that was still running 1x" })])], { hours: 24 });
    const finding = report.findings.find((entry) => entry.kind === "blocking-wait");
    assert.equal(finding.class, "missing-gate");
    assert.match(finding.change, /timeout/);
    assert.match(finding.change, /background/);
  });

  it("lists a stalled run before a friction finding that recurs in more sessions", () => {
    const scans = [
      scan("s1", [signal("blocking-wait", { severity: "high" }), signal("tool-failure", { suspect: "o-epic" })], { loaded: ["o-epic"], used: ["o-epic"] }),
      scan("s2", [signal("tool-failure", { suspect: "o-epic" })], { loaded: ["o-epic"], used: ["o-epic"] }),
      scan("s3", [signal("tool-failure", { suspect: "o-epic" })], { loaded: ["o-epic"], used: ["o-epic"] }),
    ];
    const report = aggregate(scans, { hours: 24 });
    assert.equal(report.findings[0].kind, "blocking-wait", "the stalled run is read first");
    assert.equal(report.findings[1].recurrence, 3, "the friction finding still recurs in more sessions");
    assert.ok(report.notes.some((note) => /stalled run/.test(note)), "the ranking says why");
  });

  it("keeps the user's stall complaint unranked against a skill, so it survives with no owner", () => {
    const report = aggregate([scan("s1", [signal("user-stuck", { severity: "high", summary: "the user said the run had stalled" })])], { hours: 24 });
    const finding = report.findings.find((entry) => entry.kind === "user-stuck");
    assert.equal(finding.skill, null);
    assert.equal(finding.recurrence, 1);
    assert.equal(finding.class, "missing-gate");
  });

  it("merges a model-found recurring issue and reads it beside the stalls", () => {
    const issue = {
      id: "I1",
      kind: "recurring-issue",
      class: "missing-expectation",
      skill: "o-ui",
      severity: "high",
      recurrence: 3,
      count: 3,
      summary: "the agent asks for confirmation on a request that was already complete",
      change: "build it and report what changed",
      sessions: ["a", "b", "c"],
      evidence: [{ session: "a", message: 2, excerpt: "just do it" }],
    };
    const report = aggregate([scan("s1", [signal("tool-failure", { suspect: "o-epic" })], { loaded: ["o-epic"], used: ["o-epic"] })], {
      hours: 24,
      issues: [issue],
    });
    assert.equal(report.findings[0].id, "I1", "a corrected behaviour outranks a failed step");
    assert.equal(report.findings[0].detector, "model");
    assert.equal(report.findings[1].kind, "tool-failure");
  });
});

describe("o-autoreflection check-analysis", async () => {
  const { aggregate } = await import(ANALYZE);
  const { lintAnalysis } = await import(CHECK);

  it("accepts a well-shaped report", () => {
    const report = aggregate([scan("s1", [signal("tool-failure", { suspect: "o-epic" })], { loaded: ["o-epic"], used: ["o-epic"] })], { hours: 24 });
    const { violations } = lintAnalysis(report);
    assert.deepEqual(violations, []);
  });

  it("fails a report with no evidence and a bad portfolio action", () => {
    const report = { schema: "o-autoreflection-analysis/1", stats: { sessions: 0 }, findings: [], portfolio: [{ id: "PF1", action: "rename", skills: ["x"], reason: "" }] };
    const { violations } = lintAnalysis(report);
    assert.ok(violations.some((v) => v.rule === "no-evidence"));
    assert.ok(violations.some((v) => v.rule === "portfolio-action"));
  });
});
