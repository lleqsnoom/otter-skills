"use strict";

/**
 * x-humanize measures text against a word list that ships beside its scripts. A wrong path to that list made every
 * measurement fail, and no test ran the analyzer, so the skill was broken where it is installed and nobody saw it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ANALYZE = path.join(__dirname, "..", "skills", "x-humanize", "scripts", "analyze.mjs");

test("the analyzer measures a text with the word list it ships", () => {
  const result = spawnSync(process.execPath, [ANALYZE, "--stdin", "--level", "B2"], {
    input: "The board reads the links. Each task names its plan.\n",
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(report.level && report.metrics, result.stdout.slice(0, 200));
});
