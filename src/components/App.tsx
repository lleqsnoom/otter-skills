import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js';

import { deleteItem, fetchSnapshot, moveItem, refreshSnapshot } from '../lib/api';
import { replaceProject } from '../lib/board.mjs';
import { BoardProvider } from '../lib/board-context';
import type { WorkItem } from '../lib/items';
import { locateFile } from '../lib/items';
import { current, href, linkProps, navigate, routeCategory, routeFilePath, routeGroupPath, routeProject } from '../lib/router';
import type { Project, BoardColumn, BoardDeletions, BoardOrder, Snapshot } from '../lib/types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CloseIcon, SearchIcon } from './icons';
import { ProjectIcon } from './ProjectIcon';
import { AddProject } from './AddProject';
import { GroupDetail } from './GroupDetail';
import { FileView } from './FileView';
import { NewProject } from './NewProject';
import { Overview } from './Overview';
import { ProjectView } from './ProjectView';
import { SearchView } from './SearchView';

function RailLink(props: { to: Parameters<typeof href>[0]; active: boolean; children: JSX.Element; hint?: string }) {
  return (
    <a
      {...linkProps(props.to)}
      title={props.hint}
      class={`flex min-h-7 items-center gap-2 rounded-sm px-2 text-chrome no-underline ${
        props.active ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {props.children}
    </a>
  );
}

/**
 * The app: it owns the snapshot, the search query and the one write, and hands them to the two halves of the shell.
 * Everything else — the rail's lists, the routes, the screens — is a component of its own.
 */
export default function App() {
  const [snapshot, { mutate }] = createResource(() => fetchSnapshot());
  const [refreshing, setRefreshing] = createSignal(false);
  const [query, setQuery] = createSignal('');

  // Search is a screen, and it is the one that answers first — so while it is up, *every* card is still a link and
  // every one of them would change the address without changing what is on screen. Clicking a result has to land on
  // the thing it names, so a navigation clears the query. It cannot fire while someone is typing: the route does not
  // move until they follow a link.
  createEffect(
    on(
      () => current(),
      () => setQuery(''),
      { defer: true },
    ),
  );

  let searchField: HTMLInputElement | undefined;

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchField?.focus();
        searchField?.select();
      }
      if (event.key === 'Escape' && document.activeElement === searchField) {
        setQuery('');
        searchField?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  /**
   * Filing a card, and sorting the lane it was filed into. Both are the reader's, and both are written into the
   * project's own `.x-skills/board.json` — the repository the card is about, not this app's — so the only things that
   * change in the snapshot are the moves and the orders, replaced for that one project (`replaceProject`). An entry a
   * write removed has to disappear here as well, which a merge into the map could not do. A drag must not cost a
   * re-scan of nine repositories.
   */
  const move = async (item: WorkItem, column: BoardColumn | null, order: BoardOrder | null) => {
    try {
      const answer = await moveItem(item.projectId, item.relPath, column, order);
      if (!answer.ok) return;
      mutate((current) =>
        current
          ? {
              ...current,
              board: replaceProject(current.board, item.projectId, answer.board),
              orders: replaceProject(current.orders, item.projectId, answer.orders),
            }
          : current,
      );
    } catch {
      /* the board on screen is still the last good one */
    }
  };

  /**
   * Archiving an item, or bringing it back. One write for both directions, like a card's filing: the same decision,
   * in the same project file, and the only thing that changes in the snapshot is that project's slice of the
   * decisions. Nothing in the repository moves, so a delete must not cost a re-scan of nine repositories.
   */
  const removeAt = async (projectId: string, relPath: string, deleted: boolean) => {
    try {
      const answer = await deleteItem(projectId, relPath, deleted);
      if (!answer.ok) return;
      mutate((current) =>
        current ? { ...current, deletions: replaceProject(current.deletions, projectId, answer.deletions) } : current,
      );
    } catch {
      /* the board on screen is still the last good one */
    }
  };

  /** The same write, for a caller that holds the item rather than the two parts of its key. */
  const remove = async (item: WorkItem, deleted: boolean) => removeAt(item.projectId, item.relPath, deleted);

  const refresh = async () => {
    setRefreshing(true);
    try {
      mutate(await refreshSnapshot());
    } catch {
      /* the snapshot on screen is still the last good one */
    } finally {
      setRefreshing(false);
    }
  };

  const errorMessage = () => {
    const error = snapshot.error;
    return error instanceof Error ? error.message : error ? String(error) : '';
  };

  return (
    <div class="app grid min-h-screen grid-cols-[15rem_minmax(0,1fr)]">
      <Rail
        snapshot={snapshot()}
        query={query()}
        onQuery={setQuery}
        onRefresh={refresh}
        refreshing={refreshing()}
        onSearchField={(element) => (searchField = element)}
      />
      <main class="main min-w-0 p-5 pb-16 md:px-7">
        <Screen
          snapshot={snapshot()}
          error={errorMessage()}
          query={query()}
          deletions={snapshot()?.deletions ?? {}}
          onMove={move}
          onDelete={remove}
          onDeleteAt={removeAt}
          onRefresh={refresh}
          refreshing={refreshing()}
        />
      </main>
    </div>
  );
}

/**
 * The left rail: where you are, what you can search, and the two lists that are navigation — the projects, and
 * the categories of whichever project the address names. It reads the route for its own active marks rather than
 * taking them as props, because "which link is current" is a question the router already answers.
 */
function Rail(props: {
  snapshot: Snapshot | undefined;
  query: string;
  onQuery: (value: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onSearchField: (element: HTMLInputElement) => void;
}) {
  const activeProject = () => props.snapshot?.projects.find((candidate) => candidate.id === routeProject()) ?? null;

  return (
    <aside class="rail sticky top-0 h-screen overflow-auto border-r border-sidebar-border bg-sidebar p-4">
      <div class="grid gap-3">
        <div class="grid gap-0.5">
          <a {...linkProps({ name: 'overview' })} class="text-body font-semibold text-foreground no-underline">
            Otter PM
          </a>
          <span class="text-chrome text-muted-foreground">
            {props.snapshot?.projects.length ?? 0} projects · {props.snapshot?.roots.length ?? 0} roots
          </span>
        </div>

        <div class="grid gap-1.5">
          <div class="relative grid">
            <span class="pointer-events-none absolute top-1.5 left-2 text-muted-foreground">
              <SearchIcon />
            </span>
            <Input
              ref={props.onSearchField}
              type="search"
              placeholder="Search everything…"
              value={props.query}
              onInput={(event) => props.onQuery(event.currentTarget.value)}
              class="pl-7"
            />
            <Show when={props.query}>
              <button
                type="button"
                class="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-sm text-muted-foreground hover:bg-muted"
                aria-label="Clear search"
                onClick={() => props.onQuery('')}
              >
                <CloseIcon />
              </button>
            </Show>
          </div>
          <Button size="chip" variant="quiet" onClick={props.onRefresh} disabled={props.refreshing}>
            {props.refreshing ? 'refreshing…' : 'refresh from disk'}
          </Button>
          <NewProject />
          <AddProject />
        </div>

        <nav class="grid gap-0.5" aria-label="Projects">
          <span class="px-2 pt-1 text-chrome text-muted-foreground uppercase">Projects</span>
          <For each={props.snapshot?.projects ?? []}>
            {(entry) => (
              <RailLink
                to={{ name: 'project', project: entry.id }}
                active={routeProject() === entry.id}
                hint={entry.repoPath}
              >
                <ProjectIcon project={entry} />
                <span class="break-anywhere">{entry.name}</span>
                <span class="ml-auto text-chrome text-muted-foreground tabular-nums">{entry.totals.files}</span>
              </RailLink>
            )}
          </For>
          <Show when={!props.snapshot?.projects?.length}>
            <span class="px-2 text-chrome text-muted-foreground italic">none found</span>
          </Show>
        </nav>

        <Show when={activeProject()}>
          {(active) => (
            <nav class="grid gap-0.5" aria-label="Categories">
              <span class="px-2 pt-1 text-chrome text-muted-foreground uppercase">{active().name}</span>
              <For each={active().categories}>
                {(category) => (
                  <RailLink
                    to={{ name: 'category', project: active().id, category: category.id }}
                    active={routeCategory() === category.id}
                    hint={category.hint}
                  >
                    <span class="break-anywhere">{category.label}</span>
                    <span class="ml-auto text-chrome text-muted-foreground tabular-nums">
                      {category.counts.files}
                    </span>
                  </RailLink>
                )}
              </For>
            </nav>
          )}
        </Show>
      </div>
    </aside>
  );
}

/**
 * One artifact's address.
 *
 * A document the tree files on its own — a loose analysis, a plan filed straight into a category — is a page of its
 * own. One that lives inside a collection is answered with the collection's page instead, because that page already
 * draws the artifact and everything it belongs to, and two addresses for one document is one address too many. The
 * address is replaced rather than kept, so what a reader can copy is the one that names the artifact.
 */
function FilePage(props: {
  project: Project;
  path: string;
  deletions: BoardDeletions;
  onDelete: (relPath: string, deleted: boolean) => void;
  onSaved: () => void;
}) {
  const group = createMemo(() => locateFile(props.project, props.path)?.group ?? null);

  createEffect(() => {
    const found = group();
    if (found) navigate({ name: 'group', project: props.project.id, group: found.relPath, file: props.path }, { replace: true });
  });

  return (
    <Show
      when={group()}
      fallback={<FileView project={props.project} path={props.path} onSaved={props.onSaved} />}
    >
      {(found) => (
        <GroupDetail
          project={props.project}
          groupPath={found().relPath}
          file={props.path}
          onSaved={props.onSaved}
          deletions={props.deletions}
          onDelete={props.onDelete}
        />
      )}
    </Show>
  );
}

/**
 * The screen the address asks for, and the only place the routes are listed.
 *
 * The category route has no branch of its own: `ProjectView` takes a `category` and draws itself either way, so the
 * two screens are one element with one argument — which is also why a prop added to one of them cannot go missing
 * from the other.
 */
function Screen(props: {
  snapshot: Snapshot | undefined;
  error: string;
  query: string;
  deletions: BoardDeletions;
  onMove: (item: WorkItem, column: BoardColumn | null, order: BoardOrder | null) => void;
  /** The write itself, for a page that knows its project but holds only a path inside it. */
  onDeleteAt: (projectId: string, relPath: string, deleted: boolean) => void;
  onDelete: (item: WorkItem, deleted: boolean) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const project = createMemo(() => {
    const id = routeProject();
    if (!id) return null;
    return props.snapshot?.projects.find((candidate) => candidate.id === id) ?? null;
  });

  return (
    <Show
      when={props.snapshot}
      fallback={
        <Show when={props.error} fallback={<p class="text-muted-foreground italic">scanning the roots…</p>}>
          <div class="grid gap-2">
            <h1>Could not read the snapshot</h1>
            <p class="text-weak">{props.error}</p>
          </div>
        </Show>
      }
    >
      {(snap) => (
        <Switch>
          <Match when={props.query}>
            <SearchView snapshot={snap()} query={props.query} />
          </Match>
          <Match when={current().name === 'overview'}>
            <Overview snapshot={snap()} />
          </Match>
          <Match when={project()}>
            {(active) => (
              // A page that reads one artifact knows the project from the address, so the decisions a page can
              // make are provided here — the artifact itself is handed them, rather than every caller repeating them.
              // The flag a page passes is the state the item is *in*, which is what its own button is labelled from,
              // so the write is the other direction: one button, both ways.
              <BoardProvider
                deletions={() => props.deletions}
                onDelete={(relPath, deleted) => props.onDeleteAt(active().id, relPath, !deleted)}
              >
                <Switch>
                  <Match when={current().name === 'group'}>
                    <GroupDetail
                      project={active()}
                      groupPath={routeGroupPath()}
                      onSaved={props.onRefresh}
                      deletions={props.deletions}
                      onDelete={(relPath, deleted) => props.onDeleteAt(active().id, relPath, !deleted)}
                    />
                  </Match>
                  <Match when={current().name === 'file'}>
                    <FilePage
                      project={active()}
                      path={routeFilePath()}
                      deletions={props.deletions}
                      onDelete={(relPath, deleted) => props.onDeleteAt(active().id, relPath, !deleted)}
                      onSaved={props.onRefresh}
                    />
                  </Match>
                  <Match when={true}>
                    <ProjectView
                      project={active()}
                      category={routeCategory()}
                      board={snap().board}
                      orders={snap().orders}
                      deletions={props.deletions}
                      onMove={props.onMove}
                      onDelete={props.onDelete}
                      onRefresh={props.onRefresh}
                      refreshing={props.refreshing}
                    />
                  </Match>
                </Switch>
              </BoardProvider>
            )}
          </Match>
          <Match when={true}>
            <div class="grid gap-2">
              <h1>Unknown project</h1>
              <p class="text-muted-foreground">
                No root matches <code>{routeProject()}</code>.
              </p>
              <Button size="chip" onClick={() => navigate({ name: 'overview' })}>
                back to the overview
              </Button>
            </div>
          </Match>
        </Switch>
      )}
    </Show>
  );
}
