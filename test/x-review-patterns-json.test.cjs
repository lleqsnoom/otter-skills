'use strict';

/**
 * `save-plan.mjs` reads each analyzer by capturing its stdout and parsing it as JSON, so the analyzers' one job is
 * to emit a whole document. That contract is easy to break and easy to miss: `console.log` to a pipe is
 * asynchronous, and a `process.exit` on the line after it discards whatever had not drained, so a consumer gets a
 * document cut mid-string and reports the analysis as failed.
 *
 * This runs the analyzer exactly the way its consumer does — stdout is a pipe, not a file — because writing to a
 * file is synchronous and would hide the bug the test exists for.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PATTERNS = path.join(ROOT, 'skills', 'x-review', 'scripts', 'analyze-patterns.mjs');

/** The pipe buffer both `spawnSync` and `execSync` drain through, in bytes. */
const PIPE_BUFFER = 64 * 1024;

test('the pattern analyzer emits one whole JSON document through a pipe', () => {
  const run = spawnSync(process.execPath, [PATTERNS, '--all'], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });

  assert.equal(run.status, 0, `the analyzer exited ${run.status}: ${run.stderr}`);

  const document = run.stdout;
  assert.ok(document.length > 0, 'it wrote something');

  // A document smaller than the pipe buffer cannot show the truncation this test is for, so a run that produced
  // one is not evidence of anything and is reported as such rather than passing quietly.
  assert.ok(
    document.length > PIPE_BUFFER,
    `the document is only ${document.length} bytes, which fits the pipe buffer — this run cannot prove the flush`,
  );

  let parsed;
  assert.doesNotThrow(() => {
    parsed = JSON.parse(document);
  }, 'the captured document parses as JSON: a cut tail would raise "Unterminated string in JSON" here');

  assert.ok(Array.isArray(parsed.results), 'it answers with a results array');
  assert.ok(parsed.totalFiles > 0, 'and says how many files it read');
  assert.equal(document.trimEnd().slice(-1), '}', 'the document ends where a whole document ends');
});

test('an analyzer that finds nothing still answers with a whole document', () => {
  const empty = path.join(ROOT, 'test', 'fixtures');
  const run = spawnSync(process.execPath, [PATTERNS, empty], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });

  assert.equal(run.status, 0, `the analyzer exited ${run.status}: ${run.stderr}`);
  const parsed = JSON.parse(run.stdout);
  assert.ok(Array.isArray(parsed.results));
});
