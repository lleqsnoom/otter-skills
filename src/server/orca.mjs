import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Orca's own project list, as a source of roots.
 *
 * Keeping a list of repositories to preview in two places is a list that drifts: a repo added to the IDE would
 * have to be added here as well, and a repo removed from the IDE would leave a root pointing at a directory that
 * is no longer one. So Otter PM can read the IDE's list instead — `repos[]` in Orca's profile store, where
 * every entry carries the checkout path, which is the only thing a root needs (`<path>/.x-skills`).
 *
 * The store is a JSON document the app rewrites as you work, so this reads defensively: a missing file, an old
 * schema or a file being written mid-read all mean "no roots from here", never a crash — the explicit roots and
 * the other sources still apply.
 */

/** Orca's config root. `$ORCA_CONFIG_DIR` wins so a profile can be pointed at explicitly. */
export function orcaConfigDir(env = process.env) {
  return env.ORCA_CONFIG_DIR || join(homedir(), '.config', 'orca');
}

/**
 * The newest `profiles/<name>/orca-data.json`, which is the profile the IDE is actually using — there can be more
 * than one, and the one written to most recently is the one on screen.
 */
export function orcaDataFile(env = process.env) {
  const profiles = join(orcaConfigDir(env), 'profiles');
  if (!existsSync(profiles)) return null;

  let newest = null;
  for (const entry of readdirSync(profiles, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(profiles, entry.name, 'orca-data.json');
    try {
      const stat = statSync(candidate);
      if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { file: candidate, mtimeMs: stat.mtimeMs };
    } catch {
      continue;
    }
  }
  return newest?.file ?? null;
}

/**
 * Every repository the IDE has, as `{ name, path, icon, badgeColor }`.
 *
 * The icon and the badge colour are the IDE's own fields, carried through unchanged so Otter PM and the IDE
 * label the same repository the same way — `repoIcon` is a GitHub avatar for a repository imported from GitHub, and
 * `badgeColor` is the colour Orca paints that repository's badge. Nothing is invented for a repository that has
 * neither, and nothing is filtered here beyond a shape check: whether a path is a root is `toXSkillsRoot`'s
 * question, and the answer is the same wherever the candidate came from.
 */
export function readOrcaRepos(env = process.env) {
  const file = orcaDataFile(env);
  if (!file) return { file: null, repos: [], reason: 'no Orca profile store found' };

  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { file, repos: [], reason: `could not read ${file}: ${error.message}` };
  }

  const repos = Array.isArray(data?.repos) ? data.repos : [];
  const found = repos
    .filter((repo) => typeof repo?.path === 'string' && repo.path.length > 0)
    .map((repo) => ({
      name: typeof repo.displayName === 'string' && repo.displayName ? repo.displayName : repo.path,
      path: repo.path,
      // A URL is the only icon this can render: Orca also has `type: 'emoji'` and `'letter'` entries, and those
      // are drawn from the label instead of fetched.
      icon: typeof repo.repoIcon?.src === 'string' && /^https?:\/\//.test(repo.repoIcon.src) ? repo.repoIcon.src : null,
      iconLabel: typeof repo.repoIcon?.label === 'string' ? repo.repoIcon.label : null,
      badgeColor: typeof repo.badgeColor === 'string' ? repo.badgeColor : null,
    }));

  return { file, repos: found, reason: found.length ? null : 'the profile store lists no repositories' };
}