import { createMemo, Show } from 'solid-js';

import { locateFile } from '../lib/items';
import type { Project } from '../lib/types';
import { Artifact } from './Artifact';
import { Breadcrumbs, rootCrumb, type Crumb } from './Breadcrumbs';
import { Related } from './Related';

/**
 * One artifact, on its own address.
 *
 * The trail is resolved from the snapshot rather than from the path string: `/f/<project>/<path>` knows the file,
 * and `locateFile` says which category and which collection it came from — so a file opened straight from a search
 * result still shows the run it belongs to, which is the one thing the address alone cannot say.
 *
 * Below the document, `Related` answers the two questions the trail cannot: which run numbered this artifact and
 * which rungs sit beside it, and which artifacts this one names.
 */
export function FileView(props: { project: Project; path: string; onSaved?: () => void }) {
  const located = createMemo(() => locateFile(props.project, props.path));

  const trail = createMemo<Crumb[]>(() => {
    const found = located();
    const crumbs: Crumb[] = [
      rootCrumb(),
      { label: props.project.name, to: { name: 'project', project: props.project.id } },
    ];
    if (found) {
      crumbs.push({
        label: found.category.label,
        to: { name: 'category', project: props.project.id, category: found.category.id },
      });
      if (found.group) {
        crumbs.push({
          label: found.group.title,
          to: { name: 'group', project: props.project.id, group: found.group.relPath },
        });
      }
    }
    crumbs.push({ label: props.path.split('/').pop() ?? props.path });
    return crumbs;
  });

  return (
    <div class="grid gap-4">
      <Breadcrumbs trail={trail()} />

      <Show when={!located()}>
        <p class="break-anywhere m-0 text-chrome text-muted-foreground">{props.path}</p>
      </Show>

      <Artifact project={props.project.id} path={props.path} onSaved={props.onSaved} />

      <Related project={props.project} path={props.path} />
    </div>
  );
}