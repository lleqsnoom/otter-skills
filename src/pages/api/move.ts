import type { APIRoute } from 'astro';

import { writeMove } from '../../server/board.mjs';
import { boardAfterWrite, json, readBody, readTarget } from './_decide';

/**
 * The one write in this app: the column a reader dragged a card to, and the place in it the card was let go.
 *
 * It is a decision *about* a document rather than a change to it, and it is written into the project's own
 * `.x-skills/board.json` — the file that makes a filing outlive the branch, the worktree and the checkout the board
 * happens to be served from. Nothing a document says is touched, and a moved card still says *moved*.
 *
 * The place travels as the whole lane, in the order it should read from now on: what a drop decides is where one card
 * sits among the others, and a lane is the smallest thing that can say that without every other card in it having to
 * move too.
 */
interface MoveBody {
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
  const body = await readBody<MoveBody>(request);
  if (body instanceof Response) return body;
  const target = readTarget(body);
  if (target instanceof Response) return target;

  const written = writeMove({
    root: target.project.root,
    relPath: target.path,
    column: body.column === null || body.column === undefined ? null : String(body.column),
    order: readOrder(body.order),
  });
  if (!written.ok) return json(written, 400);

  const board = boardAfterWrite(target.project);
  return json({ ok: true, file: written.file, project: target.project.id, board: board.moves, orders: board.orders });
};
