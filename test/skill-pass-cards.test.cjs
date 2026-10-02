"use strict";

/**
 * One non-UI o-implement task makes the agent read o-implement, then o-review's card and o-fix in VERIFY, then every
 * skill file those name by path. This counts that read chain, so a change to what callers load is measured
 * rather than estimated.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");
const LINT = path.join(SKILLS, "o-skill-lint", "scripts", "lint.mjs");
const ROOTS = ["o-implement/SKILL.md", "o-review/references/pass.md", "o-fix/SKILL.md"];
const EXCLUDED = new Set(["o-ui"]);
const SKILL_FILE_REF = /o-([a-z0-9-]+)\/(SKILL\.md|references\/pass\.md)/g;

// measured 2026-10-01 before pass cards
const BASELINE_WORDS = 12091;

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

const readSkillFile = (rel) => {
  const file = path.join(SKILLS, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
};

const referencedFiles = (text) =>
  [...text.matchAll(SKILL_FILE_REF)]
    .filter(([, name]) => !EXCLUDED.has(`o-${name}`))
    .map(([, name, rel]) => `o-${name}/${rel}`);

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

describe("o-implement read chain", () => {
  it("follows the skill files o-implement, the o-review card and o-fix name by path", (t) => {
    const chain = readChain(ROOTS);
    t.diagnostic(`read chain: ${chain.files.length} files, ${chain.words} words (baseline ${BASELINE_WORDS})`);
    t.diagnostic(chain.files.join(", "));
    for (const skill of ["o-implement", "o-arch", "o-unbloat", "o-comments"]) {
      assert.ok(chain.files.some((f) => f.startsWith(`${skill}/`)), `${skill} is in the chain`);
    }
  });

  it("is at most half the baseline once VERIFY reads the cards", () => {
    assert.ok(readChain(ROOTS).words <= BASELINE_WORDS / 2, `${readChain(ROOTS).words} > ${BASELINE_WORDS / 2}`);
  });

  it("skips a referenced file that does not exist", () => {
    assert.deepEqual(referencedFiles("see o-nope/references/pass.md"), ["o-nope/references/pass.md"]);
    assert.equal(readSkillFile("o-nope/references/pass.md"), null);
  });
});

const CARDS = {
  "o-arch": ["o-review", "o-implement", "o-decompose", "o-fix"],
  "o-unbloat": ["o-review", "o-refactor", "o-implement", "o-fix"],
  "o-comments": ["o-review", "o-implement", "o-fix"],
  "o-review": ["o-implement"],
};

describe("pass cards", () => {
  for (const [skill, hosts] of Object.entries(CARDS)) {
    it(`${skill} has a card naming every host`, () => {
      const card = readSkillFile(`${skill}/references/pass.md`);
      assert.ok(card, `${skill}/references/pass.md exists`);
      for (const host of hosts) assert.match(card, new RegExp(`\\*\\*${host}\\*\\*`), `${skill} card names ${host}`);
    });
  }

  it("the o-arch card keeps naming as the only enforced group when no arch.json exists", () => {
    assert.match(readSkillFile("o-arch/references/pass.md"), /no `?\.x-skills\/config\/arch\.json`?[^.]*naming/i);
  });

  it("the real tree has no card over budget and no caller naming a carded body", () => {
    const result = spawnSync(process.execPath, [LINT, "--root", path.join(__dirname, "..")], { encoding: "utf8" });
    const hits = JSON.parse(result.stdout).violations.filter((v) => v.rule === "card-budget" || v.rule === "pass-ref");
    assert.deepEqual(hits, []);
  });
});

