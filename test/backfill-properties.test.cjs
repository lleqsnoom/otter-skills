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
    '---\ntitle: "b, named by hand"\nsize: M\n---\n# Task: b\n**Layer:** 0 — x\n**Files:** src/c.ts (new)\n\n## Definition of Done\n- [ ] b works\n',
  );
  writeFile(path.join(root, RUN, 'E03-critique.md'), `# Roast — login\n\n**Artifact:** .x-skills/${RUN}/E00-plan.md\n`);
  writeFile(path.join(root, RUN, 'memory.md'), '# Memory — login\n');
  writeFile(path.join(root, RUN, 'E04-summary.md'), '# Summary — login\n');
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
    read(root, `${RUN}/E02-tasks/L0-T1-a.md`).startsWith(`---\ntype: task\ntitle: "L0-T1 · a"\n${hub}\nplan: "[[${RUN}/E00-plan]]"\nsize: S\ndone: true\n---\n# Task: a\n`),
    'a task gets its plan, a size from its Files line with tests not counted, and done from its boxes',
  );
  assert.ok(read(root, `${RUN}/E00-plan.md`).startsWith(`---\ntype: plan\ntitle: "Plan · login"\n${hub}\ninput: "[[${ANALYSIS_RUN}/E00-analysis]]"\n---\n# Plan — login\n`));
  assert.ok(read(root, `${RUN}/E03-critique.md`).startsWith(`---\ntype: review\ntitle: "Roast of plan (#1)"\n${hub}\nreviews: "[[${RUN}/E00-plan]]"\n---\n`));
  assert.ok(read(root, `${RUN}/E04-summary.md`).startsWith(`---\ntype: summary\ntitle: "Summary · login"\n${hub}\n---\n`));
  assert.ok(read(root, `${RUN}/E01-triage.md`).startsWith(`---\ntype: triage\ntitle: "Triage · login"\n${hub}\n---\n`));
  assert.ok(read(root, `${ANALYSIS_RUN}/E00-analysis.md`).startsWith(`---\ntype: analysis\ntitle: "Analysis · login-cause"\nrun: "[[${ANALYSIS_RUN}/index]]"\n---\n`));
});

test('the backfill keeps what is set, leaves what is not an artifact, and changes nothing the second time', () => {
  const { repo, root } = repository();
  backfill('--root', repo);
  const kept = read(root, `${RUN}/E02-tasks/L0-T2-b.md`);
  assert.match(kept, /^size: M$/m, 'a size someone set survives');
  assert.match(kept, /^title: "b, named by hand"$/m, 'and so does a title');
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
  assert.match(result.stdout, new RegExp(`${RUN}/E02-tasks/L0-T1-a\\.md: \\+ type, title, run, plan, size, done`));
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

  assert.equal(read(root, `${RUN}/index.md`), '---\ntype: run\ntitle: "login"\n---\n# login\n', 'a hub names itself after the run and links nothing');
  assert.equal(read(root, `${ANALYSIS_RUN}/index.md`), '---\ntype: run\ntitle: "login-cause"\n---\n# login-cause\n');
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
  for (const name of ['open-tasks.base', 'by-run.base', 'tag.base']) {
    assert.equal(
      fs.readFileSync(path.join(__dirname, 'fixtures', 'vault', name), 'utf8'),
      fs.readFileSync(path.join(VAULT_FILES, name), 'utf8'),
      `${name} is one file in two places: the vault Obsidian opens, and the one the backfill copies`,
    );
  }
});

test('a roast is numbered among the run’s critiques, and a hub written before titles gets one', () => {
  const { repo, root } = repository();
  writeFile(path.join(root, RUN, 'E05-critique.md'), `# Roast — login\n\n**Artifact:** .x-skills/${RUN}/E00-plan.md\n`);
  writeFile(path.join(root, RUN, 'index.md'), '---\ntype: run\n---\n# login\n');
  backfill('--root', repo);
  assert.match(read(root, `${RUN}/E05-critique.md`), /^title: "Roast of plan \(#2\)"$/m);
  assert.equal(read(root, `${RUN}/index.md`), '---\ntype: run\ntitle: "login"\n---\n# login\n');
});

test('a task gains the code areas its Files touch, and the vault the tag notes for them, once', () => {
  const { repo, root } = repository();
  writeFile(
    path.join(root, RUN, 'E02-tasks', 'L1-T1-c.md'),
    '# Task: c\n**Layer:** 1 — x\n**Files:** `src/server/a.mjs` (mod), skills/o-plan/b.mjs (new), apps/app-web/src/main.ts (new), test/a.test.cjs (new), package.json (mod)\n\n## Definition of Done\n- [ ] c\n',
  );
  writeFile(path.join(root, 'tags', 'area', 'server.md'), 'mine\n');
  const result = backfill('--root', repo);
  assert.equal(result.status, 0, result.stderr);

  assert.match(
    read(root, `${RUN}/E02-tasks/L1-T1-c.md`),
    /^topics:\n {2}- "\[\[tags\/area\/server\]\]"\n {2}- "\[\[tags\/area\/o-plan\]\]"\n {2}- "\[\[tags\/area\/app-web\]\]"$/m,
    'one area per module, in the order the Files line names them; tests and root files name none',
  );
  assert.equal(read(root, 'tags/area/o-plan.md'), '---\ntype: tag\ntitle: "o-plan (area)"\n---\n# o-plan\n\n![[tag.base]]\n');
  assert.equal(read(root, 'tags/area/server.md'), 'mine\n', 'an existing tag note is kept');
  assert.equal(read(root, 'tag.base'), fs.readFileSync(path.join(VAULT_FILES, 'tag.base'), 'utf8'));
  assert.doesNotMatch(read(root, `${RUN}/E02-tasks/L0-T1-a.md`), /^topics:/m, 'a task whose files sit at the top of src/ names no area');

  const again = backfill('--root', repo);
  assert.doesNotMatch(again.stdout, /: created$/m);
});

test('the backfill creates the tag folders it needs in a vault that has none', () => {
  const { repo, root } = repository();
  writeFile(path.join(root, RUN, 'E02-tasks', 'L1-T1-c.md'), '# Task: c\n**Layer:** 1 — x\n**Files:** src/server/a.mjs (mod)\n');
  const result = backfill('--root', repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(root, 'tags/area/server.md'), '---\ntype: tag\ntitle: "server (area)"\n---\n# server\n\n![[tag.base]]\n');
});

test('a Files line is read as paths: a list inside parentheses and a prose entry name no area', () => {
  const { repo, root } = repository();
  writeFile(
    path.join(root, RUN, 'E02-tasks', 'L1-T1-c.md'),
    "# Task: c\n**Layer:** 1 — x\n**Files:** test/fixtures/vault/ (new: runs/<run>/index.md, E02-tasks/L0-T1-a.md, plus tasks/legacy-task.md), src/server/parse.mjs (mod), otter-pm's .x-skills/.obsidian (not in git)\n",
  );
  backfill('--root', repo);
  const task = read(root, `${RUN}/E02-tasks/L1-T1-c.md`);
  assert.match(task, /^topics:\n {2}- "\[\[tags\/area\/server\]\]"\n(?! {2}-)/m);
  assert.match(task, /^size: XS$/m, 'one source path, the vault fixture being a test');
});

function domains(repo, map) {
  const file = path.join(repo, 'domains.json');
  fs.writeFileSync(file, JSON.stringify(map));
  return file;
}

test('--domains adds a run’s domain tags to each of its artifacts, ahead of their areas, and creates the notes', () => {
  const { repo, root } = repository();
  writeFile(path.join(root, RUN, 'E02-tasks', 'L1-T1-c.md'), '# Task: c\n**Layer:** 1 — x\n**Files:** src/server/a.mjs (mod)\n');
  const map = domains(repo, { [path.basename(RUN)]: ['login', 'auth'] });
  const result = backfill('--root', repo, '--domains', map);
  assert.equal(result.status, 0, result.stderr);

  assert.match(
    read(root, `${RUN}/E02-tasks/L1-T1-c.md`),
    /^topics:\n {2}- "\[\[tags\/domain\/login\]\]"\n {2}- "\[\[tags\/domain\/auth\]\]"\n {2}- "\[\[tags\/area\/server\]\]"$/m,
  );
  assert.match(read(root, `${RUN}/E00-plan.md`), /^topics:\n {2}- "\[\[tags\/domain\/login\]\]"\n {2}- "\[\[tags\/domain\/auth\]\]"\n---$/m);
  assert.doesNotMatch(read(root, `${RUN}/index.md`), /topics/, 'the hub links nothing');
  assert.doesNotMatch(read(root, `${ANALYSIS_RUN}/E00-analysis.md`), /topics/, 'a run not in the map is left alone');
  assert.equal(read(root, 'tags/domain/auth.md'), '---\ntype: tag\ntitle: "auth (domain)"\n---\n# auth\n\n![[tag.base]]\n');

  const before = read(root, `${RUN}/E02-tasks/L1-T1-c.md`);
  backfill('--root', repo, '--domains', map);
  assert.equal(read(root, `${RUN}/E02-tasks/L1-T1-c.md`), before, 'a second run adds nothing');
});

test('--domains refuses a run it cannot find, a malformed name, and a fourth domain, before writing anything', () => {
  for (const map of [{ 'no-such-run': ['x'] }, { [path.basename(RUN)]: ['Bad Name'] }, { [path.basename(RUN)]: ['a', 'b', 'c', 'd'] }]) {
    const { repo, root } = repository();
    const before = read(root, `${RUN}/E00-plan.md`);
    const result = backfill('--root', repo, '--domains', domains(repo, map));
    assert.equal(result.status, 2, JSON.stringify(map));
    assert.equal(read(root, `${RUN}/E00-plan.md`), before);
  }
});
