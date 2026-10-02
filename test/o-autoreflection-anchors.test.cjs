"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const ANCHORS = path.join(__dirname, "..", "skills", "o-autoreflection", "scripts", "anchors.mjs");

const REQUEST = "I am not happy with results from o-autoreflection skills (3). They miss the subtle prompt/model/skill cooperation issues. Do a deep research on that topic.";

function entry(key, overrides = {}) {
  return {
    key,
    id: key,
    host: "crush",
    model: "deepseek-v4-flash",
    modified: "2026-09-18T12:00:00Z",
    request: null,
    signals: [],
    stats: { userMessages: 3 },
    lastOwner: null,
    ...overrides,
  };
}

const anchorSignal = (kind, owner, message = 5) => ({ kind, severity: "high", suspects: owner ? [owner] : [], count: 1, evidence: [{ message }] });

describe("o-autoreflection anchors — the same request asked again", async () => {
  const anchors = await import(ANCHORS);

  it("measures how much of a request reappears, ignoring links and punctuation", () => {
    const a = anchors.shingles("Use https://example.com/a and read the article, then plan it.");
    const b = anchors.shingles("use https://other.org/b and read the article then plan it");
    assert.equal(anchors.overlap(a, b), 1);
    assert.equal(anchors.overlap(anchors.shingles("one two three"), anchors.shingles("four five six")), 0);
  });

  it("links a later session that re-asks an earlier request, and blames the earlier one", () => {
    const earlier = entry("crush:908228ee", { request: { message: 2, created: "2026-09-18T18:07:55+02:00", text: REQUEST }, lastOwner: "o-research" });
    const later = entry("claude:5fe2b092", { host: "claude", request: { message: 3, created: "2026-09-18T16:30:00Z", text: REQUEST.replace("(3)", "") } });
    const [retry] = anchors.crossSessionRetries([later, earlier]);
    assert.equal(retry.earlier, "crush:908228ee");
    assert.equal(retry.later, "claude:5fe2b092");
    assert.ok(retry.hours > 0.3 && retry.hours < 0.5, `hours ${retry.hours}`);
    assert.ok(retry.overlap >= 0.9);
  });

  it("does not call an automation's daily prompt a retry, nor a request asked days later", () => {
    const daily = "Run the daily o-skills reflection. Read the runbook and follow it step by step today.";
    const runs = ["a", "b", "c"].map((id, day) => entry(id, { request: { message: 0, created: `2026-09-1${6 + day}T05:00:00Z`, text: daily } }));
    assert.deepEqual(anchors.crossSessionRetries(runs), [], "an opener seen in three sessions is a template");
    const old = entry("old", { request: { message: 0, created: "2026-09-10T10:00:00Z", text: REQUEST } });
    const recent = entry("new", { request: { message: 0, created: "2026-09-18T10:00:00Z", text: REQUEST } });
    assert.deepEqual(anchors.crossSessionRetries([old, recent]), [], "outside 48 hours");
  });
});

describe("o-autoreflection anchors — which sessions a reflection reads", async () => {
  const anchors = await import(ANCHORS);

  it("puts a handoff before a retry, a retry before a rejection, and friction last", () => {
    const sessions = [
      entry("friction", { signals: [{ kind: "tool-failure", severity: "high", suspects: ["o-fix"], count: 1, evidence: [] }] }),
      entry("rejected", { signals: [anchorSignal("tool-rejected", "o-analyze")] }),
      entry("handoff", { signals: [anchorSignal("user-handoff", "o-research")] }),
      entry("retried", { lastOwner: "o-plan" }),
    ];
    const retries = [{ earlier: "retried", later: "elsewhere", hours: 1, overlap: 0.9 }];
    const picked = anchors.selectSessions(sessions, { retries, cap: 4 });
    assert.deepEqual(picked.select.map((choice) => [choice.session, choice.reason]), [
      ["handoff", "user-handoff"],
      ["retried", "cross-session-retry"],
      ["rejected", "tool-rejected"],
      ["friction", "friction"],
    ]);
  });

  it("reads a stalled run before the session where the user refused a step", () => {
    const sessions = [
      entry("rejected", { signals: [anchorSignal("tool-rejected", "o-analyze")] }),
      entry("stalled", { signals: [anchorSignal("user-stuck", null)] }),
      entry("redone", { signals: [anchorSignal("user-redo", "o-plan")] }),
    ];
    const picked = anchors.selectSessions(sessions, { cap: 4 });
    assert.deepEqual(picked.select.map((choice) => [choice.session, choice.reason]), [
      ["stalled", "user-stuck"],
      ["rejected", "tool-rejected"],
      ["redone", "user-redo"],
    ]);
  });

  it("reads one session per owning skill, and names the rest as recurring", () => {
    const sessions = [
      entry("s1", { modified: "2026-09-18T10:00:00Z", signals: [anchorSignal("user-redo", "o-research")] }),
      entry("s2", { modified: "2026-09-18T11:00:00Z", signals: [anchorSignal("user-redo", "o-research")] }),
      entry("s3", { signals: [anchorSignal("user-redo", "o-plan")] }),
    ];
    const picked = anchors.selectSessions(sessions, { cap: 4 });
    assert.deepEqual(picked.select.map((choice) => choice.session).sort(), ["s2", "s3"], "the most recent of o-research's two, and o-plan's one");
    assert.deepEqual(picked.recurring, [{ owner: "o-research", sessions: ["s2", "s1"], reason: "user-redo" }]);
  });

  it("keeps model-read pushback out of the ranking until the labels validate it", () => {
    const sessions = [entry("pushed", { signals: [anchorSignal("user-pushback", "o-ui")] }), entry("plain")];
    assert.deepEqual(anchors.selectSessions(sessions, { cap: 4 }).select, [], "unvalidated: no anchor");
    const validated = anchors.selectSessions(sessions, { cap: 4, validated: new Set(["user-pushback"]) });
    assert.deepEqual(validated.select.map((choice) => [choice.session, choice.reason]), [["pushed", "user-pushback"]]);
  });

  it("never reads more than the cap", () => {
    const sessions = ["a", "b", "c", "d", "e"].map((key, i) => entry(key, { signals: [anchorSignal("user-redo", `o-s${i}`)] }));
    assert.equal(anchors.selectSessions(sessions, { cap: 4 }).select.length, 4);
  });

  it("draws the day's audit from the interactive sessions with no anchor, the same one for the same day", () => {
    const sessions = [
      entry("anchored", { signals: [anchorSignal("user-redo", "o-plan")] }),
      entry("quiet-1"),
      entry("quiet-2"),
      entry("one-shot", { stats: { userMessages: 1 } }),
    ];
    const first = anchors.auditPick(sessions, { date: "2026-09-19" });
    assert.ok(["quiet-1", "quiet-2"].includes(first.session));
    assert.deepEqual(anchors.auditPick(sessions, { date: "2026-09-19" }), first, "deterministic");
    assert.equal(anchors.auditPick([entry("anchored", { signals: [anchorSignal("user-redo", "o-plan")] })], { date: "2026-09-19" }), null);
  });

  it("reads a session once two weak implicit signals agree, and never for one alone", () => {
    const weak = (kind) => ({ kind, severity: "low", suspects: [], count: 1, evidence: [{ message: 7 }] });
    const sessions = [
      entry("two-weak", { signals: [weak("user-abandon"), weak("user-pushback")], lastOwner: "o-research" }),
      entry("one-weak", { signals: [weak("user-abandon")] }),
      entry("redo-first", { signals: [anchorSignal("user-redo", "o-plan")] }),
    ];
    const picked = anchors.selectSessions(sessions, { cap: 4 });
    assert.deepEqual(
      picked.select.map((choice) => [choice.session, choice.reason]),
      [
        ["redo-first", "user-redo"],
        ["two-weak", "user-dissatisfied"],
      ],
      "one weak signal is noise; two name the session, ranked after a redo"
    );
    const dissatisfied = picked.select.find((choice) => choice.reason === "user-dissatisfied");
    assert.equal(dissatisfied.owner, "o-research", "the last skill in charge owns the composite");
  });

  it("flags a file the user edited after the agent wrote it, and not one a later session wrote", () => {
    const writes = (file) => [{ path: file, message: 4 }];
    const sessions = [
      entry("handed", { modified: "2026-09-18T10:00:00Z", writes: writes("src/app.ts"), lastOwner: "o-implement" }),
      entry("untouched", { modified: "2026-09-18T11:00:00Z", writes: writes("src/clean.ts") }),
      entry("rewritten", { modified: "2026-09-18T09:00:00Z", writes: writes("src/shared.ts") }),
      entry("rewriter", { modified: "2026-09-18T12:00:00Z", writes: writes("src/shared.ts") }),
    ];
    const mtime = (file) => ({ "src/app.ts": "2026-09-18T10:20:00Z", "src/clean.ts": "2026-09-18T10:55:00Z", "src/shared.ts": "2026-09-18T12:05:00Z" })[file] ?? null;
    const found = anchors.handEditSignals(sessions, { mtime });
    assert.deepEqual(
      found.get("handed")?.map((signal) => signal.kind),
      ["user-handedit"],
      "edited twenty minutes after the agent's write, by no session in the window"
    );
    assert.equal(found.has("untouched"), false, "mtime before the session ended");
    assert.equal(found.has("rewritten"), false, "a later session's own write explains the change");
    const [signal] = found.get("handed");
    assert.equal(signal.severity, "medium");
    assert.deepEqual(signal.suspects, ["o-implement"]);
  });
});

describe("o-autoreflection anchors — the command line the analysis skill calls", () => {
  it("reads scans and prints the retries, the reading order and the audit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-anchors-"));
    try {
      const scanOf = (id, host, created, extra = {}) => ({
        source: { host, id, uuid: id, model: "m" },
        request: { message: 0, created, text: REQUEST },
        stats: { userMessages: 3 },
        signals: [],
        lastOwner: "o-research",
        ...extra,
      });
      const input = path.join(dir, "scans.json");
      fs.writeFileSync(input, JSON.stringify([scanOf("a", "crush", "2026-09-18T16:00:00Z"), scanOf("b", "claude", "2026-09-18T16:30:00Z")]));
      const out = JSON.parse(execFileSync(process.execPath, [ANCHORS, "--input", input, "--date", "2026-09-19"], { encoding: "utf8" }));
      assert.deepEqual(out.retries.map((retry) => [retry.earlier, retry.later]), [["crush:a", "claude:b"]]);
      assert.equal(out.select[0].session, "crush:a");
      assert.equal(out.audit.session, "claude:b");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
