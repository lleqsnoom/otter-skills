import type { APIRoute } from 'astro';

import { writeMove } from '../../server/board.mjs';
import { getSnapshot, invalidateSnapshot } from '../../server/snapshot.mjs';

/**
 * The one write in this app: the column a reader dragged a card to.
 *
 * It writes a local preference, never a repository — what a document says about itself is still what the card
 * shows, and a moved card says so. The answer is the fresh snapshot, so the next render and the file cannot
 * disagree about where the card is.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: { project?: string; path?: string; column?: string | null };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'expected a JSON body' }, 400);
  }

  const project = typeof body.project === 'string' ? body.project : '';
  const path = typeof body.path === 'string' ? body.path : '';
  const column = body.column === null || body.column === undefined ? null : String(body.column);

  if (!project || !path) return json({ ok: false, error: 'project and path are required' }, 400);

  const written = writeMove({ projectId: project, relPath: path, column });
  if (!written.ok) return json(written, 400);

  invalidateSnapshot();
  return json({ ok: true, file: written.file, board: getSnapshot({ force: true }).board });
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}