import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import type { Project } from '../lib/types';
import { cn } from '../ui/cn';
import { FolderIcon, ICON_BY_ID } from './icons';

/** A project names one of the app's marks as `icon:<id>`; anything else it carries is text to draw. */
const NAMED_MARK = /^icon:([a-z0-9-]+)$/i;

/**
 * A project's mark, the way the IDE draws it.
 *
 * Two sources agree here. A project made in this app describes itself — `.x-skills/project.md` carries an image
 * URL, a short text and a colour — and the Orca store gives the repositories the IDE knows a GitHub avatar and a
 * badge tint. The project's own mark is drawn first, then the IDE's, then the name's initial, then the folder:
 * a project with no mark of its own looks exactly as it did before there was anywhere to put one.
 *
 * `loading="lazy"` and `referrerpolicy="no-referrer"` because these are remote images — the only request this app
 * makes off the machine — and an offline machine falls back to the initial.
 */
export function ProjectIcon(props: {
  project: Pick<
    Project,
    'id' | 'name' | 'icon' | 'iconLabel' | 'badgeColor' | 'iconText' | 'color' | 'iconSrc' | 'iconFile'
  >;
  size?: 'chip' | 'lead';
  class?: string;
}) {
  const size = () => (props.size === 'lead' ? 'h-5 w-5' : 'h-4 w-4');
  /** An image the project carries is served from inside it, so a clone shows the same mark as the machine that made it. */
  const asset = () => {
    const relPath = props.project.iconFile;
    if (!relPath) return null;
    return `/api/asset?${new URLSearchParams({ project: props.project.id, path: relPath })}`;
  };
  const image = () => props.project.iconSrc ?? asset() ?? props.project.icon;
  /**
   * A picture the project was given is the mark on its own, so nothing is painted behind it: a transparent image on
   * a tinted tile reads as two things. A tint is for a glyph — the IDE's badge colour behind its avatar, the
   * project's own colour behind an emoji or a letter — and never for a photograph.
   */
  const own = () => props.project.iconSrc ?? asset();
  const tint = () => (own() ? null : (props.project.color ?? props.project.badgeColor ?? null));
  const mark = () => {
    const match = NAMED_MARK.exec(props.project.iconText ?? '');
    return match ? (ICON_BY_ID[match[1].toLowerCase()] ?? null) : null;
  };
  const glyph = () => (mark() || !props.project.iconText ? null : props.project.iconText.slice(0, 2));

  return (
    <span
      class={cn('inline-grid shrink-0 place-items-center overflow-hidden rounded-sm', size(), props.class)}
      style={
        tint()
          ? {
              background: `color-mix(in srgb, ${tint()} 18%, transparent)`,
              'box-shadow': `inset 0 0 0 1px color-mix(in srgb, ${tint()} 35%, transparent)`,
            }
          : undefined
      }
      aria-hidden="true"
    >
      <Show
        when={image()}
        fallback={
          <Show
            when={mark()}
            fallback={
              <Show
                when={glyph()}
                fallback={
                  <Show when={tint()} fallback={<FolderIcon />}>
                    <span class="text-[10px] font-semibold leading-none" style={{ color: tint() ?? undefined }}>
                      {props.project.name.slice(0, 1).toUpperCase()}
                    </span>
                  </Show>
                }
              >
                {(text) => (
                  <span class="text-[10px] font-semibold leading-none" style={{ color: tint() ?? undefined }}>
                    {text()}
                  </span>
                )}
              </Show>
            }
          >
            {(Icon) => (
              <span class="h-full w-full p-0.5" style={{ color: tint() ?? undefined }}>
                <Dynamic component={Icon()} />
              </span>
            )}
          </Show>
        }
      >
        {(src) => (
          <img
            src={src()}
            alt=""
            title={props.project.iconLabel ?? props.project.name}
            loading="lazy"
            referrerpolicy="no-referrer"
            class="h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        )}
      </Show>
    </span>
  );
}