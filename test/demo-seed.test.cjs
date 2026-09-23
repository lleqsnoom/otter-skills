'use strict';

/**
 * `npm run demo` writes a sample tree to look at the board with, and the shapes it writes are the reason it exists:
 * a plan carrying the layers with the tasks it was split into, a plan filed loose and paired with its tasks by slug,
 * and one collection belonging to nothing. A generator that silently wrote a flatter tree would still look fine on
 * disk, so these tests read it the way the board does.
 *
 * The shape it must *not* write is the epic. An epic document repeated the plan's layer roadmap in a second file, so
 * one plan had two pages; the sample is the merged shape and these tests hold it there.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'seed-demo.mjs');

/** Seed a tree into a fresh directory and read it back with the real scanner. */
async function seeded() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-demo-'));
  execFileSync(process.execPath, [SCRIPT, '--root', dir], { cwd: ROOT });
  const { scanRoot } = await import(pathToFileURL(path.join(ROOT, 'src', 'server', 'scan.mjs')).href);
  const { epicIndex, epicOfTasks, epicColorIndex } = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'epics.mjs')).href);
  const project = scanRoot(path.join(dir, '.x-skills'));
  return { dir, project, index: epicIndex(project.categories), epicOfTasks, epicColorIndex };
}

const category = (project, id) => project.categories.find((candidate) => candidate.id === id);

function filesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

test('every task collection in the sample resolves to the plan it was split from', async () => {
  const { dir, project, index, epicOfTasks } = await seeded();
  try {
    assert.ok(index.size >= 8, `the sample spreads the work over ${index.size} plans, so the palette and the grouping have something to draw`);

    const tasks = category(project, 'tasks');
    assert.ok(tasks, 'the sample has a Tasks category');
    const claimed = new Map(tasks.groups.map((group) => [group.relPath, epicOfTasks(index, { ...group, runPath: group.runPath, step: group.step })]));

    assert.equal(claimed.get('runs/2026-09-23-0905-R01-csv-export/E01-tasks')?.title, 'csv-export', 'a run’s tasks hang off the plan above them');
    assert.equal(claimed.get('runs/2026-09-19-1415-R01-search-speed/E02-tasks')?.title, 'search-speed', 'with the plan at the rung below the tasks, not the folder that happens to sort first');
    assert.equal(claimed.get('tasks/18-09-2026-11:30-openapi-gaps')?.title, 'openapi-gaps', 'a stamped folder pairs with the plan of the same slug, whatever the stamps say');
    assert.equal(claimed.get('tasks/23-09-2026-09:40-weekly-digest')?.title, 'weekly-digest', 'and a plan written loose pairs with its tasks the same way');
    assert.equal(claimed.get('tasks/21-09-2026-09:20-orphan-tasks'), null, 'a collection nothing claims is work of its own');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the sample writes the merged shape only: no run repeats its layers in a second document', async () => {
  const { dir } = await seeded();
  try {
    const files = filesUnder(path.join(dir, '.x-skills'));
    assert.deepEqual(files.filter((file) => /-epic\.md$/.test(file)), [], 'no epic document: the plan is where the layers are written');
    assert.equal(files.some((file) => file.endsWith(path.join('epics', 'x.md'))), false, 'and no `epics/` folder invents one either');

    const runs = path.join(dir, '.x-skills', 'runs');
    for (const run of fs.readdirSync(runs)) {
      const withLayers = fs
        .readdirSync(path.join(runs, run), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .filter((entry) => fs.readFileSync(path.join(runs, run, entry.name), 'utf8').includes('## Layers'))
        .map((entry) => entry.name);
      assert.ok(withLayers.length <= 1, `${run} writes its layer roadmap ${withLayers.length} times: ${withLayers.join(', ')}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the sample spreads across the palette instead of painting one colour', async () => {
  const { dir, index, epicColorIndex } = await seeded();
  try {
    const colours = new Set([...index.keys()].map((key) => epicColorIndex(key)));
    assert.ok(colours.size >= 6, `${index.size} collections reach ${colours.size} of 8 colours — the point of the sample is to show them apart`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the sample reads as one project: a mark, both analysis spellings, and a run that ended early', async () => {
  const { dir, project } = await seeded();
  try {
    assert.equal(project.about, 'A sample tree for looking at the board without waiting on real work.');
    assert.equal(project.iconText, 'OD');
    assert.equal(project.markPath, 'project.md', 'and the mark says which file carries it');
    assert.equal(category(project, 'analysis').items.length, 3, '`analysis/` and `anal/` are one category');
    assert.equal(category(project, 'runs').groups.length, 5);
    const runs = category(project, 'runs').groups;
    assert.equal(runs.find((run) => run.name === '2026-09-20-1645-R01-import-board').status, 'done', 'the abandoned run reads as done');
    assert.equal(runs.find((run) => run.name === '2026-09-22-0830-R01-notifications').status, 'active', 'a run stopped at its gate reads as active');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The one edge a document writes down itself, so the sample has to write one: two runs joined by a written path, and
 * a plan filed loose that names the analysis it read. Without them the reads row has nothing to show in the sample.
 */
test('two of the sample’s plans name the analysis they read', async () => {
  const { dir, project } = await seeded();
  try {
    const named = (relPath) => {
      for (const category of project.categories) {
        const file = [...category.items, ...category.groups.flatMap((group) => group.files)].find(
          (candidate) => candidate.relPath === relPath,
        );
        if (file) return file.links.map((link) => `${link.label} ${link.path}`);
      }
      return null;
    };

    assert.deepEqual(named('runs/2026-09-18-0930-R01-checkout-redesign/E01-plan.md'), [
      'Input runs/2026-09-18-0930-R01-checkout-redesign/E00-analysis.md',
    ], 'a run’s plan names the analysis its own run wrote');
    assert.deepEqual(named('runs/2026-09-19-1415-R01-search-speed/E01-plan.md'), [
      'Input analysis/2026-09-17-slow-search.md',
    ], 'and the next run’s plan names the loose analysis it read, which is an address of its own');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('re-seeding overwrites rather than accumulating, and --clean removes what is gone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-demo-'));
  try {
    execFileSync(process.execPath, [SCRIPT, '--root', dir], { cwd: ROOT });
    const stale = path.join(dir, '.x-skills', 'plans', 'stale.md');
    fs.writeFileSync(stale, '# Plan — stale\n');
    execFileSync(process.execPath, [SCRIPT, '--root', dir], { cwd: ROOT });
    assert.ok(fs.existsSync(stale), 'without --clean a hand-written file survives, so edits are not silently lost');
    execFileSync(process.execPath, [SCRIPT, '--root', dir, '--clean'], { cwd: ROOT });
    assert.equal(fs.existsSync(stale), false, '--clean gives back the sample exactly');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
