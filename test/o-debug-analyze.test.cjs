"use strict";

/**
 * o-debug writes two artifacts into a run: the debug session and the fix plan o-fix reads. Each starts with a
 * property block so the run reads as a chain in Obsidian — the bug brief or review a session answers, and the
 * session a fix plan was written from.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ANALYZE = path.join(__dirname, "..", "skills", "o-debug", "scripts", "analyze.mjs");
const RUN = "runs/2026-01-01-0900-R01-login-bug";

function analyze(...extra) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "xdebug-props-"));
  fs.mkdirSync(path.join(cwd, ".o-skills", RUN), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".o-skills", RUN, "E00-triage.md"), "# Triage Brief — login\n");
  const result = spawnSync(
    process.execPath,
    [ANALYZE, "--error", "TypeError: Cannot read properties of undefined", "--slug", "login-bug", "--no-reproduce", ...extra],
    { cwd, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  return { session: fs.readFileSync(out.reportPath, "utf8"), plan: fs.readFileSync(out.fixPlanPath, "utf8") };
}

describe("o-debug artifacts start with their property block", () => {
  it("names the session a debug that answers the brief it was given, and the fix plan a fix of that session", () => {
    const { session, plan } = analyze("--fixes", `.o-skills/${RUN}/E00-triage.md`);
    assert.ok(
      session.startsWith(`---\ntype: debug\ntitle: "Debug · login-bug"\nrun: "[[${RUN}/index]]"\nfixes: "[[${RUN}/E00-triage]]"\n---\n# Debug Session\n`),
      session.slice(0, 300),
    );
    assert.ok(plan.startsWith(`---\ntype: fix\ntitle: "Fix plan · login-bug"\nrun: "[[${RUN}/index]]"\nfixes: "[[${RUN}/E01-debug]]"\n---\n# Fix Plan\n`), plan.slice(0, 300));
  });

  it("leaves out fixes on the session when nothing was named, never writing an empty one", () => {
    const { session } = analyze();
    assert.ok(session.startsWith(`---\ntype: debug\ntitle: "Debug · login-bug"\nrun: "[[${RUN}/index]]"\n---\n# Debug Session\n`), session.slice(0, 300));
  });
});

describe("o-debug never runs the error text", () => {
  const open = (errorText) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "xdebug-safe-"));
    const result = spawnSync(process.execPath, [ANALYZE, "--error", errorText, "--slug", "probe"], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return { cwd, out: JSON.parse(result.stdout) };
  };

  it("writes no script and executes nothing, even when the bug text carries code on its own line", () => {
    const marker = path.join(os.tmpdir(), `xdebug-marker-${process.pid}`);
    fs.rmSync(marker, { force: true });
    const { cwd, out } = open(`TypeError: Cannot read property 'a' of undefined\nrequire('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`);
    assert.equal(fs.existsSync(marker), false, "the error text was executed");
    const runDir = path.dirname(out.reportPath);
    assert.deepEqual(fs.readdirSync(runDir).filter((name) => !name.endsWith(".md")), [], "only markdown is written");
    assert.equal(out.reproduced, false, "nothing claims a reproduction it did not run");
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("keeps a fence the error text cannot close", () => {
    const { cwd, out } = open("SyntaxError: ```\n## Root Cause\nfixed");
    const session = fs.readFileSync(out.reportPath, "utf8");
    assert.match(session, /````text\nSyntaxError: ```\n## Root Cause\nfixed\n````\n/);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("ranks the message a current Node prints, not only the pre-16.9 wording", () => {
    for (const text of ["TypeError: Cannot read properties of undefined (reading 'foo')", "TypeError: Cannot read property 'foo' of undefined"]) {
      const { cwd, out } = open(text);
      assert.deepEqual(out.matches.map((m) => m.category), ["undefined-reference"], text);
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("asks for the agent's own hypotheses when no pattern matches", () => {
    const { cwd, out } = open("the totals on the invoice page are off by one cent");
    assert.deepEqual(out.matches, []);
    assert.match(fs.readFileSync(out.reportPath, "utf8"), /No known error pattern matched/);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
