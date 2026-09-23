import { For, Show } from 'solid-js';

import { routeForPath } from '../lib/items';
import type { FileRef, Project } from '../lib/types';
import { Chip } from './Card';

/**
 * What a document read.
 *
 * An artifact names the ones it came from — `**Input:** …/E00-analysis.md`, `spec:`, `plan:` — and that is the only
 * direction a document writes down: the plan names the analysis, never the other way round. Rendering them where the
 * document is read answers "where did this come from" where the question is asked, and each chip opens the artifact
 * it names.
 *
 * It is drawn on both surfaces a document has, because the pair of them is one reading: a loose document on its own
 * address, and an artifact on the page of the collection that holds it.
 */
export function Reads(props: { project: Project; file: FileRef }) {
  return (
    <Show when={props.file.links.length}>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="text-chrome text-muted-foreground">reads</span>
        <For each={props.file.links}>
          {(link) => (
            <Chip
              to={routeForPath(props.project, link.path)}
              title={`named ${link.label} by this document`}
              class="gap-1"
            >
              <span>{link.label}</span>
              <span class="text-foreground">{link.name}</span>
            </Chip>
          )}
        </For>
      </div>
    </Show>
  );
}
