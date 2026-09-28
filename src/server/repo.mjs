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

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', '.astro', 'vendor']);
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

/** One repository file's text, or a refusal saying why it was not read. */
export function readRepoFile(repoPath, relPath, { maxBytes = MAX_FILE_BYTES } = {}) {
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
