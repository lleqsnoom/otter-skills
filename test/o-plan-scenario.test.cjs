"use strict";

/**
 * o-plan's graph is recorded event by event, which made a planning session dozens of script calls; a JSON-lines
 * batch records a round in one. The options gate asks for approaches actually weighed — two, or one with the
 * reason no alternative is real — and an approved plan can be amended in place, with a changelog line.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCENARIO = path.join(__dirname, "..", "skills", "o-plan", "scripts", "scenario.mjs");

function start() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "oplan-"));
  const out = spawnSync(process.execPath, [SCENARIO, "start", "--slug", "caching"], { cwd, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  return { cwd, dir: JSON.parse(out.stdout).dir };
}

const cmd = (cwd, ...args) => spawnSync(process.execPath, [SCENARIO, ...args], { cwd, encoding: "utf8" });

function batch(cwd, lines) {
  const file = path.join(cwd, "events.jsonl");
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n"));
  return file;
}

describe("o-plan scenario", () => {
  it("records a whole round from one events file", () => {
    const { cwd, dir } = start();
    const file = batch(cwd, [
      { to: "research" },
      { event: "research", data: "the cache layer lives in src/cache.mjs:12" },
      { to: "clarify" },
      { event: "option", data: "read-through cache" },
      { event: "option", data: "write-behind cache" },
      { to: "propose" },
      { to: "decide" },
    ]);
    const out = cmd(cwd, "record", "--dir", dir, "--events", file);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).node, "decide");
    assert.match(fs.readFileSync(path.join(cwd, dir, "memory.md"), "utf8"), /write-behind cache/);
  });

  it("accepts a single approach only with the reason no alternative is real", () => {
    const { cwd, dir } = start();
    const head = [{ to: "research" }, { event: "research", data: "x" }, { to: "clarify" }];
    const bare = cmd(cwd, "record", "--dir", dir, "--events", batch(cwd, [...head, { event: "option", data: "the only fit" }, { to: "propose" }]));
    assert.notEqual(bare.status, 0);
    assert.match(bare.stderr, /options_weighed failed/);

    const second = start();
    const reasoned = cmd(second.cwd, "record", "--dir", second.dir, "--events", batch(second.cwd, [...head, { event: "option", data: "the only fit", reason: "the provider allows one integration" }, { to: "propose" }]));
    assert.equal(reasoned.status, 0, reasoned.stderr);
  });

  it("amends a plan in place with a dated changelog line", () => {
    const { cwd, dir } = start();
    const out = cmd(cwd, "amend", "--dir", dir, "--data", "L2 drops the DLQ: the queue retries natively");
    assert.equal(out.status, 0, out.stderr);
    const plan = fs.readFileSync(path.join(cwd, dir, "E00-plan.md"), "utf8");
    assert.match(plan, /## Changelog\n\n- \d{4}-\d{2}-\d{2} — L2 drops the DLQ/);
    cmd(cwd, "amend", "--dir", dir, "--data", "second change");
    const again = fs.readFileSync(path.join(cwd, dir, "E00-plan.md"), "utf8");
    assert.equal((again.match(/## Changelog/g) || []).length, 1, "one changelog section, newest line first");
    assert.match(again, /## Changelog\n\n- \d{4}-\d{2}-\d{2} — second change\n- /);
  });
});
