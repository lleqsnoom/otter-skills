'use strict';

/**
 * The work tree and its documents are what an agent is usually asked about, and the two facts that are easy to get
 * wrong are asserted here: a lane and an archived flag are the *reader's* decisions, read from the project's own
 * board file rather than invented from the task's status; and every path these tools answer with is repository
 * relative, so the path an agent was handed is the path it may pass back.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const { makeRepo, withRoots } = require('./fixtures/repository.cjs');

const handlerOf = async (name) => {
  const { WORK_TOOLS } = await import(pathToFileURL(path.join(ROOT, 'src', 'mcp', 'work.mjs')).href);
  const tool = WORK_TOOLS.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} is registered`);
  return tool.handler;
};

const parse = (answered) => JSON.parse(answered.text);

/**
 * The project's own board file, written the way the board writes it: bare `.o-skills`-relative paths, because a
 * decision belongs to the repository it is about and the project id is added when the board is read.
 */
function writeBoard(fixture, moves = {}, deleted = {}) {
  const body = {
    moves: Object.fromEntries(
      Object.entries(moves).map(([relPath, column]) => [relPath, { column, at: '2026-01-01T00:00:00.000Z' }]),
    ),
    orders: {},
    deleted: Object.fromEntries(
      Object.entries(deleted).map(([relPath, flag]) => [relPath, flag ? { at: '2026-01-01T00:00:00.000Z' } : null]),
    ),
  };
  fs.writeFileSync(path.join(fixture.root, 'board.json'), `${JSON.stringify(body, null, 2)}\n`);
}

const firstTaskPath = '.o-skills/tasks/2026-01-01-1000-R01-first.md';

test('list_tasks answers with the task, its state and its progress', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('list_tasks'))({ project: fixture.id }));

      assert.equal(body.count, 1);
      const [task] = body.tasks;
      assert.equal(task.path, firstTaskPath);
      assert.equal(task.title, 'First task');
      assert.equal(task.progress.done, 1);
      assert.equal(task.progress.total, 2);
      assert.equal(task.status, 'active', 'one of two boxes ticked is work in progress');
      assert.equal(task.archived, false);
    });
  } finally {
    fixture.cleanup();
  }
});

test('a lane and an archived flag are the reader decisions, read from the project board file', async () => {
  const fixture = makeRepo();
  try {
    writeBoard(fixture, { 'tasks/2026-01-01-1000-R01-first.md': 'closed' }, { 'tasks/2026-01-01-1000-R01-first.md': true });
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('list_tasks'))({ project: fixture.id }));
      const [task] = body.tasks;

      assert.equal(task.lane, 'closed', 'the lane the reader left it in beats the one its status implies');
      assert.equal(task.archived, true);
    });
  } finally {
    fixture.cleanup();
  }
});

test('list_tasks filters by state', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const done = parse(await (await handlerOf('list_tasks'))({ project: fixture.id, state: 'done' }));
      const active = parse(await (await handlerOf('list_tasks'))({ project: fixture.id, state: 'active' }));

      assert.equal(done.count, 0);
      assert.equal(active.count, 1);
    });
  } finally {
    fixture.cleanup();
  }
});

test('get_task answers the full text and the parsed fields, and refuses a path that is not a task', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('get_task'))({ project: fixture.id, path: firstTaskPath }));

      assert.match(body.text, /First task/);
      assert.equal(body.fields.effort, '1h');
      assert.equal(body.path, firstTaskPath);

      const refused = await (await handlerOf('get_task'))({ project: fixture.id, path: 'README.md' }).then(
        () => null,
        (error) => error,
      );
      assert.ok(refused, 'a path that is not a task is refused');
      assert.match(refused.message, /no such task/);
    });
  } finally {
    fixture.cleanup();
  }
});

test('list_epics answers the plan with the tasks under it', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('list_epics'))({ project: fixture.id }));

      assert.equal(body.epics.length, 1);
      assert.equal(body.epics[0].path, '.o-skills/plan/E00-plan.md');
      assert.match(body.epics[0].title, /fixture/i);
    });
  } finally {
    fixture.cleanup();
  }
});

test('list_docs answers the README and the tree documents, each at one repository path', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('list_docs'))({ project: fixture.id }));
      const paths = body.documents.map((document) => document.relPath);

      assert.ok(paths.includes('README.md'), `README is listed; saw ${paths.join(', ')}`);
      assert.ok(paths.includes('.o-skills/docs/roadmap.md'), `the tree's own document is listed; saw ${paths.join(', ')}`);
      assert.equal(new Set(paths).size, paths.length, 'a document appears once');
      assert.equal(body.mode, 'tracked');
    });
  } finally {
    fixture.cleanup();
  }
});

test('read_doc answers a document text, and refuses a path outside the repository', async () => {
  const fixture = makeRepo();
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('read_doc'))({ project: fixture.id, path: 'README.md' }));

      assert.match(body.text, /Fixture/);
      assert.equal(body.title, 'Fixture');

      const escaped = await (await handlerOf('read_doc'))({ project: fixture.id, path: '../outside.md' }).then(
        () => null,
        (error) => error,
      );
      assert.ok(escaped, 'an escaping path is refused');
      assert.match(escaped.message, /escapes the repository/);
    });
  } finally {
    fixture.cleanup();
  }
});

test('a repository that is not a checkout is read by walking, and the answer says so', async () => {
  const fixture = makeRepo({ name: 'plain-folder', git: false });
  try {
    await withRoots([fixture.repo], async () => {
      const body = parse(await (await handlerOf('list_docs'))({ project: fixture.id }));

      assert.equal(body.mode, 'walk');
      assert.ok(body.documents.some((document) => document.relPath === 'README.md'));
    });
  } finally {
    fixture.cleanup();
  }
});
