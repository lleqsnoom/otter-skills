import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';

import { Marked } from 'marked';

import { resolveRoots } from './config.mjs';
import { boardForProject } from './board.mjs';
import { highlightCode, highlightFence, languageForFile } from './highlight.mjs';
import { clearParseCache, scanRoot, TEXT_EXTENSIONS } from './scan.mjs';

const SNAPSHOT_TTL_MS = 4000;
let cache = { at: 0, value: null };

export function getSnapshot({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < SNAPSHOT_TTL_MS) return cache.value;

  const { roots, rootMeta, rejected, skipped, orca } = resolveRoots({});
  const projects = [];
  const failures = [];
  for (const root of roots) {
    try {
      projects.push(scanRoot(root, rootMeta[root]));
    } catch (error) {
      failures.push({ root, error: error.message });
    }
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));

  // One board file per project, read from inside the project: a decision belongs to the repository it is about, so
  // it survives the branch, the worktree and the checkout the board is served from. See `board.mjs`.
  const boards = projects.map((project) => boardForProject({ root: project.root, projectId: project.id }));

  const value = {
    generatedAt: new Date().toISOString(),
    projects,
    roots,
    rejected,
    skipped,
    failures,
    orca,
    /** The reader's own column moves, keyed `<projectId>:<relPath>`; see `board.mjs`. */
    board: Object.assign({}, ...boards.map((board) => board.moves)),
    /** The order each lane was left in, keyed `<projectId>:<column>`. */
    orders: Object.assign({}, ...boards.map((board) => board.orders)),
    /** The items the reader archived, by the same key: off the board, and still on disk. */
    deletions: Object.assign({}, ...boards.map((board) => board.deleted)),
    /** Where each project keeps its decisions: `<root>/board.json` inside its own `.x-skills`. */
    boardFiles: Object.fromEntries(projects.map((project, index) => [project.id, boards[index].file])),
  };
  cache = { at: now, value };
  return value;
}

export function invalidateSnapshot() {
  cache = { at: 0, value: null };
}

export function findProject(id) {
  return getSnapshot().projects.find((project) => project.id === id) || null;
}

function insideRoot(root, candidate) {
  const target = resolve(root, normalize(candidate));
  const base = resolve(root);
  return target === base || target.startsWith(base + sep);
}

const MARKDOWN = new Set(['.md', '.markdown']);

/** The raster types an icon may be served as, and the ceiling on one: an icon is a tile, not a download. */
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

/** What a page holds in memory; `writeFileContent` refuses anything larger, and says so rather than truncating. */
const MAX_READ_BYTES = 400_000;
const MAX_WRITE_BYTES = 1024 * 1024;

const BLOCKED_TAGS = /<\/?(?:script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi;
const EVENT_ATTRIBUTE = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const SCRIPT_URL = /(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi;

/** Raw HTML in a repo's own docs is trusted to render, but not to run. */
function scrub(html) {
  return html
    .replace(BLOCKED_TAGS, '')
    .replace(EVENT_ATTRIBUTE, '')
    .replace(SCRIPT_URL, '$1="#"');
}

/**
 * Markdown, rendered here rather than in the island, with each fence coloured in the dialect it is written in.
 *
 * A ```` ```mermaid ```` fence is deliberately *not* touched: it is returned to marked's own renderer so it stays a
 * `pre > code.language-mermaid`, which is the shape `src/lib/diagrams.ts` finds it by. Everything else — including
 * a fence with no language, which is detected from its own text — becomes shiki's markup, and the dialect it was
 * read as travels with that markup as `data-language`.
 */
const markdown = new Marked({
  gfm: true,
  async: false,
  renderer: {
    code(token) {
      const info = String(token.lang ?? '').trim();
      if (/^mermaid\b/i.test(info)) return false;
      const fence = highlightFence(token.text ?? '', info);
      return fence ? fence.html : false;
    },
  },
});

/**
 * The single place a project id and a relative path become a file on disk. Both the read and the write go through
 * it, so "is this path inside the root" is asked once and cannot be answered differently by two callers.
 */
function locate(projectId, relPath) {
  const project = findProject(projectId);
  if (!project) return { status: 404, error: `unknown project ${projectId}` };
  if (!relPath || !insideRoot(project.root, relPath)) {
    return { status: 400, error: 'path escapes the project root' };
  }
  const full = join(project.root, relPath);
  let stat;
  try {
    stat = statSync(full, { throwIfNoEntry: false });
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) return { status: 404, error: `no such file: ${relPath}` };
  return { project, full, stat, extension: extname(full).toLowerCase() };
}

export function readFileContent(projectId, relPath) {
  const found = locate(projectId, relPath);
  if (found.status) return found;

  const { full, stat, extension } = found;
  const isMarkdown = MARKDOWN.has(extension);
  let raw;
  try {
    raw = readFileSync(full, 'utf8');
  } catch (error) {
    return { status: 500, error: error.message };
  }

  const truncated = raw.length > MAX_READ_BYTES;
  const text = truncated ? raw.slice(0, MAX_READ_BYTES) : raw;

  // A file that is not markdown is code, and the dialect is its extension first and its own text only when the
  // extension is one that says nothing (`.txt`, `.csv`). `null` here means plain text, which is a real answer.
  const dialect = isMarkdown ? { language: null, detected: false } : languageForFile(text, extension.replace('.', ''));
  const highlighted = isMarkdown ? null : highlightCode(text, dialect.language, { detected: dialect.detected });
  const html = isMarkdown ? scrub(markdown.parse(text)) : (highlighted?.html ?? null);

  return {
    status: 200,
    body: {
      projectId,
      relPath,
      name: basename(full),
      extension: extension.replace('.', ''),
      isMarkdown,
      isCode: !isMarkdown && highlighted !== null,
      language: isMarkdown ? null : (highlighted?.language ?? null),
      detected: isMarkdown ? false : (highlighted?.detected ?? false),
      /**
       * Whether this app may write the file back. It is asked here, where the text set lives, so the button that
       * offers an edit and the request that refuses one cannot disagree; a truncated read is never editable,
       * because saving what was shown would throw away everything past the cut.
       */
      editable: TEXT_EXTENSIONS.has(extension) && !truncated,
      html,
      raw: text,
      truncated,
      size: stat.size,
      mtime: new Date(stat.mtimeMs).toISOString(),
    },
  };
}

/**
 * An image a project carries — the icon it was given — as bytes.
 *
 * Its own read beside the text one, because a tile needs the picture and a browser cannot draw JSON. Raster types
 * only: an SVG opened on this origin is a document that can run script, and this route exists for an icon.
 */
export function readAsset(projectId, relPath) {
  const found = locate(projectId, relPath);
  if (found.status) return { ...found, contentType: null, body: null };

  const contentType = IMAGE_TYPES[found.extension];
  if (!contentType) return { status: 415, error: `not an image: ${relPath}`, contentType: null, body: null };
  if (found.stat.size > MAX_ASSET_BYTES) {
    return { status: 413, error: `refusing to serve ${found.stat.size} bytes`, contentType: null, body: null };
  }
  try {
    return { status: 200, contentType, body: readFileSync(found.full) };
  } catch (error) {
    return { status: 500, error: error.message, contentType: null, body: null };
  }
}

/**
 * An artifact, changed.
 *
 * This is Otter PM's second write and the only one that reaches into a repository: filing a card is a local
 * preference (see `board.mjs`), whereas editing a document *is* the document. Only a file the scanner already reads
 * as text may be written, so a save cannot turn a screenshot or a `.gitignore` into prose.
 */
export function writeFileContent(projectId, relPath, raw) {
  const found = locate(projectId, relPath);
  if (found.status) return found;
  if (!TEXT_EXTENSIONS.has(found.extension)) {
    return { status: 415, error: `not a text artifact: ${relPath}` };
  }
  if (typeof raw !== 'string') return { status: 400, error: 'expected the new contents as a string' };
  if (raw.length > MAX_WRITE_BYTES) {
    return { status: 413, error: `refusing to write ${raw.length} characters; the limit is ${MAX_WRITE_BYTES}` };
  }

  // Dot-prefixed, so a scan landing mid-save cannot see a half-written artifact in the tree.
  const temporary = join(dirname(found.full), `.${basename(found.full)}.otter-pm-tmp`);
  try {
    writeFileSync(temporary, raw, { encoding: 'utf8', mode: found.stat.mode });
    renameSync(temporary, found.full);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      /* the failure below is the one worth reporting */
    }
    return { status: 500, error: `could not write ${relPath}: ${error.message}` };
  }

  // Both caches go: the artifact just changed, so a title, a layer or a checklist must not be answered from the
  // parse cache, and the snapshot's own copy is a version of the tree that no longer exists.
  clearParseCache();
  invalidateSnapshot();
  return readFileContent(projectId, relPath);
}

