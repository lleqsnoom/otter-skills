import { createMemo, createSignal, For, Show } from 'solid-js';

import { liveItems } from '../lib/board.mjs';
import {
  COLUMNS,
  COLUMN_LABELS,
  columnCounts,
  columnOf,
  columnTone,
  isMoved,
  relativeTime,
  type ClosedWindow,
  type WorkItem,
} from '../lib/items';
import { linkProps } from '../lib/router';
import type { BoardColumn, BoardDeletions, BoardMoves } from '../lib/types';
import { Button } from '../ui/Button';
import { Card, CardHead, Chip, ProgressBar, StatusBadge } from './Card';

/** Where an item's own page is: a collection opens as a group, a document as a file. */
export function routeFor(item: WorkItem) {
  return item.kind === 'group'
    ? ({ name: 'group', project: item.projectId, group: item.relPath } as const)
    : ({ name: 'file', project: item.projectId, path: item.relPath } as const);
}

export function WorkCard(props: {
  item: WorkItem;
  showProject?: boolean;
  column?: BoardColumn;
  moved?: boolean;
  dragging?: boolean;
  onDragStart?: (item: WorkItem) => void;
  onDragEnd?: () => void;
  onKeyMove?: (item: WorkItem, direction: -1 | 1) => void;
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    // Alt + arrows, so a card can be filed without a pointer. `preventDefault` is load-bearing: Alt + Left is the
    // browser's own "back", and without it filing a card would also navigate away from the board.
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    props.onKeyMove?.(props.item, event.key === 'ArrowLeft' ? -1 : 1);
  };

  return (
    <Card
      as="a"
      {...linkProps(routeFor(props.item))}
      label={`${props.item.categoryLabel}: ${props.item.title}`}
      title={
        props.onKeyMove ? 'Drag to another column, or Alt + ← / → to file it' : undefined
      }
      class={props.dragging ? 'opacity-50' : undefined}
      draggable={Boolean(props.onDragStart)}
      onDragStart={(event) => {
        // Firefox will not start a drag without data on the transfer, even though the board keeps the item itself.
        event.dataTransfer?.setData('text/plain', props.item.key);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        props.onDragStart?.(props.item);
      }}
      onDragEnd={() => props.onDragEnd?.()}
      onKeyDown={onKeyDown}
    >
      <CardHead>
        <StatusBadge status={props.item.status} />
        <Show when={props.moved}>
          <Chip title="A column you set; the item's own data still says otherwise" class="text-fair">
            moved
          </Chip>
        </Show>
        <span class="text-chrome text-muted-foreground">{props.item.categoryLabel}</span>
        <span class="ml-auto text-chrome text-muted-foreground">
          {relativeTime(props.item.date || props.item.mtime)}
        </span>
      </CardHead>

      <h3 class="break-anywhere m-0 text-body font-semibold">{props.item.title}</h3>

      <Show when={props.item.excerpt}>
        <p class="m-0 line-clamp-2 text-chrome text-muted-foreground">{props.item.excerpt}</p>
      </Show>

      <Show when={props.item.badges.length}>
        <div class="flex flex-wrap items-center gap-1">
          <For each={props.item.badges}>{(badge) => <Chip>{badge}</Chip>}</For>
        </div>
      </Show>

      <Show when={props.item.progress?.total}>
        <ProgressBar progress={props.item.progress} />
      </Show>

      <footer class="flex flex-wrap items-center gap-x-2 text-chrome text-muted-foreground">
        <Show when={props.showProject}>
          <span class="break-anywhere">{props.item.projectId}</span>
        </Show>
        {/* The folder's own name: two runs can share one title ("Code Review — Fix Plan" twice in one project),
            and a card that is indistinguishable from the one a reader just archived reads as an archive that failed. */}
        <Show when={props.item.kind === 'group'}>
          <span class="break-anywhere">{props.item.relPath.split('/').pop()}</span>
        </Show>
        <span class="ml-auto break-anywhere">
          <Show when={props.item.parentTitle} fallback={`${props.item.fileCount} ${props.item.fileCount === 1 ? 'file' : 'files'}`}>
            in {props.item.parentTitle}
          </Show>
        </span>
      </footer>
    </Card>
  );
}

/**
 * How many cards a lane shows before it folds the rest away.
 *
 * A repository's `To do` lane is a hundred cards: measured on a phone, the five lanes stacked to a 51,000px page,
 * which is neither readable nor tabbable. The first dozen are what a reader works with; the rest are one click
 * away, per lane, and folded cards cost nothing — no layout, and no link in the tab order.
 */
const LANE_PAGE = 12;

/**
 * One lane: its heading, the cards it holds, and the drop target for the whole column.
 *
 * It owns no state of its own — what is being dragged and which lane the pointer is over belong to the board,
 * because they are facts about the drag rather than about a lane.
 */
function Lane(props: {
  column: BoardColumn;
  items: WorkItem[];
  count: number;
  window: ClosedWindow;
  board: BoardMoves;
  showProject?: boolean;
  dragging: WorkItem | null;
  over: BoardColumn | null;
  expanded: boolean;
  onDragOver: (column: BoardColumn) => void;
  onDragLeave: (column: BoardColumn) => void;
  onDrop: (column: BoardColumn) => void;
  onDragStart?: (item: WorkItem) => void;
  onDragEnd: () => void;
  onKeyMove?: (item: WorkItem, direction: -1 | 1) => void;
  onToggleFold: (column: BoardColumn) => void;
}) {
  // A lane being dragged over shows everything: the card you are carrying must be droppable where you mean it.
  const shown = () => (props.expanded || props.dragging !== null ? props.items : props.items.slice(0, LANE_PAGE));
  const folded = () => props.items.length - shown().length;
  const highlighted = () => props.over === props.column && props.dragging !== null;

  return (
    <section
      class="grid content-start gap-2 rounded-lg border border-transparent p-1.5 transition-colors"
      classList={{
        'border-[color-mix(in_srgb,var(--primary)_35%,var(--border))]': highlighted(),
        'bg-[color-mix(in_srgb,var(--muted)_45%,transparent)]': highlighted(),
      }}
      aria-label={`${COLUMN_LABELS[props.column]} column`}
      onDragOver={(event) => {
        if (!props.dragging) return;
        // Only a lane that accepted the drop can receive it, so this has to be prevented on every drag-over.
        event.preventDefault();
        props.onDragOver(props.column);
      }}
      onDragLeave={() => props.onDragLeave(props.column)}
      onDrop={(event) => {
        event.preventDefault();
        props.onDrop(props.column);
      }}
    >
      <header class="flex items-baseline gap-2 border-b border-border pb-1.5">
        <h2 class={`m-0 border-0 p-0 text-chrome font-medium tracking-wide uppercase ${columnTone(props.column)}`}>
          {COLUMN_LABELS[props.column]}
        </h2>
        <Show when={props.column === 'closed'}>
          <span class="text-chrome font-normal text-muted-foreground normal-case">
            {props.window.ms === null ? 'every finished item' : `finished in the last ${props.window.label}`}
          </span>
        </Show>
        <span class="ml-auto text-chrome text-muted-foreground tabular-nums">{props.count}</span>
      </header>

      <div class="grid content-start gap-2">
        <For each={shown()}>
          {(item) => (
            <WorkCard
              item={item}
              showProject={props.showProject}
              moved={isMoved(item, props.board)}
              dragging={props.dragging?.key === item.key}
              onDragStart={props.onDragStart}
              onDragEnd={props.onDragEnd}
              onKeyMove={props.onKeyMove}
            />
          )}
        </For>
        <Show when={folded() > 0}>
          <Button
            size="chip"
            variant="quiet"
            class="justify-self-start"
            onClick={() => props.onToggleFold(props.column)}
          >
            {props.expanded ? `fold the last ${folded()}` : `+ ${folded()} more`}
          </Button>
        </Show>
        <Show when={!props.items.length}>
          <p class="m-0 text-chrome text-muted-foreground italic">
            {props.dragging ? 'drop here' : 'nothing here'}
          </p>
        </Show>
      </div>
    </section>
  );
}

/**
 * The board: one lane per column, in the order `COLUMNS` gives.
 *
 * A card can be filed by dragging it onto a lane, or by `Alt + ←/→` while it has focus — the pointer gesture is the
 * quick one and the keyboard one is the reason the feature is usable at all. Both end in the same call: the column
 * is stored beside the app (`board.json`), never in the repository, because a document's own state is not a thing
 * this app can change.
 *
 * Dropping a card on the column its *data* already gives it clears the move rather than storing a preference that
 * says nothing — so a card can always be put back by dragging it where it would have been anyway.
 */
export function Board(props: {
  items: WorkItem[];
  board: BoardMoves;
  window: ClosedWindow;
  deletions: BoardDeletions;
  showProject?: boolean;
  onMove?: (item: WorkItem, column: BoardColumn | null) => void;
}) {
  const [dragging, setDragging] = createSignal<WorkItem | null>(null);
  const [over, setOver] = createSignal<BoardColumn | null>(null);
  const [expanded, setExpanded] = createSignal<BoardColumn[]>([]);

  // A board draws what the reader has not archived, and its lane counts agree with it: a lane that says `12` while
  // showing nine cards is the kind of number a reader stops trusting.
  const live = () => liveItems(props.items, props.deletions);
  const counts = createMemo(() => columnCounts(liveItems(props.items, props.deletions), props.board, props.window));

  const itemsIn = (column: BoardColumn) => live().filter((item) => columnOf(item, props.board, props.window) === column);

  const toggleFold = (column: BoardColumn) => {
    setExpanded((current) => (current.includes(column) ? current.filter((entry) => entry !== column) : [...current, column]));
  };

  const drop = (column: BoardColumn) => {
    const item = dragging();
    setOver(null);
    setDragging(null);
    if (!item || !props.onMove) return;
    props.onMove(item, column);
  };

  const keyMove = (item: WorkItem, direction: -1 | 1) => {
    if (!props.onMove) return;
    const current = columnOf(item, props.board, props.window);
    const next = COLUMNS[COLUMNS.indexOf(current) + direction];
    if (next) props.onMove(item, next);
  };

  return (
    <div class="grid gap-3 lg:grid-cols-3 xl:grid-cols-5">
      <For each={COLUMNS}>
        {(column) => (
          <Lane
            column={column}
            items={itemsIn(column)}
            count={counts()[column]}
            window={props.window}
            board={props.board}
            showProject={props.showProject}
            dragging={dragging()}
            over={over()}
            expanded={expanded().includes(column)}
            onDragOver={setOver}
            onDragLeave={(leaving) => setOver((current) => (current === leaving ? null : current))}
            onDrop={drop}
            onDragStart={props.onMove ? setDragging : undefined}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onKeyMove={props.onMove ? keyMove : undefined}
            onToggleFold={toggleFold}
          />
        )}
      </For>
    </div>
  );
}

/** The control that says how far back "Closed" reaches. */
export function ClosedWindowPicker(props: {
  value: ClosedWindow;
  windows: ClosedWindow[];
  onChange: (id: string) => void;
}) {
  return (
    <span class="inline-flex flex-wrap items-center gap-1">
      <span class="text-chrome text-muted-foreground">Closed within</span>
      <For each={props.windows}>
        {(window) => (
          <Button
            size="chip"
            variant={props.value.id === window.id ? 'on' : 'outline'}
            onClick={() => props.onChange(window.id)}
          >
            {window.label}
          </Button>
        )}
      </For>
    </span>
  );
}
