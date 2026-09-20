import { Popover } from '@kobalte/core/popover';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { cn } from '../ui/cn';
import { ICONS } from './icons';
import { ProjectIcon } from './ProjectIcon';

/** The emoji a project is most often marked with. A short list is the point: a picker you can read at a glance. */
export const EMOJIS = [
  '🚀', '📦', '🧪', '🧭', '🗺️', '🔧', '🌱', '🎯',
  '🧩', '📊', '🛰️', '🔒', '⚙️', '🧠', '📝', '🧱',
  '🪄', '🕹️', '🐳', '☁️', '🔥', '💡', '🎨', '🧵',
];

/** Mid-tone hues, so a mark reads on the light surface and on the dark one with the same colour. */
export const SWATCHES = [
  '#64748b', '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
];

/** Raster only, and the same ceiling the server refuses at: an SVG is a document, and an icon is a tile. */
const ICON_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
const MAX_ICON_BYTES = 2 * 1024 * 1024;

const OPTION =
  'grid h-7 w-7 place-items-center rounded-sm border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring max-[860px]:h-11 max-[860px]:w-11';
const CHOSEN = 'border-border bg-accent text-accent-foreground';

/**
 * A project's mark, chosen from a popup.
 *
 * The field was a row of four controls — a text input, a bare colour well, an image URL and nothing to choose a
 * mark from — and each of them looked like something else. This is one control that shows the mark it would set and
 * opens everything a mark can be: the app's own drawn icons, an emoji, one or two letters, a colour from a palette
 * or a colour of your own, and an image URL. A named icon is stored as `icon:<id>` in the project's own
 * `project.md`, so a clone on another machine draws the same mark without carrying an image.
 */
export function IconPicker(props: {
  text: string;
  color: string;
  src: string;
  file: { name: string; type: string; data: string } | null;
  onText: (value: string) => void;
  onColor: (value: string) => void;
  onSrc: (value: string) => void;
  onFile: (file: { name: string; type: string; data: string } | null) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [dropping, setDropping] = createSignal(false);
  const [fileError, setFileError] = createSignal('');
  let fileInput: HTMLInputElement | undefined;

  /** One mark at a time: choosing any of them drops the others, so the tile shows the last thing chosen. */
  const chooseText = (value: string) => {
    props.onText(value);
    props.onSrc('');
    props.onFile(null);
  };

  const chooseSrc = (value: string) => {
    props.onSrc(value);
    if (value) {
      props.onText('');
      props.onFile(null);
    }
  };

  const chooseFile = (file: { name: string; type: string; data: string } | null) => {
    props.onFile(file);
    if (file) {
      props.onText('');
      props.onSrc('');
    }
  };

  /** Read in the browser: the project does not exist yet, and the bytes travel with the create that makes it. */
  const accept = (file: File | undefined) => {
    if (!file) return;
    if (!ICON_TYPES.includes(file.type)) {
      setFileError('PNG, JPEG, GIF, WebP or AVIF');
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      setFileError('images up to 2 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      chooseFile({ name: file.name, type: file.type, data: String(reader.result).split(',')[1] ?? '' });
      setFileError('');
    };
    reader.readAsDataURL(file);
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDropping(false);
    accept(event.dataTransfer?.files?.[0]);
  };

  const named = () => (props.text.startsWith('icon:') ? props.text.slice('icon:'.length) : null);
  const label = () => {
    if (props.file || props.src) return 'image';
    if (named()) return ICONS.find((entry) => entry.id === named())?.label.toLowerCase() ?? 'icon';
    return props.text || 'no icon';
  };
  // The tile is drawn by the same component the rail and the cards use, so this preview cannot drift from them.
  const preview = () => ({
    id: '',
    name: 'mark',
    icon: null,
    iconLabel: null,
    badgeColor: null,
    iconText: props.text,
    color: props.color,
    iconSrc: props.file ? `data:${props.file.type};base64,${props.file.data}` : props.src,
    iconFile: null,
  });

  return (
    <Popover open={open()} onOpenChange={setOpen} gutter={6}>
      <Popover.Anchor class="inline-flex">
        <Button
          size="chip"
          variant="outline"
          onClick={() => setOpen(!open())}
          aria-haspopup="dialog"
          aria-expanded={open()}
        >
          <ProjectIcon project={preview()} size="lead" />
          {label()}
        </Button>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content class="z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-3 rounded-lg border border-border bg-card p-3 shadow-lg">
          <div class="grid gap-1.5">
            <span class="text-chrome text-muted-foreground">Icons</span>
            <div class="flex flex-wrap gap-1">
              <For each={ICONS}>
                {(entry) => (
                  <button
                    type="button"
                    title={entry.label}
                    aria-label={entry.label}
                    aria-pressed={named() === entry.id}
                    class={cn(OPTION, named() === entry.id && CHOSEN)}
                    onClick={() => chooseText(`icon:${entry.id}`)}
                  >
                    <span class="h-4 w-4">
                      <Dynamic component={entry.Icon} />
                    </span>
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="grid gap-1.5">
            <span class="text-chrome text-muted-foreground">Emoji</span>
            <div class="flex flex-wrap gap-1">
              <For each={EMOJIS}>
                {(emoji) => (
                  <button
                    type="button"
                    aria-label={emoji}
                    aria-pressed={props.text === emoji}
                    class={cn(OPTION, 'text-base', props.text === emoji && CHOSEN)}
                    onClick={() => chooseText(emoji)}
                  >
                    {emoji}
                  </button>
                )}
              </For>
            </div>
          </div>

          <label class="grid gap-1 text-chrome">
            Letters
            <Input
              value={named() ? '' : props.text}
              maxlength={2}
              placeholder="mc"
              onInput={(event) => chooseText(event.currentTarget.value)}
            />
          </label>

          <div class="grid gap-1.5">
            <span class="text-chrome text-muted-foreground">Colour</span>
            <div class="flex flex-wrap items-center gap-1.5">
              <For each={SWATCHES}>
                {(swatch) => (
                  <button
                    type="button"
                    title={swatch}
                    aria-label={swatch}
                    aria-pressed={props.color === swatch}
                    class={cn(
                      'h-6 w-6 rounded-full border border-border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring max-[860px]:h-11 max-[860px]:w-11',
                      props.color === swatch && 'ring-2 ring-ring ring-offset-2 ring-offset-card',
                    )}
                    style={{ background: swatch }}
                    onClick={() => props.onColor(swatch)}
                  />
                )}
              </For>
              <input
                type="color"
                title="A colour of your own"
                aria-label="A colour of your own"
                class="h-6 w-10 cursor-pointer appearance-none rounded-md border border-dashed border-input bg-card p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[4px] [&::-webkit-color-swatch]:border-0 max-[860px]:h-11"
                value={props.color || SWATCHES[0]}
                onInput={(event) => props.onColor(event.currentTarget.value)}
              />
              <Show when={props.color}>
                <Button size="chip" variant="quiet" onClick={() => props.onColor('')}>
                  no colour
                </Button>
              </Show>
            </div>
          </div>

          <div class="grid gap-1.5">
            <span class="text-chrome text-muted-foreground">Image</span>
            <div
              class={cn(
                'grid place-items-center gap-1 rounded-md border border-dashed px-3 py-2 text-center text-chrome',
                dropping() ? 'border-ring bg-muted text-foreground' : 'border-input text-muted-foreground',
              )}
              onDragOver={(event) => {
                event.preventDefault();
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={drop}
            >
              <span class="break-anywhere">{props.file ? props.file.name : 'Drop an image here'}</span>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
                class="hidden"
                onChange={(event) => accept(event.currentTarget.files?.[0])}
              />
              <div class="flex items-center gap-1.5">
                <Button size="chip" variant="quiet" onClick={() => fileInput?.click()}>
                  choose a file
                </Button>
                <Show when={props.file}>
                  <Button size="chip" variant="quiet" onClick={() => chooseFile(null)}>
                    no image
                  </Button>
                </Show>
              </div>
            </div>
            <Show when={fileError()}>
              <span class="text-chrome text-weak">{fileError()}</span>
            </Show>
            <label class="grid gap-1 text-chrome">
              Image URL
              <Input
                value={props.src}
                placeholder="https://…"
                onInput={(event) => chooseSrc(event.currentTarget.value)}
              />
            </label>
          </div>

          <div class="flex justify-end gap-2">
            <Button
              size="chip"
              variant="quiet"
              onClick={() => {
                chooseText('');
                props.onColor('');
              }}
            >
              clear
            </Button>
            <Button size="chip" variant="primary" onClick={() => setOpen(false)}>
              done
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}