import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';

import { landingBoundary, leftLane, liveItems, orderKey, orderedLane, placeAtPointer } from '../lib/board.mjs';
import {
  COLUMNS,
  COLUMN_LABELS,
  columnCounts,
  columnOf,
  columnTone,
  isMoved,
  relativeTime,
  routeFor,
  STATUS_LABELS,
  statusTone,
  type ClosedWindow,
  type WorkItem,
} from '../lib/items';
import { linkProps } from '../lib/router';
import type { BoardColumn, BoardDeletions, BoardMoves, BoardOrder, BoardOrders } from '../lib/types';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { Card, CardHead, CardTitle, Chip, EpicPill, ProgressBar, StatusBadge } from './Card';

export function WorkCard(props: {
  item: WorkItem;
  showProject?: boolean;
  column?: BoardColumn;
  moved?: boolean;
  dragging?: boolean;
  /** Where the card sits in its lane's grid: the lane's odd rows are the cards, its even ones the slot. */
  order?: number;
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

  // A card holding tasks is still one target: the title below carries the card's link, stretched over the panel,
  // and the tasks paint above that stretch — which is what leaves them links of their own.
  const holds = () => props.item.tasks.length > 0;

  return (
    <Card
      title={props.onKeyMove ? 'Drag to a column and a place in it, or Alt + ← / → to file it' : undefined}
      class={cn(props.dragging && 'opacity-40 shadow-none rotate-[-1.2deg]')}
      style={cardStyle(props.item, props.order)}
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
        <Show when={!props.item.isEpic && props.item.epic}>{(epic) => <EpicPill epic={epic()} />}</Show>
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

      <CardTitle to={routeFor(props.item)} label={`${props.item.categoryLabel}: ${props.item.title}`}>
        {props.item.title}
      </CardTitle>

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

      <Show when={holds()}>
        <TaskList tasks={props.item.tasks} limit={TASK_PREVIEW} class="border-t border-border pt-1.5" />
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
        <Show when={whereabouts(props.item)}>
          <span class="ml-auto break-anywhere">{whereabouts(props.item)}</span>
        </Show>
      </footer>
    </Card>
  );
}

/**
 * What a card's own line says about where the thing sits: the tasks it holds, the collection holding it, or how many
 * files there are. Work read under an epic says nothing, because the pill already names it.
 */
function whereabouts(item: WorkItem): string | null {
  if (item.tasks.length) return `${item.tasks.length} ${item.tasks.length === 1 ? 'task' : 'tasks'}`;
  if (item.epic) return null;
  if (item.parentTitle) return `in ${item.parentTitle}`;
  return `${item.fileCount} ${item.fileCount === 1 ? 'file' : 'files'}`;
}

/**
 * A card's own styling: the place a lane put it in, and — when it is an epic — the palette's colour down its leading
 * edge. The edge is what tells two epics apart at a glance on a board of cards rather than one at a time.
 */
function cardStyle(item: WorkItem, order: number | undefined): JSX.CSSProperties | undefined {
  const style: JSX.CSSProperties = {};
  if (order !== undefined) style.order = order;
  if (item.isEpic && item.epic) {
    style['border-inline-start-color'] = item.epic.color;
    style['border-inline-start-width'] = '3px';
  }
  return Object.keys(style).length ? style : undefined;
}

/**
 * How many tasks an epic's card lists before it counts the rest.
 *
 * An epic of thirty tasks would make one card taller than the lane it sits in, and the lane's own fold is per card.
 * The first few are what a reader scans; the count says how many there are, and the epic's own page holds every one
 * of them.
 */
const TASK_PREVIEW = 8;

/**
 * The tasks inside an epic.
 *
 * On the epic's card they are what the card is for, so the list is capped at `TASK_PREVIEW` and the rest counted;
 * on the epic's own page they are the page, and `limit` is left off. One shape either way, because they are one
 * thing read in two places.
 */
export function TaskList(props: { tasks: WorkItem[]; limit?: number; class?: string }) {
  const shown = () => props.tasks.slice(0, props.limit ?? props.tasks.length);
  const rest = () => props.tasks.length - shown().length;
  return (
    <ul class={cn('m-0 grid list-none gap-0 p-0', props.class)}>
      <For each={shown()}>
        {(task) => (
          <li>
            <a
              {...linkProps(routeFor(task))}
              title={task.title}
              class="flex items-center gap-2 rounded-sm px-1 py-1 text-foreground no-underline hover:bg-muted"
            >
              <span class={cn('shrink-0 text-chrome', statusTone(task.status))}>{STATUS_LABELS[task.status]}</span>
              <span class="min-w-0 flex-1 truncate text-chrome">{task.title}</span>
              <Show when={taskCount(task)}>
                <span class="shrink-0 text-chrome text-muted-foreground tabular-nums">{taskCount(task)}</span>
              </Show>
            </a>
          </li>
        )}
      </For>
      <Show when={rest() > 0}>
        <li class="px-1 py-0.5 text-chrome text-muted-foreground">+ {rest()} more</li>
      </Show>
    </ul>
  );
}

function taskCount(task: WorkItem): string {
  return task.progress?.total ? `${task.progress.done}/${task.progress.total}` : '';
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
 * How many cards a lane draws while one of its cards is being carried.
 *
 * A lane at rest folds to `LANE_PAGE`; a drag used to unfold the whole lane, which is right for the twenty-card lane
 * this was written on and a two-second freeze for a ten-thousand-card one, because the cost is cards x pointer moves
 * and the pointer only ever moves over the cards in front of the reader. So during a drag a lane draws the rows
 * around the viewport and lets two spacers stand in for the rest: the lane keeps its height, and a place the reader
 * drops at is still a place in the lane.
 */
const WINDOW = 30;
/** The rows drawn beyond the viewport, so a place just off screen is still a place the pointer can reach. */
const OVERSCAN = 2;
/** How close to the edge of the window a card in hand asks for the page to move, and how fast it moves at the edge. */
const EDGE = 90;
/** The page's speed at the edge of the window, in pixels per second: slowest just inside it, fastest against it. */
const EDGE_MIN_SPEED = 260;
const EDGE_SPEED = 2400;

/**
 * One lane: its heading, the cards it holds in the order the reader left them, and the place a drop would land.
 *
 * It owns no state of its own — what is being dragged, which lane the pointer is over, and where in that lane the
 * card would land belong to the board, because they are facts about the drag rather than about a lane. What it does
 * own is the two readings a lane alone can take: where in itself the pointer is, and whether a leave is leaving.
 *
 * Everything it reads during a drag is read once, not once per card: the lane's list is a memo, the card in hand is
 * one index for the lane, and the place it would land is one `order` between the cards rather than a slot opened in
 * each of them.
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
  pointerY: number | null;
  expanded: boolean;
  onDragOver: (column: BoardColumn, index: number) => void;
  onDragLeave: (column: BoardColumn) => void;
  onDrop: (column: BoardColumn, index: number) => void;
  onDragStart?: (item: WorkItem, height: number) => void;
  onDragEnd: () => void;
  onKeyMove?: (item: WorkItem, direction: -1 | 1) => void;
  onToggleFold: (column: BoardColumn) => void;
}) {
  // `props.items` is a getter that filters and sorts the project's whole list on every read, and a drag used to read
  // it once per card: the memo is what makes a lane one reading per change instead of one per question asked of it.
  const items = createMemo(() => props.items);
  // The row the lane is drawing from while a card is carried: the rows around the viewport, which is where a pointer
  // can be. Everything above and below is a spacer, and the row it stands for is the row the lane last measured.
  const [windowStart, setWindowStart] = createSignal(0);
  const [row, setRow] = createSignal(0);
  let laneRef: HTMLElement | undefined;
  const rowHeight = () => row() || props.carried?.height || 0;

  onMount(() => {
    const card = laneRef?.querySelector<HTMLElement>('.card');
    if (!card || !laneRef) return;
    setRow(card.getBoundingClientRect().height + (Number.parseFloat(getComputedStyle(laneRef).rowGap) || 0));
  });

  // The window follows the viewport, not the pointer: a pointer that moved without the page moving has not changed
  // which rows are in front of the reader, and re-anchoring on it would redraw the lane under the pointer it is
  // measuring. Scrolling (including the browser's own autoscroll at the edge of a drag) is what moves the window.
  createEffect(() => {
    if (props.carried === null) {
      setWindowStart(0);
      return;
    }
    const lane = laneRef;
    const height = rowHeight();
    if (!lane || !height) return;
    const follow = () => {
      const top = lane.getBoundingClientRect().top + window.scrollY;
      const wanted = Math.floor(Math.max(0, window.scrollY - top) / height) - OVERSCAN;
      setWindowStart(Math.max(0, Math.min(wanted, Math.max(0, items().length - WINDOW))));
    };
    follow();
    window.addEventListener('scroll', follow, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', follow));
  });

  // A lane being dragged over draws the rows around the viewport; a lane at rest draws its fold, or everything when
  // the reader asked for that. Either way the card in hand is drawn where it came from, so it can be put back.
  const shown = createMemo(() => {
    if (props.carried !== null) return items().slice(windowStart(), windowStart() + WINDOW);
    return props.expanded ? items() : items().slice(0, LANE_PAGE);
  });
  // Only the rows a lane is not drawing are hidden: folded-away cards are the reader's own fold, and a drag draws the
  // window instead of the whole lane.
  const hidden = () => {
    if (props.carried === null) return 0;
    // The card in hand is drawn out of place (see `drawn`), so it is not one of the rows the spacer below stands for.
    return Math.max(0, items().length - windowStart() - shown().length - (offWindow() ? 1 : 0));
  };
  const folded = () => (props.carried !== null ? 0 : items().length - shown().length);
  const highlighted = () => props.over?.column === props.column && props.carried !== null;
  // The card in hand, where this lane keeps it (-1 when it came from another), read once for the lane rather than
  // once for every card that asks for a place.
  const carriedAt = createMemo(() => (props.carried ? items().findIndex((item) => item.key === props.carried?.item.key) : -1));
  /** Whether the card in hand sits outside the drawn window — the reader has scrolled away from where they picked it up. */
  const offWindow = () => carriedAt() >= 0 && (carriedAt() < windowStart() || carriedAt() >= windowStart() + WINDOW);

  // A drag lives in the element that started it: the browser aborts the whole gesture the moment that element leaves
  // the document. Windowing would take the card in hand away as soon as the reader scrolled past it, which is exactly
  // what a drag to the far end of a long lane does — so it is drawn again at the end of the list, below the window
  // and off screen, where it can be neither seen nor dropped on. Keeping the item in the list keeps its own node, so
  // the gesture survives.
  const drawn = createMemo(() => {
    const list = shown();
    if (!offWindow()) return list;
    const item = items()[carriedAt()];
    return item ? [...list, item] : list;
  });

  // A place measured among the rows on screen is a place in the lane once the rows the lane is not drawing are
  // counted — and the card in hand is not one of those rows when it came from above the window.
  const windowOffset = () => windowStart() - (carriedAt() >= 0 && carriedAt() < windowStart() ? 1 : 0);

  // The drawn window moved under the pointer — the page scrolled, or the edge of it did it for the reader — so the
  // place the slot promises is re-read from where the pointer is. Without this the slot says where the card would
  // have landed before the page moved, and the drop lands somewhere else.
  createEffect(() => {
    windowStart();
    const y = props.pointerY;
    if (y === null || props.carried === null || props.over?.column !== props.column) return;
    props.onDragOver(props.column, placeAt(y));
  });

  // Where a pointer at this height would put the card, among the cards this lane is drawing: the card in hand is not
  // one of them, wherever the window has put it, because it is already out of the lane the reader is aiming into and
  // it is the one card whose box is not where it reads.
  const placeAt = (clientY: number) => {
    const cards = [...(laneRef?.querySelectorAll<HTMLElement>('.card') ?? [])].filter(
      (card) => !card.classList.contains('opacity-40'),
    );
    return placeAtPointer(cards.map((card) => card.getBoundingClientRect()), clientY) + windowOffset();
  };

  const indexAtPointer = (event: DragEvent) => placeAt(event.clientY);

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
  const slotBoundary = () => (props.carried ? landingBoundary(landing(), carriedAt()) : -1);

  // The lane is a grid and the cards hold its odd rows, so the slot is one `order` that moves: `For`'s index is
  // stable, and only the slot's own row changes as the pointer moves. The row is the row of the drawn window, which
  // is what a card's own `order` counts in, rather than the row of the whole lane.
  const slotOrder = () => (slotBoundary() - windowStart()) * 2;
  const tailOrder = () => shown().length * 2 + 2;

  return (
    <section
      ref={laneRef}
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
        {/* The rows the lane is not drawing, standing in for themselves: the grid only has to know how tall they are,
            and the place a drop lands is counted past them rather than among them. */}
        <Show when={windowStart() > 0}>
          <div aria-hidden="true" style={{ order: 0, height: `${windowStart() * rowHeight()}px` }} />
        </Show>
        {/* The size of the card in hand, and `aria-hidden` because where a card goes is a question the keyboard
            already answers with `Alt + ←/→`. */}
        <div
          class="drop-slot"
          aria-hidden="true"
          style={{
            display: slotBoundary() < 0 ? 'none' : undefined,
            order: slotOrder(),
            height: `${props.carried?.height ?? 0}px`,
          }}
        />
        <For each={drawn()}>
          {(item, rendered) => (
            <WorkCard
              item={item}
              order={rendered() * 2 + 1}
              showProject={props.showProject}
              moved={isMoved(item, props.board)}
              dragging={props.carried?.item.key === item.key}
              onDragStart={props.onDragStart}
              onDragEnd={props.onDragEnd}
              onKeyMove={props.onKeyMove}
            />
          )}
        </For>
        <Show when={hidden() > 0}>
          <div aria-hidden="true" style={{ order: tailOrder(), height: `${hidden() * rowHeight()}px` }} />
        </Show>
        <Show when={folded() > 0}>
          <Button
            size="chip"
            variant="quiet"
            class="justify-self-start"
            style={{ order: tailOrder() }}
            onClick={() => props.onToggleFold(props.column)}
          >
            {props.expanded ? `fold the last ${folded()}` : `+ ${folded()} more`}
          </Button>
        </Show>
        <Show when={!props.items.length && !props.carried}>
          <p class="m-0 text-chrome text-muted-foreground italic" style={{ order: tailOrder() }}>
            nothing here
          </p>
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
  const [pointerY, setPointerY] = createSignal<number | null>(null);

  // Dragging to the edge of the window scrolls the page, because a pointer cannot leave the window and the rows past
  // the fold are the whole point of a long lane. The scrolling is this app's own: a pointer held still fires no more
  // events, and whether a browser scrolls its page under a drag is not a thing a page can rely on — so the loop below
  // runs on its own, off the last reading of where the pointer is, until the pointer moves somewhere else.
  createEffect(() => {
    if (!carried()) {
      setPointerY(null);
      return;
    }
    const track = (event: DragEvent) => setPointerY(event.clientY);
    window.addEventListener('dragover', track, { passive: true });
    onCleanup(() => window.removeEventListener('dragover', track));
  });

  createEffect(() => {
    const y = pointerY();
    if (!carried() || y === null) return;
    const up = y < EDGE;
    const down = y > window.innerHeight - EDGE;
    if (!up && !down) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      // The closer to the edge, the faster: a reader who meant "a little further" holds a little way in, and one who
      // meant "the end of this lane" holds it against the edge. The rate is per second and not per frame, because a
      // frame is not a fixed amount of time — the same hold has to move the page the same distance either way.
      const dt = Math.min(now - last, 50);
      last = now;
      const reach = Math.min((up ? y : window.innerHeight - y) / (EDGE / 2), 1);
      const speed = EDGE_MIN_SPEED + reach * reach * (EDGE_SPEED - EDGE_MIN_SPEED);
      window.scrollBy(0, ((up ? -speed : speed) * dt) / 1000);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    onCleanup(() => cancelAnimationFrame(frame));
  });

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
    setPointerY(null);
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
            pointerY={pointerY()}
            expanded={expanded().includes(column)}
            onDragOver={(dragged: BoardColumn, index: number) =>
              // A place that did not move is not news: keeping the same value is what stops a pointer inside one gap
              // from re-drawing the lane on every pixel it crosses.
              setOver((current) => (current?.column === dragged && current.index === index ? current : { column: dragged, index }))
            }
            onDragLeave={(leaving) => setOver((current) => (current?.column === leaving ? null : current))}
            onDrop={drop}
            onDragStart={props.onMove ? (item, height) => setCarried({ item, height }) : undefined}
            onDragEnd={() => {
              setCarried(null);
              setOver(null);
              setPointerY(null);
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
