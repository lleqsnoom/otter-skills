"use strict";

/**
 * The review-plan gate turns o-review's "a plan missing a pass heading is incomplete, not clean" from
 * prose into a fact: whatever text crosses the hook must carry the four pass headings, and a plan that
 * does not is refused with one actionable line per missing heading, never a silent pass. The tests pin
 * that on stdin text, on a JSON hook payload, and on the plan template o-review actually ships.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const GATE = path.join(ROOT, "hooks", "review-plan-gate.mjs");
const SKILL = path.join(ROOT, "skills", "o-review", "SKILL.md");

const HEADINGS = ["[Comments]", "[Bloat]", "[Architecture]", "[Floor]"];

const run = (input, args = []) =>
  spawnSync(process.execPath, [GATE, ...args], { input, encoding: "utf8" });

const plan = (headings) =>
  `## Summary\n\n**Status:** clean\n\n${headings.map((h) => `## ${h} — pass\n\nnone\n\n---\n`).join("\n")}`;

const shippedPlanTemplate = () => {
  const source = fs.readFileSync(SKILL, "utf8");
  const fences = [...source.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  const template = fences.find((fence) => fence.includes("## [Comments]"));
  assert.ok(template, "o-review's SKILL.md must carry a fenced plan template with a [Comments] heading");
  return template;
};

describe("review-plan gate hook", () => {
  it("exits 0 with no output on a plan carrying all four headings", () => {
    const result = run(plan(HEADINGS));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });

  it("exits 0 on o-review's shipped plan template", () => {
    const result = run(shippedPlanTemplate());
    assert.equal(result.status, 0, result.stderr);
  });

  it("exits 1 and names only the missing heading", () => {
    const result = run(plan(HEADINGS.filter((h) => h !== "[Floor]")));
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /\[Floor\]/);
    for (const heading of HEADINGS.filter((h) => h !== "[Floor]")) {
      assert.doesNotMatch(result.stderr, new RegExp(heading.replace(/[[\]]/g, "\\$&")));
    }
  });

  it("prints one actionable line per missing heading", () => {
    const result = run("## Summary\n\n**Status:** clean\n");
    assert.equal(result.status, 1);
    const lines = result.stderr.trim().split("\n");
    assert.equal(lines.length, HEADINGS.length);
    for (const heading of HEADINGS) {
      assert.ok(lines.some((line) => line.includes(heading)), `no line names ${heading}`);
      assert.ok(lines.every((line) => line.includes("o-review")), "every line is actionable");
    }
  });

  it("exits 1 on empty stdin", () => {
    const result = run("");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[Comments\]/);
  });

  it("matches the heading however the plan writes it", () => {
    for (const text of [
      "## [Comments] — pass 3 of the review\n## [Bloat] — pass 4\n## [Architecture] — pass 5\n## [Floor] — pass 6\n",
      "[Comments]\n[Bloat]\n[Architecture]\n[Floor]\n",
      "# [Comments]\n# [Bloat]\n# [Architecture]\n# [Floor]\n",
    ]) {
      const result = run(text);
      assert.equal(result.status, 0, result.stderr);
    }
  });

  it("reads the plan from a file path argument", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-plan-gate-"));
    try {
      const file = path.join(dir, "plan.md");
      fs.writeFileSync(file, plan(HEADINGS));
      const result = run("", [file]);
      assert.equal(result.status, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the plan from a hook payload naming the file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-plan-gate-"));
    try {
      const file = path.join(dir, "plan.md");
      fs.writeFileSync(file, plan(HEADINGS));
      const payload = JSON.stringify({
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: file },
      });
      const result = run(payload);
      assert.equal(result.status, 0, result.stderr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the plan text from a hook payload carrying the content", () => {
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "plan.md", content: plan(HEADINGS) },
    });
    const result = run(payload);
    assert.equal(result.status, 0, result.stderr);
  });
});