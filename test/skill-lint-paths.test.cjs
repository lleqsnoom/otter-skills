"use strict";

/**
 * A skill's commands have to run wherever the skill is installed. `node skills/o-x/…` only resolves from this
 * checkout's root, and `<path-to-x>` / `<o-x skill>` placeholders name no convention an agent can expand — both
 * slipped through a path clean-up once, so the lint now names each with its file and line.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const LINT = path.join(__dirname, "..", "skills", "o-skill-lint", "scripts", "lint.mjs");

function skill(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-paths-"));
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: o-x\ndescription: d\n---\n${body}\n`);
  return dir;
}

describe("skill-lint path conventions", () => {
  it("names a command that runs a script by a repo-relative path", async () => {
    const { pathConventionProblems } = await import(pathToFileURL(LINT).href);
    const problems = pathConventionProblems(skill("Run it:\n\nnode skills/o-browser/scripts/launch.mjs --url x"));
    assert.deepEqual(problems.map((p) => [p.rule, p.file]), [["repo-relative-path", "SKILL.md:7"]]);
  });

  it("names placeholders an agent cannot expand, and accepts <skill> and <skills>", async () => {
    const { pathConventionProblems } = await import(pathToFileURL(LINT).href);
    const problems = pathConventionProblems(skill("node <path-to-commit.mjs> x\nnode <o-plan skill>/scripts/a.mjs\nnode <skill>/scripts/a.mjs\nnode <skills>/o-plan/scripts/a.mjs"));
    assert.deepEqual(problems.map((p) => p.rule), ["stale-placeholder", "stale-placeholder"]);
  });

  it("leaves a heal check alone, which runs inside the skills repository", async () => {
    const { pathConventionProblems } = await import(pathToFileURL(LINT).href);
    assert.deepEqual(pathConventionProblems(skill('  "check": "node skills/o-skill-lint/scripts/lint.mjs",')), []);
  });
});
