"use strict";

/**
 * Every runnable skill script answers --help with its usage and exit 0. Eleven did not, and some treated the flag as
 * input: commit.mjs would have tried to commit a message called "--help", and two read-only scripts ran their whole
 * analysis. Each runs here in an empty directory with an empty HOME, so a script that ignores the flag cannot
 * reach a real repository or profile.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");

function runnableScripts() {
  return fs
    .readdirSync(SKILLS)
    .flatMap((skill) => {
      const dir = path.join(SKILLS, skill, "scripts");
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).map((f) => path.join(dir, f)) : [];
    })
    .filter((file) => /import\.meta\.url\s*===/.test(fs.readFileSync(file, "utf8")));
}

describe("skill scripts answer --help", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "oskills-help-"));
  const home = path.join(sandbox, "home");
  const cwd = path.join(sandbox, "cwd");
  fs.mkdirSync(home);
  fs.mkdirSync(cwd);

  for (const script of runnableScripts()) {
    it(path.relative(SKILLS, script), () => {
      const run = spawnSync(process.execPath, [script, "--help"], { cwd, env: { ...process.env, HOME: home }, encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
      assert.equal(run.status, 0, `exit ${run.status}: ${run.stderr.slice(0, 300)}`);
      assert.match(run.stdout, /usage/i);
    });
  }

  it("left the sandbox untouched", () => {
    assert.deepEqual([...fs.readdirSync(cwd), ...fs.readdirSync(home)], []);
  });
});
