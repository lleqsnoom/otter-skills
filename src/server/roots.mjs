import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { configFilePath, projectIdFor, resolveRoots, toXSkillsRoot } from './config.mjs';

/**
 * Adding a repository that already exists on disk, and the one config write both it and a create end with.
 *
 * `createProject` and `addExistingProject` are the two ways a path becomes a root, and they agree on the part that
 * matters: the path is appended to `roots` in the config file `configFilePath` resolves, and the next scan reads it.
 * That write lives here rather than beside the create flow, because a create is not the only caller any more.
 */

/** The category a scaffold writes: an empty folder the board already knows, and the least that makes a root. */
const SCAFFOLD_CATEGORY = 'tasks';

const readConfig = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

/** The path a root is remembered by, so the next scan finds it. Every other key survives. */
export function addRoot(file, dir) {
  const config = readConfig(file);
  const roots = Array.isArray(config.roots) ? config.roots : [];
  if (roots.includes(dir)) return { ok: true, file };
  try {
    writeFileSync(file, `${JSON.stringify({ ...config, roots: [...roots, dir] }, null, 2)}\n`, 'utf8');
  } catch (error) {
    return { ok: false, status: 500, error: `could not write ${file}`, detail: error.message };
  }
  return { ok: true, file };
}

/**
 * A folder a picker may show: its children that are directories, and whether it is already a root.
 *
 * Directories only — a picker chooses a folder, and nothing here reads a file. Dot-directories and `node_modules`
 * are left out for the same reason discovery leaves them out: they are almost never what someone is looking for,
 * and they are most of what is there. The top of the list is a place to stop: `parent` is null at `/`.
 */
export function listDirectories(asked, { env = process.env } = {}) {
  const wanted = String(asked ?? '').trim();
  const path = wanted ? resolve(wanted) : homedir();

  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return { status: 404, error: `no such folder: ${path}` };
  if (!stat.isDirectory()) return { status: 400, error: `not a folder: ${path}` };

  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch (error) {
    return { status: 403, error: `could not read ${path}`, detail: error.message };
  }

  const dirs = entries
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .map((entry) => {
      const child = join(path, entry.name);
      const root = toXSkillsRoot(child);
      return { name: entry.name, path: child, root };
    })
    .filter((entry) => existsSync(entry.path))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    status: 200,
    body: {
      path,
      parent: dirname(path) === path ? null : dirname(path),
      /** The `.x-skills` root this folder itself is, when it is one. */
      root: toXSkillsRoot(path),
      dirs,
    },
  };
}

/** The repository path a root belongs to: the `.x-skills` directory's parent, or the folder itself when it is one. */
export function repoPathFor(root) {
  return basename(root) === '.x-skills' ? dirname(root) : root;
}

/** The `.x-skills` tree a folder with none is given, and the only thing a scaffold writes. */
function scaffold(dir) {
  try {
    mkdirSync(join(dir, '.x-skills', SCAFFOLD_CATEGORY), { recursive: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, status: 500, error: `could not write ${join(dir, '.x-skills')}`, detail: error.message };
  }
}

/**
 * A path on disk, read as a root: validated, given the least tree when it has none, and remembered in the config so
 * the next scan finds it. Nothing else in the repository is touched — no `project.md`, no README, no commit — which
 * is the difference between this and a create.
 *
 * A refusal says which step refused, the same way a create does: 400 for a path that is missing or not a folder, 409
 * for one that is already on the board or that would take an id another root already answers to, 500 when the tree
 * or the config could not be written.
 */
export function addExistingProject(spec = {}, { env = process.env } = {}) {
  const asked = String(spec.path ?? '').trim();
  if (!asked) return { ok: false, status: 400, error: 'a path is required' };

  const dir = resolve(asked);
  const stat = statSync(dir, { throwIfNoEntry: false });
  if (!stat) return { ok: false, status: 400, error: `no such folder: ${dir}` };
  if (!stat.isDirectory()) return { ok: false, status: 400, error: `not a folder: ${dir}` };

  let root = toXSkillsRoot(dir);
  let scaffolded = false;
  if (!root) {
    const made = scaffold(dir);
    if (!made.ok) return made;
    root = toXSkillsRoot(dir);
    scaffolded = true;
  }
  if (!root) return { ok: false, status: 500, error: `could not make ${dir} a root` };

  const repo = repoPathFor(root);
  const current = resolveRoots({ env }).roots;
  if (current.includes(root)) return { ok: false, status: 409, error: `${root} is already on the board` };

  /**
   * An id is the repository folder's name, and the board and the archive are keyed by it, so a second root answering
   * to the same one would have its cards filed under the other's decisions. Refused rather than renamed: the id of a
   * root that is already read must not move.
   */
  const id = projectIdFor(root);
  const clash = current.find((other) => projectIdFor(other) === id);
  if (clash) return { ok: false, status: 409, error: `${dirname(clash)} is already read as ${id}` };

  const configFile = configFilePath({ env });
  const rooted = addRoot(configFile, repo);
  if (!rooted.ok) return rooted;

  return { ok: true, status: 200, id, dir, repo, root, scaffolded, configFile };
}
