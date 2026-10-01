import { Show } from 'solid-js';

import type { Complexity } from '../lib/items';

const DOTS: Record<Complexity, string> = { clear: '🟢', complicated: '🟡', complex: '🔴' };

/** How much of a task is unknown, as a dot and its word: the colour reads at a glance, the word says it to everyone. */
export function ComplexityMark(props: { complexity: Complexity | null; class?: string }) {
  return (
    <Show when={props.complexity}>
      {(complexity) => (
        <span class={`inline-flex items-center gap-1 whitespace-nowrap text-chrome text-muted-foreground ${props.class ?? ''}`}>
          <span aria-hidden="true">{DOTS[complexity()]}</span>
          {complexity()}
        </span>
      )}
    </Show>
  );
}
