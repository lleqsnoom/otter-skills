import { For, Show } from 'solid-js';

import { countLabel } from '../lib/api';
import { liveItems as liveItemsIn } from '../lib/board.mjs';
import { itemsForProject, relativeTime, statusCounts, type WorkItem } from '../lib/items';
import { linkProps } from '../lib/router';
import type { BoardDeletions, Project, Snapshot } from '../lib/types';
import { Breadcrumbs, rootCrumb } from './Breadcrumbs';
import { Card, CardHead, Chip, Empty, Stat, StatusBadge } from './Card';
import { ProjectIcon } from './ProjectIcon';

/** One project: what the IDE calls it, how much is in it, and where the board stands without opening it. */
function ProjectCard(props: { project: Project; deletions: BoardDeletions }) {
  // The overview counts the same work a project's own board does: an item the reader archived is not part of it.
  const liveItems = (items: WorkItem[]) => liveItemsIn(items, props.deletions);
  const counts = () => statusCounts(liveItems(itemsForProject(props.project)));
  return (
    <Card as="a" {...linkProps({ name: 'project', project: props.project.id })} label={props.project.name}>
      <CardHead>
        <ProjectIcon project={props.project} size="lead" />
        <h3 class="m-0 text-body font-semibold">{props.project.name}</h3>
        <Show when={counts().active}>
          <StatusBadge status="active" class="ml-auto" />
        </Show>
      </CardHead>
      <p class="break-anywhere m-0 text-chrome text-muted-foreground">{props.project.repoPath}</p>
      <Show when={props.project.about}>
        <p class="break-anywhere m-0 text-chrome text-muted-foreground">{props.project.about}</p>
      </Show>
      <div class="flex flex-wrap gap-x-4 gap-y-2 pt-1">
        <Stat value={props.project.totals.files} label="artifacts" />
        <Stat value={props.project.totals.groups} label="collections" />
        <Stat value={counts().active} label="in progress" />
        <Stat value={counts().todo} label="to do" />
      </div>
      <div class="flex flex-wrap gap-1 pt-1">
        <For each={props.project.categories.slice(0, 8)}>
          {(category) => (
            <Chip title={category.label}>
              {category.id} · {category.counts.files}
            </Chip>
          )}
        </For>
      </div>
    </Card>
  );
}

/** The newest work in any project, which is the one thing the overview is for. */
function RecentCard(props: { item: WorkItem & { projectName: string } }) {
  return (
    <Card
      as="a"
      {...linkProps(
        props.item.kind === 'group'
          ? { name: 'group', project: props.item.projectId, group: props.item.relPath }
          : { name: 'file', project: props.item.projectId, path: props.item.relPath },
      )}
    >
      <CardHead>
        <StatusBadge status={props.item.status} />
        <span class="text-chrome text-muted-foreground">{props.item.projectName}</span>
        <span class="ml-auto text-chrome text-muted-foreground">
          {relativeTime(props.item.date || props.item.mtime)}
        </span>
      </CardHead>
      <h3 class="break-anywhere m-0 text-body font-semibold">{props.item.title}</h3>
      <p class="m-0 text-chrome text-muted-foreground">{props.item.categoryLabel}</p>
    </Card>
  );
}

/** Where the projects came from, and what the IDE said — the one thing a reader cannot get from the cards. */
function SourcePanel(props: { snapshot: Snapshot }) {
  return (
    <section class="grid gap-2">
      <h2 class="m-0 border-0 p-0 text-section font-medium">Where the projects come from</h2>
      <p class="m-0 text-chrome text-muted-foreground">
        <Show
          when={props.snapshot.orca.enabled}
          fallback={
            <>
              Roots come from <code>otter-pm.config.json</code>, <code>--root</code> and <code>$OTTER_PM_ROOTS</code>.
              Turning on <code>orca</code> in the config keeps the list in step with the Orca IDE instead.
            </>
          }
        >
          {props.snapshot.orca.roots} of {props.snapshot.orca.listed} repositories in the Orca IDE, read from{' '}
          <code class="break-anywhere">{props.snapshot.orca.file}</code>
          <Show when={props.snapshot.skipped.length}>
            {' '}
            · {props.snapshot.skipped.length} without a <code>.x-skills</code>
          </Show>
          .
        </Show>
      </p>
      <Show when={props.snapshot.orca.enabled && props.snapshot.orca.reason}>
        <p class="m-0 text-chrome text-fair">Orca said: {props.snapshot.orca.reason}</p>
      </Show>
      <ul class="m-0 grid gap-1 pl-4 text-chrome text-muted-foreground">
        <For each={props.snapshot.roots}>{(root) => <li class="break-anywhere">{root}</li>}</For>
      </ul>
      <p class="m-0 text-chrome text-muted-foreground">
        Add a project the IDE does not have with <code>+ add existing</code> in the rail, <code>--root &lt;path&gt;</code>,
        or a <code>roots</code> entry in <code>otter-pm.config.json</code>; every one of them is used alongside the
        IDE's list.
      </p>
    </section>
  );
}

/**
 * The front screen: every root the server found, and what is in it. Three sections, one component each — the
 * projects, the newest work across them, and where the list came from.
 */
export function Overview(props: { snapshot: Snapshot }) {
  const recent = () => {
    const items = props.snapshot.projects.flatMap((project) =>
      liveItemsIn(itemsForProject(project), props.snapshot.deletions)
        .slice(0, 6)
        .map((item) => ({ ...item, projectName: project.name })),
    );
    return items.sort((a, b) => String(b.date || b.mtime).localeCompare(String(a.date || a.mtime))).slice(0, 12);
  };

  return (
    <div class="grid gap-6">
      <header class="grid gap-1.5">
        <Breadcrumbs trail={[rootCrumb(true)]} />
        <h1>Otter PM</h1>
        <p class="m-0 text-muted-foreground">
          {countLabel(props.snapshot.projects.length, 'project')} ·{' '}
          {countLabel(
            props.snapshot.projects.reduce((total, project) => total + project.totals.files, 0),
            'artifact',
          )}{' '}
          · refreshed {relativeTime(props.snapshot.generatedAt)}
        </p>
      </header>

      <Show when={props.snapshot.failures.length || props.snapshot.rejected.length}>
        <Card class="border-fair">
          <CardHead>
            <StatusBadge status="active" />
            <span class="text-body font-medium">Roots that were not read</span>
          </CardHead>
          <ul class="m-0 grid gap-1 pl-4 text-chrome text-muted-foreground">
            <For each={props.snapshot.failures}>
              {(failure) => (
                <li class="break-anywhere">
                  {failure.root}: {failure.error}
                </li>
              )}
            </For>
            <For each={props.snapshot.rejected}>
              {(candidate) => <li class="break-anywhere">{candidate} does not look like a .x-skills root</li>}
            </For>
          </ul>
        </Card>
      </Show>

      <section class="grid gap-3">
        <h2 class="m-0 border-0 p-0 text-section font-medium">Projects</h2>
        <Show when={props.snapshot.projects.length} fallback={<Empty>No .x-skills roots were found.</Empty>}>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <For each={props.snapshot.projects}>
              {(project) => <ProjectCard project={project} deletions={props.snapshot.deletions} />}
            </For>
          </div>
        </Show>
      </section>

      <section class="grid gap-3">
        <h2 class="m-0 border-0 p-0 text-section font-medium">Newest across projects</h2>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <For each={recent()}>{(item) => <RecentCard item={item} />}</For>
        </div>
      </section>

      <SourcePanel snapshot={props.snapshot} />
    </div>
  );
}
