import type { APIRoute } from 'astro';

import { writeDeletion } from '../../server/board.mjs';
import { boardAfterWrite, json, readBody, readTarget } from './_decide';

/**
 * Archiving an item, or bringing it back — the second write this app makes, and a decision of the same kind as the
 * first: the artifact keeps saying whatever it says, the board stops drawing it, and the entry lands in the
 * project's own `.x-skills/board.json` beside a card's column and a lane's order. `deleted: false` unarchives it.
 */
interface DeleteBody {
  deleted?: boolean;
}

export const POST: APIRoute = async ({ request }) => {
  const body = await readBody<DeleteBody>(request);
  if (body instanceof Response) return body;
  const target = readTarget(body);
  if (target instanceof Response) return target;

  const written = writeDeletion({
    root: target.project.root,
    relPath: target.path,
    deleted: body.deleted !== false,
  });
  if (!written.ok) return json(written, 400);

  const board = boardAfterWrite(target.project);
  return json({ ok: true, file: written.file, project: target.project.id, deletions: board.deleted });
};
