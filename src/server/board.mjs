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
 * Archiving an item is the second decision the same file holds, and it is a decision of the same kind: the
 * artifact is not touched, the board simply stops drawing it, and the reader can unarchive it. Filing and archiving
 * are independent — a card that is archived keeps the column it was filed into, so unarchiving it lands where it
 * was rather than at the end of the queue.
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

export function readBoard(env = process.env) {
  const file = boardFile(env);
  if (!existsSync(file)) return { file, moves: {}, deleted: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { file, moves: cleanMoves(parsed?.moves), deleted: cleanDeletions(parsed?.deleted) };
  } catch {
    // A board file that cannot be read is an empty board, never a failed snapshot: it holds a preference, and the
    // reader can set it again in one drag.
    return { file, moves: {}, deleted: {} };
  }
}

/** Both decisions live in one file, so both are written by one function and neither can drop the other. */
function writeBoard(file, moves, deleted) {
  const body = JSON.stringify(
    {
      note: 'Column moves and archived items in Otter PM. Delete an entry to return an item to the column its own data gives it, or to unarchive it.',
      moves,
      deleted,
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
 */
export function writeMove({ projectId, relPath, column, env = process.env }) {
  if (column !== null && !BOARD_COLUMNS.includes(column)) {
    return { ok: false, error: `unknown column: ${column}` };
  }
  const { file, moves, deleted } = readBoard(env);
  const key = boardKey(projectId, relPath);
  if (column === null) delete moves[key];
  else moves[key] = { column, at: new Date().toISOString() };

  const written = writeBoard(file, moves, deleted);
  if (!written.ok) return written;
  return { ok: true, file, key, column };
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

  const written = writeBoard(board.file, board.moves, board.deleted);
  if (!written.ok) return written;
  return { ok: true, file: written.file, key, deleted: Boolean(deleted) };
}
