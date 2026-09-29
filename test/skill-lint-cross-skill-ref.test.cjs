"use strict";

/**
 * A skill cites another skill's files by path — `~/.agents/skills/x-arch/SKILL.md`,
 * `x-arch-lint/scripts/arch-check.mjs`. Those lines were skipped by the same-skill reference rule, so nothing
 * checked them: renaming a skill or moving its script broke every citation in the corpus silently, and the
 * defect only surfaced when an agent tried to run the command. These tests pin the rule that closes it, across
 * the three ways a citation is written.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LINT = path.join(__dirname, "..", "skills", "x-skill-lint", "scripts", "lint.mjs");

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-cross-ref-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const write = (rel, text) => {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};

/** A root whose README lists every fixture skill, so only the rule under test can be red. */
function fixture(names) {
  const rows = names.map((name) => `| \`${name}\` | fixture |`).join("\n");
  write("README.md", `| Skill | Description |\n|-------|-------------|\n${rows}\n`);
  for (const name of names) write(`skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name} fixture\ntags: [fixture]\n---\n\n# ${name}\n\nA fixture skill.\n`);
}

const lint = () => {
  const result = spawnSync(process.execPath, [LINT, "--root", root], { encoding: "utf8" });
  const json = JSON.parse(result.stdout);
  return {
    code: result.status,
    refs: json.violations.filter((violation) => violation.rule === "cross-skill-ref" || violation.rule === "unknown-skill-ref"),
  };
};

const setBody = (name, body) =>
  write(`skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name} fixture\ntags: [fixture]\n---\n\n# ${name}\n\n${body}\n`);

describe("the lint checks a citation of another skill's files", () => {
  it("stays clean when the cited skill ships the file", () => {
    fixture(["x-a", "x-b"]);
    write("skills/x-b/scripts/tool.mjs", "export const tool = 1;\n");
    setBody("x-a", "Run `~/.agents/skills/x-b/scripts/tool.mjs` and read `x-b/SKILL.md`.");
    const { code, refs } = lint();
    assert.deepEqual(refs, []);
    assert.equal(code, 0);
  });

  it("flags a file the cited skill does not ship, in every install form it is written in", () => {
    fixture(["x-a", "x-b"]);
    setBody(
      "x-a",
      ["Run `~/.agents/skills/x-b/scripts/gone.mjs`.", "A local install is `.agents/skills/x-b/scripts/also-gone.mjs`.", "See `x-b/references/missing.md`."].join("\n"),
    );
    const { code, refs } = lint();
    assert.equal(code, 1);
    assert.deepEqual(
      refs.map((violation) => violation.detail).sort(),
      ["x-b/references/missing.md does not exist", "x-b/scripts/also-gone.mjs does not exist", "x-b/scripts/gone.mjs does not exist"],
    );
  });

  it("flags a citation that names something which is not a skill at all", () => {
    fixture(["x-a"]);
    setBody("x-a", "Run `x-retired/scripts/old.mjs`.");
    const { refs } = lint();
    assert.deepEqual(refs.map((violation) => violation.rule), ["unknown-skill-ref"]);
    assert.match(refs[0].detail, /x-retired/);
  });

  it("flags a cited skill directory that has no SKILL.md", () => {
    fixture(["x-a", "x-b"]);
    fs.rmSync(path.join(root, "skills", "x-b", "SKILL.md"));
    setBody("x-a", "Read `x-b/SKILL.md` first.");
    const { refs } = lint();
    assert.deepEqual(refs.map((violation) => violation.detail), ["x-b/SKILL.md does not exist"]);
  });

  it("does not double-count a skill's own paths, which the same-skill rule already covers", () => {
    fixture(["x-a"]);
    setBody("x-a", "Run `x-a/scripts/gone.mjs`.");
    const result = spawnSync(process.execPath, [LINT, "--root", root], { encoding: "utf8" });
    const rules = JSON.parse(result.stdout).violations.map((violation) => violation.rule);
    assert.deepEqual(rules, ["missing-ref"]);
  });
});
