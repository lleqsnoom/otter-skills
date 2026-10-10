'use strict';

/**
 * The duplication check compares a file's lines with its comments stripped. Stripping by regex took `//` inside a
 * string for a comment — every `preload("res://…")` became `preload("res:` and two different loads compared equal —
 * read `#` only at a line's start, and reported each duplicate at its index among the surviving lines rather than
 * its line in the file.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'skills', 'o-review', 'scripts');

function duplicates(name, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duplication-'));
  fs.writeFileSync(path.join(dir, name), text);
  const run = spawnSync(process.execPath, [path.join(SCRIPTS, 'check-duplication.mjs'), path.join(dir, name)], { cwd: dir, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('two blocks that differ only after a res:// path are not duplicates', () => {
  const loads = (folder) => Array.from({ length: 6 }, (_, n) => `const K${n} := preload("res://${folder}/kind_${n}.gd")`).join('\n');
  assert.equal(duplicates('kinds.gd', `${loads('plants')}\n\n${loads('rocks')}\n`).duplicatedBlocks, 0);
});

test('an indented GDScript comment is a comment, and a real duplicate is reported at its line in the file', () => {
  const body = ['\tvar a := 1', '\tvar b := 2', '\tvar c := a + b', '\tprint(c)', '\treturn c'];
  const text = [
    'func first():',
    '\t# a comment the first copy has',
    ...body,
    '',
    '## A doc comment between the two.',
    '## It runs over two lines.',
    'func second():',
    ...body,
  ].join('\n');
  const report = duplicates('twins.gd', text);
  assert.equal(report.duplicatedBlocks, 1, JSON.stringify(report.duplicates));
  assert.deepEqual(report.duplicates[0].occurrences, [3, 12], 'the lines the copies start on in the file');
});

test('a URL in a JavaScript string is not cut at its slashes', async () => {
  const { stripComments } = await import(path.join(SCRIPTS, 'text-normalization.mjs'));
  assert.equal(stripComments('fetch("https://a.example/x"); // call it', '.js'), 'fetch("https://a.example/x"); ');
  assert.equal(stripComments('x = "#not a comment"  # but this is', '.py'), 'x = "#not a comment"  ');
  assert.equal(stripComments('a /* gone */ b', '.gdshader'), 'a  b');
});
