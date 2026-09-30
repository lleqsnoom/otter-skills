#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

import { parseTask } from '../skills/x-implement/scripts/status.mjs';
import { boldFields, parseWikilink, splitProperties } from '../src/server/parse.mjs';

/**
 * Give a repository's existing runs the property block new artifacts are written with, so work done before the
 * block existed joins the graph in Obsidian and on the board.
 *
 * It adds only what the files themselves say — the type from the name, the run from the folder, a task's plan from
 * the rung below it, an edge a bold-label field already names, a task's size from its `**Files:**` line and `done`
 * from its boxes — and never overwrites a key that is set, so a second run changes nothing. `depends_on` and
 * `complexity` are left for a person: Preconditions describe a state rather than a task, and complexity is a
 * judgement. `finished` is not stamped either: the backfill does not know when old work finished. Only `runs/` is
 * read, so the colon-named folders older skills wrote are never touched.
 *
 * It also creates what a vault needs and does not have yet: each run's `index` note — the hub every artifact's `run`
 * links, written once and never edited, since backlinks list the run's artifacts — and the two bases in
 * `scripts/vault/`, in the form Obsidian saves them. Neither is ever overwritten.
 *
 * Usage:
 *   node scripts/backfill-properties.mjs --root <repository or its .x-skills folder> [--dry-run]
 */

const TOP_LEVEL_TYPES = [
  [/^index\.md$/, 'run'],
  [/^E\d+-(?:plan|epic)\.md$/, 'plan'],
  [/^E\d+-triage\.md$/, 'triage'],
  [/^E\d+-(?:critique|review[\w-]*)\.md$/, 'review'],
  [/^E\d+-analysis\.md$/, 'analysis'],
  [/^E\d+-debug\.md$/, 'debug'],
  [/^E\d+-fix-plan\.md$/, 'fix'],
];
const NOT_ARTIFACTS = new Set(['memory.md', 'questions.md', 'research_log.md']);
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[a-z]+$/i;

const FOLDER_TYPES = [
  [/^E\d+-tasks$/, 'task'],
  [/^E\d+-research$/, 'research'],
];

/**
 * What an artifact under `runs/<run>/` is: a file at the top of the run by its name, a file one folder down by the
 * stage folder it is in; `null` for anything else.
 */
export function artifactType(relPath) {
  const [top, , ...inner] = relPath.split('/');
  const name = inner.at(-1);
  if (top !== 'runs' || !name || NOT_ARTIFACTS.has(name) || inner.length > 2) return null;
  const [table, subject] = inner.length === 2 ? [FOLDER_TYPES, inner[0]] : [TOP_LEVEL_TYPES, name];
  return table.find(([pattern]) => pattern.test(subject))?.[1] ?? null;
}

const runSlug = (run) => run.replace(/^\d{4}-\d{2}-\d{2}-\d{4}-R\d+-/, '');

/** A note's file name as words: `L0-T2-some-task` reads `L0-T2 · some task`, `E00-plan` reads `plan`. */
export function noteLabel(note) {
  const name = basename(note).replace(/\.md$/, '');
  const task = name.match(/^(L\d+-T\d+)-(.+)$/);
  if (task) return `${task[1]} · ${task[2].replace(/-/g, ' ')}`;
  return name.replace(/^E\d+-/, '').replace(/[-_]/g, ' ');
}

const FIXED_TITLES = { plan: 'Plan', analysis: 'Analysis', triage: 'Triage', debug: 'Debug', fix: 'Fix plan' };
const RESEARCH_TITLES = { 'research.md': 'Research', 'final_report.md': 'Research report' };

/** This critique's place among the run's critiques, counting from 1 in the order they were numbered. */
function critiqueNumber(root, relPath) {
  const folder = dirname(relPath);
  const critiques = readdirSync(join(root, folder)).filter((name) => /^E\d+-critique\.md$/.test(name)).sort();
  return critiques.indexOf(basename(relPath)) + 1;
}

/** A review's title: what it reviewed, else the run it belongs to; a roast also carries its number in the run. */
function reviewTitle(root, relPath, slug, target) {
  if (!/-critique\.md$/.test(relPath)) return target ? `Review of ${noteLabel(target)}` : `Review · ${slug}`;
  const number = critiqueNumber(root, relPath);
  return target ? `Roast of ${noteLabel(target)} (#${number})` : `Roast · ${slug} (#${number})`;
}

/**
 * The title an artifact is shown by in Obsidian's graph: its kind, then its subject. The file name (`E13-review-plan`)
 * says neither, and it cannot change — the rung is what the board and the run order read.
 */
export function titleFor(root, relPath, text, type, target) {
  const slug = runSlug(relPath.split('/')[1]);
  const name = basename(relPath);
  if (type === 'run') return slug;
  if (type === 'task') {
    const heading = text.match(/^#\s+(?:Task:\s*)?(.+)$/m)?.[1].trim();
    return heading ? `${noteLabel(name).split(' · ')[0]} · ${heading}` : noteLabel(name);
  }
  if (type === 'review') return reviewTitle(root, relPath, slug, target);
  if (type === 'research') return `${RESEARCH_TITLES[name] ?? noteLabel(name)} · ${slug}`;
  return `${FIXED_TITLES[type]} · ${slug}`;
}

/** A size from a task's `**Files:**` line: the source paths it names, tests not counted. */
export function sizeFromFiles(files) {
  const count = [files ?? []]
    .flat()
    .flatMap((value) => value.split(','))
    .map((entry) => entry.replace(/\([^)]*\)|`/g, '').trim())
    .filter((entry) => entry && !TEST_PATH.test(entry)).length;
  if (!count) return null;
  if (count === 1) return 'XS';
  if (count <= 3) return 'S';
  return count <= 10 ? 'M' : 'L';
}

/** A value a bold-label field names, as a note in this `.x-skills` tree — or `null` when it leads nowhere there. */
function noteIn(root, value) {
  const bare = String(value ?? '')
    .replace(/[`'"]/g, '')
    .trim()
    .replace(/^\.x-skills\//, '');
  return bare && existsSync(join(root, bare)) ? bare.replace(/\.md$/, '') : null;
}

/** The plan a tasks folder was cut from: the run's plan or epic at the highest rung below the folder's own. */
function planOf(root, runRel, tasksDir) {
  const rung = Number(tasksDir.match(/^E(\d+)/)[1]);
  const below = readdirSync(join(root, runRel))
    .filter((name) => /^E\d+-(?:plan|epic)\.md$/.test(name) && Number(name.match(/^E(\d+)/)[1]) < rung)
    .sort();
  return below.length ? `${runRel}/${below.at(-1).replace(/\.md$/, '')}` : null;
}

/** Every key the backfill can derive for one artifact, in the order a block lists them; unknown ones are `null`. */
function derived(root, relPath, text, type, properties) {
  const [, run, ...inner] = relPath.split('/');
  const runRel = `runs/${run}`;
  const fields = boldFields(text);
  const link = (note) => (note ? `"[[${note}]]"` : null);
  const setReview = properties.find((property) => property.key === 'reviews')?.values[0];
  const reviewed = type === 'review' ? (parseWikilink(setReview ?? '')?.path ?? noteIn(root, fields.artifact)) : null;
  return [
    ['type', type],
    ['title', JSON.stringify(titleFor(root, relPath, text, type, reviewed))],
    ['run', type === 'run' ? null : link(`${runRel}/index`)],
    ['plan', type === 'task' ? link(planOf(root, runRel, inner[0])) : null],
    ['input', type === 'plan' ? link(noteIn(root, fields.input)) : null],
    ['reviews', link(reviewed?.replace(/\.md$/, ''))],
    ['size', type === 'task' ? sizeFromFiles(fields.files) : null],
    ['done', type === 'task' ? String(parseTask(basename(relPath), text).complete) : null],
  ].filter(([, value]) => value !== null);
}

/**
 * One artifact's text with the keys it lacks added — into the block it has, or a new block on top — and the keys that
 * were added. Text that already has every key comes back unchanged.
 */
export function backfillText(root, relPath, text) {
  const type = artifactType(relPath);
  if (!type) return { text, added: [] };
  const { properties } = splitProperties(text);
  const present = new Set(properties.map((property) => property.key));
  const missing = derived(root, relPath, text, type, properties).filter(([key]) => !present.has(key));
  if (!missing.length) return { text, added: [] };
  const lines = missing.map(([key, value]) => `${key}: ${value}`);
  const withBlock = properties.length
    ? text.replace(/^(---\n[\s\S]*?\n)(---\n)/, (_, head, close) => `${head}${lines.join('\n')}\n${close}`)
    : `---\n${lines.join('\n')}\n---\n${text}`;
  return { text: withBlock, added: missing.map(([key]) => key) };
}

const VAULT_FILES = join(dirname(fileURLToPath(import.meta.url)), 'vault');
const BASES = ['open-tasks.base', 'by-run.base'];

/** The files a vault needs and this one lacks: a hub for every run, and the two bases at its root. */
export function missingFiles(root) {
  const runs = readdirSync(join(root, 'runs')).filter((name) => statSync(join(root, 'runs', name)).isDirectory());
  const hubs = runs.map((name) => ({
    relPath: `runs/${name}/index.md`,
    text: `---\ntype: run\ntitle: ${JSON.stringify(runSlug(name))}\n---\n# ${runSlug(name)}\n`,
  }));
  const bases = BASES.map((name) => ({ relPath: name, text: readFileSync(join(VAULT_FILES, name), 'utf8') }));
  return [...hubs, ...bases].filter((file) => !existsSync(join(root, file.relPath)));
}

function parseArgs(argv) {
  const args = { root: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--root') args.root = argv[(index += 1)] ?? null;
    else {
      process.stderr.write(`Unknown argument: ${flag}\n`);
      process.exit(2);
    }
  }
  return args;
}

/** Each edit written unless it is a dry run, and said either way: the one place the backfill touches the disk. */
function apply(root, edits, dryRun) {
  for (const edit of edits) {
    if (!dryRun) writeFileSync(join(root, edit.relPath), edit.text, 'utf8');
    process.stdout.write(`${edit.relPath}: ${edit.note}\n`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root) {
    process.stderr.write('Usage: node scripts/backfill-properties.mjs --root <repository or its .x-skills folder> [--dry-run]\n');
    process.exit(2);
  }
  const root = basename(args.root) === '.x-skills' ? args.root : join(args.root, '.x-skills');
  if (!existsSync(join(root, 'runs'))) {
    process.stderr.write(`There is no .x-skills/runs at ${dirname(join(root, 'runs'))} — nothing to backfill.\n`);
    process.exit(1);
  }
  const files = readdirSync(join(root, 'runs'), { recursive: true })
    .filter((name) => String(name).endsWith('.md'))
    .map((name) => `runs/${String(name).split('\\').join('/')}`)
    .sort();
  const changed = files
    .map((relPath) => ({ relPath, ...backfillText(root, relPath, readFileSync(join(root, relPath), 'utf8')) }))
    .filter((result) => result.added.length)
    .map((result) => ({ ...result, note: `+ ${result.added.join(', ')}` }));
  const created = missingFiles(root).map((file) => ({ ...file, note: 'created' }));
  apply(root, [...changed, ...created], args.dryRun);
  const summary = args.dryRun
    ? `Would change ${changed.length} of ${files.length} files and create ${created.length}`
    : `Changed ${changed.length} of ${files.length} files and created ${created.length}`;
  process.stdout.write(`${summary} in ${root}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
