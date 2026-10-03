"use strict";

/**
 * A project that already declares its layers for eslint-plugin-boundaries should not declare them twice. The scaffold
 * imports a JSON boundaries config as the proposal and names a JavaScript config instead of running it. Its JSON
 * reader once stripped "comments" inside strings, and every glob holds both `/*` and `*\/`.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCAFFOLD = path.join(__dirname, "..", "skills", "o-arch-lint", "scripts", "scaffold.mjs");
const load = () => import(pathToFileURL(SCAFFOLD).href);

function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oarch-boundaries-"));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), text);
  return root;
}

describe("o-arch-lint scaffold and existing boundaries", () => {
  it("keeps globs inside strings when it strips comments", async () => {
    const { stripJsonComments } = await load();
    const text = '{ // a comment\n "a": "src/**/*.ts", /* block */ "b": "x//y", }';
    assert.deepEqual(JSON.parse(stripJsonComments(text)), { a: "src/**/*.ts", b: "x//y" });
  });

  it("imports eslint-plugin-boundaries as layers and allowed dependencies, under either default", async () => {
    const { existingDeclaration } = await load();
    const elements = [{ type: "domain", pattern: "src/domain/*" }, { type: "app", pattern: "src/app/**" }, { type: "infra", pattern: "src/infra" }, { type: "odd", pattern: "src/**/*.helper.ts" }];
    const disallow = project({
      ".eslintrc.json": JSON.stringify({ settings: { "boundaries/elements": elements }, rules: { "boundaries/element-types": [2, { default: "disallow", rules: [{ from: "app", allow: ["domain"] }, { from: ["infra"], allow: ["domain", "app"] }] }] } }),
    });
    const imported = existingDeclaration(disallow).declaration;
    assert.deepEqual(imported.allowed_dependencies, { domain: [], app: ["domain"], infra: ["app", "domain"] });
    assert.deepEqual(imported.layers.infra.roots, ["src/infra"]);
    assert.equal(imported.layers.odd, undefined, "a pattern richer than one folder is left out");

    const allow = project({
      "package.json": JSON.stringify({ eslintConfig: { settings: { "boundaries/elements": elements.slice(0, 3) }, rules: { "boundaries/element-types": [2, { default: "allow", rules: [{ from: "domain", disallow: ["app", "infra"] }] }] } } }),
    });
    assert.deepEqual(existingDeclaration(allow).declaration.allowed_dependencies, { domain: [], app: ["domain", "infra"], infra: ["app", "domain"] });
  });

  it("names a JavaScript config instead of running it", async () => {
    const { existingDeclaration, proposeDeclaration } = await load();
    const root = project({ ".dependency-cruiser.js": "throw new Error('executed');\n", "eslint.config.js": "throw new Error('executed');\n" });
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "a.mjs"), "export const a = 1;\n");
    assert.deepEqual(existingDeclaration(root), { declaration: null, unread: ["eslint.config.js", ".dependency-cruiser.js"] });
    assert.match(proposeDeclaration({ root }).note, /Also found eslint\.config\.js, \.dependency-cruiser\.js: a JavaScript config is not executed/);
  });
});
