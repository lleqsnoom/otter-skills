import type { JSX } from 'solid-js';

import { cn } from '../ui/cn';
import { STATUS_LABELS, statusTone, type EpicRef } from '../lib/items';
import { linkProps, type Route } from '../lib/router';
import type { Progress, Status } from '../lib/types';

/**
 * One panel, and the only shape a list in this app is made of: a head (what the thing is, its state) and a body
 * (the numbers behind it). A run, a task group, a document, a project — four views of the same kind of thing, so
 * one card and no layouts to learn.
 *
 * One card is one target: the link that covers it is the card's own title (`CardTitle`), stretched over the box by
 * the stylesheet — the only shape a card holding links of its own, an epic and its tasks, could wear.
 */
export function Card(props: {
  onKeyDown?: (event: KeyboardEvent) => void;
  /** Drag support, for a board that files cards between columns. */
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDragEnd?: (event: DragEvent) => void;
  class?: string;
  /** A lane orders its own rows, so a card on one carries the `order` of its row. */
  style?: JSX.CSSProperties;
  title?: string;
  children: JSX.Element;
}) {
  return (
    <article
      onKeyDown={props.onKeyDown}
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      title={props.title}
      style={props.style}
      class={cn(
        // `card` is the hook the board's own stylesheet and the tests reach for: a card on a lane carries an
        // elevation, and there is nowhere else to hang a rule that every card in every lane gets.
        'card',
        'grid content-start gap-1.5 rounded-lg border border-border bg-card p-2.5 text-foreground no-underline',
        // Whether a card opens is asked of the card (`:has`) rather than passed in as a prop: its stretched title is
        // the fact. Both halves of the hover move together, and neither moves for a reader who asked for less motion.
        'has-[.stretched]:hover:border-ring has-[.stretched]:transition-[color,background-color,border-color,box-shadow] has-[.stretched]:motion-reduce:transition-none',
        props.class,
      )}
    >
      {props.children}
    </article>
  );
}

/**
 * A card's title, and the card's one link.
 *
 * The stylesheet stretches it over the panel, so a reader aims at the card and the card is what opens — the space
 * between things included. The links a card holds paint above the stretch and keep their own clicks, which is what
 * leaves the title as the card's one tab stop.
 */
export function CardTitle(props: { to: Route; label?: string; class?: string; children: JSX.Element }) {
  return (
    <h3 class={cn('break-anywhere m-0 text-body font-semibold', props.class)}>
      <a
        {...linkProps(props.to)}
        aria-label={props.label}
        class="stretched text-foreground no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {props.children}
      </a>
    </h3>
  );
}

/** The card's head: what it is on the left, the action at the end. The gap is the head's own, never a margin. */
export function CardHead(props: { children: JSX.Element }) {
  return <header class="flex flex-wrap items-center gap-x-2 gap-y-1">{props.children}</header>;
}

export function CardActions(props: { children: JSX.Element }) {
  return <span class="ml-auto inline-flex flex-wrap items-center justify-end gap-1.5">{props.children}</span>;
}

/** The state of a work item, as a word. The colour only agrees with the word. */
export function StatusBadge(props: { status: Status; class?: string }) {
  return (
    <span
      class={cn(
        'inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px text-chrome font-medium whitespace-nowrap',
        statusTone(props.status),
        props.class,
      )}
      style={{
        background: 'color-mix(in srgb, currentColor 10%, transparent)',
        'border-color': 'color-mix(in srgb, currentColor 25%, transparent)',
      }}
    >
      {STATUS_LABELS[props.status]}
    </span>
  );
}

/** A small chip for a fact about a card: a layer, an effort, the skill that produced it. */
export function Chip(props: { children: JSX.Element; class?: string; title?: string }) {
  return (
    <span
      title={props.title}
      class={cn(
        // `truncate` rather than `whitespace-nowrap`: a chip whose text is a sentence is what makes a card, and
        // then the board, wider than the pane it is in.
        'inline-flex max-w-full min-w-0 items-center truncate rounded-sm bg-muted px-1.5 py-px text-chrome text-muted-foreground',
        props.class,
      )}
    >
      {props.children}
    </span>
  );
}

/**
 * A bar for "how much of this is done". An item with no checklist gets no bar: a bar at zero would read as work
 * that has not started, which is a different claim from one nothing was counted for.
 *
 * The bar is painted in the page's own ink rather than in `--muted`, because a card is not the only surface it
 * lands on: the chosen artifact in a list tints its own background, and a `--muted` track on a `--muted` row is a
 * bar that disappears exactly when the reader has selected the thing it describes. The stylesheet moves both mixes
 * one step for that selected row.
 */
export function ProgressBar(props: { progress: Progress | null; class?: string }) {
  if (!props.progress?.total) return null;
  const percent = Math.round(props.progress.ratio * 100);
  return (
    <div class={cn('flex items-center gap-2', props.class)}>
      <div
        class="progress-track h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={props.progress.total}
        aria-valuenow={props.progress.done}
      >
        <div class="progress-fill h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
      <span class="shrink-0 text-chrome text-muted-foreground tabular-nums">
        {props.progress.done}/{props.progress.total}
      </span>
    </div>
  );
}

/**
 * The epic a task belongs to, as a pill in the epic's own colour.
 *
 * It is a label and not a link, deliberately: a card is one link, and a link inside a link is not one. What a task
 * needs is the answer to "which epic is this?" — the epic's own page is where its tasks are worked, and the epic's
 * card is where they are listed.
 */
export function EpicPill(props: { epic: EpicRef; class?: string }) {
  return (
    <span
      title={`Epic · ${props.epic.title}`}
      class={cn(
        'inline-flex max-w-[22ch] min-w-0 items-center rounded-sm border px-1.5 py-px text-chrome font-medium',
        props.class,
      )}
      style={{
        color: props.epic.color,
        background: 'color-mix(in srgb, currentColor 10%, transparent)',
        'border-color': 'color-mix(in srgb, currentColor 25%, transparent)',
      }}
    >
      <span class="truncate">{props.epic.title}</span>
    </span>
  );
}

/** One number a screen leads with. */
export function Stat(props: { value: JSX.Element; label: string; class?: string }) {
  return (
    <div class={cn('grid gap-0.5', props.class)}>
      <span class="text-title font-semibold leading-none tabular-nums">{props.value}</span>
      <span class="text-chrome text-muted-foreground">{props.label}</span>
    </div>
  );
}

export function Empty(props: { children: JSX.Element }) {
  return <p class="text-muted-foreground italic">{props.children}</p>;
}