import type { APIRoute } from 'astro';

import { writeDeletion } from '../../server/board.mjs';
import { getSnapshot, invalidateSnapshot } from '../../server/snapshot.mjs';

/**
 * Archiving an item, or bringing it back — the second write this app makes, and a local preference like the
 * first: the artifact keeps saying whatever it says, and the board stops drawing it. `deleted: false` unarchives it.
 * The answer is the fresh snapshot's deletions, so the screen and the file cannot disagree.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { project?: string; path?: string; deleted?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'expected a JSON body' }, 400);
  }

  const project = typeof body.project === 'string' ? body.project : '';
  const path = typeof body.path === 'string' ? body.path : '';
  if (!project || !path) return json({ ok: false, error: 'project and path are required' }, 400);

  const written = writeDeletion({ projectId: project, relPath: path, deleted: body.deleted !== false });
  if (!written.ok) return json(written, 400);

  invalidateSnapshot();
  return json({ ok: true, file: written.file, deletions: getSnapshot({ force: true }).deletions });
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
