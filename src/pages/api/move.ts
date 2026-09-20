import type { APIRoute } from 'astro';

import { readBoard, writeMove } from '../../server/board.mjs';
import { invalidateSnapshot } from '../../server/snapshot.mjs';

/**
 * The one write in this app: the column a reader dragged a card to, and the place in it the card was let go.
 *
 * It writes a local preference, never a repository — what a document says about itself is still what the card
 * shows, and a moved card says so. The answer is the board as the file now reads rather than a fresh snapshot: a
 * snapshot re-reads every root to hand back the ten projects a drop never touched, and the client replaces only its
 * moves and its orders. The snapshot is invalidated instead, so the next screen that asks for one gets the new board
 * and this drop pays for nothing else.
 *
 * The place travels as the whole lane, in the order it should read from now on. What a drop decides is where one
 * card sits among the others, and a lane is the smallest thing that can say that without every other card in it
 * having to move too.
 */
interface MoveBody {
  project?: string;
  path?: string;
  column?: string | null;
  order?: { column?: string; paths?: unknown } | null;
}

/** The lane a drop left, as it arrived: an order that is not a list of paths is no order at all. */
function readOrder(value: MoveBody['order']): { column: string; paths: string[] } | null {
  if (!value || !Array.isArray(value.paths)) return null;
  return {
    column: String(value.column ?? ''),
    paths: value.paths.filter((entry): entry is string => typeof entry === 'string'),
  };
}

export const POST: APIRoute = async ({ request }) => {
  let body: MoveBody;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'expected a JSON body' }, 400);
  }

  const project = typeof body.project === 'string' ? body.project : '';
  const path = typeof body.path === 'string' ? body.path : '';
  const column = body.column === null || body.column === undefined ? null : String(body.column);

  if (!project || !path) return json({ ok: false, error: 'project and path are required' }, 400);

  const written = writeMove({ projectId: project, relPath: path, column, order: readOrder(body.order) });
  if (!written.ok) return json(written, 400);

  invalidateSnapshot();
  const { moves, orders } = readBoard();
  return json({ ok: true, file: written.file, board: moves, orders });
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}