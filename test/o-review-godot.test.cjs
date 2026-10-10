'use strict';

/**
 * Godot's two languages, GDScript and the Godot shading language, are measured by godot-extractors.mjs: neither has
 * a tree-sitter grammar that ships WebAssembly, and before it every `.gd` file was "No source files found". These
 * pin what a function is, where it ends, how many parameters it takes and what counts as a decision.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'skills', 'o-review', 'scripts');
const extractors = () => import(path.join(SCRIPTS, 'godot-extractors.mjs'));

const GDSCRIPT = [
  'extends Node3D',
  '',
  '## Says if and or for in a doc comment, which is not code.',
  'func place(rings: Array, centre := Vector3(1, 2, 3),',
  '\t\tdelay := 0) -> void:',
  '\tvar path := "res://a/b.gd if and or"',
  '\tif rings.is_empty() and delay > 0:',
  '\t\treturn',
  '\telif delay < 0 or centre.x > 1:',
  '\t\tpass',
  '\tfor ring in rings:',
  '\t\twhile ring.busy():',
  '\t\t\tring.step()',
  '\tvar side := 1 if delay else 2',
  '\tmatch delay:',
  '\t\t0:',
  '\t\t\tpass',
  '\t\t1, 2:',
  '\t\t\tpass',
  '\t\t_:',
  '\t\t\tpass',
  '\tvar sorter := func(a, b):',
  '\t\tif a < b:',
  '\t\t\treturn true',
  '\t\treturn false',
  '\t# a trailing comment with if inside',
  '',
  'func one() -> int: return 1',
  '',
  '@warning_ignore("unused_parameter")',
  'static func make(kind: int) -> Node:',
  '\treturn null',
  '',
  'class Chunk:',
  '\tvar due := 0.0',
  '\tfunc reset() -> void:',
  '\t\tif due > 0.0:',
  '\t\t\tdue = 0.0',
].join('\n');

test('a GDScript function runs from its header to its last deeper-indented line', async () => {
  const { extractFunctionsGDScript } = await extractors();
  const byName = Object.fromEntries(extractFunctionsGDScript(GDSCRIPT).map((fn) => [fn.name, fn]));

  assert.deepEqual(Object.keys(byName).sort(), ['make', 'one', 'place', 'reset'], 'a lambda is part of its function, not one of its own');
  assert.equal(byName.place.startLine, 4);
  assert.equal(byName.place.endLine, 25, 'the trailing comment and blank line are not the body');
  assert.equal(byName.one.length, 1, 'a body on the header line ends there');
  assert.equal(byName.make.startLine, 31, 'an annotation on the line before is not the header');
  assert.equal(byName.reset.startLine, 36, 'an inner class method is a function of its own');
});

test('GDScript parameters are counted at the top level of the parentheses, over several lines', async () => {
  const { extractFunctionsGDScript } = await extractors();
  const place = extractFunctionsGDScript(GDSCRIPT).find((fn) => fn.name === 'place');
  assert.deepEqual(place.params, ['rings', 'centre', 'delay']);
  assert.equal(place.paramCount, 3, 'Vector3(1, 2, 3) is one default, not three parameters');
});

test('GDScript decisions are code only: if, elif, for, while, and, or, ternaries and match arms', async () => {
  const { extractFunctionsGDScript } = await extractors();
  const place = extractFunctionsGDScript(GDSCRIPT).find((fn) => fn.name === 'place');
  // if + and, elif + or, for, while, the ternary's if, two match arms (not the _ wildcard), the lambda's if.
  assert.equal(place.complexity, 1 + 2 + 2 + 1 + 1 + 1 + 2 + 1);
  const reset = extractFunctionsGDScript(GDSCRIPT).find((fn) => fn.name === 'reset');
  assert.equal(reset.complexity, 2);
});

test('a string or comment holding a keyword or res:// is blanked, line for line', async () => {
  const { gdscriptCodeLines } = await extractors();
  const lines = gdscriptCodeLines('var a := "res://x if" # or\nvar b := """if\nand""" + c');
  assert.equal(lines.length, 3, 'line numbers survive');
  assert.ok(!/\b(?:if|or|and)\b/.test(lines.join('\n')), `no keyword survives: ${JSON.stringify(lines)}`);
  assert.match(lines[2], /\+ c/, 'code after a closing triple quote is kept');
});

const SHADER = [
  'shader_type spatial;',
  'uniform float rank_fade = 0.1;',
  '#ifdef USE_FADE',
  'float fade(float rank, float share);',
  '#endif',
  '// if a comment says for, it is not a loop',
  'float fade(float rank, float share) {',
  '\treturn rank < share ? 1.0 : 0.0;',
  '}',
  '',
  'void vertex() {',
  '\tif (VERTEX.y > 0.0 && rank_fade > 0.0) {',
  '\t\tfor (int i = 0; i < 4; i++) {',
  '\t\t\tVERTEX.x += 0.1;',
  '\t\t}',
  '\t}',
  '}',
].join('\n');

test('a shader function runs from its header to its closing brace, prototypes and directives skipped', async () => {
  const { extractFunctionsShader } = await extractors();
  const fns = extractFunctionsShader(SHADER);
  assert.deepEqual(fns.map((fn) => [fn.name, fn.startLine, fn.endLine]), [['fade', 7, 9], ['vertex', 11, 17]]);
  assert.deepEqual(fns[0].params, ['rank', 'share']);
  assert.equal(fns[0].complexity, 2, 'the ternary');
  assert.equal(fns[1].complexity, 4, 'if, &&, for — and not the comment');
  assert.equal(fns[1].paramCount, 0);
});

function tempTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-review-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

function analyze(dir, args) {
  const run = spawnSync(process.execPath, [path.join(SCRIPTS, 'analyze-complexity.mjs'), ...args], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('the analyzer finds a Godot project\'s scripts and shaders, names its engine, and skips the .godot cache', () => {
  const dir = tempTree({
    'world/plant.gd': GDSCRIPT,
    'world/plant.gdshader': SHADER,
    '.godot/editor/cache.gd': 'func cached():\n\tpass\n',
  });
  // The project root, as a walk meets it: the cache is a directory inside it, not one the caller named.
  const report = analyze(dir, [dir]);
  const file = (tail) => report.files.find((entry) => entry.file.endsWith(path.join('world', tail)));
  assert.equal(file('plant.gd').engine, 'gdscript (indentation-based)');
  assert.equal(file('plant.gd').functionCount, 4);
  assert.equal(file('plant.gdshader').engine, 'godot shader (brace-based)');
  assert.equal(report.summary.language, 'gdscript (indentation-based) + godot shader (brace-based)');
  assert.ok(!report.files.some((entry) => entry.file.includes('.godot')), 'the editor cache is not source');
});

test('a language whose grammar is not installed is measured by the regex fallback, not reported empty', () => {
  // PHP is discovered and mapped to a grammar; with tree-sitter running and that grammar missing, the file used to
  // come back with no functions at all. Installed or not, it must come back measured.
  const dir = tempTree({ 'area.php': '<?php\nfunction area($w, $h) {\n  if ($w > 0) { return $w * $h; }\n  return 0;\n}\n' });
  const report = analyze(dir, [path.join(dir, 'area.php')]);
  assert.equal(report.files.length, 1, JSON.stringify(report.summary));
  assert.ok(report.files[0].functionCount >= 1, 'its function is found');
});
