'use strict';

/**
 * Otter PM reads another repository's `.x-skills` tree, so the shape it depends on is a contract: a category
 * is anything in the root, a collection is a folder in it, and a run's `state.json` is what says how far the
 * workflow got. These tests build a small tree of their own and assert exactly that, so a change to the scanner
 * that would misread a real repo fails here first.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');

function writeFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/** A repository whose `.x-skills` has one of everything the scanner claims to understand. */
function fixture() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-'));
  const root = path.join(repo, '.x-skills');

  writeFile(
    path.join(root, 'runs', '2026-01-02-1015-R01-sample', 'state.json'),
    JSON.stringify({
      skill: 'x-plan',
      slug: 'sample',
      goal: 'prove the scanner reads a run',
      node: 'handoff',
      stops: ['handoff', 'abandon'],
      updatedAt: '2026-01-02T10:15:00.000Z',
      guards: { research_recorded: { pass: true }, gate_approved: { pass: true } },
      openQuestions: [{ id: 'Q1', text: 'answered?', status: 'answered', answer: 'yes' }],
      options: [{ id: 'O1', summary: 'A' }],
      decision: { summary: 'A' },
      events: [{ kind: 'research' }, { kind: 'decide' }],
    }),
  );
  writeFile(path.join(root, 'runs', '2026-01-02-1015-R01-sample', 'E01-plan.md'), '# Plan\n\n## Layers\n\nbody\n');
  writeFile(path.join(root, 'runs', '2026-01-02-1015-R01-sample', 'E02-epic.md'), '# Epic\n\n### Layer 0 — x\n');
  writeFile(path.join(root, 'runs', '2026-01-02-1015-R01-sample', 'notes.txt'), 'fixture\n');

  writeFile(
    path.join(root, 'tasks', '2026-01-03-sample', 'task-1.1-first.md'),
    '# Task: first\n\n**Layer:** 1\n**Effort:** 2h\n\n- [x] one\n- [ ] two\n',
  );
  writeFile(path.join(root, 'tasks', '2026-01-03-sample', 'task-0.1-skeleton.md'), '# Task: skeleton\n\n**Layer:** 0\n');

  writeFile(path.join(root, 'epics', '2026-01-01-sample.md'), '# Epic — sample\n\n**Date:** 2026-01-01\n');
  writeFile(path.join(root, 'plans', 'loose.md'), '# Loose plan\n\nprose\n');
  writeFile(path.join(root, 'roadmap.md'), '# Roadmap\n\nroot level\n');
  writeFile(path.join(root, 'review', 'README.txt'), 'not markdown\n');

  // Two folder names for one category: `anal` was the older spelling of `analysis`.
  writeFile(path.join(root, 'analysis', 'older-analysis.md'), '# Analysis — older\n\n**Date:** 2026-01-04\n');
  writeFile(path.join(root, 'anal', 'session-a', 'state.json'), JSON.stringify({ skill: 'x-anal', slug: 'session-a', node: 'route' }));
  writeFile(path.join(root, 'anal', 'session-a', 'E00-analysis.md'), '# Analysis — session a\n');
  writeFile(path.join(root, 'anal', 'loose-anal.md'), '# Analysis — loose\n');

  return { repo, root };
}

async function load() {
  const { repo, root } = fixture();
  process.env.OTTER_PM_ROOTS = repo;
  process.env.OTTER_PM_CONFIG = path.join(repo, 'no-such-config.json');
  const config = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'config.mjs')).href);
  const scan = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'scan.mjs')).href);
  const snapshot = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'snapshot.mjs')).href);
  snapshot.invalidateSnapshot();
  scan.clearParseCache();
  return { repo, root, config, scan, snapshot };
}

/** One server module, by name, from the app that serves it. */
async function serverModule(name) {
  return import(pathToFileURL(path.join(ROOT, 'src', 'server', `${name}.mjs`)).href);
}

const APP_SRC = path.join(ROOT, 'src');

function source(file) {
  return fs.readFileSync(path.join(APP_SRC, file), 'utf8');
}

/**
 * `resolveRoots` with the config file taken out of the picture — every test that drives it passes `--config` at a
 * path that does not exist, so the repository's own `otter-pm.config.json` cannot decide the answer. Stated once,
 * because three tests were each spelling it out.
 */
async function rootsWith({ argv = [], env = {}, cwd } = {}) {
  const { resolveRoots } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'config.mjs')).href);
  const noConfig = ['--config', path.join(os.tmpdir(), 'otter-pm-no-such-config.json'), ...argv];
  return resolveRoots({ argv: noConfig, env, ...(cwd ? { cwd } : {}) });
}

const category = (project, id) => project.categories.find((entry) => entry.id === id);

test('a repository path resolves to the .x-skills root beside it', async () => {
  const { repo, root, config } = await load();
  assert.equal(config.toXSkillsRoot(repo), root);
  assert.equal(config.toXSkillsRoot(root), root);
  assert.equal(config.toXSkillsRoot(path.join(repo, 'nope')), null);
});

test('resolveRoots reads OTTER_PM_ROOTS and rejects anything that is not a root', async () => {
  const { repo, root } = await load();
  const resolved = await rootsWith({ env: { OTTER_PM_ROOTS: `${repo},/definitely/not/here` } });
  assert.deepEqual(resolved.roots, [root]);
  assert.deepEqual(resolved.rejected, ['/definitely/not/here']);
});

test('every directory in the root is a category, and a folder in one is a collection', async () => {
  const { root, scan } = await load();
  const project = scan.scanRoot(root);
  assert.equal(project.id, path.basename(path.dirname(root)).toLowerCase().replace(/[^a-z0-9_.-]+/g, '-'));
  assert.deepEqual(
    project.categories.map((entry) => entry.id),
    ['runs', 'epics', 'tasks', 'plans', 'analysis', 'review', 'docs'],
  );
  assert.equal(category(project, 'runs').kind, 'containers');
  assert.equal(category(project, 'epics').kind, 'documents');
  assert.equal(category(project, 'tasks').kind, 'containers');
  assert.equal(category(project, 'docs').items.length, 1, 'root-level markdown folds into Docs');
});

test('`anal` and `analysis` are one Analysis category, not two', async () => {
  const { root, scan } = await load();
  const project = scan.scanRoot(root);
  const analysis = category(project, 'analysis');

  assert.equal(analysis.label, 'Analysis');
  assert.deepEqual(analysis.dirs, ['anal', 'analysis'], 'both folders were read, and both are remembered');
  assert.equal(analysis.dir, 'analysis', 'the panel is shown under the folder that bears the category name');

  assert.deepEqual(
    analysis.groups.map((group) => group.relPath),
    ['anal/session-a'],
    'a collection keeps the path it came from, so it still links and opens',
  );
  assert.deepEqual(
    analysis.items.map((item) => item.relPath).sort(),
    ['anal/loose-anal.md', 'analysis/older-analysis.md'],
  );
  assert.deepEqual(analysis.counts, { groups: 1, items: 2, files: 3 });
});

test("a run's state.json is read, not listed as an artifact", async () => {
  const { root, scan } = await load();
  const run = category(scan.scanRoot(root), 'runs').groups[0];
  assert.equal(run.state.skill, 'x-plan');
  assert.equal(run.state.node, 'handoff');
  assert.equal(run.state.finished, true);
  assert.equal(run.state.guardsPassed, 2);
  assert.equal(run.state.guardsTotal, 2);
  assert.equal(run.state.openQuestions, 0);
  assert.equal(run.state.events, 2);
  assert.equal(run.status, 'done');
  assert.deepEqual(
    run.files.map((file) => file.name),
    ['E01-plan.md', 'E02-epic.md', 'notes.txt'],
    'artifacts read in the order the run produced them',
  );
});

test('a task file carries its layer, effort and checklist progress', async () => {
  const { root, scan } = await load();
  const group = category(scan.scanRoot(root), 'tasks').groups[0];
  const first = group.files.find((file) => file.name === 'task-1.1-first.md');
  assert.equal(first.kind, 'task');
  assert.equal(first.layer, 1);
  assert.equal(first.title, 'first');
  assert.deepEqual(first.progress, { done: 1, total: 2, ratio: 0.5 });
  assert.equal(first.status, 'active');
  assert.equal(group.status, 'active', 'a collection is in progress while any of its boxes is not ticked');
});

test('the snapshot exposes the fixture repository, and file content is rendered or refused', async () => {
  const { root, snapshot } = await load();
  const snap = snapshot.getSnapshot({ force: true });
  assert.equal(snap.projects.length, 1);
  assert.equal(snap.projects[0].root, root);

  const projectId = snap.projects[0].id;
  const markdown = snapshot.readFileContent(projectId, 'runs/2026-01-02-1015-R01-sample/E01-plan.md');
  assert.equal(markdown.status, 200);
  assert.equal(markdown.body.isMarkdown, true);
  assert.match(markdown.body.html, /<h1[^>]*>Plan<\/h1>/);

  const escaped = snapshot.readFileContent(projectId, '../../etc/passwd');
  assert.equal(escaped.status, 400, 'a path outside the root is refused');

  const missing = snapshot.readFileContent(projectId, 'runs/nope.md');
  assert.equal(missing.status, 404);

  const unknown = snapshot.readFileContent('not-a-project', 'runs/nope.md');
  assert.equal(unknown.status, 404);
});

test('raw HTML in an artifact is stripped of what could run', async () => {
  const { root, snapshot } = await load();
  writeFile(path.join(root, 'docs-script.md'), '# t\n\n<script>alert(1)</script>\n\n<a href="javascript:alert(2)">x</a>\n');
  snapshot.invalidateSnapshot();
  const project = snapshot.getSnapshot({ force: true }).projects[0];
  const file = snapshot.readFileContent(project.id, 'docs-script.md');
  assert.equal(file.status, 200);
  assert.doesNotMatch(file.body.html, /<script/i);
  assert.doesNotMatch(file.body.html, /javascript:/i);
});

/** An Orca profile store with three repositories: one previewable, one with no run tree, one that is not there. */
function orcaStore(profiles) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-orca-'));
  for (const [name, repos, mtime] of profiles) {
    const file = path.join(configDir, 'profiles', name, 'orca-data.json');
    writeFile(file, JSON.stringify({ schemaVersion: 1, repos }));
    fs.utimesSync(file, mtime, mtime);
  }
  return configDir;
}

test('the Orca IDE list is a root source, and a repository without .x-skills is not a mistake', async () => {
  const { root } = await load();
  const repo = path.dirname(root);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-empty-'));
  const configDir = orcaStore([
    [
      'local-default',
      [
        { displayName: 'has-a-run-tree', path: repo },
        { displayName: 'no-run-tree', path: empty },
        { displayName: 'gone', path: path.join(empty, 'was-deleted') },
      ],
      new Date(),
    ],
  ]);

  const { readOrcaRepos, orcaDataFile } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'orca.mjs')).href);
  const read = readOrcaRepos({ ORCA_CONFIG_DIR: configDir });
  assert.equal(read.repos.length, 3);
  assert.equal(orcaDataFile({ ORCA_CONFIG_DIR: configDir }), path.join(configDir, 'profiles', 'local-default', 'orca-data.json'));

  const resolved = await rootsWith({ argv: ['--orca'], env: { ORCA_CONFIG_DIR: configDir } });

  assert.deepEqual(resolved.roots, [root]);
  assert.deepEqual(
    resolved.skipped.sort(),
    [path.join(empty, 'was-deleted'), empty].sort(),
    'repositories the IDE lists with no run tree are reported as skipped, not as bad paths',
  );
  assert.deepEqual(resolved.rejected, []);
  assert.deepEqual(resolved.orca, { enabled: true, file: path.join(configDir, 'profiles', 'local-default', 'orca-data.json'), listed: 3, roots: 1, reason: null });
});

test('the newest profile store is the one read, and --no-orca turns the source off', async () => {
  const { root } = await load();
  const repo = path.dirname(root);
  const configDir = orcaStore([
    ['old', [{ displayName: 'old', path: '/nope/old' }], new Date(Date.now() - 60_000)],
    ['current', [{ displayName: 'current', path: repo }], new Date()],
  ]);

  const { orcaDataFile, readOrcaRepos } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'orca.mjs')).href);
  assert.match(orcaDataFile({ ORCA_CONFIG_DIR: configDir }), /profiles\/current\//);
  assert.deepEqual(readOrcaRepos({ ORCA_CONFIG_DIR: configDir }).repos.map((entry) => entry.path), [repo]);

  const off = await rootsWith({ argv: ['--no-orca'], env: { ORCA_CONFIG_DIR: configDir }, cwd: '/tmp' });
  assert.deepEqual(off.roots, []);
  assert.equal(off.orca.enabled, false);
});

test('a run\'s state is normalised, so an older state file reads like a newer one', async () => {
  const { summariseState } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'scan.mjs')).href);

  const bare = summariseState({});
  assert.equal(bare.skill, null);
  assert.deepEqual(bare.stops, []);
  assert.equal(bare.finished, false, 'nothing can be finished when the state names no node');
  assert.equal(bare.updatedAt, null);
  assert.deepEqual(bare.questions, []);
  assert.equal(bare.openQuestions, 0);
  assert.equal(bare.events, 0);
  assert.equal(bare.guardsPassed, 0);
  assert.equal(bare.guardsTotal, 0);

  const full = summariseState({
    skill: 'x-plan',
    node: 'handoff',
    stops: ['handoff', 'abandon'],
    guards: { a: { pass: true }, b: { pass: false } },
    openQuestions: [{ id: 'Q1', status: 'answered' }, { id: 'Q2', status: 'open' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    events: [1, 2, 3],
  });
  assert.equal(full.finished, true);
  assert.equal(full.guardsPassed, 1);
  assert.equal(full.guardsTotal, 2);
  assert.equal(full.openQuestions, 1, 'an answered question is not open');
  assert.equal(full.questions.length, 2, 'both questions are still shown');
  assert.equal(full.updatedAt, '2026-01-01T00:00:00.000Z', 'createdAt stands in when there is no updatedAt');
  assert.equal(full.events, 3);
});

test('a missing or unreadable profile store is reported, never thrown', async () => {
  const { readOrcaRepos } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'orca.mjs')).href);
  const missing = readOrcaRepos({ ORCA_CONFIG_DIR: path.join(os.tmpdir(), 'xskills-no-orca-here') });
  assert.deepEqual(missing.repos, []);
  assert.match(missing.reason, /no Orca profile store/);

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-orca-bad-'));
  writeFile(path.join(configDir, 'profiles', 'local-default', 'orca-data.json'), '{ this is not json');
  const broken = readOrcaRepos({ ORCA_CONFIG_DIR: configDir });
  assert.deepEqual(broken.repos, []);
  assert.match(broken.reason, /could not read/);
});

test('the Orca icon and badge colour are carried through unchanged', async () => {
  const { root } = await load();
  const configDir = orcaStore([
    [
      'local-default',
      [
        {
          displayName: 'marked-up',
          path: path.dirname(root),
          repoIcon: { type: 'image', src: 'https://github.com/owner.png?size=64', label: 'owner/repo' },
          badgeColor: '#737373',
        },
      ],
      new Date(),
    ],
  ]);

  const resolved = await rootsWith({ argv: ['--orca'], env: { ORCA_CONFIG_DIR: configDir } });
  assert.deepEqual(resolved.rootMeta[root], {
    name: 'marked-up',
    icon: 'https://github.com/owner.png?size=64',
    iconLabel: 'owner/repo',
    badgeColor: '#737373',
    source: 'orca',
  });

  const { scanRoot } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'scan.mjs')).href);
  const project = scanRoot(root, resolved.rootMeta[root]);
  assert.equal(project.name, 'marked-up', 'the IDE names the repository, not the directory');
  assert.equal(project.badgeColor, '#737373');
  assert.equal(project.source, 'orca');
});

test('a column move is written, read back, and cleared by moving the card home', async () => {
  const { root } = await load();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-board-'));
  const env = { OTTER_PM_BOARD: path.join(configDir, 'board.json') };
  const { readBoard, writeMove, BOARD_COLUMNS } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'board.mjs')).href);

  assert.deepEqual(readBoard(env).moves, {}, 'no file yet is an empty board, not an error');

  const key = `fixture:runs/x`;
  const written = writeMove({ projectId: 'fixture', relPath: 'runs/x', column: 'closed', env });
  assert.equal(written.ok, true);
  assert.deepEqual(readBoard(env).moves[key], { column: 'closed', at: readBoard(env).moves[key].at });
  assert.match(readBoard(env).moves[key].at, /^\d{4}-\d{2}-\d{2}T/);

  const cleared = writeMove({ projectId: 'fixture', relPath: 'runs/x', column: null, env });
  assert.equal(cleared.ok, true);
  assert.deepEqual(readBoard(env).moves, {}, 'filing a card home removes the preference instead of storing a no-op');

  const bad = writeMove({ projectId: 'fixture', relPath: 'runs/x', column: 'sideways', env });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown column/);
  assert.deepEqual(readBoard(env).moves, {});

  assert.deepEqual(BOARD_COLUMNS, ['todo', 'active', 'unknown', 'done', 'closed']);
  assert.ok(root);
});

test('the board file is read beside the config, and a corrupt one is an empty board', async () => {
  const { boardFile, readBoard } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'board.mjs')).href);
  assert.match(boardFile({ OTTER_PM_BOARD: '/tmp/elsewhere.json' }), /elsewhere\.json$/);
  assert.match(boardFile({}), /board\.json$/, 'defaults to a file beside otter-pm.config.json');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-board-bad-'));
  writeFile(path.join(dir, 'board.json'), 'not json at all');
  assert.deepEqual(readBoard({ OTTER_PM_BOARD: path.join(dir, 'board.json') }).moves, {});

  writeFile(path.join(dir, 'board.json'), JSON.stringify({ moves: { 'p:a': { column: 'nonsense' }, 'p:b': { column: 'done' } } }));
  assert.deepEqual(Object.keys(readBoard({ OTTER_PM_BOARD: path.join(dir, 'board.json') }).moves), ['p:b']);
});

test('an item is archived and brought back, in the same file as a move', async () => {
  const { readBoard, writeDeletion, writeMove } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'board.mjs')).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-delete-'));
  const env = { OTTER_PM_BOARD: path.join(dir, 'board.json') };

  assert.deepEqual(readBoard(env).deleted, {}, 'nothing deleted before anything is');

  const written = writeDeletion({ projectId: 'fixture', relPath: 'runs', deleted: true, env });
  assert.equal(written.ok, true);
  assert.match(readBoard(env).deleted['fixture:runs'].at, /^\d{4}-\d{2}-\d{2}T/);

  writeMove({ projectId: 'fixture', relPath: 'runs', column: 'done', env });
  assert.equal(readBoard(env).moves['fixture:runs'].column, 'done', 'filing and archiving are two decisions, and neither clears the other');
  assert.ok(readBoard(env).deleted['fixture:runs']);

  const restored = writeDeletion({ projectId: 'fixture', relPath: 'runs', deleted: false, env });
  assert.equal(restored.ok, true);
  assert.deepEqual(readBoard(env).deleted, {}, 'an unarchive removes the entry rather than storing a false');
  assert.equal(readBoard(env).moves['fixture:runs'].column, 'done', 'and the filing it had is still there');
});

test('a malformed deletion entry is dropped, not read as a deletion', async () => {
  const { readBoard } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'board.mjs')).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-delete-bad-'));
  const file = path.join(dir, 'board.json');
  writeFile(file, JSON.stringify({ deleted: { 'p:a': 'yes', 'p:b': null, 'p:c': { at: 5 } } }));

  const read = readBoard({ OTTER_PM_BOARD: file });
  assert.deepEqual(Object.keys(read.deleted), ['p:c'], 'only an entry that is an object is a deletion');
  assert.equal(read.deleted['p:c'].at, null, 'an `at` that is not a time is no time');
});

test('a drop records the place a card landed in, and the lane is where the order is kept', async () => {
  const { orderKey, readBoard, writeMove } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'board.mjs')).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-order-'));
  const env = { OTTER_PM_BOARD: path.join(dir, 'board.json') };

  assert.deepEqual(readBoard(env).orders, {}, 'no file yet is no order, not an error');
  assert.equal(orderKey('fixture', 'todo'), 'fixture:todo');

  const written = writeMove({
    projectId: 'fixture',
    relPath: 'runs/b',
    column: 'todo',
    order: { column: 'todo', paths: ['runs/a', 'runs/b', 'runs/c'] },
    env,
  });
  assert.equal(written.ok, true);
  assert.deepEqual(readBoard(env).orders['fixture:todo'], ['runs/a', 'runs/b', 'runs/c']);

  writeMove({
    projectId: 'fixture',
    relPath: 'runs/d',
    column: 'done',
    order: { column: 'done', paths: ['runs/e', 'runs/d'] },
    env,
  });
  assert.deepEqual(
    readBoard(env).orders['fixture:todo'],
    ['runs/a', 'runs/b', 'runs/c'],
    'another lane is another order, and writing one leaves the other alone',
  );

  // Sorting inside the lane a card's own data already gives it clears the move and keeps the order: the column was
  // never in question, and the place is what the reader decided.
  writeMove({
    projectId: 'fixture',
    relPath: 'runs/b',
    column: null,
    order: { column: 'todo', paths: ['runs/b', 'runs/a', 'runs/c'] },
    env,
  });
  assert.equal(readBoard(env).moves['fixture:runs/b'], undefined, 'a card put back where its data has it keeps no move');
  assert.equal(readBoard(env).moves['fixture:runs/d'].column, 'done', 'and the move it did not touch is still there');
  assert.deepEqual(readBoard(env).orders['fixture:todo'], ['runs/b', 'runs/a', 'runs/c'], 'while the lane reads the way it was left');

  writeMove({ projectId: 'fixture', relPath: 'runs/b', column: null, order: { column: 'todo', paths: ['runs/a', 7, '', 'runs/a', 'runs/b'] }, env });
  assert.deepEqual(readBoard(env).orders['fixture:todo'], ['runs/a', 'runs/b'], 'a path is in a lane once, and only a path is a place');

  writeMove({ projectId: 'fixture', relPath: 'runs/b', column: null, order: { column: 'todo', paths: [] }, env });
  assert.equal(readBoard(env).orders['fixture:todo'], undefined, 'an emptied lane stores no order to contradict the empty lane it is');

  const bad = writeMove({ projectId: 'fixture', relPath: 'runs/b', column: null, order: { column: 'sideways', paths: ['runs/b'] }, env });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown column/);
});

test('a malformed order is dropped rather than half-read', async () => {
  const { readBoard } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'board.mjs')).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-order-bad-'));
  const file = path.join(dir, 'board.json');
  writeFile(file, JSON.stringify({ orders: { 'p:todo': 'runs/a', 'p:done': null, 'p:active': [] } }));

  assert.deepEqual(readBoard({ OTTER_PM_BOARD: file }).orders, {}, 'an order is a list with something in it, or it is not an order');

  writeFile(file, JSON.stringify({ orders: { 'p:todo': ['runs/a', 7, '', 'runs/a', 'runs/b'] } }));
  assert.deepEqual(readBoard({ OTTER_PM_BOARD: file }).orders['p:todo'], ['runs/a', 'runs/b'], 'and reading it back keeps only the places in it');
});

test('a lane reads in the order the reader left it, and anything the order does not name follows', async () => {
  const { orderKey, orderedLane } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'board.mjs')).href);

  const item = (relPath) => ({ projectId: 'fixture', relPath });
  const lane = [item('runs/a'), item('runs/b'), item('runs/c')];
  const paths = (items) => items.map((entry) => entry.relPath);

  assert.equal(orderKey('fixture', 'todo'), 'fixture:todo');
  assert.deepEqual(orderedLane(lane, 'fixture:todo', {}), lane, 'with nothing arranged, a lane reads as it always did');
  assert.deepEqual(orderedLane(lane, 'fixture:todo', undefined), lane, 'and no board at all is the same answer');

  const orders = { 'fixture:todo': ['runs/c', 'runs/a'] };
  assert.deepEqual(paths(orderedLane(lane, 'fixture:todo', orders)), ['runs/c', 'runs/a', 'runs/b'], 'the paths the order names come first, and the ones it does not follow');
  assert.deepEqual(paths(orderedLane(lane, 'fixture:done', orders)), ['runs/a', 'runs/b', 'runs/c'], 'an order belongs to the lane it was made in');
  assert.deepEqual(paths(orderedLane(lane, 'other:todo', orders)), ['runs/a', 'runs/b', 'runs/c'], 'and to the repository it was made in');

  const grown = [...lane, item('runs/d')];
  assert.deepEqual(paths(orderedLane(grown, 'fixture:todo', orders)), ['runs/c', 'runs/a', 'runs/b', 'runs/d'], 'a card that turned up after the last drop is drawn after the ones the lane names');
});

test('a place in a lane is drawn on the boundary the cards on screen show', async () => {
  const { landingBoundary } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'board.mjs')).href);

  assert.equal(landingBoundary(-1, 2), -1, 'no place draws no line');
  assert.equal(landingBoundary(0, -1), 0, 'a card carried in from another lane is measured among all of them');
  assert.equal(landingBoundary(3, -1), 3, 'and its last place is the boundary past the last card');

  // Four cards on screen, the one in hand third (index 2), so the lane the place was measured in has three. Places
  // 0 and 1 are above where it came from and draw where they are; 2 (its own old place) and 3 draw one boundary
  // further down, because the card being carried is still drawn on the boundary in between.
  assert.deepEqual([0, 1, 2, 3].map((place) => landingBoundary(place, 2)), [0, 1, 3, 4]);
  assert.equal(landingBoundary(3, 2), 4, 'and the last of them is the boundary past the last card on screen');
});

test('a pointer is measured between the cards of a lane, and a leave is only a leave', async () => {
  const { leftLane, placeAtPointer } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'board.mjs')).href);

  const card = (top, height = 100) => ({ top, height });
  const lane = [card(0), card(108), card(216)];
  assert.equal(placeAtPointer(lane, -10), 0, 'above them all is the top of the lane');
  assert.equal(placeAtPointer(lane, 49), 0, 'the top half of a card is a place in front of it');
  assert.equal(placeAtPointer(lane, 51), 1, 'and the bottom half is the place behind it');
  assert.equal(placeAtPointer(lane, 157), 1);
  assert.equal(placeAtPointer(lane, 265), 2, 'the third card is still in front of a pointer above its middle');
  assert.equal(placeAtPointer(lane, 267), 3, 'and behind one below it');
  assert.equal(placeAtPointer(lane, 400), 3, 'past the last card is the end of the lane');
  assert.equal(placeAtPointer([], 400), 0, 'an empty lane has one place in it — the only one');
  assert.equal(placeAtPointer([card(0, 175)], 87), 0, 'and a card is measured by its own height');

  const box = { left: 100, right: 300, top: 0, bottom: 500 };
  assert.equal(leftLane({ x: 200, y: 200 }, box, false), false, 'a pointer inside the lane is not a leave, whatever it crossed');
  assert.equal(leftLane({ x: 200, y: 600 }, box, false), true, 'a leave below the lane is a leave');
  assert.equal(leftLane({ x: 20, y: 200 }, box, false), true, 'and so is one out to the side');
  assert.equal(leftLane({ x: 200, y: 600 }, box, true), false, 'while either sign saying the pointer is still inside wins: a stale ring is cheaper than a flickering one');
});

test('a card can be sorted inside a lane, and the place survives the drop', () => {
  const board = source(path.join('components', 'Board.tsx'));
  const view = source(path.join('components', 'ProjectView.tsx'));
  const api = source(path.join('lib', 'api.ts'));
  const app = source(path.join('components', 'App.tsx'));
  const styles = fs.readFileSync(path.join(APP_SRC, 'styles.css'), 'utf8');
  const route = fs.readFileSync(path.join(APP_SRC, 'pages', 'api', 'move.ts'), 'utf8');
  const types = source(path.join('lib', 'types.ts'));

  assert.match(board, /orderedLane\(/, 'a lane is drawn in the order the reader left it');
  assert.match(board, /placeAtPointer\(cards\.map\(\(card\) => card\.getBoundingClientRect\(\)\), event\.clientY\)/, 'a lane hands the pointer and the cards it can see to the rule, which is where the measuring lives');
  assert.match(board, /props\.onMove\(item, column, \{ column, paths \}\)/, 'a drop hands over the whole lane, because a place only means something against the cards around it');
  assert.match(board, /props\.onMove\(item, next, null\)/, 'a keyboard move names a lane and no place, so it writes no order and cannot freeze a lane nobody sorted by hand');
  assert.match(board, /const slotAt = \(rendered: number\) => props\.carried !== null && slotBoundary\(\) === rendered/, 'the place opens as a slot, drawn on the boundary the place maps to rather than on the card it was measured from');
  assert.match(board, /<DropSlot height=\{props\.carried\?\.height \?\? 0\} \/>/, 'and the slot is the size of the card in hand, which is the shape the place will take');
  // The flicker this board had: `dragleave` fires on every boundary crossed *inside* a lane too — card to card, and
  // card to the slot that has just opened under the pointer — and clearing the drop on each of those un-mounted the
  // slot and let the cards under it jump, forty times down one lane. Only a leave that arrives outside counts.
  assert.match(board, /onDragLeave=\{leaveLane\}/, 'a lane is left only through the one handler that can tell a leave from a crossing');
  assert.match(board, /leftLane\(\{ x: event\.clientX, y: event\.clientY \}, lane\.getBoundingClientRect\(\), entering !== null && lane\.contains\(entering\)\)/, 'and that handler reads the two signs a leave carries and hands them to the rule');
  assert.match(board, /props\.onDragStart\?\.\(props\.item, \(event\.currentTarget as HTMLElement\)\.offsetHeight\)/, 'the height is read off the card when it is picked up, because that is the only moment the card is still the card');
  assert.match(view, /column === own \? null : column, order/, 'putting a card back where its data has it clears the move and keeps the place — the column was never the decision');
  assert.match(api, /order: BoardOrder \| null = null/, 'the client sends the place with the filing, in one write');
  assert.match(app, /orders: answer\.orders/, 'and replaces the orders with the ones the server answered, so the screen and the file cannot disagree');
  assert.match(route, /orders: snapshot\.orders/);
  assert.match(types, /BoardOrders = Record<string, string\[\]>/, 'the stored order is a lane of paths, keyed by the lane');

  // The board's own look, which is the one thing a reader never sees asserted anywhere else: a lane is a surface
  // rather than a column of gaps, a card on it is lifted off it, and the slot is dashed because it is not a card.
  assert.match(styles, /\.lane \{ background: var\(--muted\); \}/, 'a lane carries its own surface, because "drop it here" is a question about an area');
  assert.match(styles, /\.lane\[data-over="true"\]/, 'and a lane under a drag steps once more and rings itself');
  assert.match(styles, /\.lane \.card \{ box-shadow: 0 1px 1px color-mix/, 'the card is the surface a reader aims at, so it carries the elevation');
  assert.match(styles, /\.drop-slot \{ border: 1px dashed/, 'and the place is a dashed slot, never a filled card');
  assert.match(board, /motion-reduce:transition-none/, 'the two steps a lane and a card take are colour steps: a reader who asked for less motion still gets them, and gets them without the fade');
});

test('a deletion hides the item and everything inside it, and an unarchive brings it all back', async () => {
  const { boardKey, isDeleted, liveItems, deletedItems } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'board.mjs')).href);

  assert.equal(boardKey('fixture', 'runs/2026-01-02-1015-R01-sample'), 'fixture:runs/2026-01-02-1015-R01-sample');

  const run = { projectId: 'fixture', relPath: 'runs/2026-01-02-1015-R01-sample' };
  const artifact = { projectId: 'fixture', relPath: 'runs/2026-01-02-1015-R01-sample/E01-plan.md' };
  const other = { projectId: 'fixture', relPath: 'runs-notes.md' };
  const elsewhere = { projectId: 'other', relPath: 'runs/2026-01-02-1015-R01-sample' };
  const deletions = { [boardKey('fixture', 'runs/2026-01-02-1015-R01-sample')]: { at: '2026-01-03T00:00:00.000Z' } };

  assert.equal(isDeleted(run, deletions), true);
  assert.equal(isDeleted(artifact, deletions), true, 'a run that is away takes its artifacts with it');
  assert.equal(isDeleted(other, deletions), false, 'a name that merely starts the same way is not inside it');
  assert.equal(isDeleted(elsewhere, deletions), false, 'and the same path in another repository is another item');
  assert.equal(isDeleted(run, {}), false);

  const items = [run, artifact, other];
  assert.deepEqual(liveItems(items, deletions).map((item) => item.relPath), ['runs-notes.md']);
  assert.deepEqual(
    deletedItems(items, deletions).map((item) => item.relPath),
    ['runs/2026-01-02-1015-R01-sample'],
    'the list is the decisions a reader made, not everything the decision covers',
  );
  assert.deepEqual(liveItems(items, {}), items, 'with nothing deleted, nothing is hidden');
});

test('a dialect is detected from the text when nothing names one', async () => {
  const highlight = await serverModule('highlight');

  assert.equal(highlight.normalizeLanguage('JS'), 'javascript', 'an alias is answered as the dialect it names');
  assert.equal(highlight.normalizeLanguage('mermaid'), null, 'a language with no grammar here is plain text');
  assert.deepEqual(highlight.languageForExtension('mjs'), 'javascript');
  assert.equal(highlight.languageForExtension('csv'), null, 'an extension that says nothing is not guessed from');

  assert.equal(highlight.detectLanguage('{"a":[1,null]}'), 'json');
  assert.equal(highlight.detectLanguage('#!/bin/bash\nset -e\nfor f in *.md; do echo $f; done'), 'bash');
  assert.equal(highlight.detectLanguage('name: x\nitems:\n  - a\n  - b'), 'yaml');
  assert.equal(highlight.detectLanguage('def f(a):\n    return a'), 'python');
  assert.equal(highlight.detectLanguage('# Title\n\n- [x] done'), 'markdown');
  assert.equal(highlight.detectLanguage('This is a sentence about a thing.\nIt has two of them.'), null, 'prose is prose');
});

test('highlighted markup carries the dialect, and never the document’s own tags', async () => {
  const highlight = await serverModule('highlight');

  const named = highlight.highlightCode('const x = 1;', 'js');
  assert.equal(named.language, 'javascript', 'the alias is resolved before the grammar is asked for it');
  assert.equal(named.detected, false);
  assert.match(named.html, /class="shiki/, 'the two palettes are in the markup');
  assert.match(named.html, /data-language="javascript"/, 'and so is the dialect it was read as');

  const guessed = highlight.highlightCode('{"a":1}', 'json', { detected: true });
  assert.match(guessed.html, /data-detected="1"/, 'a guess is disclosed, not presented as a fact');

  const escaped = highlight.plainCode('<script>alert(1)</script>');
  assert.doesNotMatch(escaped, /<script/, 'a block nothing can colour is escaped, like every other');

  const unknown = highlight.highlightFence('a plain sentence that names no dialect at all.', 'nonsense');
  assert.equal(unknown, null, 'a dialect with no grammar falls back to the caller, which shows the text');
});

test('a fence is coloured in the dialect it names, and a guessed one says so', async () => {
  const { root, snapshot } = await load();
  const project = snapshot.getSnapshot({ force: true }).projects[0];
  writeFile(
    path.join(root, 'fences.md'),
    [
      '# Fences',
      '',
      '```json',
      '{"a": 1}',
      '```',
      '',
      '```',
      '{"b": 2}',
      '```',
      '',
      '```bash',
      'echo hi',
      '```',
      '',
      '```mermaid',
      'graph TD; A-->B;',
      '```',
      '',
    ].join('\n'),
  );
  snapshot.invalidateSnapshot();

  const read = snapshot.readFileContent(project.id, 'fences.md');
  assert.equal(read.status, 200);
  const html = read.body.html;

  assert.match(html, /<pre class="shiki[^"]*"[^>]*data-language="json"/, 'the named fence is coloured as what it named');
  assert.match(html, /data-language="json"[^>]*data-detected="1"|data-detected="1"[^>]*data-language="json"/, 'the bare fence is detected from its own text, and says so');
  assert.match(html, /data-language="bash"/, 'a shell fence is a shell');
  assert.match(html, /class="language-mermaid"/, 'the diagram fence is left exactly as the diagram renderer finds it');
});

test('a file that is not markdown is code, in the dialect its extension means', async () => {
  const { root, snapshot } = await load();
  const project = snapshot.getSnapshot({ force: true }).projects[0];

  writeFile(path.join(root, 'state.json'), '{"a":1}');
  writeFile(path.join(root, 'notes.txt'), 'just some prose about a thing.\nIt has two sentences.\n');
  writeFile(path.join(root, 'picture.png'), 'not really a picture');
  snapshot.invalidateSnapshot();

  const code = snapshot.readFileContent(project.id, 'state.json');
  assert.equal(code.body.isMarkdown, false);
  assert.equal(code.body.isCode, true);
  assert.equal(code.body.language, 'json');
  assert.equal(code.body.detected, false);
  assert.match(code.body.html, /class="shiki/);
  assert.equal(code.body.editable, true, 'a JSON file is an artifact this app may write');

  const prose = snapshot.readFileContent(project.id, 'notes.txt');
  assert.equal(prose.body.isCode, false, 'a text file nothing can colour is shown as its own text');
  assert.equal(prose.body.html, null);

  const picture = snapshot.readFileContent(project.id, 'picture.png');
  assert.equal(picture.status, 200, 'it is read, because a reader asked for it by name');
  assert.equal(picture.body.editable, false, 'but it is not offered an edit the server would refuse');
});

test('an artifact is written back, and the answer is the file as it now reads', async () => {
  const { root, snapshot } = await load();
  const project = snapshot.getSnapshot({ force: true }).projects[0];
  const relPath = 'runs/2026-01-02-1015-R01-sample/E01-plan.md';

  const before = snapshot.readFileContent(project.id, relPath);
  assert.deepEqual(snapshot.getSnapshot().projects[0].categories.find((c) => c.id === 'runs').groups[0].files.find((f) => f.name === 'E01-plan.md').progress, null, 'the fixture plan starts with no checklist');

  const written = snapshot.writeFileContent(project.id, relPath, '# Plan\n\n## Layers\n\n- [x] one\n- [ ] two\n');
  assert.equal(written.status, 200);
  assert.equal(written.body.raw, '# Plan\n\n## Layers\n\n- [x] one\n- [ ] two\n');
  assert.match(written.body.html, /<h1[^>]*>Plan<\/h1>/, 'the answer is rendered, so the screen has nothing to guess');
  assert.equal(written.body.size, Buffer.byteLength(written.body.raw), 'and is a fresh stat of the file, not the one before the write');
  assert.notEqual(written.body.size, before.body.size);

  assert.equal(fs.readFileSync(path.join(root, relPath), 'utf8'), written.body.raw, 'the file on disk is the file that was written');

  const files = snapshot.getSnapshot().projects[0].categories.find((c) => c.id === 'runs').groups[0].files;
  assert.deepEqual(files.find((f) => f.name === 'E01-plan.md').progress, { done: 1, total: 2, ratio: 0.5 }, 'the scan reads the new checklist, not the one it cached');

  const leftovers = fs.readdirSync(path.dirname(path.join(root, relPath))).filter((name) => name.includes('otter-pm-tmp'));
  assert.deepEqual(leftovers, [], 'the sibling a save writes through is renamed away, not left in the tree');
});

test('a write refuses what this app does not read as text, and a path that escapes', async () => {
  const { root, snapshot } = await load();
  const project = snapshot.getSnapshot({ force: true }).projects[0];

  writeFile(path.join(root, 'picture.png'), 'not really a picture');
  snapshot.invalidateSnapshot();

  const binary = snapshot.writeFileContent(project.id, 'picture.png', 'pretending');
  assert.equal(binary.status, 415);
  assert.match(binary.error, /not a text artifact/);

  const escaped = snapshot.writeFileContent(project.id, '../../etc/passwd', 'nope');
  assert.equal(escaped.status, 400);
  assert.equal(snapshot.writeFileContent('not-a-project', 'roadmap.md', 'nope').status, 404);
  assert.equal(snapshot.writeFileContent(project.id, 'roadmap.md', 42).status, 400, 'the contents are a string or nothing is written');
  assert.match(snapshot.writeFileContent(project.id, 'roadmap.md', 'x'.repeat(1_100_000)).error, /refusing to write/);
});

test('the edit surface offers only what the server would accept', () => {
  const artifact = source(path.join('components', 'Artifact.tsx'));

  assert.match(artifact, /mode\(\) === 'read' && content\(\)\?\.editable/, 'the edit button is gated on the flag the read carried');
  assert.match(artifact, /await saveFile\(props\.project, props\.path, text\(\)\)/, 'a save writes the draft, not the file it came from');
  assert.match(artifact, /mutate\(written\)/, 'the answer replaces the content, so the screen shows what the disk holds');
  assert.match(artifact, /on\([\s\S]*?\[props\.project, props\.path\][\s\S]*?setDraft\(null\)/, 'opening another artifact drops the draft it did not belong to');
  assert.match(artifact, /Edit \$\{props\.path\}/, 'the editor names the file it is editing');
  assert.match(artifact, /props\.onSaved\?\.\(\)/, 'a save re-reads the snapshot, which is where the checklist it changed is counted');
  assert.match(
    source(path.join('components', 'GroupDetail.tsx')),
    /<Artifact project=\{props\.project\.id\} path=\{file\(\)\.relPath\} onSaved=\{props\.onSaved\} canArchive=\{false\} \/>|<Artifact\s+project=\{props\.project\.id\}\s+path=\{file\(\)\.relPath\}\s+onSaved=\{props\.onSaved\}\s+canArchive=\{false\}\s+\/>/,
    'a collection’s page offers no per-file archive: its header carries the only one',
  );
  assert.match(source(path.join('components', 'App.tsx')), /<FileView project=\{active\(\)\} path=\{routeFilePath\(\)\} onSaved=\{props\.onRefresh\} \/>/);
  assert.match(fs.readFileSync(path.join(APP_SRC, 'server', 'snapshot.mjs'), 'utf8'), /editable: TEXT_EXTENSIONS\.has\(extension\) && !truncated/, 'and that flag is decided where the text set lives');
});

test('a checklist bar survives the row it is selected on', () => {
  const card = source(path.join('components', 'Card.tsx'));
  const group = source(path.join('components', 'GroupDetail.tsx'));
  const css = fs.readFileSync(path.join(APP_SRC, 'styles.css'), 'utf8');

  assert.doesNotMatch(card, /bg-muted">\s*<div\s+class="h-full/, 'the track is not the surface it lands on');
  assert.match(card, /class="progress-track h-1\.5/, 'the track is the app’s own ink');
  assert.match(card, /class="progress-fill h-full rounded-full"/);
  assert.match(group, /data-selected=\{props\.selected === file\.relPath \? 'true' : undefined\}/, 'the chosen row declares itself, so the bar can move with it');
  assert.match(css, /\[data-selected="true"\] \.progress-track \{ background: color-mix\(in srgb, var\(--foreground\) 26%/, 'and the track is a step darker on it');
});

test('archiving an item hides it from the board, and only the reader’s own decisions are listed', () => {
  const view = source(path.join('components', 'ProjectView.tsx'));
  const board = source(path.join('components', 'Board.tsx'));
  const overview = source(path.join('components', 'Overview.tsx'));
  const search = source(path.join('components', 'SearchView.tsx'));
  const items = source(path.join('lib', 'items.ts'));

  assert.match(view, /liveItems\(itemsForProject\(props\.project, visible\(\)\)\.filter/, 'the board draws what is not archived');
  assert.match(board, /columnCounts\(liveItems\(/, 'and its lane counts agree with it');
  assert.match(board, /props\.item\.relPath\.split\('\/'\)\.pop\(\)/, 'a collection card carries the folder’s own name, because two runs can share one title and a card indistinguishable from the one just archived reads as an archive that failed');
  assert.match(overview, /liveItems\(itemsForProject\(props\.project\)\)/, 'the overview counts the same work the project does');
  assert.match(search, /liveItems\(searchItemsForProject\(project\)/, 'and a search result that is archived does not come back in through search');

  assert.match(view, /searchItemsForProject\(props\.project, visible\(\)\)/, 'the Archived list is built from the widest item set, so an artifact archived on its own page can be found again');
  assert.match(view, /deletedItems\(/, 'and lists the decisions rather than everything they cover');
  assert.match(view, /onClick=\{\(\) => props\.onDelete\?\.\(item, false\)\}/, 'with an unarchive per row');
  assert.match(view, /<a \{\.\.\.linkProps\(routeFor\(item\)\)\} class="break-anywhere text-chrome">\s*\{item\.title\}\s*<\/a>/, 'an archived row opens the item it names, so a reader can see what the decision was about');
  assert.match(view, /text-chrome text-muted-foreground">\{item\.relPath\}</, 'and names the path it covers, because a collection and a file inside it can share one title');
  assert.match(view, /liveItems\(itemsForProject\(props\.project\), props\.deletions\)\.slice\(0, 6\)/, 'the recent list draws live work only — an archived item is not one of the project’s recent things');
  assert.doesNotMatch(items, /deletions/, 'the rules live in one module, not in the item model');
});

test('an item is archived and brought back from the page it is read on', () => {
  const artifact = source(path.join('components', 'Artifact.tsx'));
  const group = source(path.join('components', 'GroupDetail.tsx'));
  const app = source(path.join('components', 'App.tsx'));
  const api = source(path.join('lib', 'api.ts'));
  const route = fs.readFileSync(path.join(APP_SRC, 'pages', 'api', 'delete.ts'), 'utf8');
  const types = source(path.join('lib', 'types.ts'));

  assert.match(route, /export const POST/, 'the write is its own route, beside the one that reads an artifact');
  assert.match(api, /export function deleteItem\(project: string, path: string, deleted: boolean\)/, 'the client names the direction');
  assert.match(app, /const remove = async \(item: WorkItem, deleted: boolean\)/, 'one handler for both directions, like a card’s filing');
  assert.match(app, /mutate\(\(current\) => \(current \? \{ \.\.\.current, deletions: answer\.deletions \} : current\)\)/, 'and only the reader’s decisions change in the snapshot, not a re-scan');
  assert.match(types, /BoardDeletions = Record<string, \{ at: string \| null \}>/);

  assert.match(artifact, /const own = \(\) => Boolean\(props\.deletions\[boardKey\(props\.project, props\.path\)\]\)/, 'an artifact knows whether it is the thing that was archived');
  assert.match(artifact, /inside an archived collection/, 'and says so when it is only off the board because its collection is');
  assert.match(artifact, /onClick=\{\(\) => props\.onDelete\?\.\(props\.path, own\(\)\)\}/, 'unarchive is the same button as archive');
  assert.match(artifact, /mode\(\) === 'read' && props\.canArchive !== false/, 'and a page can take that button out — a collection’s page does, so its one archive button cannot be mistaken for the file’s');
  assert.match(group, /props\.onDelete\?\.\(match\(\)\.group\.relPath, deleted\(\)\)/, 'a collection is archived from its own page');
});

test('this app says Projects, not Repositories', () => {
  const app = source(path.join('components', 'App.tsx'));
  const crumbs = source(path.join('components', 'Breadcrumbs.tsx'));
  const overview = source(path.join('components', 'Overview.tsx'));
  const search = source(path.join('components', 'SearchView.tsx'));
  const view = source(path.join('components', 'ProjectView.tsx'));

  for (const [name, text] of [
    ['App.tsx', app],
    ['Breadcrumbs.tsx', crumbs],
    ['Overview.tsx', overview],
    ['SearchView.tsx', search],
    ['ProjectView.tsx', view],
  ]) {
    assert.doesNotMatch(text, /Repositories/, `${name} still labels this app's own unit Repositories`);
  }
  assert.doesNotMatch(app, /repositories ·/, 'the rail counts projects, not repositories');

  assert.match(app, /aria-label="Projects"/, 'the rail list is the projects');
  assert.match(app, /Unknown project/, 'a route that names no project says project');
  assert.match(crumbs, /label: 'Projects'/, 'the trail starts at Projects');
  assert.match(overview, /text-section font-medium">Projects</, 'the overview section is Projects');
  assert.match(overview, /countLabel\(props\.snapshot\.projects\.length, 'project'\)/, 'and it counts projects');
  assert.match(search, /projects\.length\} projects/, 'search says it looked across projects');
  assert.match(view, /Recent in this project/, 'a project page says project');

  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.match(readme, /Projects wear the/, 'the docs name the same unit');
  assert.match(readme, /renders\s+`Projects \/ /, 'and the trail it draws');
});

/** The one answer every create needs, whether or not a license was chosen: which account the repository goes to. */
const ACCOUNT = { 'gh api user --jq .login': 'lleqsnoom\n' };

/**
 * A create runs against a base directory and a config file of its own, so no test reads or writes this repository's
 * `otter-pm.config.json` and none of them spawns anything: the seam is stubbed and every command is recorded.
 */
function createHarness({ stdout = {}, status = {}, fail = () => false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-projects-'));
  const configFile = path.join(base, 'otter-pm.config.json');
  fs.writeFileSync(configFile, JSON.stringify({ note: 'keep me', orca: false, roots: [], autoDiscover: [] }));

  const calls = [];
  const run = (command, args, options = {}) => {
    const call = { command, args, cwd: options.cwd };
    calls.push(call);
    const key = `${command} ${args.join(' ')}`;
    const failed = fail(call) || Boolean(status[key]);
    return { status: failed ? (status[key] ?? 1) : 0, stdout: stdout[key] ?? ACCOUNT[key] ?? '', stderr: failed ? `${key} failed` : '' };
  };

  return {
    base,
    configFile,
    calls,
    run,
    env: { ...process.env, OTTER_PM_CONFIG: configFile, OTTER_PM_PROJECTS_DIR: base },
    config: () => JSON.parse(fs.readFileSync(configFile, 'utf8')),
  };
}

const SPEC = { name: 'My Cool App', about: 'a small app that does one small thing' };

test('a create builds the project in a temp directory and renames it into place', async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness();

  const answer = createProject(SPEC, { run: harness.run, env: harness.env });

  assert.equal(answer.ok, true);
  assert.equal(answer.id, 'my-cool-app');
  assert.equal(answer.dir, path.join(harness.base, 'my-cool-app'));
  assert.equal(answer.root, path.join(harness.base, 'my-cool-app', '.x-skills'));
  assert.match(fs.readFileSync(path.join(answer.dir, 'README.md'), 'utf8'), /a small app that does one small thing/);

  const plans = fs.readdirSync(path.join(answer.root, 'plans'));
  assert.equal(plans.length, 1, 'one plan document, which is what makes the folder a root');
  assert.match(plans[0], /^\d{4}-\d{2}-\d{2}-my-cool-app\.md$/);
  assert.match(fs.readFileSync(path.join(answer.root, 'plans', plans[0]), 'utf8'), /a small app that does one small thing/);

  assert.ok(!fs.existsSync(path.join(harness.base, '.my-cool-app.otter-pm-tmp')), 'the temp directory is gone');
  assert.deepEqual(
    harness.calls.filter((call) => call.command === 'git').map((call) => call.args.join(' ')),
    ['init', 'add -A', '-c user.name=otter-pm -c user.email=otter-pm@localhost commit -m chore: start My Cool App'],
  );
  assert.ok(
    harness.calls.filter((call) => call.command === 'git').every((call) => call.cwd === path.join(harness.base, '.my-cool-app.otter-pm-tmp')),
    'git runs inside the temp directory, never in the target',
  );
});

test('a created project is a root, and its path is in the config exactly once', async () => {
  const { createProject } = await serverModule('create');
  const snapshotModule = await serverModule('snapshot');
  const harness = createHarness();

  const answer = createProject(SPEC, { run: harness.run, env: harness.env });
  assert.deepEqual(harness.config().roots, [answer.dir]);
  assert.equal(harness.config().note, 'keep me', 'the rest of the config survives');

  assert.equal(createProject(SPEC, { run: harness.run, env: harness.env }).ok, false, 'the same name is refused the second time');
  assert.deepEqual(harness.config().roots, [answer.dir], 'a refusal does not add the path again');

  process.env.OTTER_PM_CONFIG = harness.configFile;
  delete process.env.OTTER_PM_ROOTS;
  snapshotModule.invalidateSnapshot();
  const listed = snapshotModule.getSnapshot({ force: true });
  const created = listed.projects.find((project) => project.id === 'my-cool-app');
  assert.ok(created, 'the snapshot lists the project it just made');
  assert.equal(listed.rejected.length, 0, 'and it is a root, not a rejected path');
});

test('a name that cannot be a folder is refused before anything is written', async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness();

  for (const name of ['', '///', '..', '   ']) {
    const answer = createProject({ ...SPEC, name }, { run: harness.run, env: harness.env });
    assert.equal(answer.status, 400, `${JSON.stringify(name)} is refused`);
    assert.equal(answer.ok, false);
  }
  assert.deepEqual(fs.readdirSync(harness.base).sort(), ['otter-pm.config.json'], 'nothing was created');
  assert.equal(harness.calls.length, 0, 'and nothing was run');
});

test('a folder that is already there is refused, and left alone', async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness();
  fs.mkdirSync(path.join(harness.base, 'my-cool-app'));
  writeFile(path.join(harness.base, 'my-cool-app', 'notes.txt'), 'mine\n');

  const answer = createProject(SPEC, { run: harness.run, env: harness.env });

  assert.equal(answer.status, 409);
  assert.match(answer.error, /already exists/);
  assert.equal(fs.readFileSync(path.join(harness.base, 'my-cool-app', 'notes.txt'), 'utf8'), 'mine\n');
  assert.equal(harness.calls.length, 0);
});

test('a base directory that is not a directory is refused', async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness();

  const missing = createProject({ ...SPEC, baseDir: path.join(harness.base, 'nope') }, { run: harness.run, env: harness.env });
  assert.equal(missing.status, 400);
  assert.match(missing.error, /base directory/);

  const fileAsBase = path.join(harness.base, 'a-file');
  writeFile(fileAsBase, 'not a directory\n');
  assert.equal(createProject({ ...SPEC, baseDir: fileAsBase }, { run: harness.run, env: harness.env }).status, 400);
});

test('a create is its own route, and the next scan sees it', () => {
  const route = fs.readFileSync(path.join(APP_SRC, 'pages', 'api', 'project.ts'), 'utf8');

  assert.match(route, /export const POST/, 'the write is its own route, beside the ones that edit an artifact');
  assert.match(route, /createProject\(body\)/, 'and it hands the whole request to the one place a project is made');
  assert.match(route, /answer\.status/, 'a refusal keeps the status it was given');
  assert.match(route, /invalidateSnapshot\(\)/, 'the snapshot is dropped, so the new project is found');
  assert.match(route, /clearParseCache\(\)/, 'and so is the parse cache');
});

test('a reader can make a project from the rail', () => {
  const app = source(path.join('components', 'App.tsx'));
  const dialog = source(path.join('components', 'NewProject.tsx'));
  const api = source(path.join('lib', 'api.ts'));

  assert.match(app, /<NewProject/, 'the rail carries the form');
  assert.match(dialog, /new project/, 'under a control that names it');
  assert.match(api, /export function createProject\(/, 'the client has one way to make a project');
  assert.match(api, /fetch\('\/api\/project'/, 'which posts to the route that makes it');
  assert.match(dialog, /createProject\(/, 'the form posts through it');
  assert.match(dialog, /await refreshSnapshot\(\)/, 'then asks for the snapshot again');
  assert.match(dialog, /navigate\(\{ name: 'project', project: answer\.id \}\)/, 'so it can land on the project it just made');
});

test("a chosen license is written from GitHub's own text", async () => {
  const { createProject } = await serverModule('create');
  const body = 'MIT License\n\nCopyright (c) [year] [fullname]\n\nPermission is hereby granted, free of charge.';
  const harness = createHarness({
    stdout: { 'gh api /licenses/mit --jq .body': body, 'gh api user --jq .login': 'lleqsnoom\n' },
  });

  const answer = createProject({ ...SPEC, license: 'mit' }, { run: harness.run, env: harness.env });

  assert.equal(answer.ok, true);
  const license = fs.readFileSync(path.join(answer.dir, 'LICENSE'), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, new RegExp(String(new Date().getUTCFullYear())), 'the year is the year it was made');
  assert.match(license, /lleqsnoom/);
  assert.doesNotMatch(license, /\[year\]|\[fullname\]/, 'no placeholder survives');
  assert.ok(license.endsWith('\n'), 'and the file ends with one newline');
});

test('no license chosen writes no license file, and the create still works', async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness({ stdout: { 'gh api user --jq .login': 'lleqsnoom\n' } });

  const answer = createProject(SPEC, { run: harness.run, env: harness.env });

  assert.equal(answer.ok, true);
  assert.ok(!fs.existsSync(path.join(answer.dir, 'LICENSE')));
  assert.equal(harness.calls.filter((call) => call.args.join(' ').includes('/licenses/')).length, 0, 'no license text is asked for');
});

test("a license GitHub will not hand over stops the create", async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness({
    stdout: { 'gh api user --jq .login': 'lleqsnoom\n' },
    status: { 'gh api /licenses/mit --jq .body': 1 },
  });

  const answer = createProject({ ...SPEC, license: 'mit' }, { run: harness.run, env: harness.env });

  assert.equal(answer.status, 502);
  assert.ok(!fs.existsSync(path.join(harness.base, 'my-cool-app')));
  assert.ok(!fs.existsSync(path.join(harness.base, '.my-cool-app.otter-pm-tmp')));
});

test("the form's defaults are the account, the directory and GitHub's licenses", async () => {
  const { projectDefaults } = await serverModule('create');
  const harness = createHarness({
    stdout: {
      'gh api user --jq .login': 'lleqsnoom\n',
      'gh repo license list': 'mit\tMIT\tMIT License\napache-2.0\tApache-2.0\tApache License 2.0\n',
    },
  });

  const defaults = projectDefaults({ run: harness.run, env: harness.env });

  assert.equal(defaults.owner, 'lleqsnoom');
  assert.equal(defaults.baseDir, harness.base);
  assert.deepEqual(defaults.licenses, [
    { key: '', name: 'None' },
    { key: 'mit', name: 'MIT License' },
    { key: 'apache-2.0', name: 'Apache License 2.0' },
  ]);
});

test('a gh that will not answer still gives the form its licenses', async () => {
  const { projectDefaults } = await serverModule('create');
  const harness = createHarness({ status: { 'gh repo license list': 1, 'gh api user --jq .login': 1 } });

  const defaults = projectDefaults({ run: harness.run, env: harness.env });

  assert.equal(defaults.owner, null);
  assert.ok(defaults.licenses.length > 1, 'the fallback list is there');
  assert.equal(defaults.licenses[0].key, '');
});

test('a create pushes the project to GitHub, from the temp directory', async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness({ stdout: { 'gh api user --jq .login': 'lleqsnoom\n' } });
  const temp = path.join(harness.base, '.my-cool-app.otter-pm-tmp');

  const answer = createProject(SPEC, { run: harness.run, env: harness.env });

  assert.equal(answer.ok, true);
  assert.equal(answer.owner, 'lleqsnoom');
  assert.equal(answer.url, 'https://github.com/lleqsnoom/my-cool-app');
  assert.deepEqual(
    harness.calls.find((call) => call.command === 'gh' && call.args[0] === 'repo').args,
    [
      'repo',
      'create',
      'lleqsnoom/my-cool-app',
      '--source',
      temp,
      '--push',
      '--remote',
      'origin',
      '--description',
      SPEC.about,
      '--private',
    ],
    'built first, pushed explicitly, and never left to a prompt',
  );
  assert.ok(!fs.existsSync(temp), 'and the directory that was pushed is gone once it is renamed into place');
});

test('a public project is pushed public', async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness({ stdout: { 'gh api user --jq .login': 'lleqsnoom\n' } });

  createProject({ ...SPEC, visibility: 'public' }, { run: harness.run, env: harness.env });

  const argv = harness.calls.find((call) => call.command === 'gh' && call.args[0] === 'repo').args;
  assert.ok(argv.includes('--public'));
  assert.ok(!argv.includes('--private'));
});

test('a repository that cannot be created leaves the disk and the config untouched', async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness({
    stdout: { 'gh api user --jq .login': 'lleqsnoom\n' },
    fail: (call) => call.command === 'gh' && call.args[0] === 'repo',
  });
  const before = fs.readFileSync(harness.configFile, 'utf8');

  const answer = createProject(SPEC, { run: harness.run, env: harness.env });

  assert.equal(answer.status, 502);
  assert.match(answer.detail, /gh repo create .* failed/);
  assert.ok(!fs.existsSync(path.join(harness.base, 'my-cool-app')), 'the target path never appears');
  assert.ok(!fs.existsSync(path.join(harness.base, '.my-cool-app.otter-pm-tmp')), 'and the temp directory is removed');
  assert.equal(fs.readFileSync(harness.configFile, 'utf8'), before, 'the config is byte-identical');
});

test('a gh that is not authenticated refuses the create before anything is built', async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness({ fail: (call) => call.command === 'gh' && call.args[1] === 'user' });

  const answer = createProject(SPEC, { run: harness.run, env: harness.env });

  assert.equal(answer.status, 501);
  assert.match(answer.error, /not installed or not authenticated/);
  assert.deepEqual(fs.readdirSync(harness.base), ['otter-pm.config.json']);
});

test('the form asks for visibility and a license, and shows what the server refused', () => {
  const dialog = source(path.join('components', 'NewProject.tsx'));
  const api = source(path.join('lib', 'api.ts'));
  const route = fs.readFileSync(path.join(APP_SRC, 'pages', 'api', 'project.ts'), 'utf8');

  assert.match(route, /export const GET/, 'the form asks the server what a new project defaults to');
  assert.match(route, /projectDefaults\(\)/, 'which is the one place that knows');
  assert.match(api, /export function projectDefaults\(\)/, 'the client has one way to read them');
  assert.match(api, /fetch\('\/api\/project'\)/, 'from the same route that creates one');

  assert.match(dialog, /ToggleGroup/, "visibility is the app's own segmented control");
  assert.match(dialog, /label="Visibility"/, 'and it is labelled');
  assert.match(dialog, /visibility\(\)/, 'the choice travels with the request');
  assert.match(dialog, /license\(\)/, 'so does the license');
  assert.match(dialog, /<Select/, 'which is a select of what GitHub publishes');
  assert.match(source(path.join('ui', 'Select.tsx')), /<select/, 'drawn as the platform’s own control');
  assert.match(dialog, /setError\(/, 'and a refusal lands in the form');
});

test('a created project describes itself, and the scanner reads the description back', async () => {
  const { createProject } = await serverModule('create');
  const snapshotModule = await serverModule('snapshot');
  const harness = createHarness();

  const answer = createProject({ ...SPEC, icon: { text: '🚀', color: '#5b8def' } }, { run: harness.run, env: harness.env });

  const mark = fs.readFileSync(path.join(answer.root, 'project.md'), 'utf8');
  assert.match(mark, /^\*\*About:\*\* a small app that does one small thing$/m);
  assert.match(mark, /^\*\*Icon:\*\* 🚀$/m);
  assert.match(mark, /^\*\*Color:\*\* #5b8def$/m);

  process.env.OTTER_PM_CONFIG = harness.configFile;
  delete process.env.OTTER_PM_ROOTS;
  snapshotModule.invalidateSnapshot();
  const project = snapshotModule.getSnapshot({ force: true }).projects.find((entry) => entry.id === 'my-cool-app');

  assert.equal(project.about, 'a small app that does one small thing');
  assert.equal(project.iconText, '🚀');
  assert.equal(project.color, '#5b8def');
  assert.equal(project.iconSrc, null, 'a mark nobody set is nothing, not an empty string');
});

test('an icon URL travels as the image a tile would draw', async () => {
  const { createProject } = await serverModule('create');
  const snapshotModule = await serverModule('snapshot');
  const harness = createHarness();

  const answer = createProject(
    { ...SPEC, icon: { text: 'mc', color: '#5b8def', src: 'https://example.test/me.png' } },
    { run: harness.run, env: harness.env },
  );
  assert.match(fs.readFileSync(path.join(answer.root, 'project.md'), 'utf8'), /^\*\*Icon URL:\*\* https:\/\/example\.test\/me\.png$/m);

  process.env.OTTER_PM_CONFIG = harness.configFile;
  delete process.env.OTTER_PM_ROOTS;
  snapshotModule.invalidateSnapshot();
  const project = snapshotModule.getSnapshot({ force: true }).projects.find((entry) => entry.id === 'my-cool-app');
  assert.equal(project.iconSrc, 'https://example.test/me.png');
  assert.equal(project.iconText, 'mc');
});

test('a project with no mark of its own reads as it always did', async () => {
  const { root, snapshot } = await load();
  const project = snapshot.getSnapshot({ force: true }).projects[0];

  assert.equal(path.dirname(root), snapshot.getSnapshot({ force: true }).projects[0].repoPath);
  assert.equal(project.about, null);
  assert.equal(project.iconText, null);
  assert.equal(project.color, null);
  assert.equal(project.iconSrc, null);
});

test('the mark a project carries is what gets drawn, and what it is about is read', () => {
  const icon = source(path.join('components', 'ProjectIcon.tsx'));
  const overview = source(path.join('components', 'Overview.tsx'));
  const view = source(path.join('components', 'ProjectView.tsx'));
  const dialog = source(path.join('components', 'NewProject.tsx'));

  assert.match(icon, /props\.project\.iconSrc \?\? asset\(\) \?\? props\.project\.icon/, "the project's own image is drawn, then one it carries, then the IDE's");
  assert.match(icon, /iconText/, 'then its own text');
  assert.match(icon, /props\.project\.color \?\? props\.project\.badgeColor/, 'tinted by its own colour before the badge one');
  assert.match(icon, /<FolderIcon \/>/, 'and the folder mark is still the last resort');

  assert.match(overview, /when=\{props\.project\.about\}/, 'the overview card says what the project is about');
  assert.match(view, /when=\{props\.project\.about\}/, 'and so does the project page');

  assert.match(dialog, /iconText\(\)/, 'the form collects the icon text');
  assert.match(dialog, /color\(\)/, 'and its colour');
  assert.match(dialog, /iconSrc\(\)/, 'and an image URL');
});

test('a refusal stays in the form, with the reason the server gave', () => {
  const dialog = source(path.join('components', 'NewProject.tsx'));
  const api = source(path.join('lib', 'api.ts'));

  assert.match(api, /detail: body\?\.detail/, 'the reason a command failed travels with the error');
  assert.match(dialog, /setDetail\(/, 'the form keeps it');
  assert.match(dialog, /<details/, 'and shows it behind a disclosure, so a long reason cannot push the controls away');
  assert.match(dialog, /text-weak/, 'while the sentence itself is what a reader reads first');
  assert.match(dialog, /w-\[min\(30rem,calc\(100vw-2rem\)\)\]/, 'the dialog cannot be wider than the pane it is in');
  assert.match(dialog, /<Input/, "the dialog uses the app's own fields");
  assert.match(source(path.join('ui', 'Input.tsx')), /max-\[860px\]:h-11/, 'which are a thumb size at a phone width');
});

test('the create flow is written down where the next reader looks', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  assert.match(readme, /## Making a project/, 'the README describes the flow');
  assert.match(readme, /otter-pm-tmp/, 'including the directory it is built in');
  assert.match(readme, /run\(command, args/, 'and the seam every test stubs');
  assert.match(readme, /POST \/api\/project/, 'and names the routes');
  assert.match(readme, /\/api\/asset/, 'including the one that serves an uploaded icon');
  assert.match(readme, /Icon file/, 'and where an uploaded image is written');
  assert.match(readme, /made from the app/, 'and that it is the one thing made here rather than read');
});

test('the icon is chosen from a popup that shows marks, emoji and a colour', () => {
  const dialog = source(path.join('components', 'NewProject.tsx'));
  const picker = source(path.join('components', 'IconPicker.tsx'));
  const icons = source(path.join('components', 'icons.tsx'));

  assert.match(dialog, /<IconPicker/, 'the form leaves the icon to a control of its own');
  assert.match(picker, /@kobalte\/core\/popover/, 'which opens a popup rather than a row of fields');
  assert.match(picker, /<For each=\{EMOJIS\}>/, 'listing the emoji to choose from');
  assert.match(picker, /<For each=\{ICONS\}>/, "and the app's own marks");
  assert.match(icons, /export const ICONS/, 'drawn here, not fetched, like the rest of the rail');
  assert.match(picker, /<For each=\{SWATCHES\}>/, 'with a palette for the colour');
  assert.match(picker, /type="color"/, 'and a well for a colour of your own');
  assert.match(picker, /appearance-none/, "which wears the app's border instead of the browser's chrome");
  assert.match(picker, /<ProjectIcon/, 'so the control shows the mark it is about to set');
});

test('a named mark is drawn, and a select list is readable', () => {
  const icon = source(path.join('components', 'ProjectIcon.tsx'));
  const icons = source(path.join('components', 'icons.tsx'));
  const select = source(path.join('ui', 'Select.tsx'));

  assert.match(icons, /export const ICON_BY_ID/, 'the marks are looked up by the name a project stores');
  assert.match(icon, /NAMED_MARK/, 'a project may name one of them');
  assert.match(icon, /ICON_BY_ID/, 'and the tile draws it');

  assert.match(select, /bg-card/, 'a native select paints its own surface, or its list is light text on the browser white');
  assert.match(select, /\[&_option\]:bg-card/, 'and the options in its list paint theirs');
  assert.match(select, /\[&_option\]:text-foreground/, 'with the page’s own ink, not the list’s default');
});

/** An 8-byte PNG header: enough to be a file of the right type without carrying a picture in the test. */
const TINY_PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('an uploaded image is written into the project, and named by its mark', async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness();

  const answer = createProject(
    { ...SPEC, icon: { file: { name: 'logo.png', type: 'image/png', data: TINY_PNG.toString('base64') } } },
    { run: harness.run, env: harness.env },
  );

  assert.equal(answer.ok, true);
  assert.deepEqual(fs.readFileSync(path.join(answer.root, 'icon.png')), TINY_PNG, 'the bytes are the bytes');
  assert.match(
    fs.readFileSync(path.join(answer.root, 'project.md'), 'utf8'),
    /^\*\*Icon file:\*\* \.x-skills\/icon\.png$/m,
    'and the mark names where it went, relative to the repository',
  );
});

test('an upload that is not an image, or is too big, is refused before anything is built', async () => {
  const { createProject } = await serverModule('create');
  const harness = createHarness();

  const wrongType = createProject(
    { ...SPEC, icon: { file: { name: 'paper.pdf', type: 'application/pdf', data: TINY_PNG.toString('base64') } } },
    { run: harness.run, env: harness.env },
  );
  assert.equal(wrongType.status, 400);
  assert.match(wrongType.error, /not an image/);

  const tooBig = createProject(
    { ...SPEC, icon: { file: { name: 'huge.png', type: 'image/png', data: Buffer.alloc(3 * 1024 * 1024).toString('base64') } } },
    { run: harness.run, env: harness.env },
  );
  assert.equal(tooBig.status, 400);
  assert.match(tooBig.error, /larger than/);

  const empty = createProject({ ...SPEC, icon: { file: { name: 'empty.png', type: 'image/png', data: '' } } }, { run: harness.run, env: harness.env });
  assert.equal(empty.status, 400, 'an empty upload is not an icon');

  assert.deepEqual(fs.readdirSync(harness.base), ['otter-pm.config.json'], 'and nothing was built for any of them');
});

test('a project’s own icon is served from inside its root, and nothing else is', async () => {
  const { root, snapshot } = await load();
  writeFile(path.join(root, 'icon.png'), TINY_PNG);
  snapshot.invalidateSnapshot();
  const project = snapshot.getSnapshot({ force: true }).projects[0];

  const served = snapshot.readAsset(project.id, 'icon.png');
  assert.equal(served.status, 200);
  assert.equal(served.contentType, 'image/png');
  assert.deepEqual(Buffer.from(served.body), TINY_PNG);

  assert.equal(snapshot.readAsset(project.id, 'roadmap.md').status, 415, 'a document is not an image');
  assert.equal(snapshot.readAsset(project.id, '../../etc/passwd').status, 400, 'and no path escapes the root');
  assert.equal(snapshot.readAsset(project.id, 'nope.png').status, 404);

  const route = fs.readFileSync(path.join(APP_SRC, 'pages', 'api', 'asset.ts'), 'utf8');
  assert.match(route, /export const GET/, 'the image has its own route, because the file route answers JSON');
  assert.match(route, /readAsset/, 'which reads through the one place a path is resolved');
  assert.match(route, /content-type|contentType/, 'and answers with the type it read');
  assert.match(route, /nosniff/, 'so a browser cannot be talked into treating it as something else');
});

test('an image icon can be dropped or chosen, and the tile draws what the project carries', () => {
  const picker = source(path.join('components', 'IconPicker.tsx'));
  const icon = source(path.join('components', 'ProjectIcon.tsx'));
  const types = source(path.join('lib', 'types.ts'));
  const api = source(path.join('lib', 'api.ts'));

  assert.match(picker, /type="file"/, 'a file can be chosen');
  assert.match(picker, /onDrop=/, 'or dropped onto the field');
  assert.match(picker, /onDragOver=/, 'which says it will take it');
  assert.match(picker, /accept="image\//, 'images only');
  assert.match(picker, /FileReader|readAsDataURL/, 'read in the browser, so nothing has to be uploaded first');
  assert.match(picker, /2 \* 1024 \* 1024|2097152/, 'with the same ceiling the server refuses at');
  assert.match(api, /file\?: \{ name: string; type: string; data: string \}/, 'the drop travels with the create request');

  assert.match(types, /iconFile: string \| null/, 'a project carries the path of the image it was given');
  assert.match(icon, /iconFile/, 'and the tile draws it');
  assert.match(icon, /\/api\/asset\?/, 'from the route that serves it');
});

test('one mark at a time: a picture is drawn plain, and a choice replaces the last one', () => {
  const icon = source(path.join('components', 'ProjectIcon.tsx'));
  const picker = source(path.join('components', 'IconPicker.tsx'));

  assert.match(
    icon,
    /const own = \(\) => props\.project\.iconSrc \?\? asset\(\);/,
    'the project’s own picture is the image it carries, never the IDE’s avatar',
  );
  assert.match(icon, /const tint = \(\) => \(own\(\) \? null :/, 'so nothing is painted behind it: a transparent image must not sit on a coloured tile');

  assert.match(picker, /const chooseText = /, 'a mark, an emoji or letters is one way in');
  assert.match(picker, /const chooseSrc = /, 'an image URL is another');
  assert.match(picker, /const chooseFile = /, 'and a file is the third');
  assert.match(picker, /const chooseText = \(value[\s\S]{0,240}props\.onFile\(null\)/, 'each drops the mark it replaces');
  assert.match(picker, /const chooseFile = \(file[\s\S]{0,240}props\.onText\(''\)/, 'so two marks can never be set at once');
});
/**
 * Adding a folder that already exists needs a config file of its own and somewhere to point, so no test reads this
 * repository's `otter-pm.config.json` and none of them touches the machine's own roots.
 */
function rootsHarness() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-roots-'));
  const configFile = path.join(base, 'otter-pm.config.json');
  fs.writeFileSync(configFile, JSON.stringify({ note: 'keep me', orca: false, roots: [], autoDiscover: [] }));

  return {
    base,
    configFile,
    env: { ...process.env, OTTER_PM_CONFIG: configFile, OTTER_PM_ORCA: '0', OTTER_PM_ROOTS: '' },
    config: () => JSON.parse(fs.readFileSync(configFile, 'utf8')),
    folder: (name) => {
      const dir = path.join(base, name);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    },
  };
}

test('an existing folder is added, and given the least tree that makes it a root', async () => {
  const { addExistingProject } = await serverModule('roots');
  const harness = rootsHarness();
  const dir = harness.folder('existing-repo');
  fs.writeFileSync(path.join(dir, 'README.md'), 'mine\n');

  const answer = addExistingProject({ path: dir }, { env: harness.env });

  assert.equal(answer.ok, true);
  assert.equal(answer.id, 'existing-repo');
  assert.equal(answer.root, path.join(dir, '.x-skills'));
  assert.equal(answer.scaffolded, true, 'the tree was made, not found');
  assert.deepEqual(fs.readdirSync(path.join(dir, '.x-skills')), ['tasks'], 'one empty category, and nothing else');

  assert.deepEqual(harness.config().roots, [dir], 'the repository path is what is remembered');
  assert.equal(harness.config().note, 'keep me', 'and every other key survives');
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), 'mine\n', 'nothing already in the folder is touched');
  assert.ok(!fs.existsSync(path.join(dir, '.x-skills', 'project.md')), 'no mark is invented for it');
  assert.ok(!fs.existsSync(path.join(dir, '.git')), 'and no repository is made');
});

test('a folder that already has a tree is added as it is', async () => {
  const { addExistingProject } = await serverModule('roots');
  const harness = rootsHarness();
  const dir = harness.folder('already-a-root');
  fs.mkdirSync(path.join(dir, '.x-skills', 'plans'), { recursive: true });
  writeFile(path.join(dir, '.x-skills', 'plans', 'loose.md'), '# Loose\n');

  const answer = addExistingProject({ path: dir }, { env: harness.env });

  assert.equal(answer.ok, true);
  assert.equal(answer.scaffolded, false, 'nothing was made for a folder that already reads');
  assert.deepEqual(fs.readdirSync(path.join(dir, '.x-skills')), ['plans'], 'and nothing was added to the tree');
  assert.deepEqual(harness.config().roots, [dir]);
});

test('the same folder is refused the second time', async () => {
  const { addExistingProject } = await serverModule('roots');
  const harness = rootsHarness();
  const dir = harness.folder('twice');

  assert.equal(addExistingProject({ path: dir }, { env: harness.env }).ok, true);
  const again = addExistingProject({ path: dir }, { env: harness.env });

  assert.equal(again.ok, false);
  assert.equal(again.status, 409, 'already on the board is a conflict, not a bad request');
  assert.deepEqual(harness.config().roots, [dir], 'and a refusal does not add the path again');
});

test('a second folder may not take an id that is already read', async () => {
  const { addExistingProject } = await serverModule('roots');
  const harness = rootsHarness();
  const first = harness.folder(path.join('one', 'shared'));
  const second = harness.folder(path.join('two', 'shared'));

  assert.equal(addExistingProject({ path: first }, { env: harness.env }).ok, true);
  const refused = addExistingProject({ path: second }, { env: harness.env });

  assert.equal(refused.status, 409, 'the board and the archive are keyed by that id, so it cannot be taken twice');
  assert.match(refused.error, /shared/);
  assert.deepEqual(harness.config().roots, [first]);
});

test('a path that is missing, or is not a folder, is refused and writes nothing', async () => {
  const { addExistingProject } = await serverModule('roots');
  const harness = rootsHarness();
  const file = path.join(harness.base, 'a-file.txt');
  fs.writeFileSync(file, 'x\n');

  assert.equal(addExistingProject({}, { env: harness.env }).status, 400);
  assert.equal(addExistingProject({ path: '   ' }, { env: harness.env }).status, 400);
  assert.match(addExistingProject({ path: path.join(harness.base, 'nope') }, { env: harness.env }).error, /no such folder/);
  assert.equal(addExistingProject({ path: file }, { env: harness.env }).status, 400);
  assert.deepEqual(harness.config().roots, [], 'nothing was remembered');
});

test('the picker lists folders and never files', async () => {
  const { listDirectories } = await serverModule('roots');
  const harness = rootsHarness();
  harness.folder('app');
  harness.folder('api');
  harness.folder(path.join('app', '.x-skills', 'plans'));
  fs.mkdirSync(path.join(harness.base, '.hidden'), { recursive: true });
  fs.mkdirSync(path.join(harness.base, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(harness.base, 'notes.md'), '# notes\n');

  const answer = listDirectories(harness.base, { env: harness.env });

  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body.dirs.map((entry) => entry.name), ['api', 'app'], 'folders only, sorted, without the noise');
  assert.equal(answer.body.parent, path.dirname(harness.base), 'the answer carries where to go up to');
  assert.equal(answer.body.root, null, 'and this folder is not a root itself');
  assert.equal(
    answer.body.dirs.find((entry) => entry.name === 'app').root,
    path.join(harness.base, 'app', '.x-skills'),
    'a folder that is already readable says which root it is',
  );
});

test('the picker answers from the home directory when it is given no path', async () => {
  const { listDirectories } = await serverModule('roots');
  const answer = listDirectories(undefined, { env: rootsHarness().env });

  assert.equal(answer.status, 200, 'a picker always has somewhere to start');
  assert.equal(answer.body.path, os.homedir());
});

test('a picker may not be pointed at a file or at nothing', async () => {
  const { listDirectories } = await serverModule('roots');
  const harness = rootsHarness();
  const file = path.join(harness.base, 'a-file.txt');
  fs.writeFileSync(file, 'x\n');

  assert.equal(listDirectories(path.join(harness.base, 'nope'), { env: harness.env }).status, 404);
  assert.equal(listDirectories(file, { env: harness.env }).status, 400);
});

test('an existing folder is added from the rail, through its own routes', () => {
  const browse = fs.readFileSync(path.join(APP_SRC, 'pages', 'api', 'browse.ts'), 'utf8');
  const roots = fs.readFileSync(path.join(APP_SRC, 'pages', 'api', 'roots.ts'), 'utf8');
  const app = source(path.join('components', 'App.tsx'));
  const dialog = source(path.join('components', 'AddProject.tsx'));
  const api = source(path.join('lib', 'api.ts'));

  assert.match(browse, /export const GET/, 'the picker has its own read route, beside the one that writes');
  assert.match(browse, /listDirectories\(/, 'which is handed to the one place a folder is listed');
  assert.match(browse, /answer\.status/, 'a refusal keeps the status it was given');

  assert.match(roots, /export const POST/, 'adding a folder is its own route');
  assert.match(roots, /addExistingProject\(body\)/, 'and it hands the request to the one place a path is added');
  assert.match(roots, /invalidateSnapshot\(\)/, 'the snapshot is dropped, so the new root is found');
  assert.match(roots, /clearParseCache\(\)/, 'and so is the parse cache');

  assert.match(app, /<AddProject/, 'the rail carries the form');
  assert.match(dialog, /add existing/, 'under a control that names it');
  assert.match(dialog, /browseDirectory\(/, 'the picker walks the disk a level at a time');
  assert.match(dialog, /addProjectRoot\(/, 'and posts the folder it is standing in');
  assert.match(dialog, /await refreshSnapshot\(\)/, 'then asks for the snapshot again');
  assert.match(dialog, /navigate\(\{ name: 'project', project: answer\.id \}\)/, 'so it lands on the project it just added');

  assert.match(api, /export function browseDirectory\(/, 'the client has one way to list a folder');
  assert.match(api, /export function addProjectRoot\(/, 'and one way to add it');
  assert.match(api, /fetch\('\/api\/roots'/, 'which posts to the route that adds it');
});

test('adding an existing project is written down where the next reader looks', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  assert.match(readme, /## Adding a project that already exists/, 'the README describes the flow');
  assert.match(readme, /\+ add existing/, 'and names the control');
  assert.match(readme, /POST \/api\/roots/, 'and the two routes it uses');
  assert.match(readme, /GET \/api\/browse/, 'including the one the picker reads');
});
