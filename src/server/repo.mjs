import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';

import { defaultRun } from './create.mjs';
import { TEXT_EXTENSIONS } from './scan.mjs';

/**
 * The repository as a whole, which is what an agent needs and what the board never reads: the board's scanner stops
 * at the `.x-skills` root, so README, documentation and source are invisible to it. Everything here is bounded by
 * the repository directory — a path that resolves outside it is refused, never clamped.
 *
 * The file list comes from `git ls-files`, so a repository's own `.gitignore` decides what is source rather than a
 * list here that would drift from it. A folder that is not a checkout falls back to a walk, and every answer says
 * which of the two it used: an agent should know how complete a list is.
 */

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', '.astro', 'vendor', 'knowledge.lance']);
const MAX_WALK_DEPTH = 6;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** The absolute path a repository-relative path names, or `null` when it escapes the repository. */
export function resolveInside(repoPath, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) return null;
  const target = resolve(repoPath, normalize(relPath));
  const base = resolve(repoPath);
  return target === base || target.startsWith(base + sep) ? target : null;
}

/** A file this server will read as text. Anything else is listed but refuses to be read. */
export function isTextPath(relPath) {
  return TEXT_EXTENSIONS.has(extname(relPath).toLowerCase());
}

function walk(dir, depth, acc) {
  if (depth > MAX_WALK_DEPTH) return acc;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) walk(child, depth + 1, acc);
    else if (entry.isFile()) acc.push(child);
  }
  return acc;
}

/**
 * Every file the repository holds, relative to its root.
 *
 * `.x-skills` is walked in as well as listed: it is frequently gitignored — it is in this repository — and the tasks
 * and artifacts live there, so a tracked-only list would hide the half of the repository an agent came for.
 */
export function repoFiles(repoPath) {
  const listed = defaultRun('git', ['ls-files', '-z'], { cwd: repoPath });
  const tracked = listed.status === 0 ? listed.stdout.split('\0').filter(Boolean) : null;

  const skillsRoot = join(repoPath, '.x-skills');
  let skills = [];
  try {
    if (statSync(skillsRoot, { throwIfNoEntry: false })?.isDirectory()) {
      skills = walk(skillsRoot, 0, []).map((file) => relative(repoPath, file).split('\\').join('/'));
    }
  } catch {
    skills = [];
  }

  const all =
    tracked === null
      ? walk(repoPath, 0, []).map((file) => relative(repoPath, file).split('\\').join('/'))
      : [...tracked, ...skills.filter((file) => !tracked.includes(file))];

  return { mode: tracked === null ? 'walk' : 'tracked', files: [...new Set(all)].sort() };
}

/** One repository file's text, or a refusal saying why it was not read. */export function readRepoFile(repoPath, relPath, { maxBytes = MAX_FILE_BYTES } = {}) {
  const full = resolveInside(repoPath, relPath);
  if (!full) return { status: 400, error: `path escapes the repository: ${relPath}` };

  const stat = statSync(full, { throwIfNoEntry: false });
  if (!stat) return { status: 404, error: `no such file: ${relPath}` };
  if (!stat.isFile()) return { status: 400, error: `not a file: ${relPath}` };
  if (!isTextPath(relPath)) return { status: 415, error: `not a text file: ${relPath}` };

  let raw;
  try {
    raw = readFileSync(full, 'utf8');
  } catch (error) {
    return { status: 500, error: error.message };
  }

  const truncated = raw.length > maxBytes;
  return {
    status: 200,
    text: truncated ? raw.slice(0, maxBytes) : raw,
    truncated,
    size: stat.size,
    mtime: new Date(stat.mtimeMs).toISOString(),
    lines: raw.split('\n').length,
  };
}

/**
 * What a search stops at. Without a cap a query would read an entire monorepo into memory; with one that went
 * unmentioned, a cut walk would look like "this is not in the code", which is the one wrong answer that matters.
 */
const SEARCH_LIMITS = { matches: 200, files: 8000, bytes: 4_000_000 };
const MAX_READ_LINES = 2000;
const DEFAULT_RANGE = 200;

const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The declaration-shaped lines that name `name`. A heuristic by construction: it reads tokens rather than parsing,
 * so it finds a declaration in any language whose shape it recognises and misses any it does not — which is why
 * every answer says so.
 */
const DECLARATION_TOKENS = [
  'function', 'class', 'const', 'let', 'var', 'def', 'fn', 'func', 'type', 'interface', 'struct', 'enum', 'trait',
  'impl', 'module', 'namespace', 'export', 'public', 'private', 'static', 'async',
];

const declarationPatterns = (name) =>
  DECLARATION_TOKENS.map((token) => ({
    token,
    pattern: new RegExp(`\\b${token}\\b[^\\n]*\\b${escapePattern(name)}\\b`),
  }));

function textFiles(repoPath, files) {
  return files.filter((relPath) => isTextPath(relPath));
}

/** Every line of every text file that matches, up to the caps, with the reason it stopped when it did. */
export function searchRepo(repoPath, { query, regex = false } = {}) {
  const pattern = regex ? new RegExp(query) : new RegExp(escapePattern(query));
  const { mode, files } = repoFiles(repoPath);
  const candidates = textFiles(repoPath, files);

  const matches = [];
  let inspected = 0;
  let bytes = 0;
  let capped = false;
  let reason = null;

  for (const relPath of candidates) {
    if (inspected >= SEARCH_LIMITS.files || bytes >= SEARCH_LIMITS.bytes || matches.length >= SEARCH_LIMITS.matches) {
      capped = true;
      reason =
        matches.length >= SEARCH_LIMITS.matches
          ? `stopped at ${SEARCH_LIMITS.matches} matches`
          : inspected >= SEARCH_LIMITS.files
            ? `stopped after ${SEARCH_LIMITS.files} files`
            : `stopped after ${SEARCH_LIMITS.bytes} bytes`;
      break;
    }

    const read = readRepoFile(repoPath, relPath);
    if (read.status !== 200) continue;
    inspected += 1;
    bytes += read.text.length;

    read.text.split('\n').forEach((text, index) => {
      if (matches.length >= SEARCH_LIMITS.matches) return;
      if (pattern.test(text)) matches.push({ relPath, line: index + 1, text: text.trim() });
    });
  }

  return { matches, mode, inspected, capped, reason };
}

/** A range of one file's lines, numbered, with the total so a caller can tell a cut range from the end of the file. */
export function readLines(repoPath, relPath, { start = 1, end } = {}) {
  const read = readRepoFile(repoPath, relPath);
  if (read.status !== 200) return read;

  const all = read.text.split('\n');
  const from = Math.max(1, Number(start) || 1);
  const wanted = end ? Math.max(from, Number(end)) : from + DEFAULT_RANGE - 1;
  const to = Math.min(wanted, from + MAX_READ_LINES - 1, all.length);

  return {
    status: 200,
    relPath,
    language: extname(relPath).replace('.', '') || 'text',
    lines: all.slice(from - 1, to).map((text, index) => ({ n: from + index, text })),
    total: all.length,
    truncated: to < all.length || read.truncated,
  };
}

/** Where a name is declared, by declaration shape. */
export function findSymbols(repoPath, name) {
  const { mode, files } = repoFiles(repoPath);
  const patterns = declarationPatterns(name);
  const matches = [];

  for (const relPath of textFiles(repoPath, files)) {
    if (matches.length >= SEARCH_LIMITS.matches) break;
    const read = readRepoFile(repoPath, relPath);
    if (read.status !== 200) continue;

    read.text.split('\n').forEach((text, index) => {
      if (matches.length >= SEARCH_LIMITS.matches) return;
      // The earliest token on the line names the declaration: `export function thing()` is an export, and
      // reporting `function` for it would send a reader looking for the wrong thing.
      const found = patterns
        .filter((candidate) => candidate.pattern.test(text))
        .sort((a, b) => text.search(a.pattern) - text.search(b.pattern))[0];
      if (found) matches.push({ relPath, line: index + 1, text: text.trim(), kind: found.token });
    });
  }

  return { matches, mode, heuristic: true };
}
