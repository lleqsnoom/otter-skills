import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

import { categoryForDir } from './categories.mjs';
import { projectIdFor, projectNameFor, repoPathFor } from './config.mjs';
import {
  artifactKind,
  boldFields,
  dateFrom,
  excerpt,
  humanBytes,
  layerOf,
  progressOf,
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
 */
const MARK_FIELDS = { about: 'about', icon: 'iconText', color: 'color', 'icon-url': 'iconSrc', 'icon-file': 'iconFile' };

function projectMark(root) {
  const path = join(root, 'project.md');
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
  [/^E\d+-plan/i, 3],
  [/^E\d+-epic/i, 4],
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

function groupFor(root, dir) {
  const stat = safeStat(dir);
  const files = collectFiles(root, dir).sort(compareFiles);
  const state = readState(dir);
  const firstMarkdown = files.find((file) => file.isMarkdown);
  const name = basename(dir);
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
    id: relative(root, dir).split('\\').join('/'),
    name,
    title: state?.slug || firstMarkdown?.title || name,
    relPath: relative(root, dir).split('\\').join('/'),
    mtime: stat ? new Date(stat.mtimeMs).toISOString() : null,
    date: dateFrom(state?.updatedAt || name),
    state,
    files,
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
      groups.push(groupFor(root, path));
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

  const docs = rootDocs(root, rootFiles);
  if (docs) categories.push(docs);

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