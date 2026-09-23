/**
 * The category registry. Adding a category to Otter PM is one entry here: label, order, and optionally which
 * other directory names are the same category. Anything the registry does not know still shows up, labelled from
 * its directory name.
 *
 * `merge` is how two folders become one category. A skill's output folder has been renamed more than once over
 * time, so a repository can hold both spellings — `anal/` and `analysis/` — and to a reader they are one thing:
 * work that analysed a problem. The listed names are folded into the entry that names them.
 *
 * `work` is what a *collection* in the category is to a screen. A **layer plan** is the collection the tasks hang
 * from — the plan says what to build in layers, `x-decompose` turns each layer into task files, and the two are read
 * against each other wherever they appear — see `src/lib/epics.mjs`. Every folder a layer plan is written to carries
 * the role, because which folder it is in is a fact about a skill's version rather than about the work: `epics/` is
 * the folder the retired `x-epic` wrote to, and `plan/` and `plans/` are where the plan itself lands.
 * Everything else a repository holds is work in its own right.
 */
export const CATEGORY_REGISTRY = [
  { id: 'runs', label: 'Runs', order: 0, hint: 'One folder per workflow run, with its graph state and artifacts.' },
  { id: 'epics', label: 'Epics', order: 1, work: 'epic', hint: 'Layer plans written before the plan carried its own layers, under the folder the retired x-epic wrote to.' },
  { id: 'tasks', label: 'Tasks', order: 2, work: 'task', hint: 'Decomposed work: the tasks a plan was split into, one file each.' },
  { id: 'plan', label: 'Plan', order: 3, work: 'epic', hint: 'The layer plan a run produced, and the tasks it was split into.' },
  { id: 'plans', label: 'Plans', order: 4, work: 'epic', hint: 'A plan of its own, and the tasks it was split into.' },
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

/** The fields every category carries, whether the registry named it or its directory did. */
function descriptorOf(entry) {
  return { id: entry.id, label: entry.label, order: entry.order, hint: entry.hint, merge: entry.merge ?? [], work: entry.work ?? null };
}

/**
 * The category a directory belongs to. Two directories can name the same one — `anal` and `analysis` both answer
 * `analysis` — and the caller merges what it finds by this id, so a directory keeps its own `dir` and shares the
 * label, the order and the route.
 */
export function categoryForDir(dirName) {
  const entry = BY_DIRECTORY_NAME.get(dirName);
  if (!entry) return { id: dirName, label: titleCase(dirName), order: 50, merge: [], work: null };
  return descriptorOf(entry);
}

/**
 * The category that answers for a stage's kind, so an artifact a run produced is readable where a reader looks for
 * that sort of thing. The skills name the kind in the artifact (`E00-analysis.md`, `E02-tasks/`) and the folder it
 * belongs in is usually the plural of that name: `plan` is **Plan** in one tree and **Plans** in another.
 *
 * `null` for a kind no category claims — a summary, a critique, a repro script have no folder of their own, so they
 * are read where they were written. That is a fact about the registry, not a failure here.
 */
export function categoryForStageKind(kind) {
  const names = new Set([kind, `${kind}s`, kind.replace(/s$/, '')]);
  for (const entry of CATEGORY_REGISTRY) {
    if (!names.has(entry.id)) continue;
    return descriptorOf(entry);
  }
  return null;
}
