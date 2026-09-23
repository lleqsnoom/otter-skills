import { createMemo, Show } from 'solid-js';

import { itemsForProject, locateFile } from '../lib/items';
import type { Project } from '../lib/types';
import { Artifact } from './Artifact';
import { TaskList } from './Board';
import { Breadcrumbs, rootCrumb, type Crumb } from './Breadcrumbs';
import { EpicPill } from './Card';

/**
 * One artifact, on its own address.
 *
 * The trail is resolved from the snapshot rather than from the path string: `/f/<project>/<path>` knows the file,
 * and `locateFile` says which category and which collection it came from — so a file opened straight from a search
 * result still shows the run it belongs to, which is the one thing the address alone cannot say.
 *
 * Two facts about the document itself are read above it, because they are the questions a reader arrives with: the
 * epic a task belongs to is the pill beside the trail, and the tasks an epic holds are listed under it. Both read
 * the card the board draws, so a page and a board cannot disagree about whose work this is.
 */
export function FileView(props: { project: Project; path: string; onSaved?: () => void }) {
  const card = createMemo(() => itemsForProject(props.project).find((item) => item.relPath === props.path) ?? null);
  const epic = createMemo(() => (card()?.isEpic ? null : (card()?.epic ?? null)));
  const tasks = createMemo(() => (card()?.isEpic ? (card()?.tasks ?? []) : []));

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
      <div class="flex flex-wrap items-center gap-2">
        <Breadcrumbs trail={trail()} />
        <Show when={epic()}>{(ref) => <EpicPill epic={ref()} />}</Show>
      </div>

      <Show when={tasks().length}>
        <section class="grid gap-1.5 rounded-lg border border-border bg-card p-2.5">
          <h2 class="m-0 border-0 p-0 text-section font-medium">
            Tasks <span class="text-chrome font-normal text-muted-foreground tabular-nums">{tasks().length}</span>
            <Show when={card()?.progress?.total}>
              <span class="text-chrome font-normal text-muted-foreground tabular-nums">
                {' '}
                · {card()?.progress?.done}/{card()?.progress?.total} done
              </span>
            </Show>
          </h2>
          <TaskList tasks={tasks()} />
        </section>
      </Show>

      <Show when={!located()}>
        <p class="break-anywhere m-0 text-chrome text-muted-foreground">{props.path}</p>
      </Show>

      <Artifact project={props.project.id} path={props.path} onSaved={props.onSaved} />
    </div>
  );
}