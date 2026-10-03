import { resolve, sep } from 'node:path';

import { boardForProject } from '../server/board.mjs';
import { resolveRoots } from '../server/config.mjs';
import { scanRoot } from '../server/scan.mjs';

/**
 * The roots and the projects read from them, resolved once per call.
 *
 * This is the one place the MCP server decides what exists, and it decides it by calling the board's own resolver:
 * `resolveRoots` reads `--root`, the config file, `$OTTER_SKILLS_ROOTS`, discovery and the Orca list in that order. The
 * alternative — a second resolution that agrees today — is how an agent ends up asking about a repository the board
 * has stopped reading.
 */
export function resolveProjects({ argv, env, cwd } = {}) {
  const resolved = resolveRoots({ argv, env, cwd });
  const projects = [];
  const failures = [];

  for (const root of resolved.roots) {
    try {
      projects.push(scanRoot(root, resolved.rootMeta[root]));
    } catch (error) {
      failures.push({ root, error: error.message });
    }
  }

  projects.sort((a, b) => a.name.localeCompare(b.name));
  return { ...resolved, projects, failures };
}

/** The project whose repository holds `cwd`, the deepest one when repositories nest. */
function projectAt(projects, cwd) {
  const inside = projects.filter(({ repoPath }) => cwd === repoPath || cwd.startsWith(`${repoPath}${sep}`));
  return inside.sort((a, b) => b.repoPath.length - a.repoPath.length)[0] ?? null;
}

/**
 * A project named by id, or a refusal that says which ids would have worked. Every tool declares `project` optional,
 * and a client starts the server in the repository it is working in, so an omitted id means that repository.
 */
export function projectOrThrow(context, id, cwd = process.cwd()) {
  const known = context.projects.map((candidate) => candidate.id).sort();
  if (id === undefined) {
    const here = projectAt(context.projects, resolve(cwd));
    if (here) return here;
    if (!known.length) throw new Error('no project given, and this machine reads no repositories');
    throw new Error(
      `no project given, and ${cwd} is in none of them — only a repository with a .o-skills/ tree is indexed. ` +
        `Read its files directly, or pass project, one of ${known.join(', ')}`,
    );
  }

  const project = context.projects.find((candidate) => candidate.id === id);
  if (project) return project;
  if (!known.length) throw new Error(`unknown project ${id}: this machine reads no repositories`);
  throw new Error(`unknown project ${id}: known ids are ${known.join(', ')}`);
}

export function boardOf(project) {
  return boardForProject({ root: project.root, projectId: project.id });
}

/** Pretty-printed JSON, because an agent reads it and a stable shape matters more than a byte saved. */
export const asText = (value) => JSON.stringify(value, null, 2);
