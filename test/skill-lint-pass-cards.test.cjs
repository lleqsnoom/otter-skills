"use strict";

/**
 * A pass card exists so a host reads a few hundred words instead of a skill's whole body. Two moves undo that
 * silently: a card that grows past its budget, and a caller that goes back to naming the carded skill's
 * SKILL.md. These tests pin the lint rules that catch both.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LINT = path.join(__dirname, "..", "skills", "o-skill-lint", "scripts", "lint.mjs");

let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "oskills-pass-cards-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const write = (rel, text) => {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
};

const skill = (name, body) =>
  write(`skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name} fixture\ntags: [fixture]\n---\n\n# ${name}\n\n${body}\n`);

/** o-card ships a pass card of `cardWords` words; o-host's body is `hostBody`. */
function fixture({ cardWords = 10, hostBody = "A fixture skill." } = {}) {
  write("README.md", "| Skill | Description |\n|-------|-------------|\n| `o-card` | fixture |\n| `o-host` | fixture |\n");
  skill("o-card", "A fixture skill.");
  write("skills/o-card/references/pass.md", Array.from({ length: cardWords }, () => "word").join(" ") + "\n");
  skill("o-host", hostBody);
}

const lint = (rule) => {
  const result = spawnSync(process.execPath, [LINT, "--root", root], { encoding: "utf8" });
  return { code: result.status, hits: JSON.parse(result.stdout).violations.filter((violation) => violation.rule === rule) };
};

describe("pass-card budget", () => {
  it("accepts a card of exactly 600 words", () => {
    fixture({ cardWords: 600 });
    const { code, hits } = lint("card-budget");
    assert.deepEqual(hits, []);
    assert.equal(code, 0);
  });

  it("rejects a card of 601 words and says how many", () => {
    fixture({ cardWords: 601 });
    const { code, hits } = lint("card-budget");
    assert.equal(code, 1);
    assert.deepEqual(hits.map((hit) => [hit.skill, hit.detail]), [["o-card", "references/pass.md has 601 words; the budget is 600"]]);
  });
});

describe("pass-card reference", () => {
  it("accepts a caller that names the card", () => {
    fixture({ hostBody: "Read `~/.agents/skills/o-card/references/pass.md`." });
    const { code, hits } = lint("pass-ref");
    assert.deepEqual(hits, []);
    assert.equal(code, 0);
  });

  it("rejects a caller that names a carded skill's SKILL.md, with the line and the card to use", () => {
    fixture({ hostBody: "First line.\nRead `~/.agents/skills/o-card/SKILL.md`." });
    const { code, hits } = lint("pass-ref");
    assert.equal(code, 1);
    assert.deepEqual(hits.map((hit) => [hit.skill, hit.file, hit.detail]), [
      ["o-host", "SKILL.md:10", "names o-card/SKILL.md; o-card has a pass card, so name o-card/references/pass.md"],
    ]);
  });

  it("checks a caller's references too, and lets a skill name its own SKILL.md", () => {
    fixture();
    write("skills/o-host/references/notes.md", "See o-card/SKILL.md.\n");
    write("skills/o-card/references/more.md", "See o-card/SKILL.md.\n");
    const { hits } = lint("pass-ref");
    assert.deepEqual(hits.map((hit) => [hit.skill, hit.file]), [["o-host", "references/notes.md:1"]]);
  });

  it("leaves a skill without a card alone", () => {
    fixture({ hostBody: "Read o-other/SKILL.md." });
    skill("o-other", "A fixture skill.");
    write("README.md", "| Skill | Description |\n|-------|-------------|\n| `o-card` | fixture |\n| `o-host` | fixture |\n| `o-other` | fixture |\n");
    assert.deepEqual(lint("pass-ref").hits, []);
  });
});
