import { createMemo, For, Show } from 'solid-js';

import { isDeleted } from '../lib/board.mjs';
import { epicIndex, epicOfTasks } from '../lib/epics.mjs';
import { formatDate, relativeTime } from '../lib/items';
import { navigate, routeGroupFile } from '../lib/router';
import type { BoardDeletions, FileRef, Group, Project } from '../lib/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Artifact } from './Artifact';
import { Breadcrumbs, rootCrumb } from './Breadcrumbs';
import { EpicPill, ProgressBar, StatusBadge } from './Card';

const PREFERRED = ['plan', 'analysis', 'epic', 'summary', 'investigate', 'triage', 'review', 'reflection', 'doc'];

function preferredFirst(files: FileRef[]): FileRef[] {
  // An unknown kind ranks after every known one, so `questions.md` cannot open ahead of the plan it belongs to.
  const rank = (file: FileRef) => {
    const index = PREFERRED.indexOf(file.kind);
    return index === -1 ? PREFERRED.length : index;
  };
  return files.filter((file) => file.isMarkdown).sort((a, b) => rank(a) - rank(b));
}

/**
 * A run's artifacts as the run built them: the numbered stages first, in `E<nn>` order, and everything that is not
 * a stage after them. "A plain name sort lists the run in the order it was built" is what the skills promise, and
 * the `E<nn>` is the part of the name that keeps it — a benchmark beside a plan is not a rung of anything, so it
 * stays where it was.
 */
function ladderOrder(files: FileRef[]): FileRef[] {
  const staged = files.filter((file) => file.step !== null).sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  return [...staged, ...files.filter((file) => file.step === null)];
}

function RunStatePanel(props: { group: Group }) {
  const state = () => props.group.state;
  return (
    <Show when={state()}>
      {(value) => (
        <section class="grid gap-2 rounded-lg border border-border bg-card p-2.5">
          <header class="flex flex-wrap items-center gap-2">
            <h2 class="m-0 border-0 p-0 text-section font-medium">Workflow state</h2>
            {/* A state file that cannot be read is the one thing this panel is for, so it is said here rather than
                left as an empty panel with no reason on it. */}
            <Show when={value().error}>
              <Badge tone="weak">unreadable</Badge>
            </Show>
            <Show when={!value().error && value().skill}>
              <Badge tone="unknown">{value().skill}</Badge>
            </Show>
            <Show when={!value().error && value().node}>
              <Badge tone={value().finished ? 'good' : 'fair'}>
                {value().finished ? 'finished' : 'at'} {value().node}
              </Badge>
            </Show>
            <Show when={!value().error}>
              <span class="ml-auto text-chrome text-muted-foreground">
                {value().events ?? 0} events · {relativeTime(value().updatedAt || null)}
              </span>
            </Show>
          </header>

          <Show when={value().error}>
            <p class="m-0 text-chrome text-weak">
              {value().error} — the run's own record of itself is not readable, so the fields below are empty.
            </p>
          </Show>

          <Show when={value().goal}>
            <p class="m-0 text-body">{value().goal}</p>
          </Show>

          <Show when={value().guardsTotal}>
            <p class="m-0 text-chrome text-muted-foreground">
              guards {value().guardsPassed}/{value().guardsTotal} passed
            </p>
          </Show>

          <Show when={value().decision}>
            {(decision) => (
              <p class="m-0 text-chrome">
                <span class="text-muted-foreground">decision · </span>
                {decision().summary}
              </p>
            )}
          </Show>

          <Show when={value().options?.length}>
            <details class="grid gap-1">
              <summary class="cursor-pointer text-chrome text-muted-foreground">
                {value().options?.length} options considered
              </summary>
              <ol class="m-0 grid gap-1 pl-5 pt-1 text-chrome text-muted-foreground">
                <For each={value().options}>{(option) => <li>{option.summary}</li>}</For>
              </ol>
            </details>
          </Show>

          <Show when={value().questions?.length}>
            <details class="grid gap-1">
              <summary class="cursor-pointer text-chrome text-muted-foreground">
                {value().questions?.length} questions
                <Show when={value().openQuestions}> · {value().openQuestions} open</Show>
              </summary>
              <dl class="m-0 grid gap-1.5 pt-1">
                <For each={value().questions}>
                  {(question) => (
                    <div class="grid gap-0.5 border-t border-border pt-1">
                      <dt class="text-body">
                        <span class="text-muted-foreground">{question.id} · </span>
                        {question.text}
                      </dt>
                      <dd class="m-0 pl-4 text-chrome text-muted-foreground">
                        {question.status === 'answered' ? question.answer : 'unanswered'}
                      </dd>
                    </div>
                  )}
                </For>
              </dl>
            </details>
          </Show>
        </section>
      )}
    </Show>
  );
}

function ArtifactList(props: {
  group: Group;
  selected: string | null;
  onSelect: (file: FileRef) => void;
}) {
  return (
    <section class="grid gap-1.5">
      <h2 class="m-0 border-0 p-0 text-section font-medium">
        Artifacts <span class="text-chrome font-normal text-muted-foreground">{props.group.files.length}</span>
      </h2>
      <ul class="m-0 grid list-none gap-1 p-0">
        <For each={ladderOrder(props.group.files)}>
          {(file) => (
            <li>
              <button
                type="button"
                class={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1.5 text-left ${
                  props.selected === file.relPath
                    ? 'border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] bg-muted'
                    : 'border-border bg-card hover:bg-muted'
                }`}
                data-selected={props.selected === file.relPath ? 'true' : undefined}
                onClick={() => props.onSelect(file)}
              >
                <span class="break-anywhere text-body">{file.name}</span>
                <span class="flex flex-wrap items-center justify-end gap-1">
                  {/* The rung before the kind: `E00` and `plan` together are what makes the run read in order. */}
                  <Show when={file.step !== null}>
                    <Badge tone="unknown">E{String(file.step).padStart(2, '0')}</Badge>
                  </Show>
                  <Badge tone="unknown">{file.kind}</Badge>
                  <Show when={file.layer !== null}>
                    <Badge tone="unknown">L{file.layer}</Badge>
                  </Show>
                </span>
                <Show when={file.progress?.total}>
                  <ProgressBar progress={file.progress} class="col-span-2" />
                </Show>
                <Show when={!file.progress?.total && file.excerpt}>
                  <span class="col-span-2 line-clamp-1 text-chrome text-muted-foreground">{file.excerpt}</span>
                </Show>
              </button>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

/** A run or a task collection: its workflow state on the left, one artifact open on the right. */
export function GroupDetail(props: {
  project: Project;
  groupPath: string;
  /** The artifact to open, when the caller already knows it — a file's old address answered as the page that holds it. */
  file?: string;
  onSaved?: () => void;
  deletions: BoardDeletions;
  onDelete?: (relPath: string, deleted: boolean) => void;
}) {
  const found = createMemo(() => {
    for (const category of props.project.categories) {
      const group = category.groups.find((candidate) => candidate.relPath === props.groupPath);
      if (group) return { group, category };
    }
    return null;
  });

  /**
   * The epic a task collection belongs to, when the collection is task work — the same link its own files wear, read
   * from the folder. A run is not task work, so a run's page names no epic even when the run numbered one.
   */
  const epic = createMemo(() => {
    const match = found();
    if (match?.category.work !== 'task') return null;
    return epicOfTasks(epicIndex(props.project.categories), match.group);
  });

  // The collection itself is the entry a reader made; the artifacts inside it are only covered by it.
  const deleted = createMemo(() => isDeleted({ projectId: props.project.id, relPath: props.groupPath }, props.deletions));

  /**
   * What the panel has open: the artifact the address names, or the one the collection leads with. The address is the
   * only place the choice is kept, so what a reader copies is what they were reading, and the back button returns to
   * the page they arrived from rather than to the artifact they had open on the way.
   */
  const selected = createMemo(() => {
    const match = found();
    if (!match) return null;
    const named = props.file ?? routeGroupFile();
    if (named) return match.group.files.find((file) => file.relPath === named) ?? null;
    return preferredFirst(match.group.files)[0] ?? match.group.files[0] ?? null;
  });

  /**
   * The address names the artifact on screen, because a collection's page is the only address an artifact inside it
   * has. Replacing rather than pushing keeps the back button on the page the reader arrived from instead of on every
   * artifact they clicked through on the way.
   */
  const choose = (file: FileRef) => {
    navigate({ name: 'group', project: props.project.id, group: props.groupPath, file: file.relPath }, { replace: true });
  };

  return (
    <Show
      when={found()}
      fallback={<p class="text-muted-foreground italic">This collection is not in the current snapshot.</p>}
    >
      {(match) => (
        <div class="grid gap-5">
          <header class="grid gap-1.5">
            <Breadcrumbs
              trail={[
                rootCrumb(),
                { label: props.project.name, to: { name: 'project', project: props.project.id } },
                {
                  label: match().category.label,
                  to: { name: 'category', project: props.project.id, category: match().category.id },
                },
                { label: match().group.title },
              ]}
            />
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="break-anywhere">{match().group.title}</h1>
              <Show when={epic()}>{(ref) => <EpicPill epic={ref()} />}</Show>
              <StatusBadge status={match().group.status} />
              <Show when={match().group.state?.skill}>
                <Badge tone="unknown">{match().group.state?.skill}</Badge>
              </Show>
              <Show when={deleted()}>
                <Badge tone="fair" title="Off the board; its artifacts are untouched">
                  archived
                </Badge>
              </Show>
              <Show when={props.onDelete}>
                <Button
                  size="chip"
                  variant="quiet"
                  class="ml-auto"
                  title={deleted() ? 'bring it, and everything inside it, back to the board' : 'keep it off the board without touching its files'}
                  onClick={() => props.onDelete?.(match().group.relPath, deleted())}
                >
                  {deleted() ? 'unarchive' : 'archive'}
                </Button>
              </Show>
            </div>
            <p class="break-anywhere m-0 text-chrome text-muted-foreground">
              {match().group.relPath} · {formatDate(match().group.date || match().group.mtime)}
            </p>
            <Show when={match().group.progress?.total}>
              <ProgressBar progress={match().group.progress} class="max-w-96" />
            </Show>
          </header>

          <div class="grid items-start gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <div class="grid content-start gap-4">
              <RunStatePanel group={match().group} />
              <ArtifactList group={match().group} selected={selected()?.relPath ?? null} onSelect={choose} />
            </div>

            <div class="grid content-start gap-4">
              <Show when={selected()} fallback={<p class="text-muted-foreground italic">No readable file here.</p>}>
                {/* No archive button in this panel: on a collection's page the header carries the only one, because a
                    second inside the document archives just the file and leaves the run on the board looking unchanged. */}
                {(file) => (
                  <Artifact project={props.project.id} path={file().relPath} onSaved={props.onSaved} canArchive={false} />
                )}
              </Show>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}