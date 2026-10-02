'use strict';

/**
 * `list_projects` and `get_project` are how an agent finds out what it may ask about, so they answer from the same
 * resolution the board uses — `resolveRoots` over the config, `$OTTER_SKILLS_ROOTS`, discovery and the Orca list. The
 * point of asserting it here is that the board and the server cannot disagree about which repositories exist: one
 * resolver, one answer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const { makeRepo, withRoots } = require('./fixtures/repository.cjs');

const projects = () => import(pathToFileURL(path.join(ROOT, 'src', 'mcp', 'projects.mjs')).href);

const handlerOf = async (name) => {
  const { PROJECT_TOOLS } = await projects();
  const tool = PROJECT_TOOLS.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} is registered`);
  return tool.handler;
};

const parse = (answered) => JSON.parse(answered.text);

test('list_projects answers with the root it was pointed at', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const answered = await (await handlerOf('list_projects'))({});
      const body = parse(answered);

      assert.equal(body.projects.length, 1);
      const [project] = body.projects;
      assert.equal(project.id, fixture.id);
      assert.equal(project.repoPath, fixture.repo);
      assert.equal(project.root, fixture.root);
      assert.equal(project.name, fixture.name);
      assert.equal(typeof project.totals.items, 'number');
    });
  } finally {
    fixture.cleanup();
  }
});

test('get_project answers one project with the paths a reader needs', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const answered = await (await handlerOf('get_project'))({ project: fixture.id });
      const body = parse(answered);

      assert.equal(body.id, fixture.id);
      assert.equal(body.root, fixture.root);
      assert.equal(body.repoPath, fixture.repo);
      assert.equal(body.boardFile, path.join(fixture.root, 'board.json'));
      assert.equal(typeof body.totals.items, 'number');
    });
  } finally {
    fixture.cleanup();
  }
});

test('a project id that is not read is refused with the ids that are', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const refused = await (await handlerOf('get_project'))({ project: 'nope' }).then(
        () => null,
        (error) => error,
      );

      assert.ok(refused, 'an unknown id is refused');
      assert.match(refused.message, /nope/);
      assert.match(refused.message, new RegExp(fixture.id), 'the refusal lists the ids that would work');
    });
  } finally {
    fixture.cleanup();
  }
});

test('a path that is not a root is reported as rejected, and the roots that exist are still answered', async () => {
  const fixture = makeRepo();
  const missing = path.join(fixture.parent, 'not-a-repository');
  try {
    await withRoots([fixture.repo, missing], async () => {
      const answered = await (await handlerOf('list_projects'))({});
      const body = parse(answered);

      assert.deepEqual(body.rejected, [missing]);
      assert.equal(body.projects.length, 1);
    });
  } finally {
    fixture.cleanup();
  }
});

test('a folder with no .o-skills is not a root', async () => {
  const fixture = makeRepo();
  const bare = path.join(fixture.parent, 'bare-folder');
  const fs = require('node:fs');
  try {
    fs.mkdirSync(bare, { recursive: true });
    await withRoots([fixture.repo, bare], async () => {
      const answered = await (await handlerOf('list_projects'))({});
      const body = parse(answered);

      assert.deepEqual(body.rejected, [bare]);
      assert.equal(body.projects.length, 1);
    });
  } finally {
    fixture.cleanup();
  }
});

test('list_projects reports the other root sources too', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('list_projects'))({}));

      assert.deepEqual(body.skipped, []);
      assert.equal(body.orca.enabled, false, 'the IDE list is off in this run, and the answer says so');
    });
  } finally {
    fixture.cleanup();
  }
});
