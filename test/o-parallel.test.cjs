"use strict";

/**
 * o-parallel runs any worker CLI, not only Crush: each preset says how its CLI takes a prompt and which local
 * config carries the user's rights, and a custom command gets the prompt through the environment, never through
 * the shell's parser. Dependencies come from the task's own `depends_on` when it has one.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "skills", "o-parallel", "scripts", "parallel.mjs");
const load = () => import(pathToFileURL(SCRIPT).href);

describe("o-parallel workers", () => {
  it("knows how claude, codex and crush take a prompt", async () => {
    const { agentInvocation } = await load();
    assert.deepEqual(agentInvocation({ agent: "crush", prompt: "P" }).args, ["run", "P"]);
    const claude = agentInvocation({ agent: "claude", prompt: "P" });
    assert.equal(claude.command, "claude");
    assert.deepEqual(claude.args.slice(0, 2), ["-p", "P"]);
    assert.deepEqual(claude.configs, [".claude/settings.local.json"]);
    assert.deepEqual(agentInvocation({ agent: "codex", prompt: "P" }).args, ["exec", "--full-auto", "P"]);
    assert.throws(() => agentInvocation({ agent: "nope", prompt: "P" }), /unknown --agent/);
  });

  it("hands a custom command the prompt through the environment, so the shell never parses it", async () => {
    const { agentInvocation } = await load();
    const prompt = 'say "hi" $(touch /tmp/never) `uname`';
    const worker = agentInvocation({ agentCmd: "printf '%s' {prompt}", prompt });
    const run = spawnSync(worker.command, worker.args, { shell: worker.shell, env: { ...process.env, ...worker.env }, encoding: "utf8" });
    assert.equal(run.stdout, prompt);
  });
});

describe("o-parallel dependencies", () => {
  it("reads depends_on from front matter, and treats [] as no dependencies", async () => {
    const { parseDependsOn, detectDependencies } = await load();
    const withDeps = '---\ntype: task\ndepends_on:\n  - "[[runs/r/E02-tasks/L0-T1-setup]]"\nsize: S\n---\n# Task\nmentions L0-T2-other for context\n';
    assert.deepEqual(parseDependsOn(withDeps), ["L0-T1-setup"]);
    assert.deepEqual(parseDependsOn("---\ndepends_on: []\n---\n# x\n"), []);
    assert.equal(parseDependsOn("# no front matter\n"), null);
    const tasks = [
      { id: "L0-T1-setup", content: "---\ndepends_on: []\n---\n" },
      { id: "L0-T2-other", content: "---\ndepends_on: []\n---\n" },
      { id: "L1-T1-next", content: withDeps },
    ];
    assert.deepEqual(detectDependencies(tasks)["L1-T1-next"], ["L0-T1-setup"], "a mention in the body is context, not a dependency");
  });

  it("defaults to the first worker CLI the machine has, so a Claude-only machine is not sent to crush", async () => {
    const { defaultAgent } = await load();
    assert.equal(defaultAgent((cmd) => cmd === "claude"), "claude");
    assert.equal(defaultAgent((cmd) => cmd === "codex" || cmd === "crush"), "crush");
    assert.equal(defaultAgent(() => false), "crush");
  });

  it("waits on run.json: done when finished, 3 while running, and a run whose process died is not left waiting", async () => {
    const { statusFile, readRunStatus, waitForRun, waitExitCode } = await load();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oparallel-wait-"));
    const write = (status) => {
      fs.mkdirSync(path.dirname(statusFile(root)), { recursive: true });
      fs.writeFileSync(statusFile(root), JSON.stringify(status));
    };
    assert.equal(readRunStatus(root).phase, "none");
    write({ phase: "running", pid: 1234 });
    assert.equal(readRunStatus(root, { alive: () => false }).phase, "died");
    assert.equal(waitExitCode(readRunStatus(root, { alive: () => false })), 1);

    let clock = 0;
    const running = await waitForRun(root, 1, { alive: () => true, sleep: async (ms) => { clock += ms; }, now: () => clock });
    assert.equal(waitExitCode(running), 3, "still running when the wait runs out");

    let polls = 0;
    const finished = await waitForRun(root, 9, {
      alive: () => true,
      sleep: async () => { if (++polls === 2) write({ phase: "finished", ok: true, pid: 1234 }); },
    });
    assert.equal(waitExitCode(finished), 0);
  });
});
