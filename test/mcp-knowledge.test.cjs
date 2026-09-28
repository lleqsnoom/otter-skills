'use strict';

/**
 * The fuzzy tools read the index and the exact tools read the files, and the difference has to survive an agent
 * reading the answer: every result carries the stamp it came from, the limit it was clamped to, and — when the
 * index cannot be built at all — a wording that sends the agent to the exact tools instead of retrying.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const { makeRepo, withRoots } = require('./fixtures/repository.cjs');

const handlerOf = async (name) => {
  const { KNOWLEDGE_TOOLS } = await import(pathToFileURL(path.join(ROOT, 'src', 'mcp', 'knowledge.mjs')).href);
  const tool = KNOWLEDGE_TOOLS.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} is registered`);
  return tool.handler;
};

const modelReady = async () =>
  (await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'embed.mjs')).href)).embedAvailable().then((a) => a.ok);

const parse = (answered) => JSON.parse(answered.text);
const refusal = (promise) => promise.then(() => null, (error) => error);

test('search_knowledge answers ranked rows with the stamp they came from', async () => {
  if (!(await modelReady())) {
    test.skip('the embedding model is not available here');
    return;
  }
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(
        await (await handlerOf('search_knowledge'))({ project: fixture.id, query: 'the fixture task about a plan' }),
      );

      assert.equal(typeof body.index.stamp, 'string');
      assert.equal(typeof body.index.rebuilt, 'boolean');
      assert.ok(body.results.length > 0, 'a built index answers something');
      const tables = new Set(body.results.map((row) => row.table));
      assert.ok(tables.size >= 2, `results come from more than one table; got ${[...tables].join(', ')}`);
      assert.deepEqual(
        body.results.map((row) => row.distance),
        body.results.map((row) => row.distance).sort((a, b) => a - b),
      );
    });
  } finally {
    fixture.cleanup();
  }
});

test('a limit above the cap is clamped, and the answer says which limit it used', async () => {
  if (!(await modelReady())) {
    test.skip('the embedding model is not available here');
    return;
  }
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('search_knowledge'))({ project: fixture.id, query: 'task', limit: 100 }));

      assert.equal(body.limit, 50);
    });
  } finally {
    fixture.cleanup();
  }
});

test('find_related answers the neighbours of a path', async () => {
  if (!(await modelReady())) {
    test.skip('the embedding model is not available here');
    return;
  }
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('find_related'))({ project: fixture.id, path: 'README.md' }));

      assert.equal(body.related.path, 'README.md');
      assert.ok(body.results.length > 0, 'a path with neighbours answers some');
      assert.ok(
        body.results.every((row) => row.relPath !== 'README.md'),
        'the path is not its own neighbour',
      );
    });
  } finally {
    fixture.cleanup();
  }
});

test('find_related refuses a path the index does not hold, naming it', async () => {
  if (!(await modelReady())) {
    test.skip('the embedding model is not available here');
    return;
  }
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const refused = await refusal(
        (await handlerOf('find_related'))({ project: fixture.id, path: 'src/nowhere.mjs' }),
      );

      assert.ok(refused, 'a path that is not indexed is refused');
      assert.match(refused.message, /src\/nowhere\.mjs/);
    });
  } finally {
    fixture.cleanup();
  }
});

test('get_project reports the index state without building one', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const { PROJECT_TOOLS } = await import(pathToFileURL(path.join(ROOT, 'src', 'mcp', 'projects.mjs')).href);
      const handler = PROJECT_TOOLS.find((tool) => tool.name === 'get_project').handler;

      const before = parse(await handler({ project: fixture.id }));
      assert.equal(before.index.present, false, 'nothing was built by asking');
    });
  } finally {
    fixture.cleanup();
  }
});
