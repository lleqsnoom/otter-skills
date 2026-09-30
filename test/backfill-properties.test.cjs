'use strict';

/**
 * The backfill gives a repository's existing runs the property block new artifacts are written with, so old work
 * joins the graph. It adds what it can derive and never overwrites what is set, so running it twice changes nothing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BACKFILL = path.join(__dirname, '..', 'scripts', 'backfill-properties.mjs');
const RUN = 'runs/2026-09-01-0900-R01-login';
const ANALYSIS_RUN = 'runs/2026-08-31-0900-R01-login-cause';

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** A repository whose runs were written before artifacts carried properties, plus one legacy folder. */
function repository() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-backfill-'));
  const root = path.join(repo, '.x-skills');
  writeFile(path.join(root, ANALYSIS_RUN, 'E00-analysis.md'), '# Analysis — login cause\n');
  writeFile(path.join(root, RUN, 'E00-plan.md'), `# Plan — login\n\n**Input:** \`.x-skills/${ANALYSIS_RUN}/E00-analysis.md\`\n\n## Layers\n`);
  writeFile(path.join(root, RUN, 'E01-triage.md'), '# Task triage - login\n');
  writeFile(
    path.join(root, RUN, 'E02-tasks', 'L0-T1-a.md'),
    '# Task: a\n**Layer:** 0 — x\n**Effort:** 3h\n**Files:** src/a.ts (new), src/b.ts (mod), test/a.test.ts (new)\n\n## Definition of Done\n- [x] a works\n',
  );
  writeFile(
    path.join(root, RUN, 'E02-tasks', 'L0-T2-b.md'),
    '---\nsize: M\n---\n# Task: b\n**Layer:** 0 — x\n**Files:** src/c.ts (new)\n\n## Definition of Done\n- [ ] b works\n',
  );
  writeFile(path.join(root, RUN, 'E03-critique.md'), `# Roast — login\n\n**Artifact:** .x-skills/${RUN}/E00-plan.md\n`);
  writeFile(path.join(root, RUN, 'memory.md'), '# Memory — login\n');
  writeFile(path.join(root, 'tasks', '07-08-2026-12:56-old', 'task.md'), '# Task: old\n**Effort:** 2h\n');
  return { repo, root };
}

function backfill(...args) {
  return spawnSync(process.execPath, [BACKFILL, ...args], { encoding: 'utf8' });
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const hub = `run: "[[${RUN}/index]]"`;

test('the backfill adds each artifact the block it can derive', () => {
  const { repo, root } = repository();
  const result = backfill('--root', repo);
  assert.equal(result.status, 0, result.stderr);

  assert.ok(
    read(root, `${RUN}/E02-tasks/L0-T1-a.md`).startsWith(`---\ntype: task\n${hub}\nplan: "[[${RUN}/E00-plan]]"\nsize: S\ndone: true\n---\n# Task: a\n`),
    'a task gets its plan, a size from its Files line with tests not counted, and done from its boxes',
  );
  assert.ok(read(root, `${RUN}/E00-plan.md`).startsWith(`---\ntype: plan\n${hub}\ninput: "[[${ANALYSIS_RUN}/E00-analysis]]"\n---\n# Plan — login\n`));
  assert.ok(read(root, `${RUN}/E03-critique.md`).startsWith(`---\ntype: review\n${hub}\nreviews: "[[${RUN}/E00-plan]]"\n---\n`));
  assert.ok(read(root, `${RUN}/E01-triage.md`).startsWith(`---\ntype: triage\n${hub}\n---\n`));
  assert.ok(read(root, `${ANALYSIS_RUN}/E00-analysis.md`).startsWith(`---\ntype: analysis\nrun: "[[${ANALYSIS_RUN}/index]]"\n---\n`));
});

test('the backfill keeps what is set, leaves what is not an artifact, and changes nothing the second time', () => {
  const { repo, root } = repository();
  backfill('--root', repo);
  const kept = read(root, `${RUN}/E02-tasks/L0-T2-b.md`);
  assert.match(kept, /^size: M$/m, 'a size someone set survives');
  assert.doesNotMatch(kept, /^size: XS$/m);
  assert.match(kept, /^done: false$/m, 'and the keys it lacked are added to its own block');
  assert.equal((kept.match(/^---$/gm) || []).length, 2, 'into the block it had, not a second one');
  assert.equal(read(root, `${RUN}/memory.md`), '# Memory — login\n');
  assert.equal(read(root, 'tasks/07-08-2026-12:56-old/task.md'), '# Task: old\n**Effort:** 2h\n', 'nothing outside runs/ is touched');

  const before = fs.readdirSync(root, { recursive: true }).filter((name) => name.endsWith('.md')).map((name) => read(root, name));
  backfill('--root', root);
  const after = fs.readdirSync(root, { recursive: true }).filter((name) => name.endsWith('.md')).map((name) => read(root, name));
  assert.deepEqual(after, before, 'a second run, given the .x-skills folder itself, writes nothing');
});

test('a dry run says what it would add and writes nothing', () => {
  const { repo, root } = repository();
  const before = read(root, `${RUN}/E02-tasks/L0-T1-a.md`);
  const result = backfill('--root', repo, '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(root, `${RUN}/E02-tasks/L0-T1-a.md`), before);
  assert.match(result.stdout, new RegExp(`${RUN}/E02-tasks/L0-T1-a\\.md: \\+ type, run, plan, size, done`));
});

test('a root with no .x-skills is refused, by name', () => {
  const result = backfill('--root', os.tmpdir());
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no \.x-skills/);
});

const VAULT_FILES = path.join(__dirname, '..', 'scripts', 'vault');

test('the backfill gives every run a hub and the vault its two bases, once', () => {
  const { repo, root } = repository();
  writeFile(path.join(root, 'open-tasks.base'), 'mine\n');
  const result = backfill('--root', repo);
  assert.equal(result.status, 0, result.stderr);

  assert.equal(read(root, `${RUN}/index.md`), '---\ntype: run\n---\n# login\n', 'a hub names itself after the run and links nothing');
  assert.equal(read(root, `${ANALYSIS_RUN}/index.md`), '---\ntype: run\n---\n# login-cause\n');
  assert.equal(read(root, 'by-run.base'), fs.readFileSync(path.join(VAULT_FILES, 'by-run.base'), 'utf8'));
  assert.equal(read(root, 'open-tasks.base'), 'mine\n', 'a base the vault already has is kept');
  assert.match(result.stdout, new RegExp(`${RUN}/index\\.md: created`));

  const again = backfill('--root', repo);
  assert.doesNotMatch(again.stdout, /: created$/m, 'the second run creates nothing');
});

test('a dry run lists the hubs and bases it would create, and creates none', () => {
  const { repo, root } = repository();
  const result = backfill('--root', repo, '--dry-run');
  assert.match(result.stdout, /by-run\.base: created/);
  assert.equal(fs.existsSync(path.join(root, RUN, 'index.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'by-run.base')), false);
});

test('the fixture vault holds the same bases the backfill writes', () => {
  for (const name of ['open-tasks.base', 'by-run.base']) {
    assert.equal(
      fs.readFileSync(path.join(__dirname, 'fixtures', 'vault', name), 'utf8'),
      fs.readFileSync(path.join(VAULT_FILES, name), 'utf8'),
      `${name} is one file in two places: the vault Obsidian opens, and the one the backfill copies`,
    );
  }
});
