import { For, Show } from 'solid-js';

import { linkProps } from '../lib/router';
import type { FileProperty } from '../lib/types';

/**
 * The property block an artifact starts with, shown as data above the document instead of as a paragraph of
 * `key: value` text. The server has already decided which values are notes in this project, so a value with a path
 * is a link and every other value is plain text — never HTML.
 */
export function Properties(props: { project: string; properties: FileProperty[] }) {
  return (
    <Show when={props.properties.length}>
      <dl class="mb-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-body">
        <For each={props.properties}>
          {(property) => (
            <>
              <dt class="text-muted-foreground">{property.key}</dt>
              <dd class="m-0 flex min-w-0 flex-wrap gap-x-3 break-words">
                <For each={property.values} fallback={<span class="text-muted-foreground">—</span>}>
                  {(value) => (
                    <Show when={value.path} fallback={<span>{value.text}</span>}>
                      {(path) => (
                        <a
                          {...linkProps({ name: 'file', project: props.project, path: path() })}
                          class="text-foreground underline decoration-muted-foreground underline-offset-2 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {value.text}
                        </a>
                      )}
                    </Show>
                  )}
                </For>
              </dd>
            </>
          )}
        </For>
      </dl>
    </Show>
  );
}
