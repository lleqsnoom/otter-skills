import { onePerPath } from './board.mjs';
import type { BoardColumn, BoardMoves, Category, FileRef, Group, Progress, Project, Status } from './types';

/** One thing a board can hold: a run/task folder, or a loose document beside them. */
export interface WorkItem {
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

export function itemsForProject(project: Project, categories: Category[] = project.categories): WorkItem[] {
  const items: WorkItem[] = [];
  for (const category of categories) {
    for (const group of category.groups) items.push(groupItem(project, category, group));
    for (const file of category.items) items.push(fileItem(project, category, file, null));
  }
  return items.sort((a, b) => String(b.date || b.mtime).localeCompare(String(a.date || a.mtime)));
}

/** A collection's own progress: what it recorded, or what its files' checklists add up to. */
function groupProgress(group: Group): Progress | null {
  const progress =
    group.progress ??
    group.files.reduce(
      (acc, file) => {
        if (file.progress) {
          acc.done += file.progress.done;
          acc.total += file.progress.total;
        }
        return acc;
      },
      { done: 0, total: 0, ratio: 0 },
    );
  return progress.total ? { ...progress, ratio: progress.done / progress.total } : null;
}

/**
 * One collection as a board card. Its state file decides its status when there is one — a run that reached its stop
 * is done whatever its checklists say — and its files' checklists decide it otherwise.
 */
function groupItem(project: Project, category: Category, group: Group): WorkItem {
  const progress = groupProgress(group);
  return {
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
function fileItem(project: Project, category: Category, file: FileRef, group: Group | null): WorkItem {
  return {
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
  const deep = categories.flatMap((category) =>
    category.groups.flatMap((group) => group.files.map((file) => fileItem(project, category, file, group))),
  );
  return onePerPath([...itemsForProject(project, categories), ...deep]).sort((a, b) =>
    String(b.date || b.mtime).localeCompare(String(a.date || a.mtime)),
  );
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