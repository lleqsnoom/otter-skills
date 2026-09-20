import type { APIRoute } from 'astro';

import { addExistingProject } from '../../server/roots.mjs';
import { clearParseCache } from '../../server/scan.mjs';
import { invalidateSnapshot } from '../../server/snapshot.mjs';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: HEADERS });

/**
 * A folder on disk, added to the board.
 *
 * The socket between the two halves of this feature: a create makes a repository, and this one is handed a path that
 * already exists. `roots.mjs` owns the validation, the scaffold and the config line, and answers with the status a
 * refusal belongs to; both caches are dropped on success for the same reason `/api/refresh` drops them — the root has
 * to be in the answer the next screen reads.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { path?: string };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'expected a JSON body' }, 400);
  }

  const answer = addExistingProject(body);
  if (!answer.ok) return json(answer, answer.status);

  invalidateSnapshot();
  clearParseCache();
  return json(answer);
};
