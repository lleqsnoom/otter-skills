'use strict';

/**
 * The README is the only part of the MCP server an agent's owner reads before pointing a client at it, and a tool
 * list that drifts from the registry is worse than no list: it promises a tool that is not there, or hides one that
 * is. So the table in the README and `tools/list` are checked against each other, both ways, and the config block is
 * checked to name this package's own bin rather than an invented one.
 *
 * The pack check is here for the same reason: a server whose module is not in the tarball works from a checkout and
 * fails for everybody who installed it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const README = path.join(ROOT, 'README.md');
const GUIDE = path.join(ROOT, 'docs', 'install.md');

const registry = () =>
  import(pathToFileURL(path.join(ROOT, 'src', 'mcp', 'registry.mjs')).href).then((module) => module.TOOLS);

test('every registered tool is named in the README, and the README names no others', async () => {
  const readme = fs.readFileSync(README, 'utf8');
  const section = readme.slice(readme.indexOf('## The MCP server'), readme.indexOf('## Endpoints'));
  assert.ok(section.length > 0, 'the README has an MCP section');

  const documented = [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]).sort();
  const registered = (await registry()).map((tool) => tool.name).sort();

  assert.deepEqual(documented, registered, 'the README table and tools/list are the same set');
});

test('the README shows the config that reaches this package own bin', () => {
  const readme = fs.readFileSync(README, 'utf8');

  assert.match(readme, /"command": "otter-pm-mcp"/, 'the config names the bin this package ships');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(manifest.bin['otter-pm-mcp'], 'and package.json has that bin');
});

test('the README says where the database lives, that it is safe to delete, and what is never written', () => {
  const readme = fs.readFileSync(README, 'utf8');

  assert.match(readme, /\.x-skills\/knowledge\.lance\//, 'the database path is named');
  assert.match(readme, /deleting it costs the next fuzzy call a rebuild/, 'that it is derived is said');
  assert.match(readme, /never a repository file/, 'and that only its own database is written');
});

test('the guide explains the server too, so an install path is not left without it', () => {
  const guide = fs.readFileSync(GUIDE, 'utf8');

  assert.match(guide, /## The MCP server/, 'the guide has a section');
  assert.match(guide, /otter-pm-mcp/, 'and names the bin');
  assert.match(guide, /scripts\/mcp\.mjs/, 'and points at where it comes from, by path');
});

test('the package ships the server and keeps the tests and the brand out', () => {
  const packed = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' });
  const files = JSON.parse(packed)[0].files.map((entry) => entry.path);

  assert.ok(files.includes('scripts/mcp.mjs'), 'the bin is in the tarball');
  assert.ok(files.includes('src/mcp/server.mjs'), 'and the module it starts');
  assert.ok(files.includes('src/server/index.mjs'), 'and the readers it uses');
  assert.ok(!files.some((file) => file.startsWith('test/')), 'the tests are not shipped');
  assert.ok(!files.some((file) => file.startsWith('brand/')), 'nor the brand sources');
});
