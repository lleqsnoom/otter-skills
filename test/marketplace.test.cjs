"use strict";

/**
 * The marketplace is a file contract: `.claude-plugin/marketplace.json` lists one plugin whose source is the
 * repository root, so Claude Code finds the parts in their default places — every skill under `skills/`, the loop
 * commands under `commands/`, and the hooks in `hooks/hooks.json`. A component field in the entry replaces or
 * breaks those defaults (`"hooks": "./hooks"` is a directory, which the validator rejects), so the entry carries
 * none. Each hook command must name a script that exists, since nothing else runs them before a user does.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MARKETPLACE = path.join(ROOT, ".claude-plugin", "marketplace.json");
const COMPONENT_FIELDS = ["skills", "commands", "agents", "hooks", "mcpServers", "outputStyles"];

const skillDirs = (root) =>
  fs
    .readdirSync(path.join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const readMarketplace = () => JSON.parse(fs.readFileSync(MARKETPLACE, "utf8"));
const pluginRoot = () => path.join(ROOT, readMarketplace().plugins[0].source);

describe("plugin marketplace", () => {
  it("carries a marketplace.json at the repo root", () => {
    assert.equal(fs.existsSync(MARKETPLACE), true, "missing .claude-plugin/marketplace.json");
  });

  it("declares one plugin rooted at the repository, with no component field overriding a default", () => {
    const marketplace = readMarketplace();
    assert.ok(marketplace.name, "marketplace.name must not be empty");
    assert.ok(marketplace.owner?.name, "marketplace.owner.name is required");
    assert.equal(marketplace.plugins.length, 1);
    const [plugin] = marketplace.plugins;
    assert.equal(plugin.name, "otter-skills");
    assert.equal(path.resolve(pluginRoot()), path.resolve(ROOT), "the source is the repository root");
    assert.doesNotMatch(plugin.source, /\.\./, "a source with .. fails validation");
    assert.deepEqual(COMPONENT_FIELDS.filter((field) => field in plugin), [], "component fields in the entry");
  });

  it("finds every skill in the default skills/ directory", () => {
    const root = pluginRoot();
    for (const name of skillDirs(root)) {
      assert.ok(fs.existsSync(path.join(root, "skills", name, "SKILL.md")), `skills/${name} has no SKILL.md`);
    }
  });

  it("ships the four loop commands in commands/, each naming its skill", () => {
    const commandsDir = path.join(pluginRoot(), "commands");
    const loop = ["o-fix", "o-implement", "o-plan", "o-review"];
    const declared = fs.readdirSync(commandsDir).filter((file) => file.endsWith(".md")).map((file) => file.replace(/\.md$/, ""));
    assert.deepEqual(declared.sort(), loop, "the plugin must declare exactly the four loop commands");
    for (const name of loop) {
      assert.ok(fs.readFileSync(path.join(commandsDir, `${name}.md`), "utf8").includes(name), `command ${name} must name its skill`);
    }
  });

  it("registers its hooks in hooks/hooks.json, each running a script that exists", () => {
    const file = path.join(pluginRoot(), "hooks", "hooks.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(typeof config.hooks, "object", "a hooks file wraps the event map in a top-level hooks key");
    const scripts = [];
    for (const [event, groups] of Object.entries(config.hooks)) {
      assert.ok(Array.isArray(groups), `${event} must hold an array of matcher groups`);
      for (const group of groups) {
        assert.ok(Array.isArray(group.hooks) && group.hooks.length, `${event} group needs hooks`);
        for (const hook of group.hooks) {
          assert.equal(hook.type, "command");
          const match = hook.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/);
          assert.ok(match, `${event} hook must run a script under \${CLAUDE_PLUGIN_ROOT}: ${hook.command}`);
          scripts.push(match[1]);
        }
      }
    }
    for (const rel of scripts) assert.ok(fs.existsSync(path.join(pluginRoot(), rel)), `${rel} does not exist`);
    const shipped = fs.readdirSync(path.join(pluginRoot(), "hooks")).filter((f) => f.endsWith(".mjs")).map((f) => `hooks/${f}`);
    assert.deepEqual(shipped.sort(), [...new Set(scripts)].sort(), "every hook script is registered, and only those");
  });
});
