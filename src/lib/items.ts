import { onePerPath } from './board.mjs';
import { epicIndex, epicOfSelf, epicOfTasks } from './epics.mjs';
import type { Route } from './router';
import type { BoardColumn, BoardMoves, Category, FileRef, Group, Progress, Project, Status } from './types';

/** The epic a task belongs to, as much of it as a card names one by: what it is called, and its colour. */
export interface EpicRef {
  key: string;
  title: string;
  relPath: string;
  color: string;
  /** The run the epic is a stage of, and the rung it holds there; `null` for an epic filed in `epics/`. */
  runPath: string | null;
  step: number | null;
}

/** How an item is read under an epic: which one it belongs to, and whether it is that epic itself. */
export interface EpicLink {
  /** The epic this item is read under — the task's parent, or the epic the item is. `null` for unclaimed work. */
  epic: EpicRef | null;
  /** True when this item *is* the epic: it carries `tasks` and is drawn in the epic's own colour. */
  isEpic: boolean;
}

/** One thing a board can hold: a run/task folder, or a loose document beside them. */
export interface WorkItem extends EpicLink {
  key: string;
  projectId: string;
  categoryId: string;
  categoryLabel: string;
  kind: 'group' | 'file';
  title: string;
  relPath: string;
  groupRelPath: string | null;
  date: string | null;
  mtime: string;
  status: Status;
  progress: Progress | null;
  badges: string[];
  excerpt: string;
  fileCount: number;
  /** The collection an artifact belongs to, when it is inside one: what a search hit says instead of a count. */
  parentTitle?: string | null;
  skill: string | null;
  layer: number | null;
  effort: string | null;
  /** The tasks inside this epic, in the order the project lists them. Empty for everything that is not one. */
  tasks: WorkItem[];
}

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'To do',
  active: 'In progress',
  done: 'Done',
  unknown: 'Unsorted',
};

/**
 * The lanes of the board, in the order they are drawn: the queue first, then what is being worked on, then the
 * two that are finished. **Done** is the record of everything finished and **Closed** is the window of it the
 * reader set — so the column that answers "what did I just finish?" sits at the end, beside the archive.
 */
export const COLUMNS: BoardColumn[] = ['todo', 'active', 'unknown', 'done', 'closed'];

export const COLUMN_LABELS: Record<BoardColumn, string> = {
  todo: 'To do',
  active: 'In progress',
  unknown: 'Unsorted',
  done: 'Done',
  closed: 'Closed',
};

/** How far back "closed" reaches. `null` is every finished item. */
export interface ClosedWindow {
  id: string;
  label: string;
  ms: number | null;
}

export const CLOSED_WINDOWS: ClosedWindow[] = [
  { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: '90d', label: '90 days', ms: 90 * 24 * 60 * 60 * 1000 },
  { id: 'all', label: 'all', ms: null },
];

export const DEFAULT_CLOSED_WINDOW = '30d';

export function closedWindow(id: string): ClosedWindow {
  return CLOSED_WINDOWS.find((window) => window.id === id) ?? CLOSED_WINDOWS[2];
}

/** What the data alone says about an item — before the reader's own moves are considered. */
export function dataColumn(item: WorkItem, window: ClosedWindow): BoardColumn {
  if (item.status !== 'done') return item.status;
  if (window.ms === null) return 'closed';
  const at = Date.parse(item.date || item.mtime);
  if (!Number.isFinite(at)) return 'done';
  return Date.now() - at <= window.ms ? 'closed' : 'done';
}

/**
 * The lane an item sits in: the reader's move if there is one, otherwise what its own data says. A move is kept
 * even when the data later agrees or disagrees — it is a decision a person made, and `moved` is what says so.
 */
export function columnOf(item: WorkItem, board: BoardMoves, window: ClosedWindow): BoardColumn {
  const moved = board[`${item.projectId}:${item.relPath}`];
  if (moved) return moved.column;
  return dataColumn(item, window);
}

export function isMoved(item: WorkItem, board: BoardMoves): boolean {
  return Boolean(board[`${item.projectId}:${item.relPath}`]);
}

export function columnCounts(items: WorkItem[], board: BoardMoves, window: ClosedWindow): Record<BoardColumn, number> {
  const counts: Record<BoardColumn, number> = { todo: 0, active: 0, unknown: 0, done: 0, closed: 0 };
  for (const item of items) counts[columnOf(item, board, window)] += 1;
  return counts;
}

export function statusTone(status: Status): string {
  if (status === 'done') return 'text-good';
  if (status === 'active') return 'text-fair';
  if (status === 'todo') return 'text-unknown';
  return 'text-muted-foreground';
}

export function columnTone(column: BoardColumn): string {
  return column === 'closed' ? 'text-muted-foreground' : statusTone(column === 'active' ? 'active' : column);
}

function progressStatus(progress: Progress | null): Status {
  if (!progress || !progress.total) return 'unknown';
  if (progress.done >= progress.total) return 'done';
  if (progress.done === 0) return 'todo';
  return 'active';
}

function fieldOf(file: FileRef, key: string): string | null {
  return file.fields[key] || null;
}

/**
 * A chip is a fact, not a paragraph. Some documents put a sentence in `**Effort:**` ("Large (if corrected) —
 * requires fixing …"), and a chip that cannot wrap is what pushes a card — and then the whole board — wider
 * than the pane. So a badge is short by construction: an effort is a duration or it is not a badge at all.
 */
const EFFORT = /^\s*\d+(?:\.\d+)?\s*h(?:ours?|rs?)?\b/i;
const MAX_BADGE = 28;

function badge(value: string): string {
  const text = value.trim();
  return text.length > MAX_BADGE ? `${text.slice(0, MAX_BADGE - 1)}…` : text;
}

function effortBadge(file: FileRef): string | null {
  const effort = fieldOf(file, 'effort');
  if (!effort || !EFFORT.test(effort)) return null;
  return badge(effort.split(/[,(]/)[0].trim());
}

function badgesFor(files: FileRef[], group: Group | null): string[] {
  const badges: string[] = [];
  if (group?.state?.skill) badges.push(group.state.skill.replace(/^x-/, ''));
  const layers = [...new Set(files.map((file) => file.layer).filter((layer): layer is number => layer !== null))].sort((a, b) => a - b);
  if (layers.length) badges.push(layers.length > 4 ? `L${layers[0]}…L${layers[layers.length - 1]}` : `L${layers.join(',L')}`);
  const effort = files.map((file) => Number.parseFloat(fieldOf(file, 'effort') || '')).filter((value) => Number.isFinite(value));
  if (effort.length) badges.push(`${Math.round(effort.reduce((sum, value) => sum + value, 0))}h`);
  const kinds = new Set(files.map((file) => file.kind));
  if (kinds.has('plan')) badges.push('plan');
  if (kinds.has('epic')) badges.push('epic');
  return badges.map(badge);
}

/**
 * Everything a project holds, as the board reads it.
 *
 * Two kinds of work are read differently from the folder they were written into, because a folder is not what a
 * reader is looking for:
 *
 * - **A task collection is not a card.** `tasks/<slug>/` holds one file per task, and the card that stood for the
 *   folder was indistinguishable from the epic above it — same name, same kind of progress bar — while the tasks a
 *   reader came for were one click further in. The folder is a container the board does not draw; its files are what
 *   it draws, one card each.
 * - **An epic holds its tasks.** The epic's card names them, so "what is left in this epic" is answered on the card
 *   rather than by opening it.
 *
 * Both rest on the same link, and it is read from the whole project rather than from the categories this call was
 * asked for: an epic whose tasks are filtered off the board still holds them, and hiding **Tasks** must not empty
 * every epic. `categories` is what the caller wants to *see*, not what the project has.
 */
export function itemsForProject(project: Project, categories: Category[] = project.categories): WorkItem[] {
  const epics = epicIndex(project.categories);
  const items: WorkItem[] = [];

  for (const category of project.categories) {
    // Epics, the tasks an epic was split into, and work no epic claims — the registry's `work` says which is which.
    const role = category.work ?? null;
    for (const group of category.groups) {
      if (role === 'task') items.push(...taskItems(project, category, group, epics));
      else items.push(groupItem(project, category, group, epicLink(epics, role, group)));
    }
    for (const file of category.items) {
      items.push(fileItem(project, category, file, null, epicLink(epics, role, file)));
    }
  }

  // The link is read from the whole project and the categories are filtered out of the result, because a link is a
  // fact about the project rather than about the view: an epic's page draws one category, and its tasks are not in it.
  const linked = withTasks(items);
  const wanted = new Set(categories.map((category) => category.id));
  return linked.filter((item) => wanted.has(item.categoryId)).sort(byNewest);
}

function byNewest(a: WorkItem, b: WorkItem): number {
  return String(b.date || b.mtime).localeCompare(String(a.date || a.mtime));
}

/**
 * The cards a task collection is drawn as: one per task, each read under the epic the folder resolved to.
 *
 * The folder's own title is deliberately not what a task says it is in. A folder of tasks is named by a stamp and
 * nothing else, so `groupFor` falls back to the first file's heading — which made the folder's card read as one of
 * the tasks inside it ("Tasks: Extract SSE parser into `sse-parser.ts`"), beside an epic card with the same shape.
 * The honest parent of a task is the epic that claims it, and the folder it was filed in when none does.
 */
function taskItems(project: Project, category: Category, group: Group, epics: Map<string, EpicRef>): WorkItem[] {
  const link = epicLink(epics, 'task', group);
  const parent = link.epic?.title ?? group.name;
  return group.files.map((file) => ({ ...fileItem(project, category, file, group, link), parentTitle: parent }));
}

/**
 * The epic an item is read under: the one it **is** when it is filed in **Epics**, the one it **belongs to** when it
 * is filed in **Tasks**, and none at all for the rest of the work.
 *
 * Task work is the only work an epic claims. A run numbered both an epic and the tasks under it, and the run is not
 * a task: a card wearing its run's epic would say the analysis inside it belonged to the epic too. Which epic a task
 * belongs to is `epics.mjs`'s question — the run they share, or the slug they share.
 */
function epicLink(
  epics: Map<string, EpicRef>,
  role: 'epic' | 'task' | null,
  subject: { runPath?: string | null; step?: number | null; name: string },
): EpicLink {
  if (!role) return NO_EPIC;
  if (role === 'epic') {
    const own = epicOfSelf(epics, subject);
    return own ? { epic: own, isEpic: true } : NO_EPIC;
  }
  return { epic: epicOfTasks(epics, subject), isEpic: false };
}

const NO_EPIC: EpicLink = { epic: null, isEpic: false };

/**
 * Every epic with the tasks inside it, and its progress counted over them.
 *
 * An epic's own card carries a checklist — its layers' definitions of done — and that is the epic reading *itself*.
 * What a reader asks a project board is how much of the epic's work is left, and the tasks are that work: with none
 * written yet the epic's own count is the only one there is, and with tasks written it is the truth that matters.
 */
function withTasks(items: WorkItem[]): WorkItem[] {
  const held = new Map<string, WorkItem[]>();
  for (const item of items) {
    if (!item.epic || item.isEpic) continue;
    const tasks = held.get(item.epic.key);
    if (tasks) tasks.push(item);
    else held.set(item.epic.key, [item]);
  }
  if (!held.size) return items;

  return items.map((item) => {
    const tasks = item.isEpic && item.epic ? held.get(item.epic.key) : null;
    if (!tasks?.length) return item;
    // With no checklist inside them there is nothing to count, and the epic's own is the only one there is: a bar
    // at zero would read as work that has not started, which is a different claim from one nothing was counted for.
    const progress = counted(tasks.map((task) => task.progress));
    return progress ? { ...item, tasks, progress, status: progressStatus(progress) } : { ...item, tasks };
  });
}

/**
 * What a set of checklists adds up to, or `null` when nothing was counted at all. A count of zero and no count are
 * different facts, and every bar in this app is drawn only for the second.
 */
function counted(progresses: (Progress | null)[]): Progress | null {
  const sum = progresses.reduce(
    (acc, progress) => (progress ? { done: acc.done + progress.done, total: acc.total + progress.total } : acc),
    { done: 0, total: 0 },
  );
  return sum.total ? { ...sum, ratio: sum.done / sum.total } : null;
}

/** A collection's own progress: what it recorded, or what its files' checklists add up to. */
function groupProgress(group: Group): Progress | null {
  return group.progress ?? counted(group.files.map((file) => file.progress));
}

/**
 * One collection as a board card. Its state file decides its status when there is one — a run that reached its stop
 * is done whatever its checklists say — and its files' checklists decide it otherwise.
 */
function groupItem(project: Project, category: Category, group: Group, link: EpicLink): WorkItem {
  const progress = groupProgress(group);
  return {
    ...link,
    key: group.relPath,
    projectId: project.id,
    categoryId: category.id,
    categoryLabel: category.label,
    kind: 'group',
    title: group.title,
    relPath: group.relPath,
    groupRelPath: group.relPath,
    date: group.date,
    mtime: group.mtime || '',
    status: group.state ? (group.state.finished ? 'done' : 'active') : progressStatus(progress),
    progress,
    badges: badgesFor(group.files, group),
    excerpt: group.files.find((file) => file.excerpt)?.excerpt || '',
    fileCount: group.fileCount,
    skill: group.state?.skill ?? null,
    layer: group.files.map((file) => file.layer).find((layer) => layer !== null) ?? null,
    effort: null,
    tasks: [],
  };
}

/**
 * One artifact as something a board can hold: a document loose in a category, or a file inside a collection.
 * The second case is what search needs and the board does not — see `searchItemsForProject`.
 *
 * A stage read outside its run knows the run it belongs to (`runPath`/`runTitle`), which is what a card says
 * instead of a count: `E00-analysis.md` is a file of `shared-key-rotation-staging-sandbox`, and a card that
 * did not say so would be one of nine files with the same name on one board.
 */
function fileItem(project: Project, category: Category, file: FileRef, group: Group | null, link: EpicLink): WorkItem {
  return {
    ...link,
    key: file.relPath,
    projectId: project.id,
    categoryId: category.id,
    categoryLabel: category.label,
    kind: 'file',
    title: file.title,
    relPath: file.relPath,
    groupRelPath: group?.relPath ?? file.runPath ?? null,
    parentTitle: group?.title ?? file.runTitle ?? null,
    date: file.date,
    mtime: file.mtime,
    status: file.progress ? progressStatus(file.progress) : 'unknown',
    progress: file.progress,
    badges: [
      badge(file.kind),
      ...(file.step === null ? [] : [`E${String(file.step).padStart(2, '0')}`]),
      ...(file.layer !== null ? [`L${file.layer}`] : []),
      ...(effortBadge(file) ? [effortBadge(file) as string] : []),
    ],
    excerpt: file.excerpt,
    fileCount: 1,
    skill: null,
    layer: file.layer,
    effort: effortBadge(file),
    tasks: [],
  };
}

/**
 * Everything a search can find: the collections and the loose documents the board shows, **plus every artifact
 * inside a collection**.
 *
 * The board is a project board — a collection is one card, because that is the unit of work — but a reader who
 * knows a file's name has to be able to find it. Without this, `media-gateway-under-load` matched nothing at all:
 * the name lives on an artifact, and the artifact lives inside a run whose own name says nothing about it.
 *
 * A stage is both — a card in the category of its kind and a file inside its run — so the same path is dropped
 * when it arrives twice (`onePerPath`). The board's own card is listed first and so is the reading that is kept.
 */
export function searchItemsForProject(project: Project, categories: Category[] = project.categories): WorkItem[] {
  const epics = epicIndex(project.categories);
  const deep = categories.flatMap((category) => {
    const role = category.work ?? null;
    return category.groups.flatMap((group) =>
      role === 'task'
        ? taskItems(project, category, group, epics)
        : group.files.map((file) => fileItem(project, category, file, group, epicLink(epics, role, group))),
    );
  });
  return onePerPath([...itemsForProject(project, categories), ...deep]).sort(byNewest);
}

/**
 * Where an artifact sits: which category holds it, and which collection, when it is inside one. A file page needs
 * this to draw its breadcrumbs — the address carries one path, and the trail wants the folder names that path came
 * from.
 *
 * A collection wins over a loose artifact, and that is the whole of the ordering: an artifact a run wrote is listed
 * in the category of its kind *and* held by the run that numbered it, and the run is where it is.
 */
export function locateFile(
  project: Project,
  relPath: string,
): { category: Category; group: Group | null; file: FileRef } | null {
  let loose: { category: Category; file: FileRef } | null = null;
  for (const category of project.categories) {
    loose ??= itemHolding(category, relPath);
    for (const group of category.groups) {
      const file = group.files.find((candidate) => candidate.relPath === relPath);
      if (file) return { category, group, file };
    }
  }
  return loose && { category: loose.category, group: null, file: loose.file };
}

function itemHolding(category: Category, relPath: string): { category: Category; file: FileRef } | null {
  const file = category.items.find((candidate) => candidate.relPath === relPath);
  return file ? { category, file } : null;
}

export function statusCounts(items: WorkItem[]): Record<Status, number> {
  const counts: Record<Status, number> = { todo: 0, active: 0, done: 0, unknown: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

export function matches(item: WorkItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${item.title} ${item.relPath} ${item.categoryLabel} ${item.badges.join(' ')} ${item.excerpt}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export function relativeTime(value: string | null): string {
  if (!value) return '';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return '';
  const delta = Date.now() - time;
  const day = 86_400_000;
  if (delta < 3_600_000) return `${Math.max(1, Math.round(delta / 60_000))}m ago`;
  if (delta < day) return `${Math.round(delta / 3_600_000)}h ago`;
  if (delta < 30 * day) return `${Math.round(delta / day)}d ago`;
  return new Date(time).toISOString().slice(0, 10);
}

export function formatDate(value: string | null): string {
  if (!value) return '';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Where an item is read — and there is one address per piece of work, not two.
 *
 * A collection opens as itself. An artifact that lives inside one opens on that collection's page with itself
 * selected: a run's page already draws the artifact and the work it belongs to, so a page of its own would be the
 * same document under a second address. Only a document that is in no collection has an address of its own, which is
 * every loose analysis, plan or review filed straight into a category.
 */
export function routeFor(item: WorkItem): Route {
  if (item.kind === 'group') return { name: 'group', project: item.projectId, group: item.relPath };
  if (item.groupRelPath) return { name: 'group', project: item.projectId, group: item.groupRelPath, file: item.relPath };
  return { name: 'file', project: item.projectId, path: item.relPath };
}