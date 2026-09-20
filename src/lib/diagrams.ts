/**
 * Diagrams, drawn from the fences the artifacts already carry.
 *
 * A ```` ```mermaid ```` block is a graph in text; the server renders it as a code block like any other, and this
 * turns it into the picture. Mermaid is a megabyte of parser and layout engine, so it is loaded **on demand** — a
 * document with no diagram never fetches it, and Vite keeps it in its own chunk.
 *
 * The colours are the app's own: mermaid is initialised with `theme: 'base'` and `themeVariables` read from the
 * live stylesheet, exactly as the score chart reads `--primary` and `--border` for its ink. That matters more here
 * than anywhere, because a diagram is mostly *shape* — a light-mode diagram on a dark page is a white slab.
 *
 * Two failure modes are handled rather than hidden: a diagram mermaid cannot parse keeps its text on screen with
 * the reason beside it, and a theme change redraws what is already drawn.
 */
type MermaidApi = Awaited<typeof import('mermaid')>['default'];

let api: Promise<MermaidApi> | null = null;
let seq = 0;

/** The diagram source, kept beside its figure so a redraw after a theme change does not need the file again. */
const sources = new WeakMap<HTMLElement, string>();

function css(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function themeVariables() {
  return {
    background: 'transparent',
    primaryColor: css('--muted', '#f5f5f5'),
    primaryTextColor: css('--foreground', '#0a0a0a'),
    primaryBorderColor: css('--border', '#e5e5e5'),
    secondaryColor: css('--card', '#fff'),
    tertiaryColor: css('--background', '#fff'),
    lineColor: css('--muted-foreground', '#6d6d6d'),
    textColor: css('--foreground', '#0a0a0a'),
    mainBkg: css('--muted', '#f5f5f5'),
    nodeBorder: css('--border', '#e5e5e5'),
    clusterBkg: 'transparent',
    clusterBorder: css('--border', '#e5e5e5'),
    edgeLabelBackground: css('--background', '#fff'),
    fontFamily: css('--font-sans', 'sans-serif'),
    fontSize: '12px',
  };
}

/**
 * The mermaid API, initialised against the colours the page is wearing *now* — on every call, so a redraw after a
 * theme change cannot be drawn in the previous ink.
 */
async function mermaid(): Promise<MermaidApi> {
  api ??= import('mermaid').then((module) => module.default);
  const instance = await api;
  instance.initialize({
    startOnLoad: false,
    // Mermaid's own sanitiser: labels are escaped, so a diagram inside a document cannot inject markup into the
    // page. The markdown around it is scrubbed on the server for the same reason.
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: themeVariables(),
    fontFamily: css('--font-sans', 'sans-serif'),
    // Pinned to the renderer these documents use. Mermaid will otherwise pull in its optional ELK layout engine —
    // measured, 1.4 MB of a 2.2 MB diagram load, for graphs that lay out the same way without it.
    layout: 'dagre',
    flowchart: { useMaxWidth: true, htmlLabels: false },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
    er: { useMaxWidth: true },
    class: { useMaxWidth: true },
    state: { useMaxWidth: true },
  });
  return instance;
}

function fail(figure: HTMLElement, source: string, error: unknown) {
  figure.dataset.diagram = 'failed';
  figure.replaceChildren();

  const note = document.createElement('p');
  note.className = 'diagram-note';
  note.textContent = `Could not draw this diagram: ${error instanceof Error ? error.message : String(error)}`;
  figure.append(note);

  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.className = 'language-mermaid';
  code.textContent = source;
  pre.append(code);
  figure.append(pre);
}

async function draw(figure: HTMLElement, instance: MermaidApi) {
  const source = sources.get(figure);
  if (!source) return;
  try {
    // `parse` first: `render` on a broken diagram leaves mermaid's own error node behind in the document.
    await instance.parse(source);
    const { svg } = await instance.render(`diagram-${(seq += 1)}`, source);
    if (!figure.isConnected) return;
    figure.dataset.diagram = 'ready';
    figure.innerHTML = svg;
  } catch (error) {
    if (!figure.isConnected) return;
    fail(figure, source, error);
  }
}

/**
 * Replaces every ```mermaid code block inside `root` with the diagram it describes.
 *
 * `redraw` re-renders the figures already on screen instead of leaving them as they were drawn — a figure whose
 * SVG was painted for the previous theme has no way to know the tokens moved. Drawing is sequential because
 * mermaid keeps layout state of its own between calls.
 */
export async function renderDiagrams(root: HTMLElement, { redraw = false } = {}): Promise<void> {
  const blocks = [...root.querySelectorAll('pre > code.language-mermaid')];
  const existing = redraw ? [...root.querySelectorAll<HTMLElement>('figure.diagram')] : [];
  if (!blocks.length && !existing.length) return;

  const instance = await mermaid();
  const targets = [...existing];

  for (const code of blocks) {
    const pre = code.parentElement;
    const source = code.textContent ?? '';
    if (!pre || !source.trim()) continue;
    const figure = document.createElement('figure');
    figure.className = 'diagram';
    figure.dataset.diagram = 'pending';
    sources.set(figure, source);
    pre.replaceWith(figure);
    targets.push(figure);
  }

  for (const figure of targets) await draw(figure, instance);
}