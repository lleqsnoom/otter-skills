"use strict";

/**
 * An eval agent following o-tune's procedure word for word had a passing change reverted: evaluate.mjs --guard
 * writes guardPass into the candidate file, and record ignored it unless --guard true was passed as well, a flag the
 * procedure never shows. The candidate file's guardPass now counts, and --guard still overrides it.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const STATE = path.join(__dirname, "..", "skills", "o-tune", "scripts", "state.mjs");
const run = (cwd, ...args) => spawnSync(process.execPath, [STATE, ...args], { cwd, encoding: "utf8" });

function started() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "otune-guard-"));
  const start = run(cwd, "start", "--slug", "size", "--metric", "bytes", "--direction", "minimize", "--target", "100", "--evaluator", "node m.mjs", "--guard", "node --test", "--noise-runs", "1");
  assert.equal(start.status, 0, start.stderr);
  const dir = JSON.parse(start.stdout).dir;
  assert.equal(run(cwd, "record", "--dir", dir, "--baseline", "500").status, 0);
  return { cwd, dir };
}

describe("o-tune record reads the guard from the candidate file", () => {
  it("keeps a better candidate whose file says the guard passed", () => {
    const { cwd, dir } = started();
    fs.writeFileSync(path.join(cwd, "cand.json"), JSON.stringify({ pass: true, score: 90, guardPass: true }));
    const out = JSON.parse(run(cwd, "record", "--dir", dir, "--candidate", "cand.json", "--changed", "build.mjs", "--change", "strip comments").stdout);
    assert.equal(out.last?.decision ?? JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")).history.at(-1).decision, "keep");
  });

  it("reverts when the file says the guard failed, and --guard overrides the file", () => {
    const { cwd, dir } = started();
    fs.writeFileSync(path.join(cwd, "cand.json"), JSON.stringify({ pass: true, score: 90, guardPass: false }));
    run(cwd, "record", "--dir", dir, "--candidate", "cand.json", "--changed", "build.mjs", "--change", "a");
    const history = () => JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")).history;
    assert.equal(history().at(-1).decision, "revert");
    run(cwd, "record", "--dir", dir, "--candidate", "cand.json", "--changed", "build.mjs", "--change", "b", "--guard", "true");
    assert.equal(history().at(-1).decision, "keep");
  });
});
