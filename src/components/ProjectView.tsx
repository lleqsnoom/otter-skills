import { createMemo, createSignal, For, Show } from 'solid-js';

import { countLabel } from '../lib/api';
import { deletedItems, liveItems } from '../lib/board.mjs';
import {
  CLOSED_WINDOWS,
  type ClosedWindow,
  type WorkItem,
  closedWindow,
  COLUMNS,
  COLUMN_LABELS,
  columnCounts,
  columnOf,
  DEFAULT_CLOSED_WINDOW,
  formatDate,
  itemsForProject,
  matches,
  relativeTime,
  searchItemsForProject,
  statusCounts,
  STATUS_LABELS,
} from '../lib/items';
import { linkProps, navigate } from '../lib/router';
import type { BoardColumn, BoardDeletions, BoardMoves, BoardOrder, BoardOrders, Category, Project } from '../lib/types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ToggleGroup } from '../ui/ToggleGroup';
import { Board, ClosedWindowPicker, routeFor, WorkCard } from './Board';
import { Breadcrumbs, rootCrumb } from './Breadcrumbs';
import { Chip, Empty, Stat, StatusBadge } from './Card';
import { ProjectIcon } from './ProjectIcon';

type View = 'board' | 'list';

/**
 * What the page is, and how much of it there is. A category page counts its own contents; the project's totals —
 * artifacts, collections, where the board stands — belong to the project's page.
 */
function ProjectHeader(props: {
  project: Project;
  category: Category | null;
  counts: Record<BoardColumn, number>;
  window: ClosedWindow;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <header class="grid gap-1.5">
      <Breadcrumbs
        trail={[
          rootCrumb(),
          props.category
            ? { label: props.project.name, to: { name: 'project', project: props.project.id } }
            : { label: props.project.name },
          ...(props.category ? [{ label: props.category.label }] : []),
        ]}
      />
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Show when={!props.category}>
          <ProjectIcon project={props.project} size="lead" />
        </Show>
        <h1>{props.category?.label ?? props.project.name}</h1>
        <span class="text-chrome text-muted-foreground">{relativeTime(props.project.scannedAt)}</span>
        <span class="ml-auto inline-flex items-center gap-1.5">
          <Button size="chip" variant="quiet" onClick={props.onRefresh} disabled={props.refreshing}>
            {props.refreshing ? 'refreshing…' : 'refresh'}
          </Button>
        </span>
      </div>

      <Show
        when={props.category}
        fallback={
          <>
            <Show when={props.project.about}>
              <p class="break-anywhere m-0 text-chrome text-muted-foreground">{props.project.about}</p>
            </Show>
            <p class="break-anywhere m-0 text-chrome text-muted-foreground">{props.project.repoPath}</p>
            <div class="flex flex-wrap gap-x-5 gap-y-2 pt-1">
              <Stat value={props.project.totals.files} label="artifacts" />
              <Stat value={props.project.totals.groups} label="collections" />
              <Stat value={props.counts.active} label={STATUS_LABELS.active} />
              <Stat value={props.counts.todo} label={STATUS_LABELS.todo} />
              <Stat value={props.counts.closed} label={`${COLUMN_LABELS.closed} (${props.window.label})`} />
              <Stat value={props.counts.done} label={COLUMN_LABELS.done} />
            </div>
          </>
        }
      >
        {(active) => (
          <>
            <p class="m-0 text-chrome text-muted-foreground">
              {countLabel(active().counts.groups, 'collection')} · {countLabel(active().counts.items, 'document')} ·{' '}
              {countLabel(active().counts.files, 'file')}
              <Show when={active().dirs.length > 1}>
                {' '}
                · read from{' '}
                <For each={active().dirs}>
                  {(dir, index) => (
                    <>
                      <Show when={index() > 0}> and </Show>
                      <code>{dir}</code>
                    </>
                  )}
                </For>
              </Show>
              {/* A category no folder was read for is named by what the runs wrote; saying "read from `analysis`"
                  over it would point at a directory nothing looked in. */}
              <Show when={active().fromRuns}> · named by this project's runs, not by a folder of its own</Show>
            </p>
            <Show when={active().hint}>
              <p class="m-0 text-chrome text-muted-foreground">{active().hint}</p>
            </Show>
          </>
        )}
      </Show>
    </header>
  );
}

/**
 * The category row, where one chip opens a category and the current one hides it from the board — the board is a
 * working view, and hiding what you are not looking at is how it stays one.
 */
function CategoryFilters(props: {
  project: Project;
  current: string | null;
  hidden: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div class="flex flex-wrap items-center gap-1">
      <Button
        size="chip"
        variant={props.current === null ? 'on' : 'outline'}
        onClick={() => navigate({ name: 'project', project: props.project.id })}
      >
        all
      </Button>
      <For each={props.project.categories}>
        {(category) => (
          <Button
            size="chip"
            variant={props.current === category.id ? 'on' : 'outline'}
            title={category.hint || category.label}
            class={props.hidden.includes(category.id) ? 'opacity-40' : ''}
            onClick={() =>
              props.current === category.id
                ? props.onToggle(category.id)
                : navigate({ name: 'category', project: props.project.id, category: category.id })
            }
          >
            {category.label}
            <span class="font-normal text-muted-foreground tabular-nums">{category.counts.files}</span>
          </Button>
        )}
      </For>
    </div>
  );
}

export function ProjectView(props: {
  project: Project;
  category: string | null;
  board: BoardMoves;
  orders: BoardOrders;
  deletions: BoardDeletions;
  onRefresh: () => void;
  refreshing: boolean;
  /**
   * Absent when the snapshot cannot be written to, which is when the board is read-only. `column: null` is a card
   * dropped back where its own data puts it, and `order` — the lane it was dropped into either way — is absent for a
   * card filed with the keyboard, which names a lane and no place in it.
   */
  onMove?: (item: WorkItem, column: BoardColumn | null, order: BoardOrder | null) => void;
  /** Absent for the same reason: with nothing to write to, an item cannot be archived either. */
  onDelete?: (item: WorkItem, deleted: boolean) => void;
}) {
  const [view, setView] = createSignal<View>('board');
  const [query, setQuery] = createSignal('');
  const [hidden, setHidden] = createSignal<string[]>([]);
  const [windowId, setWindowId] = createSignal(DEFAULT_CLOSED_WINDOW);

  const window = createMemo(() => closedWindow(windowId()));

  const selected = createMemo(() => {
    if (!props.category) return props.project.categories;
    return props.project.categories.filter((category) => category.id === props.category);
  });

  /**
   * The category this page is about — and only when the address names one. It cannot be `selected()[0]`: on the
   * project's own page `selected()` is *every* category, so the first of them would title a page that is not about
   * it.
   */
  const category = createMemo(() =>
    props.category ? (props.project.categories.find((entry) => entry.id === props.category) ?? null) : null,
  );

  const visible = createMemo(() => {
    const hiddenSet = new Set(hidden());
    return selected().filter((category) => !hiddenSet.has(category.id));
  });

  const items = createMemo(() =>
    liveItems(itemsForProject(props.project, visible()).filter((item) => matches(item, query())), props.deletions),
  );
  const counts = createMemo(() => columnCounts(items(), props.board, window()));
  const allCounts = createMemo(() => columnCounts(liveItems(itemsForProject(props.project), props.deletions), props.board, window()));

  // Built from the widest item set — every artifact inside every collection, not only the cards — so an artifact
  // archived on its own page can be found and brought back here. The list is the decisions themselves, which is
  // why a collection that is archived appears once rather than once per file inside it.
  const deleted = createMemo(() => deletedItems(searchItemsForProject(props.project, visible()), props.deletions));

  const toggleCategory = (id: string) => {
    setHidden((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  };

  /**
   * A card dropped on the column its own data already gives it is not a move — the stored preference would say
   * nothing and would outlive a change to the document. `null` clears it instead.
   *
   * The order still travels: where a card was dropped *within* the lane is a decision about the reader's own board
   * either way, and a lane a card was sorted in is a lane the reader arranged, whatever its column says.
   */
  const move = (item: WorkItem, column: BoardColumn, order: BoardOrder | null) => {
    const own = columnOf(item, {}, window());
    props.onMove?.(item, column === own ? null : column, order);
  };

  return (
    <div class="grid gap-5">
      <ProjectHeader
        project={props.project}
        category={category()}
        counts={allCounts()}
        window={window()}
        onRefresh={props.onRefresh}
        refreshing={props.refreshing}
      />

      <section class="grid gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <ToggleGroup<View>
            label="Layout"
            value={view()}
            onChange={setView}
            options={[
              { value: 'board', label: 'Board' },
              { value: 'list', label: 'List' },
            ]}
          />
          <Input
            type="search"
            placeholder="Filter these items…"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            class="h-6 max-w-72"
          />
          <span class="ml-auto text-chrome text-muted-foreground tabular-nums">
            {counts().todo} to do · {counts().active} in progress · {counts().closed} closed · {items().length} shown
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <ClosedWindowPicker value={window()} windows={CLOSED_WINDOWS} onChange={setWindowId} />
          <Show when={view() === 'board' && props.onMove}>
            <span class="text-chrome text-muted-foreground">
              drag a card to a column and a place in it, or Alt + ← / → on a focused one
            </span>
          </Show>
        </div>

        <CategoryFilters
          project={props.project}
          current={props.category}
          hidden={hidden()}
          onToggle={toggleCategory}
        />
        <p class="m-0 text-chrome text-muted-foreground">
          Click a category to open it; click it again to hide it from this board.
        </p>
      </section>

      <Show when={items().length} fallback={<Empty>Nothing matches this view yet.</Empty>}>
        <Show
          when={view() === 'board'}
          fallback={
            <div class="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
              <For each={items()}>
                {(item) => (
                  <WorkCard
                    item={item}
                    column={columnOf(item, props.board, window())}
                    moved={Boolean(props.board[`${props.project.id}:${item.relPath}`])}
                  />
                )}
              </For>
            </div>
          }
        >
          <Board
            projectId={props.project.id}
            items={items()}
            board={props.board}
            orders={props.orders}
            window={window()}
            deletions={props.deletions}
            onMove={props.onMove ? move : undefined}
          />
        </Show>
      </Show>

      <Show when={deleted().length}>
        <section class="grid gap-2">
          <h2 class="m-0 border-0 p-0 text-section font-medium">
            Archived{' '}
            <span class="text-chrome font-normal text-muted-foreground">{deleted().length}</span>
          </h2>
          <p class="m-0 text-chrome text-muted-foreground">
            Off the board, and still on disk: the artifact is untouched, and bringing it back returns it — and
            everything inside it — to the column its own data gives it.
          </p>
          <ul class="m-0 grid list-none gap-1 p-0">
            <For each={deleted()}>
              {(item) => (
                <li class="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
                  <StatusBadge status={item.status} />
                  <a {...linkProps(routeFor(item))} class="break-anywhere text-chrome">
                    {item.title}
                  </a>
                  <span class="break-anywhere text-chrome text-muted-foreground">{item.relPath}</span>
                  <Chip>{formatDate(item.date || item.mtime)}</Chip>
                  <Button size="chip" variant="quiet" class="ml-auto" onClick={() => props.onDelete?.(item, false)}>
                    unarchive
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={query()}>
        <p class="m-0 text-chrome text-muted-foreground">
          Filtering {selected().length} of {props.project.categories.length} categories by “{query()}”.
        </p>
      </Show>

      <section class="grid gap-2">
        <h2 class="m-0 border-0 p-0 text-section font-medium">Recent in this project</h2>
        <div class="grid gap-2 lg:grid-cols-3">
          <For each={liveItems(itemsForProject(props.project), props.deletions).slice(0, 6)}>
            {(item) => (
              <a
                {...linkProps(routeFor(item))}
                class="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-foreground no-underline transition-colors hover:border-ring"
              >
                <StatusBadge status={item.status} />
                <span class="break-anywhere text-chrome">{item.title}</span>
                <Chip class="ml-auto">{formatDate(item.date || item.mtime)}</Chip>
              </a>
            )}
          </For>
        </div>
      </section>

    </div>
  );
}