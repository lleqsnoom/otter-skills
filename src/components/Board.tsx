import { createMemo, createSignal, For, Show } from 'solid-js';

import { landingBoundary, leftLane, liveItems, orderKey, orderedLane, placeAtPointer } from '../lib/board.mjs';
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
import type { BoardColumn, BoardDeletions, BoardMoves, BoardOrder, BoardOrders } from '../lib/types';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { Card, CardHead, Chip, ProgressBar, StatusBadge } from './Card';

/**
 * The place a card would land: a dashed slot the size of the card in hand. It is `aria-hidden`, because where a card
 * goes is a question the keyboard already answers with `Alt + ←/→`, and it is a slot rather than a card because
 * nothing has been decided until the hand lets go.
 */
function DropSlot(props: { height: number }) {
  return <div class="drop-slot" style={{ height: `${props.height}px` }} aria-hidden="true" />;
}

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
  onDragStart?: (item: WorkItem, height: number) => void;
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
        props.onKeyMove ? 'Drag to a column and a place in it, or Alt + ← / → to file it' : undefined
      }
      class={cn(props.dragging && 'opacity-40 shadow-none rotate-[-1.2deg]')}
      draggable={Boolean(props.onDragStart)}
      onDragStart={(event) => {
        // Firefox will not start a drag without data on the transfer, even though the board keeps the item itself.
        event.dataTransfer?.setData('text/plain', props.item.key);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        // How tall the card is, so the slot that opens for it is the shape it will take rather than a guess at it.
        props.onDragStart?.(props.item, (event.currentTarget as HTMLElement).offsetHeight);
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
 * One lane: its heading, the cards it holds in the order the reader left them, and the place a drop would land.
 *
 * It owns no state of its own — what is being dragged, which lane the pointer is over, and where in that lane the
 * card would land belong to the board, because they are facts about the drag rather than about a lane. What it does
 * own is the two readings a lane alone can take: where in itself the pointer is, and whether a leave is leaving.
 */
function Lane(props: {
  column: BoardColumn;
  items: WorkItem[];
  count: number;
  window: ClosedWindow;
  board: BoardMoves;
  showProject?: boolean;
  carried: { item: WorkItem; height: number } | null;
  over: { column: BoardColumn; index: number } | null;
  expanded: boolean;
  onDragOver: (column: BoardColumn, index: number) => void;
  onDragLeave: (column: BoardColumn) => void;
  onDrop: (column: BoardColumn, index: number) => void;
  onDragStart?: (item: WorkItem, height: number) => void;
  onDragEnd: () => void;
  onKeyMove?: (item: WorkItem, direction: -1 | 1) => void;
  onToggleFold: (column: BoardColumn) => void;
}) {
  // A lane being dragged over shows everything: the card you are carrying must be droppable where you mean it.
  const shown = () => (props.expanded || props.carried !== null ? props.items : props.items.slice(0, LANE_PAGE));
  const folded = () => props.items.length - shown().length;
  const highlighted = () => props.over?.column === props.column && props.carried !== null;
  const carriedAt = () => (props.carried ? props.items.findIndex((item) => item.key === props.carried?.item.key) : -1);

  const indexAtPointer = (event: DragEvent) => {
    const cards = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.card')].filter(
      (_, rendered) => rendered !== carriedAt(),
    );
    return placeAtPointer(cards.map((card) => card.getBoundingClientRect()), event.clientY);
  };

  const leaveLane = (event: DragEvent) => {
    const lane = event.currentTarget as HTMLElement;
    const entering = event.relatedTarget as Node | null;
    if (leftLane({ x: event.clientX, y: event.clientY }, lane.getBoundingClientRect(), entering !== null && lane.contains(entering))) {
      props.onDragLeave(props.column);
    }
  };

  // The slot opens on a boundary between two cards, and the card in hand is still drawn where it came from — the one
  // thing the place measured above does not count, so `landingBoundary` is where the two meet.
  const landing = () => (props.over?.column === props.column ? props.over.index : -1);
  const slotBoundary = () => landingBoundary(landing(), carriedAt());
  const slotAt = (rendered: number) => props.carried !== null && slotBoundary() === rendered;

  return (
    <section
      class="lane grid content-start gap-2 rounded-lg p-2 transition-[background-color,box-shadow] motion-reduce:transition-none"
      data-over={highlighted() ? 'true' : undefined}
      aria-label={`${COLUMN_LABELS[props.column]} column`}
      onDragOver={(event) => {
        if (!props.carried) return;
        // Only a lane that accepted the drop can receive it, so this has to be prevented on every drag-over.
        event.preventDefault();
        props.onDragOver(props.column, indexAtPointer(event));
      }}
      onDragLeave={leaveLane}
      onDrop={(event) => {
        event.preventDefault();
        props.onDrop(props.column, indexAtPointer(event));
      }}
    >
      <header class="flex items-center gap-2">
        <h2 class={`m-0 border-0 p-0 text-chrome font-medium tracking-wide uppercase ${columnTone(props.column)}`}>
          {COLUMN_LABELS[props.column]}
        </h2>
        <Show when={props.column === 'closed'}>
          <span class="text-chrome font-normal text-muted-foreground normal-case">
            {props.window.ms === null ? 'every finished item' : `finished in the last ${props.window.label}`}
          </span>
        </Show>
        <Chip class="ml-auto shrink-0 bg-background/70 tabular-nums">{props.count}</Chip>
      </header>

      <div class="grid content-start gap-2">
        <For each={shown()}>
          {(item, rendered) => (
            <>
              <Show when={slotAt(rendered())}>
                <DropSlot height={props.carried?.height ?? 0} />
              </Show>
              <WorkCard
                item={item}
                showProject={props.showProject}
                moved={isMoved(item, props.board)}
                dragging={props.carried?.item.key === item.key}
                onDragStart={props.onDragStart}
                onDragEnd={props.onDragEnd}
                onKeyMove={props.onKeyMove}
              />
            </>
          )}
        </For>
        <Show when={slotAt(shown().length)}>
          <DropSlot height={props.carried?.height ?? 0} />
        </Show>
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
        <Show when={!props.items.length && !props.carried}>
          <p class="m-0 text-chrome text-muted-foreground italic">nothing here</p>
        </Show>
      </div>
    </section>
  );
}

/**
 * The board: one lane per column, in the order `COLUMNS` gives, and each lane in the order a reader left it.
 *
 * A card can be filed by dragging it onto a lane, or by `Alt + ←/→` while it has focus — the pointer gesture is the
 * quick one and the keyboard one is the reason the feature is usable at all. Both end in the same call: the column
 * is stored beside the app (`board.json`), never in the repository, because a document's own state is not a thing
 * this app can change.
 *
 * A drag also says *where* in the lane the card was let go, and that is why a drop hands over the whole lane rather
 * than one place in it: a place is only meaningful against the cards around it, and the list is what keeps those
 * cards where they were. Dropping a card on the column its *data* already gives it clears the move rather than
 * storing a preference that says nothing — so a card can always be put back by dragging it where it would have been
 * anyway — while the order it was dropped at still stands, because that was a decision the reader made either way.
 *
 * `Alt + ←/→` names a lane and no place in it, and hands over no order at all: a card filed that way is drawn where
 * the lane already puts it — last among the cards somebody has sorted by hand — and the lane it arrives in keeps
 * the order it had.
 */
export function Board(props: {
  projectId: string;
  items: WorkItem[];
  board: BoardMoves;
  orders: BoardOrders;
  window: ClosedWindow;
  deletions: BoardDeletions;
  showProject?: boolean;
  onMove?: (item: WorkItem, column: BoardColumn, order: BoardOrder | null) => void;
}) {
  const [carried, setCarried] = createSignal<{ item: WorkItem; height: number } | null>(null);
  const [over, setOver] = createSignal<{ column: BoardColumn; index: number } | null>(null);
  const [expanded, setExpanded] = createSignal<BoardColumn[]>([]);

  // A board draws what the reader has not archived, and its lane counts agree with it: a lane that says `12` while
  // showing nine cards is the kind of number a reader stops trusting.
  const live = () => liveItems(props.items, props.deletions);
  const counts = createMemo(() => columnCounts(liveItems(props.items, props.deletions), props.board, props.window));

  const itemsIn = (column: BoardColumn) =>
    orderedLane(
      live().filter((item) => columnOf(item, props.board, props.window) === column),
      orderKey(props.projectId, column),
      props.orders,
    );

  const toggleFold = (column: BoardColumn) => {
    setExpanded((current) => (current.includes(column) ? current.filter((entry) => entry !== column) : [...current, column]));
  };

  const drop = (column: BoardColumn, index: number) => {
    const item = carried()?.item;
    setOver(null);
    setCarried(null);
    if (!item || !props.onMove) return;
    // The lane as the drop leaves it: the card taken out of the list it was measured against, and put back where
    // the slot was drawn. What is stored is the whole lane, because that is the only thing that says a place.
    const paths = itemsIn(column)
      .filter((entry) => entry.key !== item.key)
      .map((entry) => entry.relPath);
    paths.splice(Math.max(0, Math.min(index, paths.length)), 0, item.relPath);
    props.onMove(item, column, { column, paths });
  };

  const keyMove = (item: WorkItem, direction: -1 | 1) => {
    if (!props.onMove) return;
    const current = columnOf(item, props.board, props.window);
    const next = COLUMNS[COLUMNS.indexOf(current) + direction];
    if (!next) return;
    // No order travels with a keyboard move: a card filed that way lands at the end of the lane, and filing it must
    // not freeze the order of a lane the reader never sorted by hand.
    props.onMove(item, next, null);
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
            carried={carried()}
            over={over()}
            expanded={expanded().includes(column)}
            onDragOver={(dragged: BoardColumn, index: number) => setOver({ column: dragged, index })}
            onDragLeave={(leaving) => setOver((current) => (current?.column === leaving ? null : current))}
            onDrop={drop}
            onDragStart={props.onMove ? (item, height) => setCarried({ item, height }) : undefined}
            onDragEnd={() => {
              setCarried(null);
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
