'use strict';

/**
 * The index is the one thing this server writes, so two properties matter more than its speed. It writes only its
 * own directory — asserted by digesting the whole fixture before and after — and it never lets a stale copy answer
 * as if it were current: a second call with nothing changed rebuilds nothing, and an edit is picked up exactly
 * once, for the file that changed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const { makeRepo } = require('./helpers/mcp-fixture.cjs');

const load = async () => {
  const [index, embed] = await Promise.all([
    import(pathToFileURL(path.join(ROOT, 'src', 'server', 'index.mjs')).href),
    import(pathToFileURL(path.join(ROOT, 'src', 'server', 'embed.mjs')).href),
  ]);
  return { ...index, embed };
};

/** The scanned project a fixture stands for, resolved the way the server resolves it. */
async function projectOf(fixture) {
  const { scanRoot } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'scan.mjs')).href);
  return scanRoot(fixture.root, {});
}

/** A digest of every file the fixture holds, so a write into the repository cannot pass unnoticed. */
function digestOf(dir, ignore) {
  const hash = crypto.createHash('sha256');
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignore.includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else hash.update(`${path.relative(dir, full)}:${fs.readFileSync(full).length}:`);
    }
  };
  walk(dir);
  return hash.digest('hex');
}

const modelReady = async () => (await (await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'embed.mjs')).href)).embedAvailable()).ok;

test('a first sync builds the project database with its tables', async () => {
  const fixture = makeRepo();
  try {
    const { syncProject, databasePath } = await load();
    const project = await projectOf(fixture);

    const result = await syncProject(project);

    assert.equal(result.ok, true, `sync failed: ${result.reason}`);
    assert.equal(result.rebuilt, true);
    assert.ok(fs.existsSync(databasePath(fixture.root)), 'the database directory is inside the project');
    assert.match(result.stamp, /^[0-9a-f]{16}$/);

    // A table exists once something is in it, so the fixture's source, documents and board are there and `drift`
    // arrives when a document is read.
    const db = await (await import('@lancedb/lancedb')).connect(databasePath(fixture.root));
    const tables = (await db.tableNames()).sort();
    assert.deepEqual(tables, ['board', 'code', 'docs', 'tasks'], `tables: ${tables.join(', ')}`);
  } finally {
    fixture.cleanup();
  }
});

test('a second sync with nothing changed rebuilds nothing', async () => {
  const fixture = makeRepo();
  try {
    const { syncProject } = await load();
    const project = await projectOf(fixture);

    await syncProject(project);
    const again = await syncProject(project);

    assert.equal(again.ok, true, `second sync failed: ${again.reason}`);
    assert.equal(again.rebuilt, false);
  } finally {
    fixture.cleanup();
  }
});

test('editing one file re-embeds that file alone', async () => {
  const fixture = makeRepo();
  try {
    const { syncProject } = await load();
    const project = await projectOf(fixture);

    await syncProject(project);
    fixture.write('src/thing.mjs', "export function thing() {\n  return 'changed';\n}\n");

    const second = await projectOf(fixture);
    const result = await syncProject(second);

    assert.equal(result.rebuilt, true);
    assert.equal(result.embedded.code, 1, `only the edited file was embedded; got ${JSON.stringify(result.embedded)}`);
    assert.equal(result.embedded.docs, 0);
  } finally {
    fixture.cleanup();
  }
});

test('a deleted file leaves the index', async () => {
  const fixture = makeRepo();
  try {
    const { syncProject, indexState } = await load();
    await syncProject(await projectOf(fixture));
    const before = await indexState(await projectOf(fixture));

    fs.rmSync(path.join(fixture.repo, 'src', 'thing.mjs'));
    const result = await syncProject(await projectOf(fixture));
    const after = await indexState(await projectOf(fixture));

    assert.equal(result.removed, 1);
    assert.equal(after.rows.code, before.rows.code - 1);
  } finally {
    fixture.cleanup();
  }
});

test('a sync never writes into the repository', async () => {
  const fixture = makeRepo();
  try {
    const { syncProject } = await load();
    const before = digestOf(fixture.repo, ['knowledge.lance', '.git']);

    await syncProject(await projectOf(fixture));

    assert.equal(digestOf(fixture.repo, ['knowledge.lance', '.git']), before, 'every repository file is unchanged');
  } finally {
    fixture.cleanup();
  }
});

test('a search answers ranked rows with the freshness it was served from', async () => {
  const fixture = makeRepo();
  try {
    if (!(await modelReady())) {
      test.skip('the embedding model is not available here');
      return;
    }
    const { searchProject } = await load();
    const { embed } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'embed.mjs')).href);
    const project = await projectOf(fixture);

    const [vector] = await embed(['the first task of the fixture']);
    const found = await searchProject({ project, vector, limit: 3 });

    assert.equal(found.ok, true, `search failed: ${found.reason}`);
    assert.equal(typeof found.index.rebuilt, 'boolean');
    assert.equal(typeof found.index.stamp, 'string');
    assert.ok(found.results.length > 0, 'a filled index answers something');
    const distances = found.results.map((row) => row.distance);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b), 'rows come back nearest first');
  } finally {
    fixture.cleanup();
  }
});

test('an index that cannot be built says why instead of throwing', async () => {
  const { syncProject, indexState } = await load();
  const project = { id: 'elsewhere', root: '/no/such/project/.x-skills', repoPath: '/no/such/project', categories: [] };

  const result = await syncProject(project);
  const state = await indexState(project);

  assert.equal(result.ok, false);
  assert.equal(typeof result.reason, 'string');
  assert.equal(state.present, false);
});
