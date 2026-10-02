#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

import { parseTask } from '../skills/o-implement/scripts/status.mjs';
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
 *   node scripts/backfill-properties.mjs --root <repository or its .x-skills folder> [--domains <run-to-domains.json>] [--dry-run]
 */

const TOP_LEVEL_TYPES = [
  [/^index\.md$/, 'run'],
  [/^E\d+-(?:plan|epic)\.md$/, 'plan'],
  [/^E\d+-triage\.md$/, 'triage'],
  [/^E\d+-(?:critique|review[\w-]*)\.md$/, 'review'],
  [/^E\d+-analysis\.md$/, 'analysis'],
  [/^E\d+-debug\.md$/, 'debug'],
  [/^E\d+-fix-plan\.md$/, 'fix'],
  [/^E\d+-summary\.md$/, 'summary'],
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

const FIXED_TITLES = { plan: 'Plan', analysis: 'Analysis', triage: 'Triage', debug: 'Debug', fix: 'Fix plan', summary: 'Summary' };
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

const PATH_ENTRY = /^[\w@][\w.@/-]*$/;

/**
 * The source paths a task's `**Files:**` line names. Annotations come off before the line is split, because one can
 * hold a list of its own (`(new: a.md, b.md)`); what is left must be a single path token, so prose ("otter-pm's
 * .x-skills/…") and hidden folders name nothing; tests are left out.
 */
function sourcePaths(files) {
  return [files ?? []]
    .flat()
    .map((value) => value.replace(/\([^)]*\)|`/g, ''))
    .flatMap((value) => value.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => PATH_ENTRY.test(entry) && !TEST_PATH.test(entry));
}

/** A size from a task's `**Files:**` line: the source paths it names, tests not counted. */
export function sizeFromFiles(files) {
  const count = sourcePaths(files).length;
  if (!count) return null;
  if (count === 1) return 'XS';
  if (count <= 3) return 'S';
  return count <= 10 ? 'M' : 'L';
}

const MODULE_RULES = [/^(?:apps|packages|skills)\/([^/]+)\//, /^src\/([^/]+)\//, /^(?!src\/)([^/]+)\//];

/** The code area a path is in: a workspace package, else its folder under `src/`, else its top-level folder. */
export function areaOf(filePath) {
  const name = MODULE_RULES.map((rule) => filePath.match(rule)?.[1]).find(Boolean);
  return name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : null;
}

/** A task's area topics, one per module its `**Files:**` touch, in the order the line names them. */
function areaTopics(files) {
  const areas = [...new Set(sourcePaths(files).map(areaOf).filter(Boolean))];
  return areas.length ? areas.map((area) => `\n  - "[[tags/area/${area}]]"`).join('') : null;
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
    ['topics', type === 'task' ? areaTopics(fields.files) : null],
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
  const lines = missing.map(([key, value]) => (value.startsWith('\n') ? `${key}:${value}` : `${key}: ${value}`));
  const withBlock = properties.length
    ? text.replace(/^(---\n[\s\S]*?\n)(---\n)/, (_, head, close) => `${head}${lines.join('\n')}\n${close}`)
    : `---\n${lines.join('\n')}\n---\n${text}`;
  return { text: withBlock, added: missing.map(([key]) => key) };
}

const VAULT_FILES = join(dirname(fileURLToPath(import.meta.url)), 'vault');
const BASES = ['open-tasks.base', 'by-run.base'];

const tagNote = (kind, name) => `---\ntype: tag\ntitle: "${name} (${kind})"\n---\n# ${name}\n\n![[tag.base]]\n`;

/** The tag notes a set of artifacts links through `topics`, as `tags/<kind>/<name>.md` paths. */
function linkedTags(texts) {
  const paths = texts.flatMap((text) => splitProperties(text).properties.filter((property) => property.key === 'topics'))
    .flatMap((property) => property.values.map((value) => parseWikilink(value)?.path))
    .filter((target) => /^tags\/(?:domain|area)\/[^/]+\.md$/.test(target ?? ''));
  return [...new Set(paths)];
}

/** The files a vault needs and this one lacks: a hub for every run, the bases at its root, and every linked tag note. */
export function missingFiles(root, tags = []) {
  const runs = readdirSync(join(root, 'runs')).filter((name) => statSync(join(root, 'runs', name)).isDirectory());
  const hubs = runs.map((name) => ({
    relPath: `runs/${name}/index.md`,
    text: `---\ntype: run\ntitle: ${JSON.stringify(runSlug(name))}\n---\n# ${runSlug(name)}\n`,
  }));
  const bases = [...BASES, ...(tags.length ? ['tag.base'] : [])].map((name) => ({ relPath: name, text: readFileSync(join(VAULT_FILES, name), 'utf8') }));
  const notes = tags.map((relPath) => {
    const [, kind, name] = relPath.replace(/\.md$/, '').split('/');
    return { relPath, text: tagNote(kind, name) };
  });
  return [...hubs, ...bases, ...notes].filter((file) => !existsSync(join(root, file.relPath)));
}

const DOMAIN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A run's domain tags in its artifact's `topics`, ahead of the areas: added only where missing, into the list the block
 * has or a new one. Domains are a person's call — what the work was about — so they come from a map the user approved,
 * never from the files.
 */
export function withDomains(text, names) {
  const lines = text.split('\n');
  const end = lines[0] === '---' ? lines.findIndex((line, index) => index > 0 && line === '---') : -1;
  if (end === -1 || !names.length) return { text, added: [] };
  const at = lines.findIndex((line, index) => index > 0 && index < end && line === 'topics:');
  const present = new Set(at === -1 ? [] : lines.slice(at + 1, end));
  const missing = names.map((name) => `  - "[[tags/domain/${name}]]"`).filter((item) => !present.has(item));
  if (!missing.length) return { text, added: [] };
  return { text: insertTopics(lines, at, end, missing).join('\n'), added: ['domain topics'] };
}

/** Topic items at the head of the block's `topics` list, or a new list just before the block closes. */
function insertTopics(lines, at, end, items) {
  if (at === -1) return [...lines.slice(0, end), 'topics:', ...items, ...lines.slice(end)];
  return [...lines.slice(0, at + 1), ...items, ...lines.slice(at + 1)];
}

/** What is wrong with one entry of the domains map, or `null`. */
function domainProblem(root, run, names) {
  if (!existsSync(join(root, 'runs', run))) return `no run ${run} in ${root}`;
  if (!Array.isArray(names) || names.some((name) => !DOMAIN.test(name))) return `${run}: a domain is lower-case kebab-case`;
  return names.length > 3 ? `${run}: at most three domains per run` : null;
}

/** The approved run → domains map, checked whole before anything is written; a problem is refused with exit 2. */
function readDomains(root, file) {
  if (!file) return {};
  const map = JSON.parse(readFileSync(file, 'utf8'));
  const problem = Object.entries(map)
    .map(([run, names]) => domainProblem(root, run, names))
    .find(Boolean);
  if (problem) {
    process.stderr.write(`${problem}\n`);
    process.exit(2);
  }
  return map;
}

function parseArgs(argv) {
  const args = { root: null, dryRun: false, domains: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--root') args.root = argv[(index += 1)] ?? null;
    else if (flag === '--domains') args.domains = argv[(index += 1)] ?? null;
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
    if (!dryRun) {
      mkdirSync(dirname(join(root, edit.relPath)), { recursive: true });
      writeFileSync(join(root, edit.relPath), edit.text, 'utf8');
    }
    process.stdout.write(`${edit.relPath}: ${edit.note}\n`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root) {
    process.stderr.write('Usage: node scripts/backfill-properties.mjs --root <repository or its .x-skills folder> [--domains <run-to-domains.json>] [--dry-run]\n');
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
  const domains = readDomains(root, args.domains);
  const results = files.map((relPath) => {
    const filled = backfillText(root, relPath, readFileSync(join(root, relPath), 'utf8'));
    const names = artifactType(relPath) === 'run' ? [] : (domains[relPath.split('/')[1]] ?? []);
    const tagged = withDomains(filled.text, names);
    return { relPath, text: tagged.text, added: [...filled.added, ...tagged.added] };
  });
  const changed = results
    .filter((result) => result.added.length)
    .map((result) => ({ ...result, note: `+ ${result.added.join(', ')}` }));
  const created = missingFiles(root, linkedTags(results.map((result) => result.text))).map((file) => ({ ...file, note: 'created' }));
  apply(root, [...changed, ...created], args.dryRun);
  const summary = args.dryRun
    ? `Would change ${changed.length} of ${files.length} files and create ${created.length}`
    : `Changed ${changed.length} of ${files.length} files and created ${created.length}`;
  process.stdout.write(`${summary} in ${root}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
