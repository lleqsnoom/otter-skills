/**
 * The category registry. Adding a category to Otter PM is one entry here: label, order, and optionally which
 * other directory names are the same category. Anything the registry does not know still shows up, labelled from
 * its directory name.
 *
 * `merge` is how two folders become one category. A skill's output folder has been renamed more than once over
 * time, so a repository can hold both spellings — `anal/` and `analysis/` — and to a reader they are one thing:
 * work that analysed a problem. The listed names are folded into the entry that names them.
 */
export const CATEGORY_REGISTRY = [
  { id: 'runs', label: 'Runs', order: 0, hint: 'One folder per workflow run, with its graph state and artifacts.' },
  { id: 'epics', label: 'Epics', order: 1, hint: 'Layer plans produced by x-epic.' },
  { id: 'tasks', label: 'Tasks', order: 2, hint: 'Decomposed work, grouped by run or loose in the folder.' },
  { id: 'plan', label: 'Plan', order: 3 },
  { id: 'plans', label: 'Plans', order: 4 },
  { id: 'design', label: 'Design', order: 5 },
  {
    id: 'analysis',
    label: 'Analysis',
    order: 6,
    merge: ['anal'],
    hint: 'Problem analyses and their sessions, under either folder name.',
  },
  { id: 'debug', label: 'Debug', order: 7 },
  { id: 'review', label: 'Review', order: 8 },
  { id: 'critique', label: 'Critique', order: 9 },
  { id: 'investigate', label: 'Investigate', order: 10 },
  { id: 'triage', label: 'Triage', order: 11 },
  { id: 'research', label: 'Research', order: 12 },
  { id: 'specs', label: 'Specs', order: 13 },
  { id: 'docs', label: 'Docs', order: 90 },
];

const BY_DIRECTORY_NAME = new Map();
for (const entry of CATEGORY_REGISTRY) {
  BY_DIRECTORY_NAME.set(entry.id, entry);
  for (const alias of entry.merge ?? []) BY_DIRECTORY_NAME.set(alias, entry);
}

function titleCase(value) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * The category a directory belongs to. Two directories can name the same one — `anal` and `analysis` both answer
 * `analysis` — and the caller merges what it finds by this id, so a directory keeps its own `dir` and shares the
 * label, the order and the route.
 */
export function categoryForDir(dirName) {
  const entry = BY_DIRECTORY_NAME.get(dirName);
  if (!entry) return { id: dirName, label: titleCase(dirName), order: 50, merge: [] };
  return { id: entry.id, label: entry.label, order: entry.order, hint: entry.hint, merge: entry.merge ?? [] };
}