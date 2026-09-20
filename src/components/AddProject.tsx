import { Dialog } from '@kobalte/core/dialog';
import { createSignal, For, Show } from 'solid-js';

import { addProjectRoot, browseDirectory, type BrowsedFolder, refreshSnapshot } from '../lib/api';
import { navigate } from '../lib/router';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

/**
 * Adding a folder that already exists, from the rail.
 *
 * A picker rather than a path field alone: what is being chosen is a directory on this machine, and typing one from
 * memory is how a reader lands on the wrong folder. The field above the list is the picker's own address, so a path
 * that is already in the clipboard can still be pasted and entered.
 *
 * Nothing in the repository is asked for and nothing in it is written, except the one thing a folder with no
 * `.x-skills` needs to be read at all — which the screen says before the button is pressed, not after.
 */
export function AddProject() {
  const [open, setOpen] = createSignal(false);
  const [here, setHere] = createSignal<string | null>(null);
  const [parent, setParent] = createSignal<string | null>(null);
  const [root, setRoot] = createSignal<string | null>(null);
  const [dirs, setDirs] = createSignal<BrowsedFolder[]>([]);
  const [typed, setTyped] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [adding, setAdding] = createSignal(false);
  const [error, setError] = createSignal('');
  const [detail, setDetail] = createSignal('');

  const go = async (path?: string) => {
    setBusy(true);
    try {
      const answer = await browseDirectory(path);
      setHere(answer.path);
      setParent(answer.parent);
      setRoot(answer.root);
      setDirs(answer.dirs);
      setTyped(answer.path);
      setError('');
      setDetail('');
    } catch (failure) {
      const reason = failure as Error & { detail?: string };
      setError(reason instanceof Error ? reason.message : String(failure));
      setDetail(reason?.detail ?? '');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (next: boolean) => {
    setOpen(next);
    setError('');
    setDetail('');
    if (next) void go(here() ?? undefined);
  };

  const add = async () => {
    const path = here();
    if (!path) return;
    setAdding(true);
    setError('');
    setDetail('');
    try {
      const answer = await addProjectRoot(path);
      await refreshSnapshot();
      setOpen(false);
      navigate({ name: 'project', project: answer.id });
    } catch (failure) {
      const reason = failure as Error & { detail?: string };
      setError(reason instanceof Error ? reason.message : String(failure));
      setDetail(reason?.detail ?? '');
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <Button size="chip" variant="quiet" onClick={() => toggle(true)}>
        + add existing
      </Button>
      <Dialog open={open()} onOpenChange={toggle}>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content class="fixed top-1/2 left-1/2 z-50 grid w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-lg border border-border bg-card p-4 shadow-lg">
            <Dialog.Title class="m-0 text-section font-medium">Add existing project</Dialog.Title>
            <Dialog.Description class="m-0 text-chrome text-muted-foreground">
              A folder on disk. Nothing in it is changed, except the <code>.x-skills</code> folder a repository with
              none needs to be read at all.
            </Dialog.Description>

            <Input
              value={typed()}
              onInput={(event) => setTyped(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void go(typed());
                }
              }}
              placeholder="/home/you/code/app"
              aria-label="Folder path"
            />

            <div class="flex items-center gap-2">
              <Button size="chip" variant="quiet" disabled={!parent() || busy()} onClick={() => go(parent() ?? undefined)}>
                ← up
              </Button>
              <span class="break-anywhere text-chrome text-muted-foreground">{here() ?? 'reading…'}</span>
            </div>

            <ul class="grid max-h-72 gap-0.5 overflow-auto rounded-md border border-border p-1">
              <Show when={dirs().length} fallback={<li class="px-2 py-1 text-chrome text-muted-foreground italic">no folders here</li>}>
                <For each={dirs()}>
                  {(folder) => (
                    <li>
                      <button
                        type="button"
                        class="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-chrome text-foreground hover:bg-muted"
                        onClick={() => go(folder.path)}
                      >
                        <span class="break-anywhere">{folder.name}</span>
                        <Show when={folder.root}>
                          <span class="ml-auto text-chrome text-muted-foreground">.x-skills</span>
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </Show>
            </ul>

            <Show when={here()}>
              <p class="m-0 text-chrome text-muted-foreground">
                <Show when={root()} fallback={<>No <code>.x-skills</code> here yet — one with an empty <code>tasks/</code> folder will be made.</>}>
                  {(found) => <>Already a root: <code class="break-anywhere">{found()}</code></>}
                </Show>
              </p>
            </Show>

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
              <Button variant="primary" disabled={!here() || adding()} onClick={add}>
                {adding() ? 'adding…' : 'add this folder'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </>
  );
}
