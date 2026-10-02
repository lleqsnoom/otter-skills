"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const SCRIPTS = path.join(__dirname, "..", "skills", "o-autoreflection", "scripts");
const SCAN = path.join(SCRIPTS, "scan-session.mjs");
const READ = path.join(SCRIPTS, "read-session.mjs");

const text = (value) => ({ type: "text", text: value });
const call = (id, name, input) => ({ type: "tool_call", tool_call_id: id, name, input: JSON.stringify(input) });
const result = (id, name, content) => ({ type: "tool_result", tool_call_id: id, name, content });

function transcript(messages, skills = []) {
  return {
    meta: { id: "stall1", uuid: "uuid-stall", title: "Stall", created: "2026-01-01T00:00:00Z", modified: "2026-01-01T01:00:00Z", skills },
    messages,
  };
}

const OPENING = "Please add a sortable column to the runs table in the board screen.";

/** One session: the agent starts a dev server, waits on it, and the user says `words`. */
function stalledSession(words, { skills = [] } = {}) {
  return transcript(
    [
      { role: "user", parts: [text(OPENING)] },
      {
        role: "assistant",
        parts: [
          call("c1", "bash", { command: "cd app && npm run dev" }),
        ],
      },
      { role: "tool", parts: [result("c1", "bash", "Background shell started with ID: 030\n\nUse job_output tool to view output")] },
      { role: "assistant", parts: [call("c2", "job_output", { shell_id: "030", wait: true })] },
      { role: "tool", parts: [result("c2", "job_output", "Status: running\n\n  otter-skills   http://127.0.0.1:4322/")] },
      { role: "user", parts: [text(words)] },
    ],
    skills
  );
}

describe("o-autoreflection stall signals", async () => {
  const mod = await import(SCAN);
  const read = await import(READ);
  const normalized = (session) => read.normalizeSession(session);

  const complaints = [
    "AGAIN you are doingg the same thing - running the app with no time limit and getting stuck for HOUR!!!",
    "you sucked at process spawn, always make sure to add some timeout to not stuck, continue",
    "server never stops running so wehen you run it like that you will stuck",
    "You are stuck on one step for 20 minutes. Continue",
    "Why so long? Youre stuck. all we need is to inject into the game and test if the scripts work",
    "Youre stuck in a loop. Do what i said",
    "YOU ARE STUCK IN A LOOP",
    "when you run app to check something set some short execution time, you can always make it longer.",
    "your build is hung again, kill it and try once more",
  ];

  for (const words of complaints) {
    it(`reads "the run stalled" in: ${words.slice(0, 48)}`, () => {
      const scan = mod.scanSession(normalized(stalledSession(words)), { skillNames: [] });
      const stuck = scan.signals.find((signal) => signal.kind === "user-stuck");
      assert.ok(stuck, "a user-stuck signal is emitted");
      assert.equal(stuck.severity, "high");
    });
  }

  const notComplaints = [
    "So it is stuck at what - tell me like i am a junior developer",
    "never hits tjee progress. Stuck at 11%",
    "search online for possible linux freezes (total system freeze)",
    "the ratchet pattern freezes current violations so the count can only go down",
    "fix the issue with ERROR Request timed out - the model stopped sending data for 1m0s",
    "I think you do not get my need - i do not need to detect this stalls freezes, i want to detect any problematic issue with any skill",
    "Ok now i have an idea with autoreflection skill. It scanned all conversations but ity did not found recurring issues - like for example i ask llm very ofter to look that it has frozen with some script executin, i asked it to add some timeout etc.",
  ];

  for (const words of notComplaints) {
    it(`stays quiet on a stall that is not the agent's run: ${words.slice(0, 48)}`, () => {
      const scan = mod.scanSession(normalized(stalledSession(words)), { skillNames: [] });
      assert.equal(scan.signals.some((signal) => signal.kind === "user-stuck"), false);
    });
  }

  it("names the skill in charge when the user complains", () => {
    const session = stalledSession("Youre stuck in a loop, stop waiting on that server", {
      skills: [{ name: "o-plan", description: "plan", loaded_at: "t0" }],
    });
    const scan = mod.scanSession(normalized(session), { skillNames: ["o-plan"] });
    const stuck = scan.signals.find((signal) => signal.kind === "user-stuck");
    assert.deepEqual(stuck.suspects, ["o-plan"]);
    assert.equal(stuck.count, 1);
    assert.ok(stuck.evidence.length >= 1, "the complaint itself is the evidence");
  });

  it("stays quiet when the only user turn is the classifier's own prompt", () => {
    const session = transcript([
      {
        role: "user",
        parts: [
          text(
            "You label user messages sent to an AI coding agent. For each numbered message, answer D if the message pushes back on the agent's previous output: says it is wrong, stuck, broken, or that you should set some short execution time."
          ),
        ],
      },
      { role: "assistant", parts: [text("D")] },
    ]);
    const scan = mod.scanSession(normalized(session), { skillNames: [] });
    assert.equal(scan.signals.some((signal) => signal.kind === "user-stuck"), false, "a prompt the tool fed a model is not the user");
  });

  it("reads a wait on a job that was still running as the blocked pattern", () => {
    const scan = mod.scanSession(normalized(stalledSession("ok, carry on")), { skillNames: [] });
    const wait = scan.signals.find((signal) => signal.kind === "blocking-wait");
    assert.ok(wait, "a blocking-wait signal is emitted");
    assert.equal(wait.count, 1);
    assert.equal(wait.severity, "high", "npm run dev never returns on its own");
    assert.equal(wait.evidence.length, 1);
  });

  it("stays quiet when the wait came back with the job finished", () => {
    const session = transcript([
      { role: "user", parts: [text(OPENING)] },
      { role: "assistant", parts: [call("c1", "bash", { command: "npm run build" })] },
      { role: "tool", parts: [result("c1", "bash", "Background shell started with ID: 042")] },
      { role: "assistant", parts: [call("c2", "job_output", { shell_id: "042", wait: true })] },
      { role: "tool", parts: [result("c2", "job_output", "Status: done\n\nbuilt in 2s")] },
    ]);
    const scan = mod.scanSession(normalized(session), { skillNames: [] });
    assert.equal(scan.signals.some((signal) => signal.kind === "blocking-wait"), false);
  });

  it("stays quiet on a backgrounded command nobody waited on", () => {
    const session = transcript([
      { role: "user", parts: [text(OPENING)] },
      { role: "assistant", parts: [call("c1", "bash", { command: "npm run dev" })] },
      { role: "tool", parts: [result("c1", "bash", "Background shell started with ID: 030")] },
      { role: "assistant", parts: [text("The server is up; moving on.")] },
    ]);
    const scan = mod.scanSession(normalized(session), { skillNames: [] });
    assert.equal(scan.signals.some((signal) => signal.kind === "blocking-wait"), false);
  });

  it("stays quiet on a look at a running job that asked not to wait", () => {
    const session = transcript([
      { role: "user", parts: [text(OPENING)] },
      { role: "assistant", parts: [call("c1", "bash", { command: "npm run dev" })] },
      { role: "tool", parts: [result("c1", "bash", "Background shell started with ID: 2E8")] },
      { role: "assistant", parts: [call("c2", "job_output", { shell_id: "2E8", wait: false })] },
      { role: "tool", parts: [result("c2", "job_output", "Status: running\n\n▲ Next.js - Local: https://localhost:3003")] },
      { role: "assistant", parts: [text("The server is on 3003; setting the cookie next.")] },
    ]);
    const scan = mod.scanSession(normalized(session), { skillNames: [] });
    assert.equal(scan.signals.some((signal) => signal.kind === "blocking-wait"), false);
  });

  it("names the skill whose script the parked command runs", () => {
    const session = transcript([
      { role: "user", parts: [text(OPENING)] },
      { role: "assistant", parts: [call("c1", "bash", { command: "node skills/o-ui/scripts/preview.mjs --watch" })] },
      { role: "tool", parts: [result("c1", "bash", "Background shell started with ID: 7")] },
      { role: "assistant", parts: [call("c2", "job_output", { shell_id: "7", wait: true })] },
      { role: "tool", parts: [result("c2", "job_output", "Status: running\npreview on :4321")] },
    ]);
    const scan = mod.scanSession(normalized(session), { skillNames: ["o-ui"] });
    const wait = scan.signals.find((signal) => signal.kind === "blocking-wait");
    assert.deepEqual(wait.suspects, ["o-ui"]);
  });
});
