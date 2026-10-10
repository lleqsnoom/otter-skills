'use strict';

/**
 * The floor guard in a Godot project: GDScript and shaders are code, `@warning_ignore` silences a checker, GUT's
 * `pending()` makes a test easier, and an assertion is `assert_eq` / `expect_eq` as much as `assert` -- a word
 * boundary after the head of the name missed every one. A repo names its own test files with `testFiles` globs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const GUARD = path.join(__dirname, '..', 'skills', 'o-floor', 'scripts', 'floor-guard.mjs');
const load = () => import(pathToFileURL(GUARD).href);
const rules = (findings) => findings.map((f) => `${f.rule}:${f.detail}`);

test('GDScript lines that silence, skip or stub are classified', async () => {
  const { classifyAddedLine, isScannable } = await load();
  assert.ok(isScannable('world/plant.gd') && isScannable('world/plant.gdshader') && isScannable('world/a.gdshaderinc'));
  assert.deepEqual(rules(classifyAddedLine({ file: 'a.gd', line: 1, text: '@warning_ignore("unused_parameter")' })), ['silenced-checker:gdscript-warning-ignore']);
  assert.deepEqual(rules(classifyAddedLine({ file: 'a.gd', line: 1, text: '@warning_ignore_restore("unused_parameter")' })), []);
  assert.deepEqual(rules(classifyAddedLine({ file: 'test_a.gd', line: 1, text: '\tpending("flaky on CI")' })), ['test-made-easier:gdscript-skip']);
  assert.deepEqual(rules(classifyAddedLine({ file: 'a.gd', line: 1, text: '\tpush_error("not implemented")' })), ['unfinished-work:not-implemented']);
});

test('assert_eq, expect_near and assertEqual are assertions, in a test file a repo names itself', async () => {
  const { classifyRemovedLine, isTestFile } = await load();
  const globs = ['world/probes/**/*_unit.gd'];
  assert.ok(isTestFile('world/probes/body/walker_unit.gd', globs));
  assert.ok(!isTestFile('world/probes/body/walker_unit.gd'), 'not by the common conventions alone');
  for (const text of ['\tassert_eq(a, 1)', '\texpect_near(x, 0.5, 0.01)', '\tself.assertEqual(a, 1)']) {
    assert.equal(classifyRemovedLine({ file: 'world/probes/body/walker_unit.gd', line: 3, text, testGlobs: globs }).length, 1, text);
  }
});

test('the guard reports a removed GDScript assertion and a new @warning_ignore on a branch', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-godot-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  write('.o-skills/config/floor.json', JSON.stringify({ testFiles: ['probes/**/*_unit.gd'] }));
  write('probes/walker_unit.gd', 'func test_steps():\n\texpect_eq(1, 1)\n\texpect_true(true)\n');
  write('world/walker.gd', 'func step():\n\tpass\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('switch', '-q', '-c', 'work');
  write('probes/walker_unit.gd', 'func test_steps():\n\texpect_true(true)\n');
  write('world/walker.gd', '@warning_ignore("unused_variable")\nfunc step():\n\tpass\n');
  git('commit', '-q', '-am', 'easier');

  const run = spawnSync(process.execPath, [GUARD, '--root', repo, '--base', 'main'], { cwd: repo, encoding: 'utf8' });
  const report = JSON.parse(run.stdout);
  assert.deepEqual(report.violations.map((v) => `${v.rule}:${v.file}`).sort(), [
    'assertion-removed:probes/walker_unit.gd',
    'silenced-checker:world/walker.gd',
  ]);
});
