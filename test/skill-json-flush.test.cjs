'use strict';

/**
 * A skill script that writes a JSON document and then exits on the next line loses the tail of that document.
 * `process.stdout` is asynchronous when it is a pipe — which is how every consumer reads these scripts — and
 * `process.exit` does not wait for it to drain, so the reader receives a document cut mid-string and reports the
 * analysis as failed. It happened once, in `analyze-patterns.mjs`, and hid every refactor-pattern number from every
 * review this repository produced.
 *
 * The shape is easy to write and looks harmless, so it is asserted here rather than left to a reviewer's eye. The
 * fix is never to delete the exit — those codes are contracts, `exit(pass ? 0 : 1)` is how a check reports a
 * violation — but to set `process.exitCode` and return.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'skills');

/** Every `scripts/*.mjs` under a skill, which is where the scripts that print JSON live. */
function skillScripts(dir = SKILLS, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) skillScripts(full, found);
    else if (entry.name.endsWith('.mjs') && path.basename(path.dirname(full)) === 'scripts') found.push(full);
  }
  return found;
}

/** The lines where a JSON document is written and an exit follows before anything else could intervene. */
function exitsAfterJson(source) {
  const lines = source.split('\n');
  const offenders = [];

  lines.forEach((line, index) => {
    if (!line.includes('console.log(') || !line.includes('JSON.stringify')) return;

    for (let ahead = 1; ahead <= 4 && index + ahead < lines.length; ahead += 1) {
      const next = lines[index + ahead];
      if (/process\.exit\(/.test(next)) {
        offenders.push({ writes: index + 1, exits: index + ahead + 1, exit: next.trim() });
        return;
      }
      if (next.trim() === '' || next.trim().startsWith('//') || next.trim().startsWith('*')) continue;
      // Anything else between the write and the exit is doing work of its own; not this shape.
      return;
    }
  });

  return offenders;
}

test('no skill script exits on the document it just wrote', () => {
  const scripts = skillScripts();
  assert.ok(scripts.length > 0, 'the skills were found to check');

  const offenders = scripts.flatMap((script) =>
    exitsAfterJson(fs.readFileSync(script, 'utf8')).map((hit) => ({
      script: path.relative(ROOT, script),
      ...hit,
    })),
  );

  assert.deepEqual(
    offenders,
    [],
    offenders
      .map(
        (hit) =>
          `${hit.script}: writes JSON at :${hit.writes} then exits at :${hit.exits} (${hit.exit}) — ` +
          'set process.exitCode and return instead, or the reader gets a truncated document',
      )
      .join('\n'),
  );
});

test('the detector recognizes the shape it is meant to catch', () => {
  const source = ['console.log(JSON.stringify(result, null, 2));', 'process.exit(result.ok ? 0 : 1);'].join('\n');

  assert.equal(exitsAfterJson(source).length, 1, 'a write followed by an exit is found');

  const safe = ['console.log(JSON.stringify(result, null, 2));', 'process.exitCode = 0;', 'return;'].join('\n');
  assert.equal(exitsAfterJson(safe).length, 0, 'setting the code and returning is not the shape');

  const separated = ['console.log(JSON.stringify(result, null, 2));', 'await flush();', 'process.exit(0);'].join('\n');
  assert.equal(exitsAfterJson(separated).length, 0, 'work between the write and the exit is not this shape');
});
