import { ToggleGroup as Kobalte } from "@kobalte/core/toggle-group";
import { For } from "solid-js";
import { cn } from "./cn";

/**
 * One control, not two buttons: a segmented switch for a small set of mutually exclusive views.
 *
 * Kobalte's `ToggleGroup` is what the hand-written version got wrong — two buttons in a wrapping row sit flush
 * against each other as soon as the row is tight, and a reader cannot tell a gap from a border. It brings the
 * behaviour for free (one track, one chosen segment, roving focus, `aria-pressed`, arrow keys between them).
 *
 * The *look* is the app's chip, not a track of its own: the same hairline, the same card surface, the same
 * `--accent` tint for the chosen segment that a chosen filter chip wears. Two controls in one toolbar that were
 * built to different recipes read as two toolbars, which is what this was. The track wears the chip's own height
 * (`min-h-6`, and 44px in a phone pane) and each segment fills it, so the switch and the buttons beside it are
 * the same height wherever they are put.
 */
export function ToggleGroup<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  class?: string;
}) {
  return (
    <Kobalte
      value={props.value}
      onChange={(next) => next && props.onChange(next as T)}
      class={cn(
        // The chip's own height, so the switch and the buttons beside it agree at any zoom — a 150% pane renders a
        // 1px border as 0.67px, which is enough to make a `min-height` and a `height` disagree.
        "inline-flex min-h-6 shrink-0 items-center gap-0.5 rounded-md border border-border bg-card p-px",
        "max-[860px]:min-h-11",
        props.class
      )}
      aria-label={props.label}
    >
      <For each={props.options}>
        {(option) => (
          <Kobalte.Item
            value={option.value}
            title={option.title}
            class={cn(
              // `self-stretch` is what makes the height a fact rather than an agreement: the segment fills whatever
              // the track resolved to, so the two cannot disagree by a padding or a border anywhere.
              "inline-flex shrink-0 items-center justify-center self-stretch rounded-sm px-2 text-chrome font-normal",
              "text-muted-foreground whitespace-nowrap",
              "hover:bg-muted hover:text-foreground",
              "data-[pressed]:bg-accent data-[pressed]:font-semibold data-[pressed]:text-accent-foreground",
              "data-[pressed]:hover:bg-accent",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            )}
          >
            {option.label}
          </Kobalte.Item>
        )}
      </For>
    </Kobalte>
  );
}
