"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const SCRIPTS = path.join(__dirname, "..", "skills", "x-autoreflection", "scripts");
const HUNT = path.join(SCRIPTS, "hunt-issues.mjs");
const READ = path.join(SCRIPTS, "read-session.mjs");

const text = (value) => ({ type: "text", text: value });
const call = (id, name, input) => ({ type: "tool_call", tool_call_id: id, name, input: JSON.stringify(input) });
const result = (id, name, content) => ({ type: "tool_result", tool_call_id: id, name, content });

describe("x-autoreflection hunt-issues", async () => {
  const hunt = await import(HUNT);
  const read = await import(READ);

  /** One session: a request, an answer, then the user's reaction. */
  function session(id, { skills = ["x-ui"], reaction = "this is not what I asked for" } = {}) {
    return read.normalizeSession({
      meta: { id, uuid: id, title: "t", created: "2026-01-01T00:00:00Z", modified: "2026-01-01T01:00:00Z", skills: skills.map((name) => ({ name, loaded_at: "t0" })) },
      messages: [
        { role: "user", parts: [text("Build me a settings screen with three panels please")] },
        { role: "assistant", parts: [text("Done: I built the screen and asked you to confirm it.")] },
        { role: "user", parts: [text(reaction)] },
      ],
    });
  }

  it("digests the user's reactions with a citable ref, and the reply they answer", () => {
    const one = hunt.digest(session("s1"));
    assert.equal(one.key, "crush:s1");
    assert.deepEqual(one.skills, ["x-ui"]);
    assert.equal(one.turns.length, 1, "the opening request is the task, not a reaction");
    assert.equal(one.turns[0].message, 2);
    assert.match(one.turns[0].before, /I built the screen/);
    assert.equal(one.turns[0].user, "this is not what I asked for");
  });

  it("leaves a host's injected text out of the material", () => {
    const one = read.normalizeSession({
      meta: { id: "s2", uuid: "s2", title: "t", created: "2026-01-01T00:00:00Z", modified: "2026-01-01T01:00:00Z", skills: [] },
      messages: [
        { role: "user", parts: [text("Do the thing with all the details now")] },
        { role: "assistant", parts: [text("ok")] },
        { role: "user", parts: [text("You label user messages sent to an AI coding agent. For each numbered message pick a class:")] },
        { role: "user", parts: [text("stop adding so many panels to every answer")] },
      ],
    });
    assert.deepEqual(hunt.digest(one).turns.map((turn) => turn.user), ["stop adding so many panels to every answer"]);
  });

  it("builds the prompt from the window alone, with the refs the model must cite", () => {
    const prompt = hunt.buildPrompt([hunt.digest(session("s1")), hunt.digest(session("s2"))]);
    assert.match(prompt, /crush:s1#2/);
    assert.match(prompt, /crush:s2#2/);
    assert.match(prompt, /this is not what I asked for/);
    assert.match(prompt, /at least 2 different sessions/);
  });

  it("chunks a window so one prompt never carries every session", () => {
    const digests = Array.from({ length: 23 }, (_, i) => hunt.digest(session(`s${i}`)));
    assert.deepEqual(hunt.chunk(digests, 10).map((group) => group.length), [10, 10, 3]);
    assert.equal(hunt.chunk([hunt.digest(session("only-empty"))], 10)[0].length, 1);
  });

  it("reads JSON lines back and reports prose as unreadable rather than as an issue", () => {
    const answers = [
      '{"issue":"panels everywhere","skill":"x-ui","refs":["crush:s1#2"],"evidence":[],"instead":"ask once","severity":"high"}',
      "I found several issues, here they are:",
      '{"issue":"no skill","refs":[]}',
    ].join("\n");
    const { issues, unreadable } = hunt.parseIssues(answers);
    assert.equal(issues.length, 2, "both JSON lines parse; the empty one is dropped by the verifier");
    assert.equal(unreadable.length, 1, "the prose line is reported, not guessed");
    assert.match(unreadable[0], /I found several issues/);
  });

  it("keeps a theme two sessions prove, with a quote that is really in the transcript", () => {
    const digests = [hunt.digest(session("s1")), hunt.digest(session("s2"))];
    const { kept, dropped } = hunt.verifyIssues(
      [
        {
          issue: "the agent asks for confirmation on a fully specified request",
          skill: "x-ui",
          refs: ["crush:s1#2", "crush:s2#2"],
          evidence: [
            { ref: "crush:s1#2", quote: "not what i asked for" },
            { ref: "crush:s2#2", quote: "this is not what I asked for" },
          ],
          instead: "build it and report what changed",
          severity: "high",
        },
      ],
      digests,
      { knownSkills: ["x-ui", "x-plan"] }
    );
    assert.equal(dropped.length, 0);
    assert.equal(kept.length, 1);
    assert.deepEqual(kept[0].sessions, ["crush:s1", "crush:s2"]);
    const finding = hunt.toFinding(kept[0], { id: "I1" });
    assert.equal(finding.kind, "recurring-issue");
    assert.equal(finding.class, "missing-expectation");
    assert.equal(finding.recurrence, 2);
    assert.deepEqual(finding.evidence[0], { session: "crush:s1", message: 2, excerpt: "not what i asked for" });
  });

  it("drops a quote the transcript does not contain, a ref outside the window, a single session and an unknown skill", () => {
    const digests = [hunt.digest(session("s1")), hunt.digest(session("s2"))];
    const theme = (extra) => ({
      issue: "x",
      skill: "x-ui",
      refs: ["crush:s1#2", "crush:s2#2"],
      evidence: [
        { ref: "crush:s1#2", quote: "this is not what I asked for" },
        { ref: "crush:s2#2", quote: "this is not what I asked for" },
      ],
      instead: "y",
      severity: "high",
      ...extra,
    });
    const { kept, dropped } = hunt.verifyIssues(
      [
        theme({ evidence: [{ ref: "crush:s1#2", quote: "a sentence nobody ever typed here" }] }),
        theme({ refs: ["crush:missing#9", "crush:s1#2"] }),
        theme({ refs: ["crush:s1#2"] }),
        theme({ skill: "x-nope" }),
      ],
      digests,
      { knownSkills: ["x-ui"] }
    );
    assert.equal(kept.length, 0);
    assert.equal(dropped.length, 4);
    assert.match(dropped[0].why, /quote\(s\) unverified/);
    assert.match(dropped[1].why, /ref not in the window/);
    assert.match(dropped[2].why, /1 session\(s\)/);
    assert.match(dropped[3].why, /unknown skill/);
  });

  it("classes a theme no skill owns as a rule that was not applied", () => {
    const finding = hunt.toFinding({ issue: "the agent never says what it skipped", skill: null, sessions: ["a", "b"], evidence: [] }, { id: "I2" });
    assert.equal(finding.class, "rule-not-applied");
    assert.equal(finding.skill, null);
  });
  it("carries an accepted issue into the owner's expectations, citing the finding it came from", () => {
    for (const [skill, id] of [["x-review", "I2"], ["x-fix", "I3"]]) {
      const file = path.join(__dirname, "..", "skills", skill, "evals", "expectations.json");
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.equal(parsed.skill, skill);
      assert.ok(parsed.expected_behavior.length >= 1 && parsed.expected_behavior.length <= 7, "1-7 behaviours");
      assert.ok(parsed.expected_behavior.every((line) => typeof line === "string" && line.trim()));
      assert.ok(parsed.source.includes(id), `${skill} expectations name ${id}`);
    }
  });
});
