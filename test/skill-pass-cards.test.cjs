"use strict";

/**
 * One non-UI x-implement task makes the agent read x-implement, then x-review's card and x-fix in VERIFY, then every
 * skill file those name by path. This counts that read chain, so a change to what callers load is measured
 * rather than estimated.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");
const ROOTS = ["x-implement/SKILL.md", "x-review/references/pass.md", "x-fix/SKILL.md"];
const EXCLUDED = new Set(["x-ui"]);
const SKILL_FILE_REF = /x-([a-z0-9-]+)\/(SKILL\.md|references\/pass\.md)/g;

// measured 2026-10-01 before pass cards
const BASELINE_WORDS = 12091;

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

const readSkillFile = (rel) => {
  const file = path.join(SKILLS, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
};

const referencedFiles = (text) =>
  [...text.matchAll(SKILL_FILE_REF)]
    .filter(([, name]) => !EXCLUDED.has(`x-${name}`))
    .map(([, name, rel]) => `x-${name}/${rel}`);

function readChain(roots) {
  const seen = new Map();
  const queue = [...roots];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const text = readSkillFile(rel);
    if (text === null) continue;
    seen.set(rel, wordCount(text));
    queue.push(...referencedFiles(text));
  }
  return { files: [...seen.keys()], words: [...seen.values()].reduce((a, b) => a + b, 0) };
}

describe("x-implement read chain", () => {
  it("follows the skill files x-implement, the x-review card and x-fix name by path", (t) => {
    const chain = readChain(ROOTS);
    t.diagnostic(`read chain: ${chain.files.length} files, ${chain.words} words (baseline ${BASELINE_WORDS})`);
    t.diagnostic(chain.files.join(", "));
    for (const skill of ["x-implement", "x-arch", "x-unbloat", "x-comments"]) {
      assert.ok(chain.files.some((f) => f.startsWith(`${skill}/`)), `${skill} is in the chain`);
    }
  });

  it("is at most half the baseline once VERIFY reads the cards", () => {
    assert.ok(readChain(ROOTS).words <= BASELINE_WORDS / 2, `${readChain(ROOTS).words} > ${BASELINE_WORDS / 2}`);
  });

  it("skips a referenced file that does not exist", () => {
    assert.deepEqual(referencedFiles("see x-nope/references/pass.md"), ["x-nope/references/pass.md"]);
    assert.equal(readSkillFile("x-nope/references/pass.md"), null);
  });
});

const CARD_WORD_LIMIT = 600;
const CARDS = {
  "x-arch": ["x-review", "x-implement", "x-decompose", "x-fix"],
  "x-unbloat": ["x-review", "x-refactor", "x-implement", "x-fix"],
  "x-comments": ["x-review", "x-implement", "x-fix"],
  "x-review": ["x-implement"],
};

describe("pass cards", () => {
  for (const [skill, hosts] of Object.entries(CARDS)) {
    it(`${skill} has a card of at most ${CARD_WORD_LIMIT} words naming every host`, () => {
      const card = readSkillFile(`${skill}/references/pass.md`);
      assert.ok(card, `${skill}/references/pass.md exists`);
      assert.ok(wordCount(card) <= CARD_WORD_LIMIT, `${skill} card has ${wordCount(card)} words`);
      for (const host of hosts) assert.match(card, new RegExp(`\\*\\*${host}\\*\\*`), `${skill} card names ${host}`);
    });
  }

  it("no other skill names a carded skill's full body", () => {
    const offenders = skillTextFiles()
      .flatMap((rel) => referencedFiles(readSkillFile(rel)).map((ref) => ({ rel, ref })))
      .filter(namesCardedBodyOfAnotherSkill);
    assert.deepEqual(offenders, []);
  });
});

function namesCardedBodyOfAnotherSkill({ rel, ref }) {
  const [target, file] = ref.split("/");
  return file === "SKILL.md" && target in CARDS && !rel.startsWith(`${target}/`);
}

function skillTextFiles() {
  return fs.readdirSync(SKILLS).flatMap((skill) => {
    const refsDir = path.join(SKILLS, skill, "references");
    const refs = fs.existsSync(refsDir) ? fs.readdirSync(refsDir).filter((f) => f.endsWith(".md")).map((f) => `${skill}/references/${f}`) : [];
    return [`${skill}/SKILL.md`, ...refs].filter((rel) => readSkillFile(rel) !== null);
  });
}
