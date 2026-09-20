import { createMemo, For, Show } from 'solid-js';

import { liveItems } from '../lib/board.mjs';
import { matches, searchItemsForProject } from '../lib/items';
import type { Snapshot } from '../lib/types';
import { WorkCard } from './Board';
import { Breadcrumbs, rootCrumb } from './Breadcrumbs';
import { Empty } from './Card';

/**
 * Search is a screen, not a dropdown: the results are cards, and every one of them is a link somewhere.
 *
 * It searches wider than the board shows. A board card is a collection, because a collection is the unit of work —
 * but a reader searching knows a *file* name, so every artifact inside every collection is a hit too.
 */
export function SearchView(props: { snapshot: Snapshot; query: string }) {
  const results = createMemo(() =>
    props.snapshot.projects.flatMap((project) => {
      // An item the reader archived does not come back in through search: a hidden thing is hidden everywhere.
      const items = liveItems(searchItemsForProject(project), props.snapshot.deletions).filter((item) => matches(item, props.query));
      return items.map((item) => ({ item, project }));
    }),
  );

  return (
    <div class="grid gap-4">
      <header class="grid gap-1.5">
        <Breadcrumbs trail={[rootCrumb(), { label: 'Search' }]} />
        <h1>Search</h1>
        <p class="m-0 text-muted-foreground">
          {results().length} matching items for “{props.query}” across {props.snapshot.projects.length} projects,
          artifacts included.
        </p>
      </header>
      <Show when={results().length} fallback={<Empty>Nothing matches “{props.query}”.</Empty>}>
        <div class="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
          <For each={results()}>
            {(entry) => (
              <div class="grid gap-1">
                <span class="text-chrome text-muted-foreground">{entry.project.name}</span>
                <WorkCard item={entry.item} />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}