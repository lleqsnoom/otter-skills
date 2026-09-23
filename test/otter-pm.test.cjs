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

/**
 * The tree the pipeline writes: one run folder per topic, every artifact numbered in the order it was built, and
 * the rung it read named by path in the artifact it produced. This is the shape `x-analyze → x-plan → x-decompose`
 * leaves on disk, plus the `E01-epic.md` a run written before the merge still holds, and the one a reader has to be
 * able to walk.
 */
function pipeline() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-pipeline-'));
  const root = path.join(repo, '.x-skills');
  const analysisRun = 'runs/2026-09-21-0748-R01-shared-key-rotation';
  const planRun = 'runs/2026-09-21-0832-R01-shared-media-kms-key';

  writeFile(
    path.join(root, analysisRun, 'state.json'),
    JSON.stringify({ skill: 'x-analyze', slug: 'shared-key-rotation', node: 'plan', stops: ['plan', 'tasks'], route: 'plan', report: 'E00-analysis.md' }),
  );
  writeFile(path.join(root, analysisRun, 'E00-analysis.md'), '# Analysis — shared key rotation\n\n**Date:** 2026-09-21 07:48\n\nThesis\n');

  writeFile(
    path.join(root, planRun, 'state.json'),
    JSON.stringify({ skill: 'x-plan', slug: 'shared-media-kms-key', node: 'handoff', stops: ['handoff'], report: 'E00-plan.md' }),
  );
  writeFile(
    path.join(root, planRun, 'E00-plan.md'),
    `# Spec — shared media KMS key

**Date:** 2026-09-21 08:32
**Input:** \`./${analysisRun}/E00-analysis.md\`
**Source:** \`.x-skills/runs/never-written/E00-analysis.md\`
**Branch:** lleqsnoom/shared-kms

---

contract:     the construct imports a key when one is named
`,
  );
  writeFile(path.join(root, planRun, 'E01-epic.md'), '# Epic — shared media KMS key\n\nspec: <run folder>/E00-plan.md\n');
  writeFile(path.join(root, planRun, 'E02-tasks', 'L0-0.1-config-table.md'), '# Task: config table\n\n**Layer:** 0\n**Effort:** 2h\n\n- [x] schema\n- [ ] wiring\n');
  writeFile(path.join(root, planRun, 'E02-tasks', 'L1-1.1-real-arns.md'), '# Task: real ARNs\n\n**Layer:** 1\n');

  // A run whose stages have no folder of their own in this repository: Triage is a category the registry knows
  // and this tree has never written to.
  writeFile(path.join(root, 'runs', '2026-09-22-0900-R01-media-tile-gaps', 'E00-triage.md'), '# Triage — media tile gaps\n\n**Platform:** web\n');

  // A run filed *inside* its own category — the older shape, where the session lives in `anal/`.
  writeFile(path.join(root, 'anal', 'session-a', 'state.json'), JSON.stringify({ skill: 'x-analyze', slug: 'session-a', node: 'route', stops: ['route'] }));
  writeFile(path.join(root, 'anal', 'session-a', 'E00-analysis.md'), '# Analysis — session a\n');

  return { repo, root, analysisRun, planRun };
}

async function scanPipeline() {
  const built = pipeline();
  const scan = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'scan.mjs')).href);
  scan.clearParseCache();
  return { ...built, project: scan.scanRoot(built.root) };
}

const fileAt = (category_, relPath) => category_.items.find((item) => item.relPath === relPath);

test('a run\'s stages also land in the category that names their kind', async () => {
  const { project, analysisRun, planRun } = await scanPipeline();
  const runs = category(project, 'runs');

  for (const [id, relPath] of [
    ['analysis', `${analysisRun}/E00-analysis.md`],
    ['plan', `${planRun}/E00-plan.md`],
  ]) {
    const stage = fileAt(category(project, id), relPath);
    assert.ok(stage, `${id} reads the stage its run wrote`);
    assert.equal(stage.runPath, relPath.slice(0, relPath.lastIndexOf('/')), 'a stage says which run it belongs to');
  }

  assert.deepEqual(
    category(project, 'plan')
      .items.filter((item) => item.runPath === planRun)
      .map((item) => item.name),
    ['E00-plan.md'],
    'and the legacy epic beside it is not read as a second plan: one document, one card',
  );

  assert.equal(fileAt(category(project, 'plan'), `${planRun}/E00-plan.md`).runTitle, 'shared-media-kms-key');
  assert.equal(
    runs.groups.find((group) => group.relPath === planRun).files.filter((file) => file.step !== null).length,
    2,
    'the run still holds its own stages — the same files in two places, not moved',
  );
});

test('a legacy epic is read as the plan it was', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-legacy-epic-'));
  const root = path.join(repo, '.x-skills');
  const run = 'runs/2026-01-02-1015-R01-sample';
  writeFile(path.join(root, run, 'E00-epic.md'), '# Epic — sample\n\n### Layer 0 — x\n');
  writeFile(path.join(root, run, 'E01-tasks', 'L0-0.1-first.md'), '# Task: first\n');

  const { scanRoot } = await serverModule('scan');
  const project = scanRoot(root, { name: 'legacy-epic' });
  const epic = fileAt(category(project, 'plan'), `${run}/E00-epic.md`);

  assert.ok(epic, 'a run folder `x-epic` already wrote is not orphaned by the skill being gone');
  assert.equal(epic.kind, 'plan', 'the kind is the plan’s, which is the document the file holds');
  assert.equal(epic.runPath, run, 'filed where a plan is filed, under the run that wrote it');
  assert.deepEqual(
    category(project, 'runs').groups[0].stages.map((stage) => [stage.step, stage.kind]),
    [
      [0, 'plan'],
      [1, 'tasks'],
    ],
    'and at the plan’s rung, above the tasks it was decomposed into',
  );
  assert.equal(category(project, 'epics'), undefined, 'no `Epics` category is made for it: a folder names a category, an artifact does not');

  const { epicIndex, epicOfTasks } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'epics.mjs')).href);
  assert.equal(
    epicOfTasks(epicIndex(project.categories), { runPath: run, step: 1, name: 'E01-tasks' }).relPath,
    epic.relPath,
    'and its tasks still claim it: the epic is the plan at the rung above them',
  );
});

test('a stage is not listed twice in the category it already sits in', async () => {
  const { project } = await scanPipeline();
  const analysis = category(project, 'analysis');

  assert.deepEqual(
    analysis.groups.map((group) => group.relPath),
    ['anal/session-a'],
    'the session is a collection of Analysis, as it always was',
  );
  assert.equal(
    analysis.items.filter((item) => item.relPath.startsWith('anal/')).length,
    0,
    'and its own analysis is not then listed again as a document of the same category',
  );
});

test("a kind no folder claims gets its category from the registry", async () => {
  const { project } = await scanPipeline();
  const triage = category(project, 'triage');

  assert.ok(triage, 'Triage appears for a run that triaged something even though no `triage/` folder exists');
  assert.equal(triage.label, 'Triage');
  assert.equal(triage.fromRuns, true, 'and it says it was named by the runs rather than read from a folder');
  assert.deepEqual(triage.dirs, [], 'no directory was read for it');
  assert.deepEqual(triage.items.map((item) => item.name), ['E00-triage.md']);
});

test("a run's tasks folder is a collection in Tasks", async () => {
  const { project, planRun } = await scanPipeline();
  const group = category(project, 'tasks').groups.find((candidate) => candidate.relPath === `${planRun}/E02-tasks`);

  assert.ok(group, 'the tasks rung lands in Tasks');
  assert.equal(group.title, 'shared-media-kms-key', 'titled by the run that wrote it, not by the first task in it');
  assert.equal(group.state, null, 'the folder itself is not a run');
  assert.deepEqual(group.files.map((file) => file.name).sort(), ['L0-0.1-config-table.md', 'L1-1.1-real-arns.md']);
  assert.deepEqual(group.progress, { done: 1, total: 2, ratio: 0.5 }, 'its checklists are the collection\'s progress');
});

test('the stages of a run are the ladder it built', async () => {
  const { project, planRun } = await scanPipeline();
  const run = category(project, 'runs').groups.find((group) => group.relPath === planRun);

  assert.deepEqual(
    run.stages.map((stage) => [stage.step, stage.kind]),
    [
      [0, 'plan'],
      [1, 'plan'],
      [2, 'tasks'],
    ],
    'E00 plan, E01 the same plan under its legacy name, E02 tasks — numbered in the order they were written',
  );
  assert.equal(run.stages[2].isDirectory, true, 'a stage can be a folder');
  assert.equal(run.stages[2].name, 'E02-tasks', 'and it is named for the entry it came from, counted by the collection it became');
  assert.deepEqual(
    run.files.map((file) => file.step),
    [0, 1, null, null],
    'every numbered artifact carries its rung, and a task file is not a rung of the run',
  );
});

test('an artifact names the one it read, and a path that leads nowhere is not a link', async () => {
  const { project, planRun } = await scanPipeline();
  const plan = fileAt(category(project, 'plan'), `${planRun}/E00-plan.md`);

  assert.deepEqual(plan.links, [
    {
      label: 'Input',
      path: 'runs/2026-09-21-0748-R01-shared-key-rotation/E00-analysis.md',
      name: 'E00-analysis.md',
    },
  ], 'the analysis this plan came from, and not the path that was never written');

  const epic = category(project, 'runs')
    .groups.find((group) => group.relPath === planRun)
    .files.find((file) => file.name === 'E01-epic.md');
  assert.deepEqual(epic.links, [], 'a skeleton placeholder is not a link either');
});

test('one artifact read in two places is one hit in search', async () => {
  const { onePerPath } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'board.mjs')).href);

  const card = { relPath: 'runs/x/E00-plan.md', title: 'the card' };
  const inside = { relPath: 'runs/x/E00-plan.md', title: 'the same file, read inside its run' };
  assert.deepEqual(onePerPath([card, inside]), [card], 'the first reading is kept');
  assert.deepEqual(onePerPath([card, { relPath: 'runs/x/E01-epic.md' }]).length, 2);
});


test('a stage folder with no collection of its own is still a rung of the run that owns it', async () => {
  // A run filed inside the category its own stage belongs to: `tasks/<run>/E00-tasks/` is skipped where it would be
  // the same work listed twice, so the rung has no collection — and a run that dropped it would misreport the order
  // it was built in.
  const { root, scan } = await load();
  const session = path.join(root, 'tasks', '2026-01-01-session');
  writeFile(path.join(session, 'state.json'), JSON.stringify({ skill: 'x-decompose', slug: 'session', node: 'handoff', stops: ['handoff'] }));
  writeFile(path.join(session, 'E00-tasks', 'L0-0.1-a.md'), '# Task: a\n');
  scan.clearParseCache();

  const project = scan.scanRoot(root);
  const run = category(project, 'tasks').groups.find((group) => group.relPath === 'tasks/2026-01-01-session');
  const rung = run.stages.find((stage) => stage.relPath === 'tasks/2026-01-01-session/E00-tasks');

  assert.equal(rung.kind, 'tasks', 'the run numbers the folder as a stage of its own');
  assert.equal(rung.isDirectory, true);
  assert.equal(
    category(project, 'tasks').groups.some((group) => group.relPath === 'tasks/2026-01-01-session/E00-tasks'),
    false,
    'and no collection was ever created for it, so the run is the page it is read on',
  );
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

/**
 * A board store of one's own: a project's board lives in its `.x-skills`, so a test needs a root and an id — and a
 * config path that does not exist, so the file this app used to write is never found by accident.
 */
function boardFixture(prefix) {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), '.x-skills');
  fs.mkdirSync(root, { recursive: true });
  return { root, id: path.basename(path.dirname(root)) };
}

const boardModule = () => import(pathToFileURL(path.join(ROOT, 'src', 'server', 'board.mjs')).href);

test('a column move is written into the project, read back, and cleared by moving the card home', async () => {
  const { root, id } = boardFixture('xskills-board-');
  const { boardForProject, writeMove, BOARD_COLUMNS } = await boardModule();
  const board = () => boardForProject({ root, projectId: id });

  assert.deepEqual(board().moves, {}, 'a project nothing has been filed in has no board, not an error');

  const written = writeMove({ root, relPath: 'runs/x', column: 'closed' });
  assert.equal(written.ok, true);
  assert.equal(written.file, path.join(root, 'board.json'), 'the decision is written inside the project it is about');

  const key = `${id}:runs/x`;
  assert.deepEqual(board().moves[key], { column: 'closed', at: board().moves[key].at });
  assert.match(board().moves[key].at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, 'board.json'), 'utf8')).moves,
    { 'runs/x': { column: 'closed', at: board().moves[key].at } },
    'and the file itself is keyed by the artifact path: one file is already about one project',
  );

  const cleared = writeMove({ root, relPath: 'runs/x', column: null });
  assert.equal(cleared.ok, true);
  assert.deepEqual(board().moves, {}, 'filing a card home removes the preference instead of storing a no-op');

  const bad = writeMove({ root, relPath: 'runs/x', column: 'sideways' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown column/);
  assert.deepEqual(board().moves, {});

  assert.deepEqual(BOARD_COLUMNS, ['todo', 'active', 'unknown', 'done', 'closed']);
});

test('two projects keep two boards, and neither sees the other', async () => {
  const first = boardFixture('xskills-board-a-');
  const second = boardFixture('xskills-board-b-');
  const { boardForProject, writeMove } = await boardModule();

  writeMove({ root: first.root, relPath: 'runs/x', column: 'done' });
  writeMove({ root: second.root, relPath: 'runs/x', column: 'closed' });

  const a = boardForProject({ root: first.root, projectId: first.id });
  const b = boardForProject({ root: second.root, projectId: second.id });
  assert.deepEqual(Object.keys(a.moves), [`${first.id}:runs/x`]);
  assert.deepEqual(Object.keys(b.moves), [`${second.id}:runs/x`]);
  assert.equal(a.moves[`${first.id}:runs/x`].column, 'done');
  assert.equal(b.moves[`${second.id}:runs/x`].column, 'closed');
});

test('an import moves the old shared board into each project it holds decisions for', async () => {
  const first = boardFixture('xskills-board-import-');
  const second = boardFixture('xskills-board-import-');
  const { importLegacyBoard, boardForProject } = await boardModule();
  const file = path.join(os.tmpdir(), `xskills-legacy-${Date.now()}.json`);
  writeFile(
    file,
    JSON.stringify({
      moves: {
        [`${first.id}:runs/x`]: { column: 'closed', at: '2026-01-01T00:00:00.000Z' },
        [`${second.id}:runs/y`]: { column: 'done', at: null },
      },
      deleted: { [`${first.id}:runs/z`]: { at: '2026-01-02T00:00:00.000Z' } },
      orders: { [`${first.id}:closed`]: ['runs/x'], [`${second.id}:done`]: ['runs/y'] },
    }),
  );

  const report = importLegacyBoard({
    file,
    projects: [
      { id: first.id, root: first.root },
      { id: second.id, root: second.root },
      { id: 'never-filed', root: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-empty-')), '.x-skills') },
    ],
  });

  assert.equal(report.exists, true);
  assert.deepEqual(
    report.projects.map((entry) => [entry.id, entry.status]),
    [
      [first.id, 'imported'],
      [second.id, 'imported'],
      ['never-filed', 'empty'],
    ],
    'a project the file holds nothing for is not a project to write a board into',
  );
  assert.deepEqual(report.projects[0].counts, { moves: 1, deleted: 1, orders: 1 });

  assert.deepEqual(boardForProject({ root: first.root, projectId: first.id }), {
    file: path.join(first.root, 'board.json'),
    moves: { [`${first.id}:runs/x`]: { column: 'closed', at: '2026-01-01T00:00:00.000Z' } },
    deleted: { [`${first.id}:runs/z`]: { at: '2026-01-02T00:00:00.000Z' } },
    orders: { [`${first.id}:closed`]: ['runs/x'] },
  });
  assert.deepEqual(
    Object.keys(boardForProject({ root: second.root, projectId: second.id }).moves),
    [`${second.id}:runs/y`],
    'and each project got only its own',
  );
  assert.equal(
    fs.existsSync(path.join(report.projects[2].file)),
    false,
    'no empty board was written for the project that had nothing filed in it',
  );
});

test('an import fills in a project that has filed since, and overwrites nothing it already says', async () => {
  const { root, id } = boardFixture('xskills-board-import-merged-');
  const { importLegacyBoard, writeMove, boardForProject } = await boardModule();
  writeMove({ root, relPath: 'runs/filed-since', column: 'active' });

  const file = path.join(os.tmpdir(), `xskills-legacy-merged-${Date.now()}.json`);
  writeFile(
    file,
    JSON.stringify({
      moves: {
        [`${id}:runs/x`]: { column: 'closed', at: null },
        // The same card, decided differently before the change: the project's own file was written later.
        [`${id}:runs/filed-since`]: { column: 'done', at: '2026-01-01T00:00:00.000Z' },
      },
      orders: { [`${id}:closed`]: ['runs/x'] },
    }),
  );

  const report = importLegacyBoard({ file, projects: [{ id, root }] });
  assert.equal(report.projects[0].status, 'merged', 'the project has a board of its own, and it keeps it');
  assert.equal(report.projects[0].added, 2, 'two entries the project does not already answer for');

  const board = boardForProject({ root, projectId: id });
  assert.equal(board.moves[`${id}:runs/filed-since`].column, 'active', 'the decision made since wins');
  assert.equal(board.moves[`${id}:runs/x`].column, 'closed', 'and what was filed before the change arrives');
  assert.deepEqual(board.orders[`${id}:closed`], ['runs/x']);

  const again = importLegacyBoard({ file, projects: [{ id, root }] });
  assert.equal(again.projects[0].added, 0, 'a second run has nothing left to take');
});

test('a dry run reports what it would take and writes nothing', async () => {
  const { root, id } = boardFixture('xskills-board-import-dry-');
  const { importLegacyBoard } = await boardModule();
  const file = path.join(os.tmpdir(), `xskills-legacy-dry-${Date.now()}.json`);
  writeFile(file, JSON.stringify({ moves: { [`${id}:runs/x`]: { column: 'closed', at: null } } }));

  const report = importLegacyBoard({ file, projects: [{ id, root }], dryRun: true });
  assert.equal(report.projects[0].status, 'imported');
  assert.equal(fs.existsSync(path.join(root, 'board.json')), false, 'nothing was written');

  const missing = importLegacyBoard({ file: path.join(os.tmpdir(), 'xskills-nothing-here.json'), projects: [{ id, root }] });
  assert.equal(missing.exists, false);
  assert.deepEqual(missing.projects.map((entry) => entry.status), ['empty'], 'a file that is not there holds nothing to take');
});

test('a project board that cannot be read is an empty board, never a failed snapshot', async () => {
  const { root, id } = boardFixture('xskills-board-bad-');
  const { boardForProject, projectBoardFile, legacyBoardFile } = await boardModule();

  assert.match(projectBoardFile(root), /\.x-skills[/\\]board\.json$/);
  assert.match(legacyBoardFile({ OTTER_PM_BOARD: '/tmp/elsewhere.json' }), /elsewhere\.json$/,
    'the old file is still nameable, which is how the import is pointed at one');
  assert.match(legacyBoardFile({}), /board\.json$/, 'and it defaults to the one beside otter-pm.config.json');

  writeFile(path.join(root, 'board.json'), 'not json at all');
  assert.deepEqual(boardForProject({ root, projectId: id }).moves, {});

  writeFile(
    path.join(root, 'board.json'),
    JSON.stringify({ moves: { 'runs/a': { column: 'nonsense' }, 'runs/b': { column: 'done' } } }),
  );
  assert.deepEqual(Object.keys(boardForProject({ root, projectId: id }).moves), [`${id}:runs/b`]);
});

test('an item is archived and brought back, in the same file as a move', async () => {
  const { root, id } = boardFixture('xskills-delete-');
  const { boardForProject, writeDeletion, writeMove } = await boardModule();
  const board = () => boardForProject({ root, projectId: id });
  const key = `${id}:runs`;

  assert.deepEqual(board().deleted, {}, 'nothing deleted before anything is');

  const written = writeDeletion({ root, relPath: 'runs', deleted: true });
  assert.equal(written.ok, true);
  assert.match(board().deleted[key].at, /^\d{4}-\d{2}-\d{2}T/);

  writeMove({ root, relPath: 'runs', column: 'done' });
  assert.equal(board().moves[key].column, 'done', 'filing and archiving are two decisions, and neither clears the other');
  assert.ok(board().deleted[key]);

  const restored = writeDeletion({ root, relPath: 'runs', deleted: false });
  assert.equal(restored.ok, true);
  assert.deepEqual(board().deleted, {}, 'an unarchive removes the entry rather than storing a false');
  assert.equal(board().moves[key].column, 'done', 'and the filing it had is still there');
});

test('the import command says per project what it took, and exits non-zero when there is nothing to take', async () => {
  const { spawnSync } = require('node:child_process');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xskills-import-'));
  const root = path.join(repo, '.x-skills');
  // A root is a `.x-skills` with a tree in it — `runs/` is what says so, and an empty directory is not a project.
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
  const id = path.basename(repo).toLowerCase().replace(/[^a-z0-9_.-]+/g, '-');

  const legacy = path.join(repo, 'legacy.json');
  writeFile(
    legacy,
    JSON.stringify({ moves: { [`${id}:runs/x`]: { column: 'closed', at: null } }, orders: { 'other:done': ['runs/y'] } }),
  );

  // The two env names the resolver reads: this repository is the only root, and the IDE's own list stays out of it.
  const run = (args) =>
    spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'import-board.mjs'), ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        OTTER_PM_ROOTS: repo,
        OTTER_PM_CONFIG: path.join(repo, 'no-such-config.json'),
        OTTER_PM_ORCA: '0',
      },
    });

  const imported = run(['--from', legacy]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, new RegExp(`${id}: 1 moves`), 'the report counts what it took, per project');
  assert.match(imported.stdout, /1 decision into 1 project/);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, 'board.json'), 'utf8')).moves,
    { 'runs/x': { column: 'closed', at: null } },
    'and the decision is in the project',
  );

  const nothingLeft = run(['--from', legacy]);
  assert.equal(nothingLeft.status, 1, 'a second run has nothing to do, and says so by failing');
  assert.match(nothingLeft.stdout, /nothing to import/);

  const missing = run(['--from', path.join(repo, 'nope.json')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /is not there/);

  const dry = run(['--from', path.join(repo, 'nope.json'), '--dry-run']);
  assert.match(dry.stdout + dry.stderr, /not there/);

  const bad = run(['--sideways']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Unknown argument/);
  assert.ok(root);
});

test('a write answers with one project’s decisions, and the client replaces that project’s slice', async () => {
  const { replaceProject } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'board.mjs')).href);
  const before = { 'a:runs/x': { column: 'done' }, 'b:runs/x': { column: 'closed' } };

  assert.deepEqual(
    replaceProject(before, 'a', { 'a:runs/y': { column: 'todo' } }),
    { 'b:runs/x': { column: 'closed' }, 'a:runs/y': { column: 'todo' } },
    'the slice is replaced, so an entry a write removed disappears here as well',
  );
  assert.deepEqual(replaceProject(before, 'a', {}), { 'b:runs/x': { column: 'closed' } }, 'filing a card home leaves nothing');
  assert.deepEqual(
    replaceProject({ 'a:closed': ['runs/x'], 'b:done': ['runs/y'] }, 'a', { 'a:closed': ['runs/y', 'runs/x'] }),
    { 'b:done': ['runs/y'], 'a:closed': ['runs/y', 'runs/x'] },
    "and it is one rule for a lane's order too",
  );
});


test('a malformed deletion entry is dropped, not read as a deletion', async () => {
  const { root, id } = boardFixture('xskills-delete-bad-');
  const { boardForProject } = await boardModule();
  writeFile(
    path.join(root, 'board.json'),
    JSON.stringify({ deleted: { 'runs/a': 'yes', 'runs/b': null, 'runs/c': { at: 5 } } }),
  );

  const read = boardForProject({ root, projectId: id });
  assert.deepEqual(Object.keys(read.deleted), [`${id}:runs/c`], 'only an entry that is an object is a deletion');
  assert.equal(read.deleted[`${id}:runs/c`].at, null, 'an `at` that is not a time is no time');
});

test('a drop records the place a card landed in, and the lane is where the order is kept', async () => {
  const { root, id } = boardFixture('xskills-order-');
  const { orderKey } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'board.mjs')).href);
  const { boardForProject, writeMove } = await boardModule();
  const board = () => boardForProject({ root, projectId: id });
  const move = (relPath, column, order) => writeMove({ root, relPath, column, order });

  assert.deepEqual(board().orders, {}, 'no file yet is no order, not an error');
  assert.equal(orderKey('fixture', 'todo'), 'fixture:todo');

  const written = move('runs/b', 'todo', { column: 'todo', paths: ['runs/a', 'runs/b', 'runs/c'] });
  assert.equal(written.ok, true);
  assert.deepEqual(board().orders[`${id}:todo`], ['runs/a', 'runs/b', 'runs/c']);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, 'board.json'), 'utf8')).orders,
    { todo: ['runs/a', 'runs/b', 'runs/c'] },
    'the lane is stored under its own column, because the file is already one project',
  );

  move('runs/d', 'done', { column: 'done', paths: ['runs/e', 'runs/d'] });
  assert.deepEqual(
    board().orders[`${id}:todo`],
    ['runs/a', 'runs/b', 'runs/c'],
    'another lane is another order, and writing one leaves the other alone',
  );

  // Sorting inside the lane a card's own data already gives it clears the move and keeps the order: the column was
  // never in question, and the place is what the reader decided.
  move('runs/b', null, { column: 'todo', paths: ['runs/b', 'runs/a', 'runs/c'] });
  assert.equal(board().moves[`${id}:runs/b`], undefined, 'a card put back where its data has it keeps no move');
  assert.equal(board().moves[`${id}:runs/d`].column, 'done', 'and the move it did not touch is still there');
  assert.deepEqual(board().orders[`${id}:todo`], ['runs/b', 'runs/a', 'runs/c'], 'while the lane reads the way it was left');

  move('runs/b', null, { column: 'todo', paths: ['runs/a', 7, '', 'runs/a', 'runs/b'] });
  assert.deepEqual(board().orders[`${id}:todo`], ['runs/a', 'runs/b'], 'a path is in a lane once, and only a path is a place');

  move('runs/b', null, { column: 'todo', paths: [] });
  assert.equal(board().orders[`${id}:todo`], undefined, 'an emptied lane stores no order to contradict the empty lane it is');

  const bad = move('runs/b', null, { column: 'sideways', paths: ['runs/b'] });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown column/);
});

test('a malformed order is dropped rather than half-read', async () => {
  const { root, id } = boardFixture('xskills-order-bad-');
  const { boardForProject } = await boardModule();
  const orders = () => boardForProject({ root, projectId: id }).orders;

  writeFile(path.join(root, 'board.json'), JSON.stringify({ orders: { todo: 'runs/a', done: null, active: [] } }));
  assert.deepEqual(orders(), {}, 'an order is a list with something in it, or it is not an order');

  writeFile(path.join(root, 'board.json'), JSON.stringify({ orders: { todo: ['runs/a', 7, '', 'runs/a', 'runs/b'] } }));
  assert.deepEqual(orders()[`${id}:todo`], ['runs/a', 'runs/b'], 'and reading it back keeps only the places in it');
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
  // The two decisions this app writes share one file, so what they have in common is pinned where it now lives.
  const decide = fs.readFileSync(path.join(APP_SRC, 'pages', 'api', '_decide.ts'), 'utf8');
  const types = source(path.join('lib', 'types.ts'));

  assert.match(board, /orderedLane\(/, 'a lane is drawn in the order the reader left it');
  assert.match(board, /placeAtPointer\(cards\.map\(\(card\) => card\.getBoundingClientRect\(\)\), clientY\)/, 'a lane hands a pointer height and the cards it can see to the rule, which is where the measuring lives');
  assert.match(board, /props\.onMove\(item, column, \{ column, paths \}\)/, 'a drop hands over the whole lane, because a place only means something against the cards around it');
  assert.match(board, /props\.onMove\(item, next, null\)/, 'a keyboard move names a lane and no place, so it writes no order and cannot freeze a lane nobody sorted by hand');
  assert.match(board, /const items = createMemo\(\(\) => props\.items\)/, 'a lane reads its own list once per change, not once per read: that list is a filter and a sort of the whole project');
  assert.match(board, /const carriedAt = createMemo\(/, 'and the card in hand is one index for the lane, because a reading taken per card rebuilt the lane on every pointer move');
  assert.match(board, /const slotBoundary = \(\) => \(props\.carried \? landingBoundary\(landing\(\), carriedAt\(\)\) : -1\)/, 'the place a drop lands is one boundary between two cards, measured once for the lane');
  assert.match(board, /order: slotOrder\(\)/, 'and it is drawn by moving one `order`, so a pointer move writes one number instead of opening a slot in every card');
  assert.match(board, /order=\{rendered\(\) \* 2 \+ 1\}/, 'a card holds an odd row, which is what leaves the even ones for the slot');
  assert.match(board, /height: `\$\{props\.carried\?\.height \?\? 0\}px`/, 'and the slot is the size of the card in hand, which is the shape the place will take');
  assert.match(board, /current\?\.column === dragged && current\.index === index \? current : \{ column: dragged, index \}/, 'a place that did not move is not news, so the same gap crossed twice is not drawn twice');
  // The flicker this board had: `dragleave` fires on every boundary crossed *inside* a lane too — card to card, and
  // card to the slot that has just opened under the pointer — and clearing the drop on each of those un-mounted the
  // slot and let the cards under it jump, forty times down one lane. Only a leave that arrives outside counts.
  assert.match(board, /onDragLeave=\{leaveLane\}/, 'a lane is left only through the one handler that can tell a leave from a crossing');
  assert.match(board, /leftLane\(\{ x: event\.clientX, y: event\.clientY \}, lane\.getBoundingClientRect\(\), entering !== null && lane\.contains\(entering\)\)/, 'and that handler reads the two signs a leave carries and hands them to the rule');
  assert.match(board, /props\.onDragStart\?\.\(props\.item, \(event\.currentTarget as HTMLElement\)\.offsetHeight\)/, 'the height is read off the card when it is picked up, because that is the only moment the card is still the card');
  assert.match(view, /column === own \? null : column, order/, 'putting a card back where its data has it clears the move and keeps the place — the column was never the decision');
  assert.match(api, /order: BoardOrder \| null = null/, 'the client sends the place with the filing, in one write');
  assert.match(app, /board: replaceProject\(current\.board, item\.projectId, answer\.board\)/, 'the snapshot replaces what the server answered for that project');
  assert.match(app, /orders: replaceProject\(current\.orders, item\.projectId, answer\.orders\)/, 'because an entry a write removed has to disappear here too, and a merge cannot remove');
  assert.match(decide, /boardForProject\(\{ root: project\.root, projectId: project\.id \}\)/, 'the answer is that project’s board as its file now reads, not a re-scan of every root the drop never touched');
  assert.match(decide, /const project = findProject\(id\)/, 'and the write resolves the project, because only the tree knows where its decisions live');
  assert.match(route, /root: target\.project\.root/, 'which is inside the repository the card is about');
  assert.doesNotMatch(route + decide, /getSnapshot/, 'so a drop pays for its own write and for nothing else');
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
  assert.match(source(path.join('components', 'App.tsx')), /<FilePage\b[\s\S]*?path=\{routeFilePath\(\)\}/, 'and a file’s address is answered by the one component that decides whether it has a page of its own');
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
  assert.match(route, /deletions: board\.deleted/, 'and the answer is that project’s board as its file now reads, not a re-scan of every root the archive never touched');
  assert.match(route, /root: target\.project\.root/, 'written into the project the artifact belongs to');
  assert.match(api, /export function deleteItem\(project: string, path: string, deleted: boolean\)/, 'the client names the direction');
  assert.match(app, /const remove = async \(item: WorkItem, deleted: boolean\)/, 'one handler for both directions, like a card’s filing');
  assert.match(app, /deletions: replaceProject\(current\.deletions, projectId, answer\.deletions\)/, 'and only that project’s decisions change in the snapshot, not a re-scan');
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

/**
 * An epic and the work it was split into are two documents in two folders, and neither names the other. The link
 * between them is in the tree, and it is read by `epics.mjs`: the run and the rung they are both stages of, or the
 * slug they were both given. Everything the board says about an epic — which tasks are inside it, how far along it
 * is — rests on this, so the rules are pinned here rather than through a screen.
 */
test('an epic and the work it was split into are found by the rung they share, or the slug', async () => {
  const { epicSlug, epicIndex, epicOfSelf, epicOfTasks, epicColorIndex, epicColor, EPIC_PALETTE } = await import(
    pathToFileURL(path.join(ROOT, 'src', 'lib', 'epics.mjs')).href
  );

  // Every spelling a repository has used for the stamp in front of a slug: two for the day-first folders, a colon
  // and a hyphen for the clock, and the two older year-first names.
  assert.equal(epicSlug('01-09-2026-11:23-segmentation-webcodecs-proxy-upload.md'), 'segmentation-webcodecs-proxy-upload');
  assert.equal(epicSlug('16-07-2026-14-35-media-library-event-listener-reduction'), 'media-library-event-listener-reduction');
  assert.equal(epicSlug('2026-07-13T1042-media-library-delta-cache'), 'media-library-delta-cache');
  assert.equal(epicSlug('2026-07-13-media-library-proxy-sse-update.md'), 'media-library-proxy-sse-update');
  assert.equal(epicSlug('01-09-2026-11:23-segmentation-webcodecs-proxy-upload.md'), epicSlug('01-09-2026-11:26-segmentation-webcodecs-proxy-upload'), 'a stamp is not part of the slug: the epic is written at 11:23 and its tasks at 11:26');
  assert.equal(epicSlug('loose-task.md'), 'loose-task', 'a name with no stamp is its own slug');

  const run = 'runs/2026-01-02-1015-R01-sample';
  const categories = [
    {
      id: 'runs',
      work: null,
      groups: [{ name: '2026-01-02-1015-R01-sample', title: 'sample', relPath: run, runPath: null, step: null }],
      items: [],
    },
    {
      id: 'epics',
      work: 'epic',
      groups: [],
      items: [
        // Two epics in one run: `E09` was written later and is a second piece of work, not a revision of `E02`.
        { name: 'E02-epic.md', title: 'first epic', relPath: `${run}/E02-epic.md`, runPath: run, step: 2 },
        { name: 'E09-epic.md', title: 'second epic', relPath: `${run}/E09-epic.md`, runPath: run, step: 9 },
        { name: '2026-01-01-sample.md', title: 'sample', relPath: 'epics/2026-01-01-sample.md' },
      ],
    },
    {
      id: 'tasks',
      work: 'task',
      groups: [
        { name: 'E03-tasks', title: 'sample', relPath: `${run}/E03-tasks`, runPath: run, step: 3 },
        { name: '2026-01-03-sample', title: 'first', relPath: 'tasks/2026-01-03-sample', runPath: null, step: null },
      ],
      items: [],
    },
  ];

  const index = epicIndex(categories);
  assert.equal(index.size, 3, 'the category that declares itself an epic is what an epic is read from, and nothing else is one');
  assert.equal(epicIndex([{ id: 'epics', groups: [], items: [{ name: 'x.md', title: 'x', relPath: 'epics/x.md' }] }]).size, 0, 'so a folder merely named `epics` does not make one');

  assert.equal(epicOfSelf(index, { runPath: run, step: 9, name: 'E09-epic.md' }).title, 'second epic', 'an epic is itself, by its rung in its run');
  assert.equal(epicOfTasks(index, { name: '2026-01-03-sample' }).title, 'sample', 'a stamped folder in `tasks/` belongs to the epic whose stamp differs and whose slug does not');
  assert.equal(
    epicOfTasks(index, { runPath: run, step: 3, name: 'E03-tasks' }).title,
    'first epic',
    'and a run’s tasks belong to the epic at the rung above them, not to every epic the run holds',
  );
  assert.equal(epicOfTasks(index, { runPath: 'runs/some-other-run', step: 3, name: 'E03-tasks' }), null, 'a run with no epic above the tasks claims nothing');

  assert.equal(epicColorIndex('slug:sample'), epicColorIndex('slug:sample'), 'a colour is stable for a key');
  assert.ok(epicColorIndex('slug:sample') < EPIC_PALETTE && epicColorIndex('slug:sample') >= 0, 'and comes from the palette');
  assert.equal(epicColor('slug:sample'), `var(--epic-${epicColorIndex('slug:sample')})`, 'which is the theme’s own value, so both themes are painted');
});

test('a run’s numbered tasks folder carries the run and the rung it was filed out of', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-epic-'));
  const root = path.join(repo, '.x-skills');
  // A run the way the skills write one: the plan, the plan's legacy epic beside it, and the tasks it was
  // decomposed into a rung later.
  writeFile(path.join(root, 'runs', '2026-01-02-1015-R01-sample', 'E01-plan.md'), '# Plan — sample\n');
  writeFile(path.join(root, 'runs', '2026-01-02-1015-R01-sample', 'E02-epic.md'), '# Epic — sample\n');
  writeFile(path.join(root, 'runs', '2026-01-02-1015-R01-sample', 'E03-tasks', '0.1-one.md'), '# Task: one\n');
  writeFile(path.join(root, 'tasks', '2026-01-03-sample', '0.1-skeleton.md'), '# Task: skeleton\n');
  writeFile(path.join(root, 'plan', '2026-01-04-sample', 'E00-plan.md'), '# Plan — its own name\n');

  const { scanRoot } = await serverModule('scan');
  const { epicIndex, epicOfTasks } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'epics.mjs')).href);
  const project = scanRoot(root, { name: 'epic-fixture' });
  const tasks = category(project, 'tasks');
  const run = category(project, 'runs');

  assert.equal(run.groups[0].runPath, null, 'a run is not a stage of anything');
  const stage = tasks.groups.find((group) => group.relPath === 'runs/2026-01-02-1015-R01-sample/E03-tasks');
  assert.equal(
    stage.runPath,
    'runs/2026-01-02-1015-R01-sample',
    'but the tasks folder read outside its run says which run numbered it, which is the one thing its path cannot say there',
  );
  assert.equal(stage.step, 3, 'and the rung it holds there, so the epic above it can be found');
  const epic = category(project, 'plan').items.find((item) => item.name === 'E01-plan.md');
  assert.equal(epic.runPath, 'runs/2026-01-02-1015-R01-sample', 'the plan beside it is the same run’s');
  assert.equal(epic.step, 1, 'at the rung above the tasks, which is what pairs them');
  assert.equal(
    epicOfTasks(epicIndex(project.categories), stage).relPath,
    epic.relPath,
    'so the tasks resolve to that plan, off the real scanner rather than a fixture',
  );

  const collection = tasks.groups.find((group) => group.relPath === 'tasks/2026-01-03-sample');
  assert.equal(
    collection.title,
    '2026-01-03-sample',
    'a folder of tasks is named by its own name: its first file’s heading is a task’s title, and wearing it made the folder read as one of the tasks inside',
  );
  assert.equal(
    category(project, 'plan').groups[0].title,
    'its own name',
    'while every other collection is still named by the document it opens with',
  );
  assert.equal(collection.step, null, 'a folder no run numbered holds no rung');
});

test('an artifact inside a collection is read on the collection’s page, not on an address of its own', () => {
  const items = source(path.join('lib', 'items.ts'));
  const router = source(path.join('lib', 'router.ts'));
  const app = source(path.join('components', 'App.tsx'));
  const group = source(path.join('components', 'GroupDetail.tsx'));

  assert.match(items, /export function routeFor\(item: WorkItem\): Route/, 'where an item is read is one rule, in the module that reads items');
  assert.match(items, /if \(item\.groupRelPath\) return \{ name: 'group'[\s\S]*?file: item\.relPath \}/, 'a document inside a collection opens that collection with itself selected');
  assert.match(router, /route\.file \? `\/\$\{encodeURIComponent\(route\.file\)\}` : ''/, 'so a collection’s address can name the artifact it has open');
  assert.match(router, /const file = parts\.slice\(4\)\.join\('\/'\)/, 'and that artifact travels as one encoded segment, the way a group’s path does');
  assert.doesNotMatch(app, /import .*Related/, 'and nothing draws a “related” panel beside it: the trail and the artifact list already say where the document sits');
  assert.match(app, /export function FilePage|function FilePage\(/, 'a file’s address is answered by one component');
  assert.match(app, /navigate\(\{ name: 'group', project: props\.project\.id, group: found\.relPath, file: props\.path \}, \{ replace: true \}\)/, 'which replaces the address with the collection’s, so the second address does not survive being followed');
  assert.doesNotMatch(group, /createSignal/, 'and the collection keeps its selection in the address rather than in a signal beside it');
  assert.match(group, /navigate\(\{ name: 'group', project: props\.project\.id, group: props\.groupPath, file: file\.relPath \}, \{ replace: true \}\)/, 'choosing another artifact replaces the address, so the back button returns to the page rather than to the last artifact');
});

test('the board draws tasks one at a time, and an epic holds the ones that belong to it', () => {
  const items = source(path.join('lib', 'items.ts'));
  const board = source(path.join('components', 'Board.tsx'));
  const card = source(path.join('components', 'Card.tsx'));
  const view = source(path.join('components', 'FileView.tsx'));
  const epics = source(path.join('lib', 'epics.mjs'));
  const css = fs.readFileSync(path.join(APP_SRC, 'styles.css'), 'utf8');

  assert.match(epics, /const STAMPS = \[/, 'the stamps a slug hides behind are listed, not guessed at');
  assert.match(epics, /export function epicOfTasks\(/, 'and which epic a task belongs to is one function, so the two sides cannot disagree');
  assert.match(epics, /epic\.step < subject\.step/, 'which pairs a run’s tasks with the epic at the rung above them, not with every epic the run holds');
  assert.match(epics, /export function epicIndex\(/, 'with the epics resolved from the category that declares itself one, not from a file name');
  assert.match(epics, /category\.work !== 'epic'/, 'which is the registry’s own word, so this module does not hardcode a folder name either');
  assert.match(items, /if \(role === 'task'\) items\.push\(\.\.\.taskItems\(/, 'a task folder is expanded into one card per task: its old card wore the first task’s title and read as a duplicate of the epic beside it');
  assert.match(items, /function withTasks/, 'and every epic is given the tasks inside it');
  assert.match(items, /const linked = withTasks\(items\)[\s\S]*?return linked\.filter/, 'and the link is made before the caller’s filter, so an epic page — which draws one category — still holds its tasks');
  assert.match(items, /parentTitle: parent/, 'a task’s parent is the epic that claims it, not the folder title, which is the first task’s own heading');
  assert.match(card, /export function EpicPill/, 'the epic a task belongs to is drawn as a pill');
  assert.match(card, /color: props\.epic\.color/, 'in the epic’s own colour, from the theme');
  assert.match(board, /<Show when=\{!props\.item\.isEpic && props\.item\.epic\}>/, 'on every task card, and not on the epic’s own');
  assert.match(board, /as=\{holds\(\) \? 'article' : 'a'\}/, 'a card that holds tasks is not a link, because a link inside a link is not one');
  assert.match(board, /border-inline-start-color/, 'an epic’s card carries its colour down the leading edge, so two epics are told apart at a glance');
  assert.match(board, /if \(item\.epic\) return null/, 'and a task does not repeat its epic in the footer, which was half of why the two categories read alike');
  assert.match(board, /<Show when=\{whereabouts\(props\.item\)\}>/, 'so the line is left out rather than drawn empty');
  assert.match(board, /TASK_PREVIEW = 8/, 'the card lists a few tasks and counts the rest, so one epic cannot make a card taller than its lane');
  assert.match(view, /<TaskList tasks=\{tasks\(\)\} \/>/, 'an epic’s own page lists every task it holds');
  assert.match(view, /const epic = createMemo\(\(\) => \(card\(\)\?\.isEpic \? null : \(card\(\)\?\.epic \?\? null\)\)\)/, 'and a task’s page names its epic rather than its own');
});

/**
 * The palette, measured rather than eyeballed: an epic's name is read in its own colour, on the card's surface and
 * tinted with 10% of itself — the badge recipe every status in this app is drawn with. A colour is a label here and
 * never the only signal (the pill carries the name as text), but a label nobody can read is not one.
 */
test('every epic colour can be read on the surface it is drawn on', () => {
  const css = fs.readFileSync(path.join(APP_SRC, 'styles.css'), 'utf8');
  const [light, dark] = css.split('@media (prefers-color-scheme: dark)');

  for (const [theme, block] of [['light', light], ['dark', dark]]) {
    const value = (name) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6}|#[0-9a-f]{3})`, 'i'))?.[1] ?? null;
    assert.notEqual(value('card'), null, `the ${theme} theme has a card surface to draw a pill on`);
    for (let index = 0; index < 8; index += 1) {
      const colour = value(`epic-${index}`);
      assert.notEqual(colour, null, `the ${theme} theme has --epic-${index}`);
      for (const surface of ['card', 'muted']) {
        const ratio = contrast(mix(hexToRgb(colour), hexToRgb(value(surface)), 0.1), hexToRgb(colour));
        assert.ok(ratio >= 4.5, `--epic-${index} on --${surface} reads at ${ratio.toFixed(2)}:1 in the ${theme} theme, which is under 4.5:1`);
      }
    }
  }

  assert.match(css, /--epic-0: #[0-9a-f]{6}; --epic-1: #[0-9a-f]{6}; --epic-2: #[0-9a-f]{6}; --epic-3: #[0-9a-f]{6};/, 'the palette is one list per theme, so a value cannot be added to one and missed in the other');
});

/** `#rrggbb` or the `#rgb` shorthand, as three channels. */
function hexToRgb(hex) {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16));
}

/** One colour over another: what the badge recipe paints, where `weight` is how much of the top colour there is. */
function mix(top, under, weight) {
  return top.map((channel, at) => Math.round(channel * weight + under[at] * (1 - weight)));
}

/** WCAG relative luminance, and the contrast ratio between two colours. */
function contrast(a, b) {
  const luminance = ([r, g, bl]) => {
    const channel = (value) => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
  };
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (high + 0.05) / (low + 0.05);
}
