/**
 * Archiving an item, the order a lane was left in, and one card per path.
 *
 * A board card is only one of the ways a reader meets an item: search finds the artifacts inside a collection, a
 * collection's page lists them, and an artifact has a page of its own. So "is this archived?" is one question asked
 * in four places, and it is answered here rather than in each of them. An archived collection takes everything
 * inside it with it — the entry is what the reader decided, and the artifacts under it are only covered by that
 * decision, which is why the list a reader unarchives from holds the entries and not the files they hide.
 *
 * The order a lane reads in is answered here for the same reason: the board draws it, the tests can call it without
 * a browser, and what a stored order *means* — named cards first, in the order they were named — is one rule. One
 * card per path is a rule of the same kind: an artifact read in two places is still one artifact.
 */

/**
 * @typedef {{ projectId: string, relPath: string }} BoardItem
 * @typedef {Record<string, { at: string | null }>} BoardDeletions
 * @typedef {Record<string, string[]>} BoardOrders
 */

/**
 * The key a decision is stored under: a path is only unique inside its project, so both are in the key.
 *
 * @param {string} projectId
 * @param {string} relPath
 * @returns {string}
 */
export function boardKey(projectId, relPath) {
  return `${projectId}:${relPath}`;
}

/**
 * The key a lane's order is stored under. A card's place is a fact about the lane it is in, so a lane is what the
 * list belongs to — which is also why the same card in two lanes is two places.
 *
 * @param {string} projectId
 * @param {string} column
 * @returns {string}
 */
export function orderKey(projectId, column) {
  return `${projectId}:${column}`;
}

/**
 * One lane in the order the reader left it: the cards the stored list names, in the order it names them, and
 * everything it does not name after them, in the order it arrived in. A card that turned up since the last drop —
 * or one that was filtered off the board when the drop happened — is still drawn, and last is the only place it can
 * go without contradicting a decision somebody made.
 *
 * It takes the key rather than the two halves of it: which lane a reader is looking at is the caller's question —
 * the caller already knows the project and the column — and all this needs is the order stored under it.
 *
 * @template {BoardItem} T
 * @param {T[]} items
 * @param {string} key  A lane's key, from `orderKey(projectId, column)`.
 * @param {BoardOrders | null | undefined} orders
 * @returns {T[]}
 */
export function orderedLane(items, key, orders) {
  const paths = orders?.[key];
  if (!paths?.length) return items;
  const rank = new Map(paths.map((path, index) => [path, index]));
  const unnamed = paths.length;
  // `sort` is stable, so the cards the list does not name keep the order they came in — which is the order the
  // items themselves sort into, and the one a reader who has arranged nothing already reads.
  return [...items].sort((a, b) => (rank.get(a.relPath) ?? unnamed) - (rank.get(b.relPath) ?? unnamed));
}

/**
 * One project's slice of a decisions map, replaced by what a write answered with.
 *
 * A project's decisions come from its own `<root>/board.json` and go back into a map that covers every project, so a
 * write answers with the whole of one project's board — and that answer has to *replace* the slice rather than be
 * merged into it: filing a card back home deletes an entry, and a merge cannot express a deletion.
 *
 * The key is what says which entries are whose: `<projectId>:<relPath>` for moves and archives, `<projectId>:<column>`
 * for a lane's order. One rule covers all three because the project is the part in front either way.
 *
 * @template T
 * @param {Record<string, T>} map
 * @param {string} projectId
 * @param {Record<string, T> | null | undefined} entries  That project's decisions, as the write left them.
 * @returns {Record<string, T>}
 */
export function replaceProject(map, projectId, entries) {
  const prefix = `${projectId}:`;
  const rest = {};
  for (const [key, value] of Object.entries(map || {})) {
    if (!key.startsWith(prefix)) rest[key] = value;
  }
  return { ...rest, ...(entries || {}) };
}

/**
 * Whether an item is hidden: an entry names the item itself, or a collection it lives inside.
 *
 * @param {BoardItem} item
 * @param {BoardDeletions | null | undefined} deletions
 * @returns {boolean}
 */
export function isDeleted(item, deletions) {
  if (!deletions) return false;
  const prefix = `${item.projectId}:`;
  for (const key of Object.keys(deletions)) {
    if (!key.startsWith(prefix)) continue;
    const path = key.slice(prefix.length);
    if (item.relPath === path || item.relPath.startsWith(`${path}/`)) return true;
  }
  return false;
}

/**
 * The items a board still draws: nothing the reader archived, and nothing an archived collection covers.
 *
 * @template {BoardItem} T
 * @param {T[]} items
 * @param {BoardDeletions | null | undefined} deletions
 * @returns {T[]}
 */
export function liveItems(items, deletions) {
  if (!deletions || !Object.keys(deletions).length) return items;
  return items.filter((item) => !isDeleted(item, deletions));
}

/**
 * One card per path, the first reading kept.
 *
 * A run's stage is read in two places — the category of its kind, and the run that numbered it — and search looks
 * at both, so the same file arrives twice. Two cards for one artifact is two hits, two links and two archive
 * buttons for one thing, which is why the board asks this before it draws a list.
 *
 * The order of the list is what decides which reading is kept, so the caller puts the board's own cards first: a
 * path found as a board card reads as that card rather than as a file inside a collection.
 *
 * @template {{ relPath: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function onePerPath(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.relPath)) return false;
    seen.add(item.relPath);
    return true;
  });
}

/**
 * The decisions themselves — which items a reader archived, not everything those decisions cover. Taking the
 * inverse of `liveItems` would list a collection's artifacts as entries of their own, and unarchiving one of those
 * would do nothing.
 *
 * @template {BoardItem} T
 * @param {T[]} items
 * @param {BoardDeletions | null | undefined} deletions
 * @returns {T[]}
 */
export function deletedItems(items, deletions) {
  if (!deletions || !Object.keys(deletions).length) return [];
  return items.filter((item) => Boolean(deletions[boardKey(item.projectId, item.relPath)]));
}

/**
 * The boundary between two cards that a place in a lane is drawn at.
 *
 * A place is measured among the cards a lane holds *without* the one being carried, because a card in hand is
 * already out of the lane — but it is still drawn where it came from, so the lane on screen holds one card more
 * than the lane the place was measured in, and a place at or past where the card came from sits one boundary
 * further down than its own number. A card carried in from another lane has no index here (`-1`), and a place is
 * then its own boundary.
 *
 * @param {number} place    Position among the cards in the lane without the one being carried; -1 for no place.
 * @param {number} carried  Index of the card being carried in *this* lane, or -1 when it came from another.
 * @returns {number} The boundary to draw the line at, counted over the cards on screen; -1 when there is no place.
 */
export function landingBoundary(place, carried) {
  if (place < 0) return -1;
  return place + (carried >= 0 && place >= carried ? 1 : 0);
}

/**
 * The place a pointer is at, counted over the cards a lane shows without the one being carried.
 *
 * A drop lands *between* two cards, so which half of a card the pointer is in is what says which gap that is: the
 * first card whose middle is below the pointer is the card it goes in front of, and past the last of them is the
 * end of the lane. The card in hand has no box here — it is already out of the lane, and the place it goes back
 * into is a place among the others.
 *
 * @param {{ top: number, height: number }[]} boxes  The cards on screen, in the order they read, without the carried one.
 * @param {number} y  Where the pointer is, in the same coordinates as the boxes.
 * @returns {number} How many of those cards the place comes after.
 */
export function placeAtPointer(boxes, y) {
  for (let index = 0; index < boxes.length; index += 1) {
    if (y < boxes[index].top + boxes[index].height / 2) return index;
  }
  return boxes.length;
}

/**
 * Whether a `dragleave` is a lane being left, or a boundary crossed *inside* it.
 *
 * `dragleave` fires on every boundary crossed inside a lane as well — from one card to the next, from the header to
 * a card, and from a card to the slot that has just opened under the pointer — and treating those as leaving made
 * the slot blink out and back with the cards jumping under it. A leave counts only when something it carries says
 * the pointer is outside: where the pointer is, or whether the element it entered is inside the lane.
 *
 * @param {{ x: number, y: number }} pointer
 * @param {{ left: number, right: number, top: number, bottom: number }} box  The lane's own box.
 * @param {boolean} enteredInside  Whether the element the pointer entered is inside the lane.
 * @returns {boolean}
 */
export function leftLane(pointer, box, enteredInside) {
  const pointerInside =
    pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom;
  return !pointerInside && !enteredInside;
}
