"use strict";

/**
 * The plugin starts the MCP server from Claude Code's cache, where there is no node_modules. The launcher installs
 * the protocol packages before the handshake and the index packages in the background, and a resolve hook finds
 * them in the plugin's data directory. These pin the decisions; the real install was run by hand against npm.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const LAUNCHER = path.join(__dirname, "..", "scripts", "mcp-plugin.mjs");
const HOOK = path.join(__dirname, "..", "scripts", "plugin-resolve.mjs");
const load = () => import(pathToFileURL(LAUNCHER).href);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "omcp-plugin-"));

describe("mcp-plugin launcher", () => {
  it("installs the protocol packages first and leaves the index packages for the background", async () => {
    const { stages } = await load();
    const deps = require("../package.json").dependencies;
    const { core, index } = stages(deps);
    assert.deepEqual(Object.keys(core).sort(), ["@modelcontextprotocol/sdk", "zod"]);
    assert.deepEqual(Object.keys(index).sort(), ["@huggingface/transformers", "@lancedb/lancedb"]);
  });

  it("stamps a stage only after its install ran, and a version bump makes it stale", async () => {
    const { installStage, installed } = await load();
    const dir = path.join(tmp(), "core");
    const runs = [];
    installStage(dir, { zod: "^4.0.0" }, { run: (at) => runs.push(at) });
    assert.deepEqual(runs, [dir]);
    assert.equal(installed(dir, { zod: "^4.0.0" }), true);
    assert.equal(installed(dir, { zod: "^5.0.0" }), false);
    assert.throws(() => installStage(path.join(tmp(), "x"), { zod: "1" }, { run: () => { throw new Error("offline"); } }));
  });

  it("starts the background stage once, waits while it runs, and retries one that went stale", async () => {
    const { startIndexInstall } = await load();
    const data = tmp();
    const spawned = [];
    const spawnInstall = (at) => spawned.push(at);
    assert.equal(startIndexInstall(data, { a: "1" }, { spawnInstall }), "started");
    assert.equal(startIndexInstall(data, { a: "1" }, { spawnInstall }), "running");
    const lock = path.join(data, "index", ".installing");
    const old = new Date(Date.now() - 31 * 60 * 1000);
    fs.utimesSync(lock, old, old);
    assert.equal(startIndexInstall(data, { a: "1" }, { spawnInstall }), "started");
    assert.equal(spawned.length, 2);
    fs.writeFileSync(path.join(data, "index", ".installed"), JSON.stringify({ a: "1" }));
    assert.equal(startIndexInstall(data, { a: "1" }, { spawnInstall }), "installed");
  });

  it("resolves a bare package from the data directory, and only there when the plugin has none", () => {
    const data = tmp();
    const pkg = path.join(data, "core", "node_modules", "only-in-data");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "only-in-data", type: "module", exports: "./index.js" }));
    fs.writeFileSync(path.join(pkg, "index.js"), "export const where = 'data';\n");
    const parents = [pathToFileURL(path.join(data, "core", "package.json")).href];
    const script = `
      import { register } from "node:module";
      register(${JSON.stringify(pathToFileURL(HOOK).href)}, { data: { parents: ${JSON.stringify(parents)} } });
      const { where } = await import("only-in-data");
      const missing = await import("not-anywhere").then(() => "found", (e) => e.code);
      console.log(where, missing);
    `;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: tmp(), encoding: "utf8" });
    assert.equal(run.stdout.trim(), "data ERR_MODULE_NOT_FOUND", run.stderr);
  });
});
