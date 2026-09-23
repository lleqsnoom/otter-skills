export type Status = 'todo' | 'active' | 'done' | 'unknown';

export interface Progress {
  done: number;
  total: number;
  ratio: number;
}

export interface RunState {
  skill?: string | null;
  slug?: string | null;
  goal?: string | null;
  node?: string | null;
  stops?: string[];
  finished?: boolean;
  updatedAt?: string | null;
  guardsPassed?: number;
  guardsTotal?: number;
  openQuestions?: number;
  questions?: { id: string; text: string; status: string; answer?: string }[];
  options?: { id: string; summary: string }[];
  decision?: { summary: string; at?: string } | null;
  events?: number;
  report?: string | null;
  error?: string;
}

export interface FileRef {
  name: string;
  relPath: string;
  kind: string;
  isMarkdown: boolean;
  title: string;
  date: string | null;
  mtime: string;
  size: number;
  sizeLabel: string;
  fields: Record<string, string>;
  layer: number | null;
  excerpt: string;
  progress: Progress | null;
  status: Status;
  truncated: boolean;
  /** The `E<nn>` this artifact carries inside its run, or null for anything the run did not number. */
  step: number | null;
  /** The run an artifact is a stage of — set where the artifact is read outside its own run. */
  runPath?: string | null;
  runTitle?: string | null;
  /** The artifacts this one names by path, and only the ones the repository actually holds. */
  links: ArtifactLink[];
}

/** One artifact naming another: the field it was named in, and the path it named. */
export interface ArtifactLink {
  label: string;
  path: string;
  name: string;
}

/** One rung of a run: what it numbered, what kind of stage it is, and whether that stage is a file or a folder. */
export interface Stage {
  step: number;
  kind: string;
  name: string;
  relPath: string;
  isDirectory: boolean;
}

export interface Group {
  id: string;
  name: string;
  title: string;
  relPath: string;
  /** The run this collection is a stage of, when a run wrote it: `E02-tasks/` read outside its own run. */
  runPath: string | null;
  /** The rung it holds in that run — the `2` of `E02-tasks/` — or `null` for a folder no run numbered. */
  step: number | null;
  mtime: string | null;
  date: string | null;
  state: RunState | null;
  files: FileRef[];
  /** A run's stages, in the order the run built them — `E00`, `E01`, `E02` … */
  stages: Stage[];
  fileCount: number;
  progress: Progress | null;
  status: Status;
}

export interface Category {
  id: string;
  label: string;
  order: number;
  hint?: string;
  kind: 'containers' | 'documents' | 'mixed';
  /**
   * What a collection in this category is to a screen: an epic, or the tasks an epic was split into. Absent for
   * everything else, which is work in its own right. Declared by the registry in `src/server/categories.mjs`.
   */
  work?: 'epic' | 'task' | null;
  /** The folder this category is shown under — the one bearing its own name when there is one. */
  dir: string;
  /** Every folder folded into it: `anal` and `analysis` are one category read from two directories. */
  dirs: string[];
  relPath: string;
  /** True for a category a run's stages named rather than a folder this repository has. */
  fromRuns?: boolean;
  counts: { groups: number; items: number; files: number };
  groups: Group[];
  items: FileRef[];
}

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  root: string;
  /** The Orca IDE's own labelling for this repository, when the root came from it. */
  icon: string | null;
  iconLabel: string | null;
  badgeColor: string | null;
  /** The project's own mark, from `.x-skills/project.md` — what a project made here carries with it. */
  about: string | null;
  iconText: string | null;
  color: string | null;
  iconSrc: string | null;
  /** An image inside the project, relative to its root, served by `/api/asset`. */
  iconFile: string | null;
  source: 'orca' | 'path';
  scannedAt: string;
  totals: { groups: number; items: number; files: number };
  categories: Category[];
}

/** The lanes of the board, in the order they are drawn. */
export type BoardColumn = 'todo' | 'active' | 'unknown' | 'done' | 'closed';

/** Column moves a reader made, keyed `<projectId>:<relPath>`. */
export type BoardMoves = Record<string, { column: BoardColumn; at: string | null }>;

/** Items a reader archived, keyed `<projectId>:<relPath>`. */
export type BoardDeletions = Record<string, { at: string | null }>;

/** A lane in the order a reader left it, keyed `<projectId>:<column>`: the paths in it, top to bottom. */
export type BoardOrders = Record<string, string[]>;

/** One lane as a drop left it: the column the card was let go in, and every path in it, top to bottom. */
export interface BoardOrder {
  column: BoardColumn;
  paths: string[];
}

export interface Snapshot {
  generatedAt: string;
  projects: Project[];
  roots: string[];
  rejected: string[];
  /** Repositories a root source listed that have no `.x-skills` — a fact, not a mistake. */
  skipped: string[];
  failures: { root: string; error: string }[];
  orca: OrcaSource;
  /** The reader's own column moves, by `<projectId>:<relPath>`. */
  board: BoardMoves;
  /** The order each lane was left in, by `<projectId>:<column>`. */
  orders: BoardOrders;
  /** The items the reader archived: hidden from the board, still in the repository. */
  deletions: BoardDeletions;
  /** Where each project keeps its decisions: `<projectId>` → `<root>/board.json` inside that project's `.x-skills`. */
  boardFiles: Record<string, string>;
}

/** What the Orca IDE contributed, so "is the sync working?" is answerable from the screen. */
export interface OrcaSource {
  enabled: boolean;
  file: string | null;
  /** Repositories the IDE lists. */
  listed: number;
  /** How many of them became roots. */
  roots: number;
  reason: string | null;
}

export interface FileContent {
  projectId: string;
  relPath: string;
  name: string;
  extension: string;
  isMarkdown: boolean;
  /** A text file that is not markdown and whose dialect is known, so `html` is its coloured form. */
  isCode: boolean;
  /** The dialect the code was coloured as, or `null` for prose, markdown and anything unrecognised. */
  language: string | null;
  /** True when the dialect was guessed from the text rather than named by the document. */
  detected: boolean;
  /** Whether the app may write this file back — decided on the server, where the text set lives. */
  editable: boolean;
  html: string | null;
  raw: string;
  truncated: boolean;
  size: number;
  mtime: string;
}