import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import { cn } from '../ui/cn';
import { STATUS_LABELS, statusTone } from '../lib/items';
import type { Progress, Status } from '../lib/types';

/**
 * One panel, and the only shape a list in this app is made of: a head (what the thing is, its state) and a body
 * (the numbers behind it). A run, a task group, a document, a project — four views of the same kind of thing, so
 * one card and no layouts to learn.
 *
 * `as="a"` makes the whole panel the link, which is what a board wants: the row a reader aims at is the thing
 * that opens, not the name inside it.
 */
export function Card(props: {
  as?: 'article' | 'a' | 'div';
  href?: string;
  onClick?: (event: MouseEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  /** Drag support, for a board that files cards between columns. */
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDragEnd?: (event: DragEvent) => void;
  label?: string;
  class?: string;
  /** A lane orders its own rows, so a card on one carries the `order` of its row. */
  style?: JSX.CSSProperties;
  title?: string;
  children: JSX.Element;
}) {
  return (
    <Dynamic
      component={props.as ?? 'article'}
      href={props.href}
      onClick={props.onClick}
      onKeyDown={props.onKeyDown}
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      aria-label={props.label}
      title={props.title}
      style={props.style}
      class={cn(
        // `card` is the hook the board's own stylesheet and the tests reach for: a card on a lane carries an
        // elevation, and there is nowhere else to hang a rule that every card in every lane gets.
        'card',
        'grid content-start gap-1.5 rounded-lg border border-border bg-card p-2.5 text-foreground no-underline',
        // The border and the shadow are two halves of the same hover: a card on a lane is lifted by both, so both
        // move together — and neither moves at all for a reader who asked for less motion.
        props.as === 'a' && 'transition-[color,background-color,border-color,box-shadow] motion-reduce:transition-none hover:border-ring',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        props.class,
      )}
    >
      {props.children}
    </Dynamic>
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