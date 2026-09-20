import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "./cn";

/**
 * A native select, wearing the app's field recipe.
 *
 * No Kobalte equivalent is used here on purpose: a handful of fixed options read better in the platform's own
 * control (a phone opens its own picker), and the only thing this app has to add is the field's height, border and
 * focus ring, so it is the same object as the input beside it.
 *
 * The surface and the list are painted explicitly. A transparent select hands the browser its own white, and the
 * page's ink on top of it is unreadable in a dark theme — which is what the license list was.
 */
export function Select(props: ComponentProps<"select">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <select
      {...rest}
      class={cn(
        "h-7 w-full min-w-0 max-w-96 rounded-md border border-input bg-card px-2 text-chrome text-foreground",
        "[&_option]:bg-card [&_option]:text-foreground",
        "focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "max-[860px]:h-11 max-[860px]:text-base",
        local.class
      )}
    />
  );
}