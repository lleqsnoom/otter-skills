import { Dialog } from '@kobalte/core/dialog';
import { createResource, createSignal, For, Show } from 'solid-js';

import { createProject, projectDefaults, refreshSnapshot } from '../lib/api';
import { navigate } from '../lib/router';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { TextArea } from '../ui/TextArea';
import { ToggleGroup } from '../ui/ToggleGroup';
import { IconPicker } from './IconPicker';

/** The same rule the server applies to a name, so the path a reader is shown is the path that will be made. */
const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');

const FIELD = 'grid gap-1 text-chrome';

/**
 * Making a project, from the rail.
 *
 * The form asks for the least it can: what the project is called, what it is about, where it goes, who may see it
 * and what license it carries. The path is shown as it is typed, because the folder and the repository take the slug
 * of the name and a reader should see the one they are about to get. A refusal keeps the dialog open with the
 * server's own words, so nothing typed is lost.
 */
export function NewProject() {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal('');
  const [about, setAbout] = createSignal('');
  const [typedBase, setTypedBase] = createSignal<string | null>(null);
  const [visibility, setVisibility] = createSignal<'private' | 'public'>('private');
  const [license, setLicense] = createSignal('');
  const [iconText, setIconText] = createSignal('');
  const [color, setColor] = createSignal('');
  const [iconSrc, setIconSrc] = createSignal('');
  const [iconFile, setIconFile] = createSignal<{ name: string; type: string; data: string } | null>(null);
  const [error, setError] = createSignal('');
  const [detail, setDetail] = createSignal('');
  const [creating, setCreating] = createSignal(false);

  const [defaults] = createResource(projectDefaults);

  const baseDir = () => typedBase() ?? defaults()?.baseDir ?? '';
  const slug = () => slugOf(name());
  const path = () => `${baseDir() || '~/Documents'}/${slug() || '…'}`;

  const submit = async (event: Event) => {
    event.preventDefault();
    setCreating(true);
    setError('');
    setDetail('');
    try {
      const answer = await createProject({
        name: name(),
        about: about(),
        baseDir: baseDir() || undefined,
        visibility: visibility(),
        license: license() || null,
        icon: { text: iconText(), color: color(), src: iconSrc() || null, file: iconFile() },
      });
      await refreshSnapshot();
      setOpen(false);
      setName('');
      setAbout('');
      navigate({ name: 'project', project: answer.id });
    } catch (failure) {
      const reason = failure as Error & { detail?: string };
      setError(reason instanceof Error ? reason.message : String(failure));
      setDetail(reason?.detail ?? '');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Button size="chip" variant="quiet" onClick={() => setOpen(true)}>
        + new project
      </Button>
      <Dialog open={open()} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content class="fixed top-1/2 left-1/2 z-50 grid w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-lg border border-border bg-card p-4 shadow-lg">
            <Dialog.Title class="m-0 text-section font-medium">New project</Dialog.Title>
            <Dialog.Description class="m-0 text-chrome text-muted-foreground">
              A folder, a repository on GitHub, and a license if you pick one.
            </Dialog.Description>

            <form class="grid gap-3" onSubmit={submit}>
              <label class={FIELD}>
                Name
                <Input
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                  placeholder="My Cool App"
                  autofocus
                />
              </label>
              <p class="break-anywhere m-0 text-chrome text-muted-foreground">
                {path()}
                <Show when={defaults()?.owner}>
                  {(owner) => (
                    <>
                      {' '}
                      · github.com/{owner()}/{slug() || '…'}
                    </>
                  )}
                </Show>
              </p>

              <label class={FIELD}>
                What it is about
                <TextArea
                  value={about()}
                  onInput={(event) => setAbout(event.currentTarget.value)}
                  placeholder="One sentence a reader would understand."
                />
              </label>

              <label class={FIELD}>
                Where it goes
                <Input
                  value={baseDir()}
                  onInput={(event) => setTypedBase(event.currentTarget.value)}
                  placeholder="~/Documents"
                />
              </label>

              <div class="flex flex-wrap items-center gap-3">
                <span class="text-chrome">Icon</span>
                <IconPicker
                  text={iconText()}
                  color={color()}
                  src={iconSrc()}
                  file={iconFile()}
                  onText={setIconText}
                  onColor={setColor}
                  onSrc={setIconSrc}
                  onFile={setIconFile}
                />
              </div>

              <div class="flex flex-wrap items-center gap-3">
                <span class="text-chrome">Visibility</span>
                <ToggleGroup
                  label="Visibility"
                  value={visibility()}
                  options={[
                    { value: 'private', label: 'private', title: 'Only you can see it' },
                    { value: 'public', label: 'public', title: 'Anyone can see it' },
                  ]}
                  onChange={setVisibility}
                />
              </div>

              <label class={FIELD}>
                License
                <Select value={license()} onChange={(event) => setLicense(event.currentTarget.value)}>
                  <For each={defaults()?.licenses ?? []}>{(option) => <option value={option.key}>{option.name}</option>}</For>
                </Select>
              </label>

              <Show when={error()}>
                <div class="grid gap-1">
                  <p class="break-anywhere m-0 text-chrome text-weak">{error()}</p>
                  <Show when={detail()}>
                    <details class="text-chrome text-muted-foreground">
                      <summary>why</summary>
                      <p class="break-anywhere m-0">{detail()}</p>
                    </details>
                  </Show>
                </div>
              </Show>

              <div class="flex justify-end gap-2">
                <Button variant="quiet" onClick={() => setOpen(false)}>
                  cancel
                </Button>
                <Button type="submit" variant="primary" disabled={creating()}>
                  {creating() ? 'creating…' : 'create'}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </>
  );
}