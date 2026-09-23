import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';

import { categoryForDir, categoryForStageKind } from './categories.mjs';
import { projectIdFor, projectNameFor, repoPathFor } from './config.mjs';
import {
  artifactKind,
  boldFields,
  dateFrom,
  excerpt,
  humanBytes,
  layerOf,
  linkFields,
  progressOf,
  stageStep,
  statusFromProgress,
  titleFrom,
} from './parse.mjs';

const MAX_READ_BYTES = 1024 * 1024;
/** The extensions this app reads as text — and therefore the ones it may write back; see `snapshot.mjs`. */
export const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.json', '.txt', '.yml', '.yaml', '.sh', '.py', '.js', '.mjs', '.ts', '.tsx', '.mmd', '.csv', '.toml']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

/**
 * Only the fields a screen shows travel in the snapshot. A task's `**Files:**` list is twenty paths long and
 * nothing reads it, and the snapshot is every file in every root — measured, keeping it took the payload from
 * 200 kB to 950 kB for one repository.
 */
const KEPT_FIELDS = new Set(['date', 'timestamp', 'branch', 'scope', 'layer', 'effort', 'status', 'error', 'target-file', 'sentry-issue']);
const MAX_FIELD_LENGTH = 120;

function keepFields(fields) {
  const kept = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!KEPT_FIELDS.has(key)) continue;
    kept[key] = Array.isArray(value) ? value.join(', ').slice(0, MAX_FIELD_LENGTH) : value.slice(0, MAX_FIELD_LENGTH);
  }
  return kept;
}

const parseCache = new Map();

function safeStat(path) {
  try {
    return statSync(path, { throwIfNoEntry: false });
  } catch {
    return null;
  }
}

/**
 * Parse once per version of a file. The `stat` is read here rather than taken from the caller, so the cache key
 * cannot drift from the file it describes — the two parsers were each handed a stat they had just read, which is a
 * parameter that only exists to be kept in step.
 */
function cachedParse(namespace, path, parse) {
  const stat = safeStat(path);
  if (!stat) return parse();
  const key = `${namespace}:${path}`;
  const cached = parseCache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;
  const value = parse();
  parseCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

function readText(path, stat) {
  if (stat.size > MAX_READ_BYTES) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * A path an artifact named, as a path this root holds — or `null` when it leads nowhere.
 *
 * The value arrives as the document spelled it: `.x-skills/runs/<stamp>-R<nn>-<slug>/E00-analysis.md` is how one
 * skill addresses another's output, and `<run folder>/E00-plan.md` is a placeholder in a skeleton that has not
 * been filled in yet. So both readings are tried — from the root, then from the folder the naming artifact sits
 * in — and only a path that exists becomes a link. A dead link is worse than no link: it reads as a promise.
 */
function resolveLink(root, from, value) {
  const bare = value.replace(/^\.x-skills[/\\]/, '').replace(/^[/\\]+/, '');
  if (!bare) return null;
  for (const candidate of [join(root, bare), join(dirname(from), bare)]) {
    const stat = safeStat(candidate);
    if (!stat) continue;
    const rel = relative(root, candidate).split('\\').join('/');
    if (rel.startsWith('..')) continue;
    return stat.isDirectory() ? `${rel}/` : rel;
  }
  return null;
}

function artifactLinks(root, path, markdown) {
  const links = [];
  for (const { label, value } of linkFields(markdown)) {
    const target = resolveLink(root, path, value);
    if (!target) continue;
    links.push({ label, path: target, name: basename(target.replace(/\/$/, '')) });
  }
  return links;
}

function fileRef(root, path, stat) {
  const extension = extname(path).toLowerCase();
  const name = basename(path);
  const relPath = relative(root, path).split('\\').join('/');
  return cachedParse('file', path, () => {
    const isMarkdown = MARKDOWN_EXTENSIONS.has(extension);
    const text = TEXT_EXTENSIONS.has(extension) ? readText(path, stat) : null;
    const fields = text && isMarkdown ? keepFields(boldFields(text)) : {};
    const progress = text && isMarkdown ? progressOf(text) : null;
    return {
      name,
      relPath,
      kind: isMarkdown ? artifactKind(name) : extension.replace('.', '') || 'file',
      isMarkdown,
      title: text && isMarkdown ? titleFrom(text, name.replace(/\.(md|markdown)$/i, '')) : name,
      date: dateFrom(fields.date || fields.timestamp || name),
      mtime: new Date(stat.mtimeMs).toISOString(),
      size: stat.size,
      sizeLabel: humanBytes(stat.size),
      fields,
      layer: layerOf(fields),
      /** The rung this artifact is in its run — `2` for `E02-epic.md` — or `null` for anything not numbered. */
      step: stageStep(name),
      /** The artifacts this one names, and only those this root holds. */
      links: text && isMarkdown ? artifactLinks(root, path, text) : [],
      excerpt: text && isMarkdown ? excerpt(text) : '',
      progress,
      status: statusFromProgress(progress),
      truncated: text === null && TEXT_EXTENSIONS.has(extension),
    };
  });
}

function collectFiles(root, dir, depth = 0, acc = []) {
  if (depth > 4) return acc;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(root, path, depth + 1, acc);
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (entry.name === 'state.json') continue;
    const extension = extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const stat = safeStat(path);
    if (stat) acc.push(fileRef(root, path, stat));
  }
  return acc;
}

/**
 * A run's `state.json`, reduced to the facts the screens show. Every field is defaulted here rather than at each
 * use, so a state file written by an older skill version reads the same as one written today: absent is `null` or
 * an empty list, never `undefined`.
 */
export function summariseState(parsed) {
  const guards = parsed.guards ? Object.values(parsed.guards) : [];
  const questions = parsed.openQuestions || [];
  const stops = parsed.stops || [];
  return {
    skill: parsed.skill || null,
    slug: parsed.slug || null,
    goal: parsed.goal || null,
    node: parsed.node || null,
    stops,
    finished: Boolean(parsed.node) && stops.includes(parsed.node),
    updatedAt: parsed.updatedAt || parsed.createdAt || null,
    guardsPassed: guards.filter((guard) => guard.pass).length,
    guardsTotal: guards.length,
    openQuestions: questions.filter((question) => question.status !== 'answered').length,
    questions,
    options: parsed.options || [],
    decision: parsed.decision || null,
    events: (parsed.events || []).length,
    report: parsed.report || null,
  };
}

function readState(dir) {
  const path = join(dir, 'state.json');
  const stat = safeStat(path);
  if (!stat) return null;
  return cachedParse('state', path, () => {
    try {
      return summariseState(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      return { error: 'state.json is not valid JSON' };
    }
  });
}

/**
 * The project's own mark, when it has one: `<root>/project.md` says what the project is about and how to draw it.
 * Read here rather than through an artifact's fields, because these are fields about the project and not about a
 * file; a project without one is not a project missing something.
 *
 * `markPath` is the file itself, relative to the root. The same document is read as a document too — root markdown
 * lands in **Docs** — and a card that cannot say which of its documents is the mark reads as a note beside the
 * project rather than as the mark it is.
 */
const MARK_FILE = 'project.md';

const MARK_FIELDS = { about: 'about', icon: 'iconText', color: 'color', 'icon-url': 'iconSrc', 'icon-file': 'iconFile' };

function projectMark(root) {
  const path = join(root, MARK_FILE);
  const stat = safeStat(path);
  const fields = stat
    ? cachedParse('mark', path, () => {
        const text = readText(path, stat);
        return text ? boldFields(text) : {};
      })
    : {};
  const mark = {};
  for (const [field, key] of Object.entries(MARK_FIELDS)) {
    const raw = fields[field];
    mark[key] = raw ? String(raw) : null;
  }
  mark.markPath = stat ? MARK_FILE : null;
  return mark;
}

/**
 * Artifacts read in the order a run produced them: the `E00…E09` stages first, then the session's own notes,
 * then everything else — a folder of twenty files read alphabetically starts at `bench-31s.txt`.
 */
const FILE_RANK = [
  [/^E\d+-analysis/i, 0],
  [/^E\d+-triage/i, 1],
  [/^E\d+-investigate/i, 2],
  // A legacy epic is the plan under its old name, so the two are one rung rather than two.
  [/^E\d+-(?:plan|epic)/i, 3],
  [/^E\d+-tasks/i, 5],
  [/^E\d+-repro/i, 6],
  [/^E\d+-reflection/i, 7],
  [/^E\d+-review/i, 8],
  [/^E\d+-summary/i, 9],
  [/^E\d+[-_]/i, 10],
  [/^state\.json$/i, 11],
  [/^questions\.md$/i, 12],
  [/^memory\.md$/i, 13],
  [/^task[-_]/i, 14],
];

function fileRank(name) {
  for (const [pattern, rank] of FILE_RANK) {
    if (pattern.test(name)) return rank;
  }
  return 50;
}

function compareFiles(a, b) {
  const rank = fileRank(a.name) - fileRank(b.name);
  return rank !== 0 ? rank : a.name.localeCompare(b.name);
}

/**
 * The rungs of a run: every `E<nn>-<kind>` it holds, in the order it built them.
 *
 * Read from the folder rather than from the files collected under it, because a stage can be a *folder* —
 * x-decompose writes `E02-tasks/` — and its rung would otherwise be invisible while its task files look like
 * loose artifacts of the run.
 */
function stagesFor(root, dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(isRung)
    .map((entry) => rungOf(root, dir, entry))
    .sort((a, b) => a.step - b.step || a.name.localeCompare(b.name));
}

function isRung(entry) {
  return !entry.name.startsWith('.') && stageStep(entry.name) !== null;
}

function rungOf(root, dir, entry) {
  const path = join(dir, entry.name);
  return {
    step: stageStep(entry.name),
    kind: artifactKind(entry.name),
    name: entry.name,
    relPath: relative(root, path).split('\\').join('/'),
    isDirectory: entry.isDirectory(),
  };
}

function groupFor(root, dir, meta = {}) {
  const stat = safeStat(dir);
  const files = collectFiles(root, dir).sort(compareFiles);
  const state = readState(dir);
  const firstMarkdown = files.find((file) => file.isMarkdown);
  const name = basename(dir);
  const relPath = meta.relPath ?? relative(root, dir).split('\\').join('/');
  const progress = files.reduce(
    (acc, file) => {
      if (file.progress) {
        acc.done += file.progress.done;
        acc.total += file.progress.total;
      }
      return acc;
    },
    { done: 0, total: 0 },
  );
  return {
    id: relPath,
    name,
    title: meta.title ?? state?.slug ?? (meta.ownName ? name : firstMarkdown?.title) ?? name,
    relPath,
    /** The run this collection is a stage of, when it is one — see `indexRung`. */
    runPath: meta.runPath ?? null,
    /** The rung it holds there: `E02-tasks/` is rung 2. */
    step: meta.step ?? null,
    mtime: stat ? new Date(stat.mtimeMs).toISOString() : null,
    date: dateFrom(state?.updatedAt || name),
    state,
    files,
    stages: stagesFor(root, dir),
    fileCount: files.length,
    progress: progress.total ? { ...progress, ratio: progress.done / progress.total } : null,
    status: state ? (state.finished ? 'done' : 'active') : statusFromProgress(progress.total ? progress : null),
  };
}

function categoryFor(root, dirName) {
  const dir = join(root, dirName);
  const stat = safeStat(dir);
  if (!stat) return null;
  // `merge` is how the registry knows `anal` is another name for `analysis`. It is consumed here: `dirs`, which says
  // the same thing in the form the UI reads, is what travels in the snapshot.
  const { merge, ...descriptor } = categoryForDir(dirName);
  const entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
  const groups = [];
  const items = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // A folder of tasks is named by its stamp and nothing else, and its first file's heading is a *task's* name:
      // read as the folder's it made a card say `Tasks: Extract SSE parser into sse-parser.ts`, a task's title worn
      // by the folder holding it. Every other collection is named by its own first document, which is the plan or
      // the session it opens with.
      groups.push(groupFor(root, path, descriptor.work === 'task' ? { ownName: true } : {}));
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const fileStat = safeStat(path);
    if (fileStat) items.push(fileRef(root, path, fileStat));
  }

  groups.sort((a, b) => String(b.date || b.mtime).localeCompare(String(a.date || a.mtime)));
  items.sort((a, b) => String(b.date || b.mtime).localeCompare(String(a.date || a.mtime)));

  return {
    ...descriptor,
    kind: groups.length && items.length ? 'mixed' : groups.length ? 'containers' : 'documents',
    dir: dirName,
    dirs: [dirName],
    relPath: dirName,
    counts: {
      groups: groups.length,
      items: items.length,
      files: groups.reduce((total, group) => total + group.fileCount, 0) + items.length,
    },
    groups,
    items,
  };
}

/**
 * Two directories can name one category (`anal` and `analysis` both answer `analysis`), so what was read from
 * each is folded together: one label, one route, one board, and `dirs` remembers which folders were read. The
 * folder that bears the category's own name is the one the panel shows as its home.
 */
function mergeCategory(into, extra) {
  into.dirs = [...new Set([...into.dirs, ...extra.dirs])].sort();
  into.dir = into.dirs.includes(into.id) ? into.id : into.dirs[0];
  into.relPath = into.dir;
  into.kind =
    into.groups.length + extra.groups.length && into.items.length + extra.items.length
      ? 'mixed'
      : into.groups.length + extra.groups.length
        ? 'containers'
        : 'documents';
  into.counts = {
    groups: into.counts.groups + extra.counts.groups,
    items: into.counts.items + extra.counts.items,
    files: into.counts.files + extra.counts.files,
  };
  into.groups = [...into.groups, ...extra.groups].sort((a, b) =>
    String(b.date || b.mtime).localeCompare(String(a.date || a.mtime)),
  );
  into.items = [...into.items, ...extra.items].sort((a, b) =>
    String(b.date || b.mtime).localeCompare(String(a.date || a.mtime)),
  );
  return into;
}

/**
 * The category a run's stage is read in: the one this root already has for that kind, and a category made from the
 * registry when it has none. `plan` is **Plan** where `plan/` exists and **Plans** where only `plans/` does —
 * resolving to a folder that is there is what keeps one kind from reading as two.
 *
 * A category made here says so (`fromRuns`): it was named by the registry rather than read from disk, and a screen
 * that wrote "read from `analysis`" over it would be pointing at a folder nothing looked in.
 */
function stageCategoryFor(categories, kind) {
  const names = new Set([kind, `${kind}s`, kind.replace(/s$/, '')]);
  const existing = categories.find(
    (category) => names.has(category.id) || category.dirs.some((dir) => names.has(dir)),
  );
  if (existing) return existing;

  const descriptor = categoryForStageKind(kind);
  if (!descriptor) return null;
  const synthesized = {
    ...descriptor,
    kind: 'documents',
    dir: descriptor.id,
    dirs: [],
    relPath: descriptor.id,
    counts: { groups: 0, items: 0, files: 0 },
    groups: [],
    items: [],
    fromRuns: true,
  };
  categories.push(synthesized);
  return synthesized;
}

function recountCategory(category) {
  category.kind =
    category.groups.length && category.items.length
      ? 'mixed'
      : category.groups.length
        ? 'containers'
        : 'documents';
  category.counts = {
    groups: category.groups.length,
    items: category.items.length,
    files: category.groups.reduce((total, group) => total + group.fileCount, 0) + category.items.length,
  };
}

/**
 * The stages of every run, read where a reader looks for that kind of work.
 *
 * The skills write a run as one folder holding everything it produced, numbered in the order it was built
 * (`x-plan`: "a plain name sort lists the run in the order it was built"). That is the right unit to *work* in and
 * the wrong one to *find* things in: an analysis that has to be found inside a run is not in Analysis, and the
 * category that names it looks like a folder nothing has written to since the skills moved into run folders.
 *
 * So each rung is also read in the category of its kind — the artifact itself where the rung is a file, the folder
 * as a collection where x-decompose wrote `E02-tasks/`. Nothing is written: a stage keeps the path it came from,
 * so it is the same file in two places, and the pair it travelled with (`runPath`, `runTitle`) is what a screen
 * says instead of leaving a reader to guess where it came from. A run that is *already* filed in the category its
 * own stage belongs to is skipped — there it would be the same work listed twice.
 */
function indexRunStages(root, categories) {
  for (const category of [...categories]) {
    for (const group of category.groups) {
      for (const stage of rungsToIndex(categories, category, group)) indexRung(root, group, stage);
    }
  }
}

/**
 * A folder that numbered its artifacts is a run of something. `state.json` says how far the run got, which is a
 * different question — a skill that was interrupted still wrote its analysis, and that analysis is still an analysis.
 */
function rungsToIndex(categories, category, group) {
  group.files = withRun(group);
  return withoutSupersededEpic(group.stages)
    .map((stage) => ({ ...stage, target: stageCategoryFor(categories, stage.kind) }))
    .filter((stage) => stage.target && stage.target.id !== category.id);
}

/**
 * A run's plan is where its layers are written, and a run older than the merge wrote them as an epic: `E<nn>-epic.md`
 * is a plan by another name (see `artifactKind`). A run holding both spellings numbered the plan twice with one
 * document, and reading both would draw its plan twice — so the plan's own file wins and the epic beside it is left
 * unread. Two epics and no plan is a run that numbered two pieces of work, which is not this case and is left alone.
 */
const LEGACY_EPIC = /^E\d+-epic/i;

function withoutSupersededEpic(stages) {
  const numbered = stages.some((stage) => artifactKind(stage.name) === 'plan' && !LEGACY_EPIC.test(stage.name));
  return numbered ? stages.filter((stage) => !LEGACY_EPIC.test(stage.name)) : stages;
}

/** Only the numbered rungs know which run they are in; `memory.md` beside them is the run's own, not a stage. */
function withRun(group) {
  return group.files.map((file) =>
    file.step === null ? file : { ...file, runPath: group.relPath, runTitle: group.title },
  );
}

function indexRung(root, group, stage) {
  if (stage.isDirectory) {
    // The run and the rung travel with the stage it was filed out of: `E02-tasks/` is a collection of its own once
    // it is read in **Tasks**, and the run's epic at the rung above it is the one it was decomposed from — which its
    // own path cannot say from there.
    stage.target.groups.push(
      groupFor(root, join(root, stage.relPath), {
        relPath: stage.relPath,
        title: group.title,
        runPath: group.relPath,
        step: stage.step,
      }),
    );
  } else {
    const file = group.files.find((candidate) => candidate.relPath === stage.relPath);
    if (file) stage.target.items.push(file);
  }
  recountCategory(stage.target);
}

/** Root-level markdown (roadmap.md, API notes) folded into one Docs category. */
function rootDocs(root, names) {
  const items = [];
  for (const name of names) {
    const path = join(root, name);
    const stat = safeStat(path);
    if (stat) items.push(fileRef(root, path, stat));
  }
  if (!items.length) return null;
  items.sort((a, b) => a.name.localeCompare(b.name));
  return {
    ...categoryForDir('docs'),
    kind: 'documents',
    dir: '.',
    dirs: ['.'],
    relPath: '.',
    counts: { groups: 0, items: items.length, files: items.length },
    groups: [],
    items,
  };
}

export function scanRoot(root, meta = {}) {
  const entries = readdirSync(root, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
  const categories = [];
  const rootFiles = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const category = categoryFor(root, entry.name);
      if (!category) continue;
      const existing = categories.find((candidate) => candidate.id === category.id);
      if (existing) mergeCategory(existing, category);
      else categories.push(category);
      continue;
    }
    if (MARKDOWN_EXTENSIONS.has(extname(entry.name).toLowerCase())) rootFiles.push(entry.name);
  }

  // A root can hold a `docs/` folder *and* markdown beside it, and both are the same category: folding them into one
  // is what keeps the rail from drawing Docs twice, each answerable at the same address.
  const docs = rootDocs(root, rootFiles);
  if (docs) {
    const existing = categories.find((candidate) => candidate.id === docs.id);
    if (existing) mergeCategory(existing, docs);
    else categories.push(docs);
  }

  // Before the sort, so a category a run named lands in its registry order along with the ones read from disk.
  indexRunStages(root, categories);
  categories.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  const totals = categories.reduce(
    (acc, category) => {
      acc.groups += category.counts.groups;
      acc.items += category.counts.items;
      acc.files += category.counts.files;
      return acc;
    },
    { groups: 0, items: 0, files: 0 },
  );

  return {
    id: projectIdFor(root),
    name: meta.name || projectNameFor(root),
    repoPath: repoPathFor(root),
    root,
    ...projectMark(root),
    // The IDE's own labelling, when the root came from it: the same avatar and badge colour it draws, so one
    // repository is one thing in two places.
    icon: meta.icon ?? null,
    iconLabel: meta.iconLabel ?? null,
    badgeColor: meta.badgeColor ?? null,
    source: meta.source ?? 'path',
    scannedAt: new Date().toISOString(),
    totals,
    categories,
  };
}

export function clearParseCache() {
  parseCache.clear();
}