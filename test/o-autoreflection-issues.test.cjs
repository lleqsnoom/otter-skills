"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const SCRIPTS = path.join(__dirname, "..", "skills", "o-autoreflection", "scripts");
const HUNT = path.join(SCRIPTS, "hunt-issues.mjs");
const READ = path.join(SCRIPTS, "read-session.mjs");

const text = (value) => ({ type: "text", text: value });
const call = (id, name, input) => ({ type: "tool_call", tool_call_id: id, name, input: JSON.stringify(input) });
const result = (id, name, content) => ({ type: "tool_result", tool_call_id: id, name, content });

describe("o-autoreflection hunt-issues", async () => {
  const hunt = await import(HUNT);
  const read = await import(READ);

  /** One session: a request, an answer, then the user's reaction. */
  function session(id, { skills = ["o-ui"], reaction = "this is not what I asked for" } = {}) {
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
    assert.deepEqual(one.skills, ["o-ui"]);
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
      '{"issue":"panels everywhere","skill":"o-ui","refs":["crush:s1#2"],"evidence":[],"instead":"ask once","severity":"high"}',
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
          skill: "o-ui",
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
      { knownSkills: ["o-ui", "o-plan"] }
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
      skill: "o-ui",
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
        theme({ skill: "o-nope" }),
      ],
      digests,
      { knownSkills: ["o-ui"] }
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
    for (const [skill, id] of [["o-review", "I2"], ["o-fix", "I3"]]) {
      const file = path.join(__dirname, "..", "skills", skill, "evals", "expectations.json");
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.equal(parsed.skill, skill);
      assert.ok(parsed.expected_behavior.length >= 1 && parsed.expected_behavior.length <= 7, "1-7 behaviours");
      assert.ok(parsed.expected_behavior.every((line) => typeof line === "string" && line.trim()));
      assert.ok(parsed.source.includes(id), `${skill} expectations name ${id}`);
    }
  });
});

describe("o-autoreflection hunt-issues — the per-skill SKILL.md pass", async () => {
  const hunt = await import(HUNT);
  const read = await import(READ);

  const SKILL_FILE = path.join(__dirname, "..", "skills", "o-ui", "SKILL.md");
  const SKILL_TEXT = fs.readFileSync(SKILL_FILE, "utf8");
  /** A real line of the file, so the test cannot pass on a quote that is not there. */
  const REAL_LINE = SKILL_TEXT.split("\n").find((line) => line.includes("Pre-Flight"));
  const OTHER_SKILL_FILE = path.join(__dirname, "..", "skills", "o-browser", "SKILL.md");

  function session(id, { skills = ["o-ui"], reaction = "this is not what I asked for" } = {}) {
    return read.normalizeSession({
      meta: { id, uuid: id, title: "t", created: "2026-01-01T00:00:00Z", modified: "2026-01-01T01:00:00Z", skills: skills.map((name) => ({ name, loaded_at: "t0" })) },
      messages: [
        { role: "user", parts: [text("Build me a settings screen with three panels please")] },
        { role: "assistant", parts: [text("Done: I built the screen and asked you to confirm it.")] },
        { role: "user", parts: [text(reaction)] },
      ],
    });
  }

  const issue = (extra = {}) => ({
    skill: "o-ui",
    issue: "the agent asked me to confirm a fully specified request",
    line: REAL_LINE,
    refs: ["crush:s1#2", "crush:s2#2"],
    evidence: [
      { ref: "crush:s1#2", quote: "this is not what I asked for" },
      { ref: "crush:s2#2", quote: "this is not what I asked for" },
    ],
    instead: "build it and report what changed",
    severity: "high",
    ...extra,
  });

  const window = () => [hunt.digest(session("s1")), hunt.digest(session("s2")), hunt.digest(session("s3", { skills: ["o-plan"], reaction: "no, wrong screen" }))];

  it("groups the window by skill, with the sessions each skill was in play for", () => {
    const usage = hunt.usageBySkill(window());
    assert.deepEqual([...usage.keys()].sort(), ["o-plan", "o-ui"]);
    assert.deepEqual([...usage.get("o-ui").sessions].sort(), ["crush:s1", "crush:s2"]);
    assert.equal(usage.get("o-ui").turns.length, 2);
    assert.equal(usage.get("o-plan").turns.length, 1);
  });

  it("leaves a turn with no owner out of every prompt, instead of handing it to each loaded skill", () => {
    const wide = hunt.digest(session("s9", { skills: ["o-ui", "o-plan", "o-review"] }));
    assert.equal(wide.turns[0].owner, null);
    assert.equal(hunt.usageBySkill([wide]).size, 0, "with several skills loaded and nothing to say which step spoke, no file gets that turn");
  });

  it("gives the turn to the only skill a session loaded", () => {
    const narrow = hunt.digest(session("s8"));
    assert.equal(narrow.turns[0].owner, "o-ui");
  });

  it("also gives a turn to a skill the user named in it, whatever the timeline says", () => {
    const named = hunt.digest(session("s7", { skills: ["o-ui", "o-plan", "o-review"], reaction: "run o-review again on this branch" }));
    assert.equal(named.turns[0].owner, null);
    const usage = hunt.usageBySkill([named]);
    assert.deepEqual([...usage.keys()], ["o-review"], "the user naming the skill says which file the complaint is for");
  });

  it("writes one prompt per used skill, carrying the file and the refs to cite", () => {
    const prompts = hunt.skillPrompts(window());
    assert.deepEqual(prompts.map((entry) => entry.skill), ["o-ui"], "o-plan shows up once, which is not a pattern");
    assert.match(prompts[0].prompt, /the file under review — skills\/o-ui\/SKILL\.md/);
    assert.match(prompts[0].prompt, /# X-UI/, "the file's own text is in the prompt");
    assert.match(prompts[0].prompt, /\[crush:s1#2\]/);
    assert.match(prompts[0].prompt, /I SAID: this is not what I asked for/);
  });

  it("keeps a proposal that quotes a line really in the file and cites its own sessions", () => {
    const { kept, dropped } = hunt.verifySkillIssues([issue()], window(), { knownSkills: ["o-ui", "o-plan"] });
    assert.equal(dropped.length, 0);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].line, REAL_LINE);
    const finding = hunt.toFinding(kept[0], { id: "S1" });
    assert.equal(finding.skill, "o-ui");
    assert.equal(finding.skill_line, REAL_LINE);
    assert.equal(finding.skill_new, false);
    assert.equal(finding.change, "build it and report what changed");
  });

  it("drops a line the file does not contain, and a proposal with no line at all", () => {
    const { kept, dropped } = hunt.verifySkillIssues(
      [issue({ line: "## A section this file does not have" }), issue({ line: "" })],
      window(),
      { knownSkills: ["o-ui"] }
    );
    assert.equal(kept.length, 0);
    assert.match(dropped[0].why, /the quoted line is not in/);
    assert.match(dropped[1].why, /no SKILL.md line quoted/);
  });

  it("lets a proposal add a line the file has nothing for", () => {
    const { kept } = hunt.verifySkillIssues([issue({ line: "", new: true })], window(), { knownSkills: ["o-ui"] });
    assert.equal(kept.length, 1);
    assert.equal(hunt.toFinding(kept[0], { id: "S1" }).skill_new, true);
  });

  it("drops a ref from a session the skill was not used in, a skill the window never used, and a one-session theme", () => {
    const { kept, dropped } = hunt.verifySkillIssues(
      [
        issue({ refs: ["crush:s1#2", "crush:s3#2"], evidence: [{ ref: "crush:s3#2", quote: "no, wrong screen" }] }),
        issue({ skill: "o-browser" }),
        issue({ refs: ["crush:s1#2"], evidence: [{ ref: "crush:s1#2", quote: "this is not what I asked for" }] }),
        issue({ instead: "" }),
      ],
      window(),
      { knownSkills: ["o-ui", "o-plan", "o-browser"] }
    );
    assert.equal(kept.length, 0);
    assert.equal(dropped.length, 4);
    assert.match(dropped[0].why, /was not in play/);
    assert.match(dropped[1].why, /was not used in this window/);
    assert.match(dropped[2].why, /1 session\(s\)/);
    assert.match(dropped[3].why, /no instruction proposed/);
  });

  it("still refuses a quote that is not in the transcript", () => {
    const { dropped } = hunt.verifySkillIssues(
      [issue({ evidence: [{ ref: "crush:s1#2", quote: "a sentence nobody ever typed here" }] })],
      window(),
      { knownSkills: ["o-ui"] }
    );
    assert.match(dropped[0].why, /quote\(s\) unverified/);
  });

  it("keeps the per-skill file's own bar: the two skills it names exist on disk", () => {
    assert.ok(fs.existsSync(SKILL_FILE));
    assert.ok(fs.existsSync(OTHER_SKILL_FILE));
  });
});
