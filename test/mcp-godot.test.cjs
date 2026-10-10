'use strict';

/**
 * o-search in a Godot project: the code tools read only the extensions the server treats as text, which held no
 * GDScript or shader, so `find_symbols` and `search_code` answered nothing for a whole game. A GDScript declaration
 * is also `class_name` or `signal`, which the token list did not know.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoModule = () => import(pathToFileURL(path.join(__dirname, '..', 'src', 'server', 'repo.mjs')).href);

function godotRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-godot-'));
  const files = {
    'world/walker.gd': 'class_name Walker\nextends Node3D\n\nsignal landed(height: float)\n\nfunc step(delta: float) -> void:\n\tpass\n',
    'world/plant.gdshader': 'shader_type spatial;\nuniform float rank_fade = 0.1;\n',
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  }
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  return repo;
}

test('find_symbols finds a GDScript class_name, signal and func', async () => {
  const { findSymbols } = await repoModule();
  const repo = godotRepo();
  const kinds = (name) => findSymbols(repo, name).matches.map((m) => `${m.relPath}:${m.line}:${m.kind}`);
  assert.deepEqual(kinds('Walker'), ['world/walker.gd:1:class_name']);
  assert.deepEqual(kinds('landed'), ['world/walker.gd:4:signal']);
  assert.deepEqual(kinds('step'), ['world/walker.gd:6:func']);
});

test('search_code reads GDScript and shaders', async () => {
  const { searchRepo } = await repoModule();
  const repo = godotRepo();
  assert.deepEqual(searchRepo(repo, { query: 'rank_fade' }).matches.map((m) => m.relPath), ['world/plant.gdshader']);
  assert.deepEqual(searchRepo(repo, { query: 'extends Node3D' }).matches.map((m) => m.relPath), ['world/walker.gd']);
});
