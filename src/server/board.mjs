import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { configFilePath } from './config.mjs';

/**
 * The reader's own board — the one thing this app writes.
 *
 * Everything else in Otter PM is read from the repository, and moving a card cannot change what a document
 * says: a run is finished because its `state.json` says so, and a checklist is ticked in the file. So dragging a
 * card is a *local* decision, kept beside the app rather than in the tree it reads — the same shape as the report
 * app's to-do file, which is also its single write path. The stored thing is a column, with the time it was set,
 * and nothing is inferred from it: an item whose data disagrees is shown as *moved*, with the data still visible.
 *
 * Where a card sits *within* its lane is the second thing the file holds, and it is stored the other way round: not
 * a rank against the card, which would have to be renumbered whenever a neighbour moved, but the lane itself, top
 * to bottom, as the last drop left it. A card that is not named in that list — one that turned up afterwards, or
 * one the reader had filtered off the board — is drawn after the ones that are, which is the only place it can go
 * without contradicting a decision somebody made.
 *
 * Archiving an item is the third decision the same file holds, and it is a decision of the same kind: the
 * artifact is not touched, the board simply stops drawing it, and the reader can unarchive it. Filing, sorting and
 * archiving are independent — a card that is archived keeps the column and the place it was filed into, so
 * unarchiving it lands where it was rather than at the end of the queue.
 *
 * The file lives beside `otter-pm.config.json` (or wherever `$OTTER_PM_BOARD` points), so it is per-machine
 * state rather than part of either repository, and it is gitignored.
 */
export const BOARD_COLUMNS = ['todo', 'active', 'unknown', 'done', 'closed'];

export function boardFile(env = process.env) {
  return env.OTTER_PM_BOARD || join(dirname(configFilePath({ env })), 'board.json');
}

/** The key a decision is stored under: a path is only unique inside its project, so both are in the key. */
export function boardKey(projectId, relPath) {
  return `${projectId}:${relPath}`;
}

/** The key a lane's order is stored under: where a card sits is a fact about the lane, not about the card. */
export function orderKey(projectId, column) {
  return `${projectId}:${column}`;
}

/** A move whose column this app does not know is not a move; anything else about it is kept as it was written. */
function cleanMoves(value) {
  const moves = {};
  if (!value || typeof value !== 'object') return moves;
  for (const [key, entry] of Object.entries(value)) {
    if (entry && BOARD_COLUMNS.includes(entry.column)) moves[key] = { column: entry.column, at: entry.at ?? null };
  }
  return moves;
}

/**
 * A deletion is an object or it is not a deletion. A hand-edited `"yes"` would otherwise hide work nobody asked to
 * hide, so only an entry that is an object counts, and an `at` that is not a time is read as no time at all.
 */
function cleanDeletions(value) {
  const deleted = {};
  if (!value || typeof value !== 'object') return deleted;
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    deleted[key] = { at: typeof entry.at === 'string' ? entry.at : null };
  }
  return deleted;
}

/**
 * An order is a list of paths or it is not an order. A hand-edited entry that is not one is dropped rather than
 * half-read, the same way a malformed move is, and a path cannot appear twice in a lane.
 */
function cleanOrders(value) {
  const orders = {};
  if (!value || typeof value !== 'object') return orders;
  for (const [key, entry] of Object.entries(value)) {
    if (!Array.isArray(entry)) continue;
    const paths = [...new Set(entry.filter((path) => typeof path === 'string' && path))];
    if (paths.length) orders[key] = paths;
  }
  return orders;
}

export function readBoard(env = process.env) {
  const file = boardFile(env);
  if (!existsSync(file)) return { file, moves: {}, deleted: {}, orders: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return {
      file,
      moves: cleanMoves(parsed?.moves),
      deleted: cleanDeletions(parsed?.deleted),
      orders: cleanOrders(parsed?.orders),
    };
  } catch {
    // A board file that cannot be read is an empty board, never a failed snapshot: it holds a preference, and the
    // reader can set it again in one drag.
    return { file, moves: {}, deleted: {}, orders: {} };
  }
}

/**
 * Every decision lives in one file, so all of them are written by one function and none can drop the others. It
 * takes the board `readBoard` handed out, whole and unchanged in shape: one object means a write cannot pair one
 * reader's moves with another's orders, which four arguments could.
 */
function writeBoard({ file, moves, deleted, orders }) {
  const body = JSON.stringify(
    {
      note: 'Column moves, archived items and lane orders in Otter PM. Delete a move to return an item to the column its own data gives it; delete an order to put a lane back in the order the items themselves sort into.',
      moves,
      deleted,
      orders,
    },
    null,
    2,
  );
  // Written to a sibling first: a half-written board is a board that cannot be read back.
  const temporary = `${file}.tmp`;
  try {
    writeFileSync(temporary, `${body}\n`, 'utf8');
    renameSync(temporary, file);
  } catch (error) {
    return { ok: false, error: `could not write ${file}: ${error.message}` };
  }
  return { ok: true, file };
}

/**
 * Writes one move. `column: null` removes it — dragging a card back to the column its own data gives it is not a
 * move, and keeping that as an entry would leave a preference that says nothing.
 *
 * `order` is the lane the card was let go in, top to bottom, and it is written under the lane rather than under
 * the card. Dropping a card into the lane its own data gives it is therefore still worth recording when it was
 * dropped at a place: that clears the move and keeps the order, because the place is a decision and the column
 * is not.
 *
 * @param {{ projectId: string, relPath: string, column: string | null, order?: { column: string, paths?: unknown[] } | null, env?: NodeJS.ProcessEnv }} placement
 * @returns {{ ok: true, file: string, key: string, column: string | null } | { ok: false, error: string }}
 */
export function writeMove({ projectId, relPath, column, order = null, env = process.env }) {
  if (column !== null && !BOARD_COLUMNS.includes(column)) {
    return { ok: false, error: `unknown column: ${column}` };
  }
  if (order && !BOARD_COLUMNS.includes(order.column)) {
    return { ok: false, error: `unknown column: ${order?.column}` };
  }

  const board = readBoard(env);
  const key = boardKey(projectId, relPath);
  applyMove(board.moves, key, column);
  if (order) applyOrder(board.orders, projectId, order);

  const written = writeBoard(board);
  if (!written.ok) return written;
  return { ok: true, file: board.file, key, column };
}

/**
 * One card's column, applied to the moves already read: `null` is the card put back where its own data has it, which
 * is a move removed rather than stored.
 *
 * @param {Record<string, { column: string, at: string | null }>} moves
 * @param {string} key
 * @param {string | null} column
 */
function applyMove(moves, key, column) {
  if (column === null) delete moves[key];
  else moves[key] = { column, at: new Date().toISOString() };
}

/**
 * One lane's order, applied to the orders already read. A path is a place once, and an order with nothing left in it
 * is removed rather than stored: a lane nobody has arranged reads the way its items sort, and an empty list would
 * say the opposite of that.
 *
 * @param {Record<string, string[]>} orders
 * @param {string} projectId
 * @param {{ column: string, paths?: unknown[] }} order
 */
function applyOrder(orders, projectId, order) {
  const lane = orderKey(projectId, order.column);
  const paths = [...new Set((order.paths || []).filter((path) => typeof path === 'string' && path))];
  if (paths.length) orders[lane] = paths;
  else delete orders[lane];
}

/**
 * Archives an item, or brings it back. An unarchive removes the entry rather than storing a `false`, so the file
 * holds the decisions a reader made and not their negation — the same reason a move home is a cleared move.
 */
export function writeDeletion({ projectId, relPath, deleted = true, env = process.env }) {
  const board = readBoard(env);
  const key = boardKey(projectId, relPath);
  if (deleted) board.deleted[key] = { at: new Date().toISOString() };
  else delete board.deleted[key];

  const written = writeBoard(board);
  if (!written.ok) return written;
  return { ok: true, file: written.file, key, deleted: Boolean(deleted) };
}
