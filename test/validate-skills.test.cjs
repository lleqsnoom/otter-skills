"use strict";

/**
 * The suite gate over skills/: x-skill-lint's checks wired as `npm test`, plus trail of bits'
 * zero-items rule — a checker that inspects zero items must fail, not pass — and the version rules:
 * every SKILL.md carries a version, and a skill changed against git HEAD without a version bump
 * fails. These tests pin the exit codes and the named file on the paths that matter: a broken
 * frontmatter, a missing referenced script, an unreadable evals file, a skill left out of the README
 * table, an unregistered or un-bumped edit, and an empty skills directory that would otherwise pass
 * silently.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const VALIDATOR = path.join(__dirname, "..", "scripts", "validate-skills.mjs");
const REPO_ROOT = path.join(__dirname, "..");

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-validate-"));
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
  for (const name of names) {
    write(`skills/${name}/SKILL.md`, `---\nname: ${name}\nversion: 1.0.0\ndescription: ${name} fixture\n---\n\n# ${name}\n\nA fixture skill.\n`);
  }
}

/** A fixture root recorded as one git commit, so HEAD comparisons have something to compare to. */
function committedFixture(names) {
  fixture(names);
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  return git;
}

const validate = (args = []) => {
  const result = spawnSync(process.execPath, [VALIDATOR, "--root", root, ...args], { encoding: "utf8" });
  return { code: result.status, json: JSON.parse(result.stdout) };
};

describe("the validator gates the suite on skill hygiene", () => {
  it("passes the clean tree and reports the 39 skills it inspected", () => {
    const result = spawnSync(process.execPath, [VALIDATOR], { encoding: "utf8" });
    const json = JSON.parse(result.stdout);
    assert.equal(result.status, 0);
    assert.deepEqual(json.violations, []);
    assert.equal(json.counts.skills, 39);
    assert.equal(json.counts.readmeRows, 39);
  });

  it("fails on frontmatter that does not parse, naming the file", () => {
    fixture(["x-a"]);
    write("skills/x-a/SKILL.md", "# x-a\n\nNo frontmatter here.\n");
    const { code, json } = validate();
    assert.equal(code, 1);
    const violation = json.violations.find((entry) => entry.rule === "frontmatter");
    assert.equal(violation.file, "x-a/SKILL.md");
  });

  it("fails on a referenced script that does not exist, naming it", () => {
    fixture(["x-a"]);
    write("skills/x-a/SKILL.md", "---\nname: x-a\ndescription: x-a fixture\n---\n\nRun `scripts/gone.mjs`.\n");
    const { code, json } = validate();
    assert.equal(code, 1);
    const violation = json.violations.find((entry) => entry.rule === "missing-ref");
    assert.match(violation.detail, /scripts\/gone\.mjs/);
  });

  it("fails on an evals file that does not parse", () => {
    fixture(["x-a"]);
    write("skills/x-a/evals/expectations.json", "{not json");
    const { code, json } = validate();
    assert.equal(code, 1);
    assert.ok(json.violations.some((entry) => entry.rule === "expectations-shape" && /not JSON/.test(entry.detail)));
  });

  it("fails on a skill left out of the README skills table", () => {
    fixture(["x-a", "x-b"]);
    write("README.md", "| Skill | Description |\n|-------|-------------|\n| `x-a` | fixture |\n");
    const { code, json } = validate();
    assert.equal(code, 1);
    const violation = json.violations.find((entry) => entry.rule === "readme");
    assert.equal(violation.skill, "x-b");
  });

  it("fails on a skill changed against HEAD without a version bump, naming it", () => {
    const git = committedFixture(["x-a"]);
    write("skills/x-a/SKILL.md", `---\nname: x-a\nversion: 1.0.0\ndescription: x-a fixture\n---\n\n# x-a\n\nA changed fixture skill.\n`);
    const { code, json } = validate();
    assert.equal(code, 1);
    const violation = json.violations.find((entry) => entry.rule === "version-bump");
    assert.equal(violation.skill, "x-a");
    assert.equal(violation.file, "x-a/SKILL.md");
    git("checkout", "-q", "--", "skills");
    assert.equal(validate().code, 0);
  });

  it("passes a skill changed against HEAD whose version was bumped", () => {
    committedFixture(["x-a"]);
    write("skills/x-a/SKILL.md", `---\nname: x-a\nversion: 1.1.0\ndescription: x-a fixture\n---\n\n# x-a\n\nA changed fixture skill.\n`);
    const { code, json } = validate();
    assert.equal(code, 0);
    assert.deepEqual(json.violations, []);
  });

  it("fails on a SKILL.md without a version field", () => {
    fixture(["x-a"]);
    write("skills/x-a/SKILL.md", "---\nname: x-a\ndescription: x-a fixture\n---\n\n# x-a\n");
    const { code, json } = validate();
    assert.equal(code, 1);
    const violation = json.violations.find((entry) => entry.rule === "version");
    assert.equal(violation.file, "x-a/SKILL.md");
  });

  it("fails on an empty skills directory under the zero-items rule", () => {
    fixture(["x-a"]);
    fs.rmSync(path.join(root, "skills", "x-a"), { recursive: true, force: true });
    const { code, json } = validate();
    assert.equal(code, 1);
    assert.equal(json.counts.skills, 0);
    assert.deepEqual(json.violations.map((entry) => entry.rule), ["zero-items"]);
  });

  it("is wired into the suite as one npm script", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    assert.match(pkg.scripts["validate:skills"], /validate-skills\.mjs/);
    assert.match(pkg.scripts.test, /validate:skills/);
  });
});