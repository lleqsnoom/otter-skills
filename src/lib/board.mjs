/**
 * Archiving an item.
 *
 * A board card is only one of the ways a reader meets an item: search finds the artifacts inside a collection, a
 * collection's page lists them, and an artifact has a page of its own. So "is this archived?" is one question asked
 * in four places, and it is answered here rather than in each of them. An archived collection takes everything
 * inside it with it — the entry is what the reader decided, and the artifacts under it are only covered by that
 * decision, which is why the list a reader unarchives from holds the entries and not the files they hide.
 */

/**
 * @typedef {{ projectId: string, relPath: string }} BoardItem
 * @typedef {Record<string, { at: string | null }>} BoardDeletions
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
