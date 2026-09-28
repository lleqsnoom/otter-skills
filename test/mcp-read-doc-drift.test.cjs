'use strict';

/**
 * `read_doc` is where "code is the truth" reaches an agent, and it is deliberately unconditional: there is no flag
 * that returns the text alone, because an option to skip the check is the hole this feature exists to close. So
 * what is asserted is that the report is always there, that it describes the text that was returned, and that
 * reading the same document twice leaves one set of rows rather than two.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const { makeRepo, withRoots } = require('./helpers/mcp-fixture.cjs');

const handlerOf = async (name) => {
  const { WORK_TOOLS } = await import(pathToFileURL(path.join(ROOT, 'src', 'mcp', 'tools', 'work.mjs')).href);
  return WORK_TOOLS.find((candidate) => candidate.name === name).handler;
};

const parse = (answered) => JSON.parse(answered.text);

/** The drift rows the project's own database holds for one document. */
async function driftRows(fixture, docPath) {
  const { databasePath } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'index.mjs')).href);
  const lancedb = await import('@lancedb/lancedb');
  const db = await lancedb.connect(databasePath(fixture.root));
  if (!(await db.tableNames()).includes('drift')) return [];
  const table = await db.openTable('drift');
  return (await table.query().toArray()).filter((row) => row.docPath === docPath);
}

test('read_doc always carries a drift report, even when there is nothing to report', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('read_doc'))({ project: fixture.id, path: 'README.md' }));

      assert.ok(body.drift, 'the report is present');
      assert.equal(body.drift.checked, 'tracked');
      assert.ok(Array.isArray(body.drift.claims));
      assert.equal(typeof body.drift.persisted, 'boolean');
      assert.match(body.text, /Fixture/, 'the document text still comes back');
    });
  } finally {
    fixture.cleanup();
  }
});

test('a document naming a deleted path reports it missing, and its text still comes back', async () => {
  const fixture = makeRepo();
  try {
    fixture.write('README.md', '# Fixture\n\nSee `src/thing.mjs` and `src/gone.mjs`.\n');
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('read_doc'))({ project: fixture.id, path: 'README.md' }));
      const verdicts = Object.fromEntries(body.drift.claims.map((claim) => [claim.claim, claim.verdict]));

      assert.equal(verdicts['src/thing.mjs'], 'resolves');
      assert.equal(verdicts['src/gone.mjs'], 'missing');
      assert.match(body.text, /src\/gone\.mjs/, 'the document is returned in full, wrong claims and all');
    });
  } finally {
    fixture.cleanup();
  }
});

test('the same document read twice leaves one set of drift rows', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const handler = await handlerOf('read_doc');
      await handler({ project: fixture.id, path: 'README.md' });
      const first = await driftRows(fixture, 'README.md');
      await handler({ project: fixture.id, path: 'README.md' });
      const second = await driftRows(fixture, 'README.md');

      assert.ok(first.length > 0, 'the first read persisted its claims');
      assert.equal(second.length, first.length, 'the second read replaced them rather than adding to them');
    });
  } finally {
    fixture.cleanup();
  }
});

test('a document whose only claims are prose reports none, and nothing missing', async () => {
  const fixture = makeRepo();
  try {
    fixture.write('docs/notes.md', '# Notes\n\nIt retries three times before giving up.\n');
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('read_doc'))({ project: fixture.id, path: 'docs/notes.md' }));

      assert.deepEqual(body.drift.claims, []);
      assert.ok(!JSON.stringify(body.drift).includes('missing'));
    });
  } finally {
    fixture.cleanup();
  }
});

test('a document inside the tree is read the same way', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('read_doc'))({ project: fixture.id, path: '.x-skills/docs/roadmap.md' }));

      assert.match(body.text, /Roadmap/);
      assert.ok(body.drift, 'the tree documents carry a report too');
    });
  } finally {
    fixture.cleanup();
  }
});

test('a document the drift pass cannot persist still comes back with its report', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      // A read-only database directory is the one failure that must not cost the answer.
      const database = path.join(fixture.root, 'knowledge.lance');
      fs.mkdirSync(database, { recursive: true });
      fs.chmodSync(database, 0o500);
      try {
        const body = parse(await (await handlerOf('read_doc'))({ project: fixture.id, path: 'README.md' }));

        assert.ok(body.drift.claims !== undefined, 'the report is computed whether or not it could be stored');
        assert.match(body.text, /Fixture/);
      } finally {
        fs.chmodSync(database, 0o700);
      }
    });
  } finally {
    fixture.cleanup();
  }
});
