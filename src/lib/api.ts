import type { BoardColumn, BoardDeletions, BoardMoves, BoardOrder, BoardOrders, FileContent, Snapshot } from './types';

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let body: { error?: string; detail?: string } | null = null;
    try {
      body = (await response.json()) as { error?: string; detail?: string };
      if (body?.error) message = body.error;
    } catch {
      /* an error the server could not describe */
    }
    // The reason a command failed travels with the error, because a reader deciding what to do needs it.
    throw Object.assign(new Error(message), { detail: body?.detail ?? '' });
  }
  return (await response.json()) as T;
}

export function fetchSnapshot(force = false): Promise<Snapshot> {
  return fetch(`/api/snapshot${force ? '?force=1' : ''}`).then(json<Snapshot>);
}

export function refreshSnapshot(): Promise<Snapshot> {
  return fetch('/api/refresh', { method: 'POST' }).then(json<Snapshot>);
}

export function fetchFile(project: string, path: string): Promise<FileContent> {
  const query = new URLSearchParams({ project, path });
  return fetch(`/api/file?${query}`).then(json<FileContent>);
}

/**
 * An artifact, saved. The answer is the file as it reads after the write, so the screen shows what the disk holds
 * rather than what was typed; a refusal arrives as the error the server gave it.
 */
export function saveFile(project: string, path: string, content: string): Promise<FileContent> {
  return fetch('/api/file', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project, path, content }),
  }).then(json<FileContent>);
}

/**
 * The one write: the column a reader filed a card into, and the lane it was let go in. `null` puts the card back to
 * the column its own data gives it, while the order still records where it was dropped — the place is a decision
 * even when the column is not.
 *
 * The answer carries *that project's* whole board, because its decisions live in its own `.x-skills/board.json`; the
 * caller replaces that project's slice of the snapshot with it (`replaceProject`), which is what lets a write remove
 * an entry here as well as add one.
 */
export function moveItem(
  project: string,
  path: string,
  column: BoardColumn | null,
  order: BoardOrder | null = null,
): Promise<{ ok: boolean; board: BoardMoves; orders: BoardOrders; error?: string }> {
  return fetch('/api/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project, path, column, order }),
  }).then(json<{ ok: boolean; board: BoardMoves; orders: BoardOrders }>);
}

/**
 * Archiving an item, or bringing it back: `true` hides it from the board, `false` unarchives it. The file itself is
 * never touched — this is the reader's decision about it, kept in the project beside a card's column.
 */
export function deleteItem(project: string, path: string, deleted: boolean): Promise<{ ok: boolean; deletions: BoardDeletions; error?: string }> {
  return fetch('/api/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project, path, deleted }),
  }).then(json<{ ok: boolean; deletions: BoardDeletions }>);
}

export function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

export interface BrowsedFolder {
  name: string;
  path: string;
  /** The `.x-skills` root this child is, when it is one: what the picker marks as already readable. */
  root: string | null;
}

export interface BrowsedDirectory {
  path: string;
  /** Where the picker goes from here; null at the top of the tree. */
  parent: string | null;
  /** The root this folder itself is, when it is one. */
  root: string | null;
  dirs: BrowsedFolder[];
}

/** One level of folders, for the picker. With no path the server answers from the home directory. */
export function browseDirectory(path?: string): Promise<BrowsedDirectory> {
  const query = path ? `?${new URLSearchParams({ path })}` : '';
  return fetch(`/api/browse${query}`).then(json<BrowsedDirectory>);
}

export interface AddedRoot {
  ok: true;
  id: string;
  dir: string;
  repo: string;
  root: string;
  /** True when the folder had no `.x-skills` and one was made for it. */
  scaffolded: boolean;
  configFile: string;
}

/**
 * A folder that already exists, added to the board. A refusal arrives as the error the server gave it — 400 for a
 * path that is missing or not a folder, 409 for one that is already read or would take another root's id.
 */
export function addProjectRoot(path: string): Promise<AddedRoot> {
  return fetch('/api/roots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  }).then(json<AddedRoot>);
}

export interface ProjectIconSpec {
  text?: string;
  color?: string;
  src?: string | null;
  /** An image chosen or dropped in the form, read in the browser and written into the project by the server. */
  file?: { name: string; type: string; data: string } | null;
}

export interface CreateProjectSpec {
  name: string;
  about: string;
  baseDir?: string;
  icon?: ProjectIconSpec;
  visibility?: 'private' | 'public';
  license?: string | null;
}

export interface CreatedProject {
  ok: true;
  id: string;
  slug: string;
  dir: string;
  root: string;
  configFile: string;
  owner: string | null;
  url: string | null;
}

export interface ProjectDefaults {
  owner: string | null;
  baseDir: string;
  licenses: { key: string; name: string }[];
}

/** What a new project would default to: the account, the directory, and the licenses GitHub publishes. */
export function projectDefaults(): Promise<ProjectDefaults> {
  return fetch('/api/project').then(json<ProjectDefaults>);
}

/**
 * A project, made: a folder, a git history and a GitHub repository, or nothing at all. A refusal arrives as the
 * error the server gave it — 400 for a name or a directory, 409 for one that is already there, 501/502 for `gh`.
 */
export function createProject(spec: CreateProjectSpec): Promise<CreatedProject> {
  return fetch('/api/project', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(spec),
  }).then(json<CreatedProject>);
}