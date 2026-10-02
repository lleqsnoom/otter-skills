"use strict";

/**
 * o-migrate reads what the project says — the declared range, the installed version, the majors an upgrade
 * crosses — and invents nothing else. Breaking changes come from each major's official guide, so the script ships
 * no table of them and every plan step starts with an empty source for the agent to fill and cite.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "skills", "o-migrate", "scripts", "analyze.mjs");
const load = () => import(pathToFileURL(SCRIPT).href);

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omigrate-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify(body));
  }
  return dir;
}

const run = (cwd, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });

describe("o-migrate inventory", () => {
  it("ships no built-in table of breaking changes", async () => {
    const exported = Object.keys(await load());
    assert.equal(exported.includes("BREAKING_CHANGES"), false);
    assert.doesNotMatch(fs.readFileSync(SCRIPT, "utf8"), /asyncHandler|Automatic batching/);
  });

  it("keeps a scoped package name whole", async () => {
    const { splitSpec } = await load();
    assert.deepEqual(splitSpec("@types/node@20"), { name: "@types/node", version: "20" });
    assert.deepEqual(splitSpec("express@5"), { name: "express", version: "5" });
    assert.deepEqual(splitSpec("express"), { name: "express", version: null });
  });

  it("names every major an upgrade crosses, one guide each", async () => {
    const { majorsCrossed } = await load();
    assert.deepEqual(majorsCrossed("^3.2.0", "5"), [4, 5]);
    assert.deepEqual(majorsCrossed("4.21.2", "4.22.0"), []);
    assert.deepEqual(majorsCrossed("4.0.0", "latest"), []);
  });

  it("reads the installed version from the lockfile and leaves every step's source for the agent to cite", () => {
    const cwd = project({
      "package.json": { dependencies: { express: "^4.18.0" } },
      "package-lock.json": { packages: { "node_modules/express": { version: "4.21.2" } } },
    });
    const result = run(cwd, "--target", "express@5");
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(out.inventory[0], { package: "express", declared: "^4.18.0", installed: "4.21.2", from: "4.21.2", target: "5", majorsCrossed: [5] });
    assert.equal(out.plan.length, 1);
    assert.equal(out.plan[0].source, null);
    assert.deepEqual(out.plan[0].changes, []);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("says what to do with a target that is not a version, rather than guessing one", () => {
    const cwd = project({ "package.json": { dependencies: { react: "^18.2.0" } } });
    const out = JSON.parse(run(cwd, "--target", "react@latest").stdout);
    assert.deepEqual(out.plan, []);
    assert.match(out.problems[0], /npm view react version/);
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("fails on a directory with no package.json", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "omigrate-"));
    assert.equal(run(cwd, "--all").status, 1);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
});
