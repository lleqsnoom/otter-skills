import type { BoardColumn, BoardDeletions, BoardMoves, FileContent, Snapshot } from './types';

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
 * The one write: the column a reader filed a card into. `null` puts it back to the column its own data gives it.
 * The answer carries the whole board, so the screen and the file cannot disagree.
 */
export function moveItem(project: string, path: string, column: BoardColumn | null): Promise<{ ok: boolean; board: BoardMoves; error?: string }> {
  return fetch('/api/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project, path, column }),
  }).then(json<{ ok: boolean; board: BoardMoves }>);
}

/**
 * Archiving an item, or bringing it back: `true` hides it from the board, `false` unarchives it. The file itself
 * is never touched — this is the reader's decision, kept beside the app like a card's column — so the answer
 * carries every decision and the snapshot replaces its own map rather than re-reading nine repositories.
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