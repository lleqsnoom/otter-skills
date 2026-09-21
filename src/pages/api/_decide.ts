import { boardForProject } from '../../server/board.mjs';
import { findProject, invalidateSnapshot } from '../../server/snapshot.mjs';

/**
 * What the two decisions this app writes have in common: a JSON body naming an artifact by its project and its path,
 * and an answer that is that project's board as its file now reads.
 *
 * Each route keeps only what is its own — a card's column and lane, or whether an item is archived — because the
 * rest written twice is the rest free to drift, and this pair already had (one route validated its own field, the
 * other took it by truthiness).
 */

/** The two facts a write needs of the project it is about: an id to answer with, a root to write in. */
interface ProjectRef {
  id: string;
  root: string;
}

export function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** The body of a decision, or the refusal to answer it. */
export async function readBody<T extends object>(request: Request): Promise<T | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'expected a JSON body' }, 400);
  }
  if (typeof body !== 'object' || body === null) return json({ ok: false, error: 'expected a JSON object' }, 400);
  return body as T;
}

/**
 * The artifact a decision is about, resolved to the tree that holds it: the decision is written inside the repository
 * it is about, so the id has to be resolved to the root the snapshot read before anything can be filed.
 */
export function readTarget(body: unknown): { project: ProjectRef; path: string } | Response {
  const named = (body ?? {}) as { project?: unknown; path?: unknown };
  const id = typeof named.project === 'string' ? named.project : '';
  const path = typeof named.path === 'string' ? named.path : '';
  if (!id || !path) return json({ ok: false, error: 'project and path are required' }, 400);

  const project = findProject(id);
  if (!project) return json({ ok: false, error: `unknown project: ${id}` }, 400);
  return { project, path };
}

/**
 * That project's board as its file now reads, never a fresh snapshot — a re-scan would re-read every root to hand
 * back the ten projects a write never touched.
 */
export function boardAfterWrite(project: ProjectRef) {
  invalidateSnapshot();
  return boardForProject({ root: project.root, projectId: project.id });
}
