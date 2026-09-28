'use strict';

/**
 * Drift is the mechanism behind "code is the truth", so what is asserted here is its honesty rather than its
 * coverage: a path that is gone is `missing`, a script `package.json` does not define is `missing`, a symbol with a
 * declaration is `declared`, and something the pass cannot decide — a command in another tool — is `uncheckable`
 * and never dressed up as drift. A prose sentence makes no claim at all, because inventing one would put noise in
 * front of the agent this exists to inform.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const { makeRepo } = require('./fixtures/repository.cjs');

const drift = () => import(pathToFileURL(path.join(ROOT, 'src', 'server', 'drift.mjs')).href);

const verdictsOf = (report) => Object.fromEntries(report.claims.map((claim) => [claim.claim, claim.verdict]));

test('a document naming a file that exists resolves, and one naming a deleted file is missing', async () => {
  const { driftFor } = await drift();
  const fixture = makeRepo();
  try {
    const live = driftFor({
      docPath: 'README.md',
      markdown: 'See `src/thing.mjs` for the function.\n',
      repoPath: fixture.repo,
    });
    assert.equal(verdictsOf(live)['src/thing.mjs'], 'resolves');

    fs.rmSync(path.join(fixture.repo, 'src', 'thing.mjs'));
    const gone = driftFor({
      docPath: 'README.md',
      markdown: 'See `src/thing.mjs` for the function.\n',
      repoPath: fixture.repo,
    });
    assert.equal(verdictsOf(gone)['src/thing.mjs'], 'missing');
    assert.match(gone.claims[0].reason, /thing\.mjs/);
  } finally {
    fixture.cleanup();
  }
});

test('a script package.json defines resolves, and one it does not is missing', async () => {
  const { driftFor } = await drift();
  const fixture = makeRepo();
  try {
    const defined = driftFor({ docPath: 'README.md', markdown: 'Run `npm run test`.\n', repoPath: fixture.repo });
    assert.equal(verdictsOf(defined)['npm run test'], 'resolves');

    const absent = driftFor({ docPath: 'README.md', markdown: 'Run `npm run build`.\n', repoPath: fixture.repo });
    assert.equal(verdictsOf(absent)['npm run build'], 'missing');
    assert.match(absent.claims[0].reason, /build/);
  } finally {
    fixture.cleanup();
  }
});

test('a symbol with a declaration is declared, and one without is missing', async () => {
  const { driftFor } = await drift();
  const fixture = makeRepo();
  try {
    const report = driftFor({
      docPath: 'README.md',
      markdown: 'The `thing` function is declared, and `nothingDeclaresThis` is not.\n',
      repoPath: fixture.repo,
    });

    const verdicts = verdictsOf(report);
    assert.equal(verdicts.thing, 'declared');
    assert.equal(verdicts.nothingDeclaresThis, 'missing');
    assert.match(report.claims.find((claim) => claim.claim === 'thing').reason, /src\/thing\.mjs/);
  } finally {
    fixture.cleanup();
  }
});

test('a command nothing here can decide is uncheckable, never missing', async () => {
  const { driftFor } = await drift();
  const fixture = makeRepo();
  try {
    const report = driftFor({ docPath: 'README.md', markdown: 'Start it with `docker compose up`.\n', repoPath: fixture.repo });

    assert.equal(verdictsOf(report)['docker compose up'], undefined, 'a command from another tool is not extracted');
    assert.ok(
      report.claims.every((claim) => claim.verdict !== 'missing'),
      'and nothing is called missing on its account',
    );
  } finally {
    fixture.cleanup();
  }
});

test('prose makes no claim at all', async () => {
  const { claimsOf } = await drift();

  const claims = claimsOf('The system retries three times before it gives up. This is deliberate.\n');

  assert.deepEqual(claims, []);
});

test('a fence with no language is an illustration and its paths are not claims', async () => {
  const { claimsOf } = await drift();

  const claims = claimsOf(['```', 'see src/invented.mjs here', '```', '', 'But `src/real.mjs` is named outside.\n'].join('\n'));

  assert.deepEqual(claims.map((claim) => claim.claim), ['src/real.mjs']);
});

test('a fence in a language this repository reads is scanned', async () => {
  const { claimsOf } = await drift();

  const claims = claimsOf(['```bash', 'node scripts/run.mjs', '```'].join('\n'));

  assert.deepEqual(claims.map((claim) => claim.kind), ['command']);
});

test('the same claim twice on a line is one claim, and a claim knows its line', async () => {
  const { claimsOf } = await drift();

  const claims = claimsOf(['', '`src/thing.mjs` and `src/thing.mjs` again, and `thing`.'].join('\n'));

  assert.equal(claims.filter((claim) => claim.claim === 'src/thing.mjs').length, 1);
  assert.equal(claims[0].line, 2);
});

test('an unterminated fence does not throw, and claims before it survive', async () => {
  const { claimsOf } = await drift();

  const claims = claimsOf(['See `src/thing.mjs`.', '```bash', 'node scripts/run.mjs'].join('\n'));

  assert.ok(claims.length >= 1);
});
