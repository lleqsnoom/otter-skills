import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { boardKey } from '../lib/board.mjs';
import { configFilePath } from './config.mjs';

/**
 * The reader's own board — the one thing this app writes.
 *
 * Everything else in Otter Skills is read from the repository, and moving a card cannot change what a document
 * says: a run is finished because its `state.json` says so, and a checklist is ticked in the file. So dragging a
 * card is a decision *about* a document rather than a change to it — kept **with the project it is about**, in
 * `<root>/board.json` inside the `.o-skills` tree, because that is the only place where a decision stays the same
 * decision: on the other branch, in the other worktree, on the other machine. One file beside the app's own config
 * looked like per-machine state and was in fact per-checkout, so `git switch` in this repository — or serving a
 * worktree of it — hid everything a reader had filed.
 *
 * What the file holds, and why each part is shaped the way it is:
 *
 *   - **A column**, with the time it was set, and nothing inferred from it: an item whose data disagrees is shown as
 *     *moved*, with the data still visible.
 *   - **A lane's order**, stored the other way round from a card: not a rank against the card, which would have to be
 *     renumbered whenever a neighbour moved, but the lane itself, top to bottom, as the last drop left it. A card
 *     that is not named in that list — one that turned up afterwards, or one the reader had filtered off the board —
 *     is drawn after the ones that are, which is the only place it can go without contradicting a decision somebody
 *     made.
 *   - **An archive**, a decision of the same kind: the artifact is not touched, the board simply stops drawing it,
 *     and the reader can unarchive it. Filing, sorting and archiving are independent — a card that is archived keeps
 *     the column and the place it was filed into, so unarchiving it lands where it was rather than at the end of the
 *     queue.
 *
 * A project's board is keyed by the artifacts' own paths, with no project id in the key: the file is already about
 * one repository, so the id would be the same string on every line — and it is the one part of a decision that
 * changes when a folder is named differently. The id comes back on the way out (`boardForProject`), because the
 * client holds every project's decisions in one map.
 *
 * Before this, every project's decisions were written into one file beside the config. Nothing reads that file now:
 * it sits in one checkout, and a board served from a worktree or a moved clone does not know that path, so reading it
 * automatically would work in one place and silently not in another. `importLegacyBoard` is that migration made
 * visible — run once, with the file named:
 *
 *     node scripts/import-board.mjs --from <old board.json>
 */
export const BOARD_COLUMNS = ['todo', 'active', 'unknown', 'done', 'closed'];

/** One project's board: inside the `.o-skills` tree it is about. */
export function projectBoardFile(root) {
  return join(root, 'board.json');
}

/**
 * Where every project's decisions used to live: one file beside `otter-skills.config.json`, keyed
 * `<projectId>:<path>` (`$OTTER_SKILLS_BOARD` points at it). Never written, and read only by the import that moves what
 * it holds into the projects it holds it for.
 */
export function legacyBoardFile(env = process.env) {
  return env.OTTER_SKILLS_BOARD || join(dirname(configFilePath({ env })), 'board.json');
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

/**
 * The three maps one board file holds. A file that cannot be read is an empty board, never a failed snapshot: it
 * holds a preference, and the reader can set it again in one drag. `exists` is what tells a project with no board
 * yet from one whose board is empty — the difference between an import and a merge.
 */
function readFile(file) {
  if (!existsSync(file)) return { exists: false, moves: {}, deleted: {}, orders: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return {
      exists: true,
      moves: cleanMoves(parsed?.moves),
      deleted: cleanDeletions(parsed?.deleted),
      orders: cleanOrders(parsed?.orders),
    };
  } catch {
    return { exists: true, moves: {}, deleted: {}, orders: {} };
  }
}

/** The same keys with the project in front — what the snapshot and the API answer with. */
function keyed(projectId, map) {
  const out = {};
  for (const [key, value] of Object.entries(map)) out[boardKey(projectId, key)] = value;
  return out;
}

/** And the project taken back off — what one project's own file holds. A path belongs to a project; the id does not. */
function unkeyed(projectId, map) {
  const out = {};
  const prefix = `${projectId}:`;
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
  }
  return out;
}

function carried(entries) {
  return Object.keys(entries.moves).length + Object.keys(entries.deleted).length + Object.keys(entries.orders).length;
}

/**
 * One project's board as it is on disk, keyed by that project's own paths. A project nothing has been filed in is
 * not a project missing something: the file appears when the first card moves, not when the project is read.
 *
 * @param {{ root: string }} project
 */
function readOwnBoard({ root }) {
  const file = projectBoardFile(root);
  const own = readFile(file);
  return { file, moves: own.moves, deleted: own.deleted, orders: own.orders };
}

/**
 * One project's decisions in the shape the app answers with — `<projectId>:<path>` keys, because the client holds
 * every project's decisions in one map.
 *
 * @param {{ root: string, projectId: string }} project
 */
export function boardForProject({ root, projectId }) {
  const own = readOwnBoard({ root });
  return {
    file: own.file,
    moves: keyed(projectId, own.moves),
    deleted: keyed(projectId, own.deleted),
    orders: keyed(projectId, own.orders),
  };
}

/**
 * Moves the decisions of the old shared file into the projects they were made about — the migration, once, by hand.
 *
 * It is a command rather than something a read does quietly, for the reason the old file is not read at all: the
 * file is inside one checkout, so a board served from a worktree would migrate nothing and a board served from the
 * checkout that holds it would migrate everything, and neither outcome is one to guess at. Here the file is named,
 * the projects are the ones the board currently reads, and the report says per project what was taken.
 *
 * @param {{ projects: { id: string, root: string }[], file: string, dryRun?: boolean }} job
 * @returns {{ file: string, exists: boolean, projects: { id: string, file: string, counts: { moves: number, deleted: number, orders: number }, added: number, status: 'imported' | 'merged' | 'empty' | 'failed', error?: string }[] }}
 */
export function importLegacyBoard({ projects, file, dryRun = false }) {
  const source = readFile(file);
  const report = projects.map(({ id, root }) => importProject({ id, root, source, dryRun }));
  return { file, exists: source.exists, projects: report };
}

/**
 * What one project takes from the old file: how much of it is that project's, how much of that the project does not
 * already say, and the write, when there is something to write and this is not a dry run.
 *
 * A project that has filed something since — the store is new, so this is a card dropped in the last hour — keeps
 * every one of those decisions: the import fills in what the project does not already say and never overwrites it,
 * because a decision made in the project's own file was made later than the file being imported.
 *
 * @param {{ id: string, root: string, source: object, dryRun: boolean }} job
 */
function importProject({ id, root, source, dryRun }) {
  const file = projectBoardFile(root);
  const legacy = {
    moves: unkeyed(id, source.moves),
    deleted: unkeyed(id, source.deleted),
    orders: unkeyed(id, source.orders),
  };
  const counts = countsOf(legacy);
  if (!carried(legacy)) return { id, file, counts, added: 0, status: 'empty' };

  const own = readFile(file);
  const added = addedCount(legacy, own);
  const status = own.exists ? 'merged' : 'imported';
  if (!added || dryRun) return { id, file, counts, added, status };

  const written = writeBoard(file, mergeEntries(legacy, own));
  return written.ok
    ? { id, file, counts, added, status }
    : { id, file, counts, added, status: 'failed', error: written.error };
}

/** What one project's slice of the old file holds, counted by kind. */
function countsOf(entries) {
  return {
    moves: Object.keys(entries.moves).length,
    deleted: Object.keys(entries.deleted).length,
    orders: Object.keys(entries.orders).length,
  };
}

/** How many of the old file's decisions the project does not already say — what the import would add. */
function addedCount(legacy, own) {
  const fresh = (from, into) => Object.keys(from).filter((key) => !(key in into)).length;
  return fresh(legacy.moves, own.moves) + fresh(legacy.deleted, own.deleted) + fresh(legacy.orders, own.orders);
}

/** The imported decisions with the project's own left standing: the file inside the project is the later word. */
function mergeEntries(legacy, own) {
  return {
    moves: { ...legacy.moves, ...own.moves },
    deleted: { ...legacy.deleted, ...own.deleted },
    orders: { ...legacy.orders, ...own.orders },
  };
}

/**
 * Every decision of a project lives in its one file, so all of them are written by one function and none can drop
 * the others: the board is read once, handed to `mutate` whole and unchanged in shape — one object means a write
 * cannot pair one reader's moves with another's orders, which four arguments could — and written back.
 */
function updateBoard(root, mutate) {
  const board = readOwnBoard({ root });
  mutate(board);
  return writeBoard(board.file, board);
}

function writeBoard(file, { moves, deleted, orders }) {
  const body = JSON.stringify(
    {
      note: 'Column moves, archived items and lane orders for this project in Otter Skills. Paths are relative to .o-skills. Delete a move to return an item to the column its own data gives it; delete an order to put a lane back in the order the items themselves sort into.',
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
 * Writes one move into the project's own board. `column: null` removes it — dragging a card back to the column its
 * own data gives it is not a move, and keeping that as an entry would leave a preference that says nothing.
 *
 * `order` is the lane the card was let go in, top to bottom, and it is written under the lane rather than under the
 * card. Dropping a card into the lane its own data gives it is therefore still worth recording when it was dropped
 * at a place: that clears the move and keeps the order, because the place is a decision and the column is not.
 *
 * @param {{ root: string, relPath: string, column: string | null, order?: { column: string, paths?: unknown[] } | null }} placement
 * @returns {{ ok: true, file: string, column: string | null } | { ok: false, error: string }}
 */
export function writeMove({ root, relPath, column, order = null }) {
  const refused = cleanPlacement(column, order);
  if (refused) return refused;

  const written = updateBoard(root, (board) => {
    applyMove(board.moves, relPath, column);
    if (order) applyOrder(board.orders, order);
  });
  return written.ok ? { ok: true, file: written.file, column } : written;
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
 * @param {{ column: string, paths?: unknown[] }} order
 */
function applyOrder(orders, order) {
  const paths = [...new Set((order.paths || []).filter((path) => typeof path === 'string' && path))];
  if (paths.length) orders[order.column] = paths;
  else delete orders[order.column];
}

/**
 * Archives an item, or brings it back, in the project's own board. An unarchive removes the entry rather than storing
 * a `false`, so the file holds the decisions a reader made and not their negation — the same reason a move home is a
 * cleared move.
 *
 * @param {{ root: string, relPath: string, deleted?: boolean }} placement
 * @returns {{ ok: true, file: string, deleted: boolean } | { ok: false, error: string }}
 */
export function writeDeletion({ root, relPath, deleted = true }) {
  const written = updateBoard(root, (board) => {
    if (deleted) board.deleted[relPath] = { at: new Date().toISOString() };
    else delete board.deleted[relPath];
  });
  return written.ok ? { ok: true, file: written.file, deleted } : written;
}

/** A column this board has no lane for, as the refusal to answer it with. */
function unknownColumn(column) {
  return BOARD_COLUMNS.includes(column) ? null : { ok: false, error: `unknown column: ${column}` };
}

/**
 * Whether a drop can be stored, or the refusal: a column this board does not have is not a move, and an order written
 * under one is not a lane. The guard stays at the write rather than moving out to the route that asked — a store that
 * trusts its caller accepts a column nothing can be drawn in.
 */
function cleanPlacement(column, order) {
  const refused = column === null ? null : unknownColumn(column);
  return refused ?? (order ? unknownColumn(order.column) : null);
}
