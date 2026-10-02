"use strict";

/**
 * A skill script that uses CommonJS module syntax under a root whose `package.json` says
 * `"type": "module"` throws before it runs, and it does so through the symlinked install too, because the
 * nearest package.json to an installed skill is this repository's. The lint has to see that class, so these
 * tests pin the rule on fixture roots: the offending shapes, the exempt extensions, and the tree that is not
 * a module root and must stay clean.
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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-commonjs-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function lintOn(dir) {
  const result = spawnSync(process.execPath, [LINT, "--root", dir], { encoding: "utf8" });
  const json = JSON.parse(result.stdout);
  return { code: result.status, violations: json.violations, commonjs: json.violations.filter((v) => v.rule === "commonjs-script") };
}

function write(rel, text) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}

/** A root that is a module, plus one fixture skill that satisfies every other rule. */
function fixtureModuleRoot() {
  write("package.json", JSON.stringify({ type: "module" }));
  write("README.md", "| Skill | Description |\n|-------|-------------|\n| `o-probe` | probe |\n");
  write(
    "skills/o-probe/SKILL.md",
    "---\nname: o-probe\ndescription: probe fixture\ntags: [fixture]\n---\n\n# X-Probe\n\nA fixture skill.\n",
  );
}

describe("the lint refuses CommonJS under a module root", () => {
  it("flags a script that requires, and one that exports, at any depth", () => {
    fixtureModuleRoot();
    write("skills/o-probe/scripts/tool.js", 'const fs = require("node:fs");\nconsole.log(fs);\n');
    write("skills/o-probe/scripts/utils/helper.js", "module.exports = { helper: true };\n");
    write("skills/o-probe/scripts/clean.js", 'const marker = "no module syntax here";\nconsole.log(marker);\n');

    const result = lintOn(root);
    assert.equal(result.code, 1);
    assert.deepEqual(
      result.commonjs.map((violation) => violation.file).sort(),
      [path.join("scripts", "tool.js"), path.join("scripts", "utils", "helper.js")],
    );
    assert.equal(result.commonjs[0].skill, "o-probe");
    assert.match(result.commonjs[0].detail, /\.mjs/);
  });

  it("ignores the words require and module.exports inside strings and comments", () => {
    fixtureModuleRoot();
    write("skills/o-probe/scripts/quotes.js", 'const hint = "run node -e \\"require(x)\\"";\n// require("node:fs") is only prose here\nconsole.log(hint);\n');

    const result = lintOn(root);
    assert.deepEqual(result.commonjs, []);
    assert.equal(result.code, 0);
  });

  it("exempts the extensions that say which module system they are", () => {
    fixtureModuleRoot();
    write("skills/o-probe/scripts/tool.mjs", 'import fs from "node:fs";\nconsole.log(fs);\n');
    write("skills/o-probe/scripts/tool.cjs", 'const fs = require("node:fs");\nconsole.log(fs);\n');

    const result = lintOn(root);    assert.deepEqual(result.commonjs, []);
    assert.equal(result.code, 0);
  });

  it("stays silent when the root is not a module", () => {
    fixtureModuleRoot();
    write("package.json", JSON.stringify({ name: "fixture" }));
    write("skills/o-probe/scripts/tool.js", 'const fs = require("node:fs");\nconsole.log(fs);\n');

    const result = lintOn(root);
    assert.deepEqual(result.commonjs, []);
    assert.equal(result.code, 0);
  });

  it("stays silent when the root declares commonjs explicitly", () => {
    fixtureModuleRoot();
    write("package.json", JSON.stringify({ type: "commonjs" }));
    write("skills/o-probe/scripts/tool.js", "module.exports = {};\n");

    const result = lintOn(root);
    assert.deepEqual(result.commonjs, []);
    assert.equal(result.code, 0);
  });

  it("reports a root with no skills folder rather than crashing", () => {
    const empty = path.join(root, "empty");
    fs.mkdirSync(empty, { recursive: true });
    const result = lintOn(empty);
    assert.equal(result.code, 1);
    assert.deepEqual(result.commonjs, []);
  });
});
