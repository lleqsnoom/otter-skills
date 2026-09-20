import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Class names, with the last one winning: `cn("px-2", props.class)` lets a caller override a component's own
 * padding without `!important` and without the component knowing which utilities it set. `clsx` joins the
 * conditional parts, `twMerge` resolves the conflicts in Tailwind's own grammar (`px-2` + `px-3` = `px-3`).
 *
 * The merge has to be told one thing about this app that Tailwind's defaults cannot know: the four type sizes are
 * theme keys (`--text-title`, `--text-section`, `--text-body`, `--text-chrome`), so `text-chrome` is a *size*,
 * not a colour. Left as a guess, `cn("… text-chrome … text-foreground")` resolves the two as one text group and
 * drops the size for the colour — so every button and every segment of a switch rendered at the inherited 14px
 * instead of 12px, which is the sort of thing that makes two controls look like they came from different apps.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["title", "section", "body", "chrome"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
