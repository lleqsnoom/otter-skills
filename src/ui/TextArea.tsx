import { splitProps, type ComponentProps } from "solid-js";
import { cn } from "./cn";

/**
 * A multi-line field, on the app's tokens.
 *
 * The same recipe as `Input`, so a form whose fields are different shapes still reads as one form: one border, one
 * focus ring, one radius, and 16px at a phone width so a phone does not zoom when the field takes focus. `resize-y`
 * because a reader writing what a project is about is the one who knows how much room the sentence needs.
 */
export function TextArea(props: ComponentProps<"textarea">) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <textarea
      {...rest}
      class={cn(
        "min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-chrome text-foreground",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "max-[860px]:text-base",
        local.class
      )}
    />
  );
}