'use strict';

/**
 * The refactor patterns read GDScript in its own forms: snake_case `func load_and_validate`, `var x :=`, `if` /
 * `elif` chains, and one-statement private functions. Its pitfalls are pinned too: an engine callback such as
 * `_ready` and a handler named only in `connect(_on_hit)` are not single-use, and a public function is not private.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PATTERNS = path.join(__dirname, '..', 'skills', 'o-review', 'scripts', 'analyze-patterns.mjs');

const SOURCE = [
  'extends Node',
  '',
  'func _ready() -> void:',
  '\thit.connect(_on_hit)',
  '',
  'func _on_hit() -> void:',
  '\tprint("hit")',
  '',
  'func load_and_validate(path: String) -> bool:',
  '\tvar x := path.length()',
  '\tvar i := 0',
  '\tif mode == 0:',
  '\t\tx += 1',
  '\telif mode == 1:',
  '\t\tx += 2',
  '\telif mode == 2:',
  '\t\tx += 3',
  '\telif mode == 3:',
  '\t\tx += 4',
  '\treturn _clamped(x) > 0',
  '',
  'func _clamped(value: int) -> int:',
  '\treturn clampi(value, 0, 9)',
  '',
  'func public_one() -> int:',
  '\treturn 1',
  '',
  'func test_walk_and_wade_do_not_move() -> void:',
  '\tpass',
].join('\n');

test('GDScript files get GDScript patterns, and callbacks, connected handlers, public functions and test names are spared', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patterns-gd-'));
  fs.writeFileSync(path.join(dir, 'player.gd'), SOURCE);
  const run = spawnSync(process.execPath, [PATTERNS, path.join(dir, 'player.gd')], { cwd: dir, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const found = JSON.parse(run.stdout).results[0].suggestions.map((s) => `${s.pattern}:${s.symbol ?? s.variable}`).sort();
  assert.deepEqual(found, [
    'compound-verb-name:load_and_validate',
    'if-else-chain:mode',
    'single-letter:x',
    'trivial-single-call:_clamped',
  ]);
});
