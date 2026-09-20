import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readOrcaRepos } from './orca.mjs';

export const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const inRepoXSkills = (repoPath) => join(repoPath, '.x-skills');

function looksLikeXSkillsRoot(dir) {
  if (!dir || !existsSync(dir)) return false;
  return (
    existsSync(join(dir, 'runs')) ||
    existsSync(join(dir, 'tasks')) ||
    existsSync(join(dir, 'plans')) ||
    existsSync(join(dir, 'plan')) ||
    existsSync(join(dir, 'epics'))
  );
}

/** Accept either a repo path (containing .x-skills) or the .x-skills directory itself. */
export function toXSkillsRoot(candidate) {
  const abs = resolve(candidate);
  if (!existsSync(abs)) return null;
  if (looksLikeXSkillsRoot(abs)) return abs;
  const nested = inRepoXSkills(abs);
  if (looksLikeXSkillsRoot(nested)) return nested;
  return null;
}

/**
 * The config beside this tool, found by walking up from where the app was started and then from wherever this
 * module ended up — `src/server/` when the dev server runs it, `dist/server/` once it is built — so a fixed
 * relative path would only work in one of the two. The starting directory comes first because a config a person
 * edits for their own repositories has to win over the one that ships with the package. An explicit `--config` or
 * `$OTTER_PM_CONFIG` wins over both.
 */
function findConfigFile(explicit, env) {
  if (explicit) return resolve(explicit);
  if (env.OTTER_PM_CONFIG) return resolve(env.OTTER_PM_CONFIG);

  const fromModule = dirname(fileURLToPath(import.meta.url));
  for (const start of [process.cwd(), fromModule]) {
    let dir = resolve(start);
    for (let depth = 0; depth < 5; depth += 1) {
      const candidate = join(dir, 'otter-pm.config.json');
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function readConfigFile(explicit, env) {
  const file = findConfigFile(explicit, env);
  if (!file || !existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`otter-pm config ${file} is not valid JSON: ${error.message}`);
  }
}

/**
 * The config file this run found, so a file that has to be written lands beside it. `board.json` — the reader's
 * own column moves — belongs next to the config a person edits, not in the build output, and the config is the one
 * path this server already resolves robustly in both the dev tree and the built one.
 */
export function configFilePath({ argv = process.argv.slice(2), env = process.env } = {}) {
  let explicit = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--config' && argv[index + 1]) explicit = argv[index + 1];
    else if (argv[index].startsWith('--config=')) explicit = argv[index].slice('--config='.length);
  }
  return findConfigFile(explicit, env) ?? join(process.cwd(), 'otter-pm.config.json');
}

function splitList(value) {
  return String(value)
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Shallow, bounded discovery: a repository two levels under the given directory. */
function discoverUnder(dir, depth, found) {
  if (depth < 1 || !existsSync(dir)) return found;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const child = join(dir, entry.name);
    if (looksLikeXSkillsRoot(child)) {
      found.push(child);
      continue;
    }
    const nested = inRepoXSkills(child);
    if (looksLikeXSkillsRoot(nested)) {
      found.push(nested);
      continue;
    }
    discoverUnder(child, depth - 1, found);
  }
  return found;
}

/** The flags this resolver reads, as one object instead of five locals threaded through a loop. */
function parseRootFlags(argv) {
  const flags = { roots: [], config: null, discover: [], orca: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' && argv[index + 1]) flags.roots.push(argv[(index += 1)]);
    else if (arg.startsWith('--root=')) flags.roots.push(arg.slice('--root='.length));
    else if (arg === '--config' && argv[index + 1]) flags.config = argv[(index += 1)];
    else if (arg.startsWith('--config=')) flags.config = arg.slice('--config='.length);
    else if (arg === '--discover' && argv[index + 1]) flags.discover.push(argv[(index += 1)]);
    else if (arg.startsWith('--discover=')) flags.discover.push(arg.slice('--discover='.length));
    else if (arg === '--orca') flags.orca = true;
    else if (arg === '--no-orca') flags.orca = false;
  }
  return flags;
}

/** `--orca` / `--no-orca` beats `$OTTER_PM_ORCA`, which beats `orca` in the config file. */
function prefersOrca(flags, config, env) {
  if (flags.orca !== null) return flags.orca;
  if (env.OTTER_PM_ORCA) return env.OTTER_PM_ORCA === '1' || env.OTTER_PM_ORCA === 'true';
  return config.orca === true;
}

/**
 * Every directory any source names, grouped by which source named it — because that is what decides whether a
 * candidate that turns out not to be a root is a mistake or a fact.
 */
function candidateSources({ flags, config, env, cwd, orcaRepos }) {
  const explicit = [
    ...flags.roots,
    ...(Array.isArray(config.roots) ? config.roots : []),
    ...(env.OTTER_PM_ROOTS ? splitList(env.OTTER_PM_ROOTS) : []),
  ];
  const discoverDirs = [...flags.discover, ...(Array.isArray(config.autoDiscover) ? config.autoDiscover : [])];
  const discovered = discoverDirs.flatMap((dir) => discoverUnder(resolve(dir), 2, []));
  const fromOrca = orcaRepos.repos.map((repo) => repo.path);

  // Nothing named a directory, so the place we were started from is the only candidate there is.
  if (!explicit.length && !discovered.length && !fromOrca.length) explicit.push(cwd);

  return { explicit, discovered, fromOrca };
}

/**
 * Turns candidates into roots, and keeps the two ways of not being one apart: a path someone asked for by name is
 * `rejected`, while a repository the IDE lists with no `.x-skills` is `skipped` — most repositories have none, and
 * calling that a mistake would put a warning on most of a real workspace. A path arriving twice is one root.
 */
function classifyCandidates({ explicit, discovered, fromOrca, orcaRepos }) {
  const roots = [];
  const rootMeta = {};
  const rejected = [];
  const skipped = [];
  const orcaRoots = [];
  const seen = new Set();

  for (const candidate of [...explicit, ...fromOrca, ...discovered]) {
    const root = toXSkillsRoot(isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate));
    if (!root) {
      if (fromOrca.includes(candidate)) skipped.push(candidate);
      else rejected.push(candidate);
      continue;
    }
    if (seen.has(root)) continue;
    seen.add(root);
    roots.push(root);

    const repo = fromOrca.includes(candidate) ? orcaRepos.repos.find((entry) => entry.path === candidate) : null;
    if (!repo) continue;
    orcaRoots.push(root);
    rootMeta[root] = {
      name: repo.name,
      icon: repo.icon,
      iconLabel: repo.iconLabel,
      badgeColor: repo.badgeColor,
      source: 'orca',
    };
  }

  return { roots, rootMeta, rejected, skipped, orcaRoots };
}

function orcaReport(enabled, repos, rootsFromOrca) {
  if (!enabled) return { enabled: false, file: null, listed: 0, roots: 0, reason: null };
  return {
    enabled: true,
    file: repos.file,
    listed: repos.repos.length,
    roots: rootsFromOrca,
    reason: repos.reason,
  };
}

/**
 * Roots come from, in order: `--root` flags, the config file, `$OTTER_PM_ROOTS`, discovery, Orca's own project list,
 * and finally the current directory. Every root is either a `.x-skills` directory or a repository that has one.
 *
 * `--root` and `--orca` both work, and they are not exclusive: an explicit root is for a repository the IDE does
 * not know about, and Orca's list is for the ones it does.
 */
export function resolveRoots({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd() } = {}) {
  const flags = parseRootFlags(argv);
  const config = readConfigFile(flags.config, env);
  const orca = prefersOrca(flags, config, env);
  const orcaRepos = orca ? readOrcaRepos(env) : { file: null, repos: [], reason: null };

  const sources = candidateSources({ flags, config, env, cwd, orcaRepos });
  const { roots, rootMeta, rejected, skipped, orcaRoots } = classifyCandidates({ ...sources, orcaRepos });

  return { roots, rootMeta, rejected, skipped, orca: orcaReport(orca, orcaRepos, orcaRoots.length) };
}

export function repoPathFor(root) {
  return dirname(root);
}

export function projectNameFor(root) {
  return repoPathFor(root).split(/[\\/]/).filter(Boolean).pop() || root;
}

export function projectIdFor(root) {
  return projectNameFor(root)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-');
}