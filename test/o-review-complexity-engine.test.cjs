'use strict';

/**
 * The complexity analyzer says which engine measured the files (`summary.language`) and warns when it fell back
 * to the regex one. The two must agree: it warned "tree-sitter not available" on every run that held a file outside
 * JS/TS, while the same run's report said "tree-sitter (AST-based)" — a reader trusting the warning threw away a
 * real AST measurement.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ANALYZER = path.join(ROOT, 'skills', 'o-review', 'scripts', 'analyze-complexity.mjs');

test('the fallback warning appears exactly when the report says the regex fallback ran', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'complexity-engine-'));
  const file = path.join(dir, 'sample.py');
  fs.writeFileSync(file, 'def area(width, height):\n    if width > 0:\n        return width * height\n    return 0\n');

  const run = spawnSync(process.execPath, [ANALYZER, file], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, run.stderr);
  const engine = JSON.parse(run.stdout).summary.language;
  const warned = /tree-sitter not available/.test(run.stderr);

  if (engine === 'regex fallback') assert.ok(warned, 'a regex-fallback run says so on stderr');
  else assert.ok(!warned, `an ${engine} run must not claim tree-sitter is unavailable: ${run.stderr}`);
});
