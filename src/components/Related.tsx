import { createMemo, For, Show } from 'solid-js';

import { chainFor } from '../lib/chain.mjs';
import { linkProps, type Route } from '../lib/router';
import type { Project } from '../lib/types';
import { Chip } from './Card';

/**
 * What an artifact is joined to, and how to get there.
 *
 * The skills leave a pipeline in the tree: a run numbers its artifacts `E00…E09`, and a skill that read the previous
 * rung names its path in what it writes (`**Input:** .x-skills/runs/<run>/E00-analysis.md`). Both are edges of one
 * graph, and the pipeline a reader thinks in — analysis, plan, epic, tasks — is the component those edges connect,
 * which is usually *two runs*: `x-analyze` writes the analysis into its own run and `x-plan` opens the next one.
 *
 * So this panel answers one question from any view — which artifacts are part of this work — and `chain.mjs` is
 * where that is decided (`chainFor`), including the direction no artifact records: an analysis names nothing, and
 * the plan that read it is how you find what it led to.
 */
export function Related(props: { project: Project; path: string }) {
  const chain = createMemo(() => chainFor(props.project, props.path));

  return (
    <Show when={chain().run || chain().entries.length > 1}>
      <section class="grid gap-2 rounded-lg border border-border bg-card p-2.5">
        <h2 class="m-0 border-0 p-0 text-section font-medium">Related</h2>

        <Show when={chain().run}>
          {(run) => (
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span class="text-chrome text-muted-foreground">Run</span>
              <a {...linkProps({ name: 'group', project: props.project.id, group: run().relPath })}>{run().title}</a>
              <span class="break-anywhere text-chrome text-muted-foreground">{run().relPath}</span>
            </div>
          )}
        </Show>

        <div class="grid gap-1">
          <span class="text-chrome text-muted-foreground">
            Chain <span class="text-muted-foreground/70">— everything this work is made of, in the order it was built</span>
          </span>
          <ul class="m-0 grid list-none gap-1 p-0">
            <For each={chain().entries}>{(entry) => <ChainEntry project={props.project} entry={entry} />}</For>
          </ul>
          <Show when={chain().hidden}>
            <p class="m-0 text-chrome text-muted-foreground">
              {chain().hidden} more related {chain().hidden === 1 ? 'artifact' : 'artifacts'} — open the run above to
              see them all.
            </p>
          </Show>
        </div>
      </section>
    </Show>
  );
}

/** How many of a folder rung's files are listed before the rest are left to the collection's own page. */
const CHILDREN_SHOWN = 12;

function ChainEntry(props: { project: Project; entry: ReturnType<typeof chainFor>['entries'][number] }) {
  const entry = () => props.entry;
  // The entry carries where to open it, not where it is: a rung with no collection of its own is browsed at its run.
  const route = (): Route =>
    entry().isDirectory
      ? { name: 'group', project: props.project.id, group: entry().open }
      : { name: 'file', project: props.project.id, path: entry().open };

  return (
    <li class="grid gap-0.5">
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Show when={entry().step !== null}>
          <Chip title={`E${String(entry().step).padStart(2, '0')} of this run`}>
            E{String(entry().step).padStart(2, '0')}
          </Chip>
        </Show>
        <span class="text-chrome text-muted-foreground">{entry().kind}</span>
        {/* The artifact being read is a line of its own chain, marked rather than linked: a link to where you are
            reads as somewhere else to go. */}
        <Show
          when={!entry().current}
          fallback={
            <>
              <span class="break-anywhere text-body">{entry().title}</span>
              <Chip title="the artifact you are reading">this one</Chip>
            </>
          }
        >
          <a {...linkProps(route())} class="break-anywhere" title={entry().path}>
            {entry().title}
          </a>
        </Show>
        <Show when={entry().isDirectory}>
          <span class="text-chrome text-muted-foreground">{entry().children.length} files</span>
        </Show>
        {/* Which way the work flowed, which no name in the tree says: this artifact read that one, or was read by it. */}
        <Show when={entry().relation}>
          <span class="text-chrome text-muted-foreground">
            named <span class="text-foreground">{entry().relation}</span> by {nameOf(entry().from)}
          </span>
        </Show>
      </div>

      <Show when={entry().isDirectory}>
        <StageChildren project={props.project} entry={entry()} route={route()} />
      </Show>
    </li>
  );
}

/** The files a folder rung is made of, listed under it — `E02-tasks/` *is* the tasks, so they are read here. */
function StageChildren(props: { project: Project; entry: ReturnType<typeof chainFor>['entries'][number]; route: Route }) {
  const shown = () => props.entry.children.slice(0, CHILDREN_SHOWN);
  const rest = () => props.entry.children.length - CHILDREN_SHOWN;

  return (
    <Show when={shown().length}>
      <ul class="m-0 grid list-none gap-0.5 border-l border-border pl-3">
        <For each={shown()}>
          {(file) => (
            <li>
              <a
                {...linkProps({ name: 'file', project: props.project.id, path: file.relPath })}
                class="break-anywhere text-chrome"
              >
                {file.name}
              </a>
            </li>
          )}
        </For>
        <Show when={rest() > 0}>
          <li class="text-chrome text-muted-foreground">
            <a {...linkProps(props.route)} class="text-muted-foreground">
              + {rest()} more in this stage
            </a>
          </li>
        </Show>
      </ul>
    </Show>
  );
}

/** The artifact that named something, as the file name a reader would recognise. */
function nameOf(from: string | null): string {
  if (!from) return 'this artifact';
  return from.split('/').filter(Boolean).pop() ?? from;
}
