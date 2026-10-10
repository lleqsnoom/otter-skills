"use strict";

/**
 * A Godot project names its files from the root as `res://` and loads them with `preload`, `load`, `extends` and a
 * shader's `#include`; the editor keeps a generated cache in `.godot/` and writes a `.import` or `.uid` sidecar beside
 * imported files. o-arch-lint read none of the first and all of the second: no direction was ever observed, and the
 * editor's cache and sidecars filled the naming findings.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DIR = path.join(__dirname, "..", "skills", "o-arch-lint", "scripts");
const load = (name) => import(pathToFileURL(path.join(DIR, name)).href);

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archlint-godot-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const PROJECT = {
  "project.godot": "[application]\n",
  "terrain/height.gd": "extends RefCounted\n",
  "scatter/rocks.gd": 'extends Node3D\nconst Height := preload("res://terrain/height.gd")\n',
  "scatter/rock.gdshader": '#include "res://terrain/bake.gdshaderinc"\n',
  "terrain/bake.gdshaderinc": "float bake() { return 0.0; }\n",
  ".godot/editor/Bush_Common.obj-1234.mesh-folding.cfg": "x",
  "assets/Bush_Common.obj": "v 0 0 0\n",
  "assets/Bush_Common.obj.import": "[remap]\n",
};

describe("o-arch-lint in a Godot project", () => {
  it("proposes the directions res:// loads take, with res://<layer>/ as each layer's marker", async () => {
    const { proposeDeclaration } = await load("scaffold.mjs");
    const proposal = proposeDeclaration({ root: tree(PROJECT) });
    assert.deepEqual(proposal.allowed_dependencies.scatter, ["terrain"]);
    assert.deepEqual(proposal.allowed_dependencies.terrain, []);
    assert.ok(proposal.layers.terrain.import_markers.some((marker) => marker.includes("res:")), JSON.stringify(proposal.layers.terrain));
  });

  it("reports a wrong-way extends against the ratified declaration, and leaves the editor's files out of naming", async () => {
    const { proposeDeclaration } = await load("scaffold.mjs");
    const { runCheck } = await load("arch-check.mjs");
    const root = tree(PROJECT);
    const { note, ...declaration } = proposeDeclaration({ root });
    fs.mkdirSync(path.join(root, ".o-skills", "config"), { recursive: true });
    fs.writeFileSync(path.join(root, ".o-skills", "config", "arch.json"), JSON.stringify(declaration));
    fs.writeFileSync(path.join(root, "terrain", "height.gd"), 'extends "res://scatter/rocks.gd"\n');

    const report = runCheck({ root });
    const direction = report.violations.filter((v) => v.rule === "dependency-direction");
    assert.deepEqual(direction.map((v) => [v.file, v.line]), [["terrain/height.gd", 1]]);
    const named = report.violations.filter((v) => v.rule === "naming").map((v) => v.file);
    assert.deepEqual(named, ["assets/Bush_Common.obj"], "the source asset, not its sidecar or the editor cache");
  });
});
