import { createEffect, createResource, createSignal, on, onCleanup, Show } from 'solid-js';

import { fetchFile, saveFile } from '../lib/api';
import { boardKey, isDeleted } from '../lib/board.mjs';
import { useBoard } from '../lib/board-context';
import { renderDiagrams } from '../lib/diagrams';
import type { BoardDeletions } from '../lib/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Chip, Empty } from './Card';

/**
 * One artifact, read — and written back.
 *
 * The content arrives on demand from `/api/file`, which is also what renders the markdown and colours the code on
 * the server: the island has no markdown parser and no highlighter in it, so a repository's own docs cannot bloat
 * the bundle. The read and the write are the same route because they are the same thing seen twice; `editable`
 * travels with the read, decided where the set of text extensions lives, so the button that offers an edit and the
 * request that would refuse one cannot disagree. A truncated read is never editable — saving what was shown would
 * throw away everything past the cut.
 *
 * Editing is a mode, not a second panel: the document is replaced by the text it came from, and the only two ways
 * out are *save* and *discard*. Leaving by clicking elsewhere is deliberately not one of them, because that is how
 * a draft disappears without anyone deciding to lose it.
 *
 * Diagram fences are drawn after the HTML is in the page (`renderDiagrams`): mermaid needs real elements to
 * measure, and it is imported only when the document actually carries a `mermaid` block.
 */
interface ArtifactProps {
  project: string;
  path: string;
  onClose?: () => void;
  onSaved?: () => void;
  /**
   * False on a collection's page, where the collection's own header carries the only archive button: a second one
   * inside the document panel would archive just this file, and the run would stay on the board looking untouched.
   * A file is archived from its own page.
   */
  canArchive?: boolean;
}

/**
 * The public artifact. An artifact is read on a page that knows which repository it is in but not always how to put
 * it archived, so the board's decisions are filled in from the context unless a caller names its own.
 */
export function Artifact(props: ArtifactProps) {
  const board = useBoard();
  return (
    <ArtifactView
      project={props.project}
      path={props.path}
      onClose={props.onClose}
      onSaved={props.onSaved}
      canArchive={props.canArchive}
      deletions={board.deletions()}
      onDelete={board.onDelete}
    />
  );
}

function ArtifactView(props: ArtifactProps & { deletions: BoardDeletions; onDelete: (relPath: string, deleted: boolean) => void }) {
  const [file, { mutate }] = createResource(
    () => [props.project, props.path] as const,
    ([project, path]) => fetchFile(project, path),
  );

  const [mode, setMode] = createSignal<'read' | 'edit'>('read');
  /** The text as the reader has it, or `null` while it is untouched — an untouched draft is not a change. */
  const [draft, setDraft] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [notice, setNotice] = createSignal<{ tone: 'good' | 'weak'; text: string } | null>(null);

  let body: HTMLElement | undefined;
  let editor: HTMLTextAreaElement | undefined;

  const content = () => file();
  const text = () => draft() ?? content()?.raw ?? '';
  const dirty = () => draft() !== null && draft() !== content()?.raw;

  // Two states, and they are not the same one. An artifact archived itself is a decision about this file; one
  // covered by a collection is off the board only because its collection is, and unarchiving it here would do
  // nothing — the button below is the collection's to press, on the collection's own page.
  const own = () => Boolean(props.deletions[boardKey(props.project, props.path)]);
  const covered = () => !own() && isDeleted({ projectId: props.project, relPath: props.path }, props.deletions);

  // Opening another artifact opens a different document: a draft, a mode and a save notice all belong to the file
  // that was on screen a moment ago, and the same island is reused for the next one.
  createEffect(
    on(
      () => [props.project, props.path],
      () => {
        setMode('read');
        setDraft(null);
        setNotice(null);
        setSaving(false);
      },
    ),
  );

  createEffect(() => {
    const loaded = content();
    if (mode() !== 'read' || !loaded?.isMarkdown || !loaded.html || !body) return;
    void renderDiagrams(body);
  });

  createEffect(() => {
    if (mode() === 'edit') editor?.focus();
  });

  // The diagram's ink comes from the live stylesheet, which is not a signal — so the same media signal the score
  // chart watches is what redraws a diagram when the page changes theme.
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const onSchemeChange = () => {
    if (body) void renderDiagrams(body, { redraw: true });
  };
  scheme.addEventListener('change', onSchemeChange);
  onCleanup(() => scheme.removeEventListener('change', onSchemeChange));

  const save = async () => {
    if (!dirty() || saving()) return;
    setSaving(true);
    setNotice(null);
    try {
      // The answer is the file as it reads *after* the write, so the screen shows what the disk holds rather than
      // what was typed, and the draft is dropped in favour of it.
      const written = await saveFile(props.project, props.path, text());
      mutate(written);
      setDraft(null);
      setNotice({ tone: 'good', text: `saved ${new Date(written.mtime).toLocaleTimeString()}` });
      // A checklist is counted into the list it sits in and into the collection's progress, and both live in the
      // snapshot — so the row a reader just ticked a box in says `2/2` rather than the number it said before.
      props.onSaved?.();
    } catch (error) {
      setNotice({ tone: 'weak', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(null);
    setNotice(null);
    setMode('read');
  };

  const stateText = () => {
    if (saving()) return 'saving…';
    const message = notice();
    if (message) return message.text;
    return dirty() ? 'unsaved changes' : 'no changes yet';
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (mode() !== 'edit') return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  };

  return (
    <section class="grid min-w-0 content-start gap-3" onKeyDown={onKeyDown}>
      <header class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border pb-2">
        <h2 class="m-0 border-0 p-0 text-section font-medium">
          <span class="break-anywhere">{props.path.split('/').pop()}</span>
        </h2>
        <Show when={file()}>
          {(loaded) => (
            <>
              <Chip>{loaded().extension || 'file'}</Chip>
              <Show when={loaded().detected}>
                <Chip title="the extension names no dialect, so this one was read from the text itself">
                  detected as {loaded().language}
                </Chip>
              </Show>
              <Chip>{loaded().size.toLocaleString()} B</Chip>
              <Show when={loaded().truncated}>
                <Badge tone="fair" title="Only the first 400 kB are shown, so this file cannot be edited here">
                  truncated
                </Badge>
              </Show>
            </>
          )}
        </Show>
        <Show when={own()}>
          <Badge tone="fair" title="Off the board; the file itself is untouched">
            archived
          </Badge>
        </Show>
        <Show when={covered()}>
          <Badge tone="unknown" title="Off the board because the collection it lives in was archived">
            inside an archived collection
          </Badge>
        </Show>

        <span class="ml-auto inline-flex flex-wrap items-center justify-end gap-1.5">
          <Show when={mode() === 'edit'}>
            <span class={`text-chrome ${notice()?.tone === 'weak' ? 'text-weak' : 'text-muted-foreground'}`}>
              {stateText()}
            </span>
            <Button size="chip" variant="quiet" onClick={discard} disabled={saving()}>
              discard
            </Button>
            <Button
              size="chip"
              variant="primary"
              onClick={() => void save()}
              disabled={!dirty() || saving()}
              title="write the file (⌘S)"
            >
              save
            </Button>
          </Show>
          <Show when={mode() === 'read' && content()?.editable}>
            <Button size="chip" variant="quiet" onClick={() => setMode('edit')}>
              edit
            </Button>
          </Show>
          <Show when={mode() === 'read' && props.canArchive !== false}>
            <Button
              size="chip"
              variant="quiet"
              title={own() ? 'bring it back to the board' : 'keep it off the board without touching the file'}
              onClick={() => props.onDelete?.(props.path, own())}
            >
              {own() ? 'unarchive' : 'archive'}
            </Button>
          </Show>
          <Show when={props.onClose && mode() === 'read'}>
            <Button size="chip" variant="quiet" onClick={() => props.onClose?.()}>
              close
            </Button>
          </Show>
        </span>
      </header>

      <Show when={file.error}>
        <p class="text-weak">Could not read this file: {String(file.error?.message ?? file.error)}</p>
      </Show>
      <Show when={file.loading}>
        <p class="text-muted-foreground italic">reading…</p>
      </Show>

      <Show when={content()}>
        {(loaded) => (
          <Show
            when={mode() === 'edit'}
            fallback={
              <Show
                when={loaded().html}
                fallback={
                  <pre class="max-h-[75vh] overflow-auto rounded-lg border border-border bg-muted p-3 text-chrome">
                    <code>{loaded().raw}</code>
                  </pre>
                }
              >
                <Show
                  when={loaded().isMarkdown}
                  fallback={
                    /* No document to read: code, coloured. The wrapper is the app's surface, and shiki's own
                       background is overridden in the stylesheet. */
                    <div
                      class="code-view overflow-auto rounded-lg border border-border bg-muted p-3"
                      innerHTML={loaded().html ?? ''}
                    />
                  }
                >
                  {/* The HTML is rendered and sanitised on the server (see `src/server/snapshot.mjs`). */}
                  <article class="markdown" ref={body} innerHTML={loaded().html ?? ''} />
                </Show>
              </Show>
            }
          >
            <textarea
              ref={editor}
              class="min-h-[65vh] w-full resize-y rounded-lg border border-border bg-card p-3 font-mono text-body max-[860px]:text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              spellcheck={false}
              aria-label={`Edit ${props.path}`}
              value={text()}
              onInput={(event) => setDraft(event.currentTarget.value)}
            />
          </Show>
        )}
      </Show>

      <Show when={!file.loading && !file() && !file.error}>
        <Empty>Nothing to show yet.</Empty>
      </Show>
    </section>
  );
}
