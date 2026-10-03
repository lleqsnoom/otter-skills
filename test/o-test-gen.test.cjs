"use strict";

/**
 * o-test-gen writes stubs in the project's own framework that import the real source and fail until written.
 * The earlier version imported from "jest", used a fixed "../src/" path, skipped .mjs, missed `export { }`
 * lists, and wrote empty tests that passed — the exact test o-floor and o-verify exist to catch.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "skills", "o-test-gen", "scripts", "generate.mjs");
const load = () => import(pathToFileURL(SCRIPT).href);

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otestgen-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof body === "string" ? body : JSON.stringify(body));
  }
  return root;
}

describe("o-test-gen framework detection", () => {
  it("reads the framework from config files and dependencies, and falls back to node:test", async () => {
    const { detectJsFramework } = await load();
    assert.equal(detectJsFramework(project({ "jest.config.ts": "export default {}" })).framework, "jest");
    assert.equal(detectJsFramework(project({ "package.json": { devDependencies: { vitest: "^2" } } })).framework, "vitest");
    assert.equal(detectJsFramework(project({ "package.json": { scripts: { test: "node --test" } } })).framework, "node");
    assert.equal(detectJsFramework(project({ "package.json": { scripts: { test: "echo hi" } } })).framework, "node", "a test script alone is not Jest");
  });
});

describe("o-test-gen export discovery", () => {
  it("finds inline exports, export lists with renames, defaults, and CommonJS exports", async () => {
    const { jsExports } = await load();
    const esm = jsExports("function add(a, b) {}\nconst div = (a, b) => a / b;\nexport default function main(argv) {}\nexport { add, div as safeDivide };\nexport class Cart {}");
    assert.deepEqual(esm.map((e) => e.name).sort(), ["Cart", "add", "main", "safeDivide"]);
    assert.deepEqual(esm.find((e) => e.name === "safeDivide").params, ["a", "b"]);
    const cjs = jsExports("function slug(text) {}\nmodule.exports = { slug };\nexports.trim = (s) => s;");
    assert.deepEqual(cjs.map((e) => e.name).sort(), ["slug", "trim"]);
  });
});

describe("o-test-gen output", () => {
  it("writes stubs that import the real source and fail until someone writes them", () => {
    const root = project({
      "package.json": { type: "module", scripts: { test: "node --test" } },
      "src/math.mjs": "function add(a, b) { return a + b; }\nexport { add };\n",
      "test/.keep": "",
    });
    const gen = spawnSync(process.execPath, [SCRIPT, "src"], { cwd: root, encoding: "utf8" });
    assert.equal(gen.status, 0, gen.stderr);
    assert.ok(fs.existsSync(path.join(root, "test", "math.test.mjs")));
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // set by the outer runner; a nested run would report to it instead of exiting
    const run = spawnSync(process.execPath, ["--test", "test/math.test.mjs"], { cwd: root, encoding: "utf8", env });
    assert.notEqual(run.status, 0, "a stub that passes checks nothing");
    assert.match(run.stdout + run.stderr, /TODO: write this test for add/);
    assert.doesNotMatch(run.stdout + run.stderr, /Cannot find module|ERR_MODULE_NOT_FOUND/, "the import resolves");
  });

  it("never overwrites a test file that already exists", () => {
    const root = project({ "package.json": { type: "module" }, "src/a.mjs": "export function a() {}\n", "test/a.test.mjs": "// mine\n" });
    const gen = JSON.parse(spawnSync(process.execPath, [SCRIPT, "src"], { cwd: root, encoding: "utf8" }).stdout);
    assert.equal(gen.written.length, 0);
    assert.match(gen.skipped[0].reason, /already exists/);
    assert.equal(fs.readFileSync(path.join(root, "test", "a.test.mjs"), "utf8"), "// mine\n");
  });
});
