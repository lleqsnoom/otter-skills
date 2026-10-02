"use strict";

/**
 * The marketplace is a file contract: `.claude-plugin/marketplace.json` must name every skill the
 * repo ships, so `/plugin marketplace add lleqsnoom/otter-pm` can install the set. A skill missing
 * from the listing is a skill nobody can install, so the test names it instead of counting.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MARKETPLACE = path.join(ROOT, ".claude-plugin", "marketplace.json");

const skillDirs = () =>
  fs
    .readdirSync(path.join(ROOT, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

describe("plugin marketplace", () => {
  it("carries a marketplace.json at the repo root", () => {
    assert.equal(fs.existsSync(MARKETPLACE), true, "missing .claude-plugin/marketplace.json");
  });

  it("declares a plugin whose source covers every skill directory", () => {
    const marketplace = JSON.parse(fs.readFileSync(MARKETPLACE, "utf8"));
    assert.equal(typeof marketplace.name, "string", "marketplace.name must be a string");
    assert.ok(marketplace.name.length > 0, "marketplace.name must not be empty");
    assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0, "marketplace.plugins must list at least one plugin");

    const declared = new Set();
    for (const plugin of marketplace.plugins) {
      assert.equal(typeof plugin.name, "string", `plugin name must be a string: ${JSON.stringify(plugin)}`);
      const source = plugin.source ?? plugin.skills;
      assert.equal(typeof source, "string", `plugin ${plugin.name} must declare a skill source path`);
      const sourceDir = path.join(ROOT, source);
      assert.equal(fs.existsSync(sourceDir), true, `plugin ${plugin.name} source ${source} does not exist`);
      for (const name of fs.readdirSync(sourceDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
        declared.add(name.name);
      }
    }

    const missing = skillDirs().filter((name) => !declared.has(name));
    assert.deepEqual(missing, [], "skills missing from the marketplace listing");
  });
});