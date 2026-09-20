import { For, Show } from 'solid-js';

import { linkProps, type Route } from '../lib/router';

export interface Crumb {
  label: string;
  /** Where the crumb leads. The last one carries no destination: it is the page you are on. */
  to?: Route;
}

/**
 * The trail to the page being read, in one place.
 *
 * Every screen draws the same element in the same spot, and the reason is orientation rather than navigation: a
 * run's artifact list is a long way from the board it came from, and a file opened from a search result has never
 * shown the folder it lives in. The trail always starts at **Projects** and then names the path actually taken
 * — project, category, collection, artifact — so the same page reached two ways reads the same.
 *
 * The crumbs are chrome, not content: muted until pointed at, and only the page itself is in the reading colour, so
 * a title below them is still the thing a reader's eye lands on.
 */
export function Breadcrumbs(props: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" class="min-w-0">
      <ol class="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-0.5 p-0 text-chrome">
        <For each={props.trail}>
          {(crumb, index) => (
            <li class="flex min-w-0 items-center gap-x-1.5">
              <Show when={index() > 0}>
                <span class="text-muted-foreground" aria-hidden="true">
                  /
                </span>
              </Show>
              <Show
                when={crumb.to}
                fallback={
                  <span class="break-anywhere font-medium text-foreground" aria-current="page">
                    {crumb.label}
                  </span>
                }
              >
                {(to) => (
                  <a
                    {...linkProps(to())}
                    class="break-anywhere text-muted-foreground no-underline hover:text-foreground hover:underline"
                  >
                    {crumb.label}
                  </a>
                )}
              </Show>
            </li>
          )}
        </For>
      </ol>
    </nav>
  );
}

/** The first crumb of every trail: the root the app opens on. `here` drops the link, for the root page itself. */
export function rootCrumb(here = false): Crumb {
  return here ? { label: 'Projects' } : { label: 'Projects', to: { name: 'overview' } };
}