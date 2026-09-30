/**
 * Epics, and the tasks that belong to them.
 *
 * A task written with a property block names its plan (`plan: "[[runs/<run>/E00-plan]]"`), and that link decides.
 * Older tasks name nothing, so for them the link is read from the tree. There are exactly two ways the two meet:
 *
 * - **The same run.** A run numbers its epic `E<nn>-epic.md` and its tasks `E<nn>-tasks/` at different rungs, so the
 *   run folder is the identity both carry (`runPath`) and the rungs are what say whose tasks they are.
 * - **The same slug.** `epics/<stamp>-<slug>.md` and `tasks/<stamp>-<slug>/` are one epic's work: written minutes
 *   apart, so the stamps differ and the name after them does not.
 *
 * A colour is hashed from the key rather than counted, so it outlives the epics written after it, and its value is
 * the theme's (`--epic-<n>` in `styles.css`), so both themes are painted. Which category holds which is the
 * registry's declaration and not this module's: `work` in `src/server/categories.mjs`.
 */

/** How many colours the palette has. The values are `--epic-0` … `--epic-7` in `styles.css`. */
export const EPIC_PALETTE = 8;

/**
 * The stamps a repository writes in front of a slug: `01-09-2026-11:23-`, `16-07-2026-14-35-` (a hyphen where the
 * clock wants a colon), and the two the older folders use, `2026-07-13-` and `2026-07-13T1042-`. Only one of them
 * can match a name, so the order they are tried in is not a question.
 */
const STAMPS = [
  /^\d{2}-\d{2}-\d{4}[-T]\d{2}[:-]?\d{2}-/,
  /^\d{4}-\d{2}-\d{2}T\d{4}-/,
  /^\d{4}-\d{2}-\d{2}-/,
];

/**
 * The name a stamped folder or file was given, without the stamp and without the extension: what an epic in
 * `epics/` and the folder in `tasks/` written for it have in common.
 *
 * @param {string} name
 * @returns {string}
 */
export function epicSlug(name) {
  const bare = String(name).replace(/\.(md|markdown)$/i, '');
  for (const stamp of STAMPS) {
    const slug = bare.replace(stamp, '');
    if (slug !== bare) return slug;
  }
  return bare;
}

/**
 * What an epic is read under: the run it numbered and the rung it occupies there, or the slug it was named with.
 *
 * The rung is part of a stage's identity because a run can number more than one epic, and the tasks belong to the
 * epic *above* them rather than to every epic the run holds. Which epic that is is `epicOfTasks`' question; this is
 * only how the answer is spelled.
 *
 * @param {string | null | undefined} runPath  The run this thing is a stage of, when it is one.
 * @param {number | null | undefined} step  The rung it holds in that run.
 * @param {string} name  The folder or file it is filed under.
 * @returns {string}
 */
function epicKey(runPath, step, name) {
  if (!runPath) return `slug:${epicSlug(name)}`;
  return step == null ? `run:${runPath}` : `run:${runPath}#${step}`;
}

/**
 * Which colour of the palette a key is painted with. A hash, so the colour outlives the epics written after it.
 *
 * @param {string} key
 * @returns {number}
 */
export function epicColorIndex(key) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (Math.imul(hash, 31) + key.charCodeAt(index)) >>> 0;
  return hash % EPIC_PALETTE;
}

/**
 * The colour an epic is painted with, as the custom property a card sets: `var(--epic-3)` reads the theme's own
 * value where the text is drawn, so one string travels and both themes are painted.
 *
 * @param {string} key
 * @returns {string}
 */
export function epicColor(key) {
  return `var(--epic-${epicColorIndex(key)})`;
}

/**
 * @typedef {{ runPath?: string | null, step?: number | null, name: string, title?: string, relPath?: string }} EpicSubject
 *   A file or folder as the epic rules read it: the run it is a stage of, the rung it holds there, and the name it
 *   was filed under.
 * @typedef {{ key: string, title: string, relPath: string, color: string, runPath: string | null, step: number | null }} EpicRef
 *   One epic as a screen reads it: what to call it, what colour it wears, and where its tasks are looked for.
 */

/**
 * Every epic a project holds, keyed by what its tasks point at.
 *
 * Read from the category that declares itself one (`work: 'epic'`) rather than from the artifacts' kinds, because a
 * kind is inferred from the file name and an epic written loose in `epics/` is named after its slug, not after a
 * rung: it reads as a plain document. The folder it is filed in is the fact, and it is the folder a reader means
 * when they say "the epics".
 *
 * A run's stage epic is in this category too — `indexRunStages` files every rung where a reader looks for that kind
 * of work — so both spellings of an epic are here.
 *
 * @param {{ work?: string | null, groups: EpicSubject[], items: EpicSubject[] }[]} categories
 * @returns {Map<string, EpicRef>}
 */
export function epicIndex(categories) {
  const index = new Map();
  for (const category of categories) {
    if (category.work !== 'epic') continue;
    // A folder in **Epics** is an epic too, for a skill that one day writes one as a directory rather than a file.
    for (const epic of [...(category.items ?? []), ...(category.groups ?? [])]) {
      const key = epicKey(epic.runPath, epic.step, epic.name);
      if (index.has(key)) continue;
      index.set(key, {
        key,
        title: epic.title,
        relPath: epic.relPath,
        color: epicColor(key),
        runPath: epic.runPath ?? null,
        step: epic.step ?? null,
      });
    }
  }
  return index;
}

/**
 * The epic an item *is*: its own entry in the index, which is where its colour and its rung come from.
 *
 * @param {Map<string, EpicRef>} index  From `epicIndex`.
 * @param {EpicSubject} subject
 * @returns {EpicRef | null}
 */
export function epicOfSelf(index, subject) {
  return index.get(epicKey(subject.runPath, subject.step, subject.name)) ?? null;
}

/**
 * The plan a subject names with its own `plan` link: a file's own links, or the links of the files a collection holds.
 *
 * @param {EpicSubject & { links?: { label: string, path: string }[], files?: { links?: { label: string, path: string }[] }[] }} subject
 * @returns {string | null}
 */
function linkedPlan(subject) {
  const links = subject.links ?? (subject.files ?? []).flatMap((file) => file.links ?? []);
  return links.find((link) => link.label === 'Plan')?.path ?? null;
}

/**
 * The epic a task collection belongs to.
 *
 * A `plan` link the task itself wrote wins. Without one, two rules, and they are the two ways an epic and its work
 * meet:
 *
 * - **By slug**, for work filed in a folder of its own: `tasks/<stamp>-<slug>/` belongs to `epics/<stamp>-<slug>.md`
 *   however far apart the two stamps are.
 * - **By rung**, for a stage of a run: the tasks belong to the epic at the highest rung below them. A run can number
 *   more than one epic — one run in this repository does — and the run alone would give every one of them the same
 *   tasks, which is the wrong epic's name on a task and the same list drawn twice.
 *
 * A collection a run numbered always carries its rung (`indexRung` stamps it), so a stage with no rung below it
 * belongs to no epic.
 *
 * @param {Map<string, EpicRef>} index  From `epicIndex`.
 * @param {EpicSubject} subject
 * @returns {EpicRef | null}
 */
export function epicOfTasks(index, subject) {
  const named = linkedPlan(subject);
  const linked = named ? [...index.values()].find((epic) => epic.relPath === named) : null;
  if (linked) return linked;
  if (!subject.runPath) return index.get(epicKey(null, null, subject.name)) ?? null;
  const above = [...index.values()].filter(
    (epic) => epic.runPath === subject.runPath && epic.step != null && subject.step != null && epic.step < subject.step,
  );
  return above.reduce((best, epic) => (best === null || epic.step > best.step ? epic : best), null);
}