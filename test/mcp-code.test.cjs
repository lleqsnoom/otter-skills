'use strict';

/**
 * The code tools are the authoritative half: they read the files, so what they answer is what the repository says
 * rather than a copy of it. Three properties are asserted, because all three are easy to lose: a match carries the
 * line it is on, a read is bounded by the repository and by a line cap, and a search that was cut short says so
 * instead of returning an empty-looking result that reads as "this is not in the code".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const { makeRepo, withRoots } = require('./helpers/mcp-fixture.cjs');

const handlerOf = async (name) => {
  const { CODE_TOOLS } = await import(pathToFileURL(path.join(ROOT, 'src', 'mcp', 'tools', 'code.mjs')).href);
  const tool = CODE_TOOLS.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} is registered`);
  return tool.handler;
};

const parse = (answered) => JSON.parse(answered.text);
const refusal = (promise) => promise.then(() => null, (error) => error);

test('search_code finds a literal and says which line it is on', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('search_code'))({ project: fixture.id, query: 'needle' }));

      assert.equal(body.matches.length, 1);
      assert.equal(body.matches[0].relPath, 'src/thing.mjs');
      assert.equal(body.matches[0].line, 2);
      assert.match(body.matches[0].text, /needle/);
      assert.equal(body.capped, false);
      assert.equal(body.mode, 'tracked');
    });
  } finally {
    fixture.cleanup();
  }
});

test('search_code treats the query as a regular expression when asked', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(
        await (await handlerOf('search_code'))({ project: fixture.id, query: '^export function', regex: true }),
      );

      assert.equal(body.matches.length, 1);
      assert.equal(body.matches[0].line, 1);
    });
  } finally {
    fixture.cleanup();
  }
});

test('a pattern that is not a regular expression is refused by name', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const refused = await refusal(
        (await handlerOf('search_code'))({ project: fixture.id, query: '([', regex: true }),
      );

      assert.ok(refused, 'a bad pattern is refused');
      assert.match(refused.message, /\(\[/);
    });
  } finally {
    fixture.cleanup();
  }
});

test('read_code answers a line range with numbers', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(
        await (await handlerOf('read_code'))({ project: fixture.id, path: 'src/thing.mjs', start: 1, end: 3 }),
      );

      assert.equal(body.relPath, 'src/thing.mjs');
      assert.deepEqual(
        body.lines.map((line) => line.n),
        [1, 2, 3],
      );
      assert.match(body.lines[0].text, /export function thing/);
    });
  } finally {
    fixture.cleanup();
  }
});

test('read_code refuses a path outside the repository and a file that is not text', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const escaped = await refusal(
        (await handlerOf('read_code'))({ project: fixture.id, path: '../outside.mjs' }),
      );
      assert.match(escaped.message, /escapes the repository/);

      const binary = await refusal((await handlerOf('read_code'))({ project: fixture.id, path: 'src/logo.png' }));
      assert.match(binary.message, /not a text file/);

      const missing = await refusal((await handlerOf('read_code'))({ project: fixture.id, path: 'src/gone.mjs' }));
      assert.match(missing.message, /no such file/);
    });
  } finally {
    fixture.cleanup();
  }
});

test('find_symbols finds a declaration and labels itself heuristic', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('find_symbols'))({ project: fixture.id, name: 'thing' }));

      assert.equal(body.heuristic, true);
      assert.equal(body.matches.length, 1);
      assert.equal(body.matches[0].relPath, 'src/thing.mjs');
      assert.equal(body.matches[0].kind, 'export');
    });
  } finally {
    fixture.cleanup();
  }
});

test('a repository that is not a checkout is searched by walking, and the answer says so', async () => {
  const fixture = makeRepo({ name: 'plain-folder', git: false });
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('search_code'))({ project: fixture.id, query: 'needle' }));

      assert.equal(body.mode, 'walk');
      assert.equal(body.matches.length, 1);
    });
  } finally {
    fixture.cleanup();
  }
});

test('a search that finds nothing is not capped, and says the walk was complete', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('search_code'))({ project: fixture.id, query: 'nothing_matches_this' }));

      assert.deepEqual(body.matches, []);
      assert.equal(body.capped, false);
      assert.ok(body.inspected > 0, 'the walk inspected files before concluding nothing matched');
    });
  } finally {
    fixture.cleanup();
  }
});
