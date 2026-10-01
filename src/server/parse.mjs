const TITLE_PREFIXES = [
  /^task:\s*/i,
  /^epic\s*[—:-]\s*/i,
  /^design spec:\s*/i,
  /^spec:\s*/i,
  /^analysis\s*[—:-]\s*/i,
  /^debug session report\s*$/i,
  /^debug\s*[—:-]\s*/i,
  /^review\s*[—:-]\s*/i,
  /^plan\s*[—:-]\s*/i,
];

export function titleFrom(markdown, fallback) {
  // A title the artifact gives itself is the name Obsidian shows too, so the board and the graph agree.
  const named = splitProperties(markdown).properties.find((property) => property.key === 'title')?.values[0];
  if (named) return named;
  const heading = markdown.match(/^#\s+(.+)$/m);
  if (!heading) return fallback;
  let title = heading[1].trim();
  for (const prefix of TITLE_PREFIXES) {
    if (prefix.test(title)) {
      title = title.replace(prefix, '').trim();
      break;
    }
  }
  return title || fallback;
}

/** Parses `**Key:** value` lines. Bullet lines following a field continue it. */
export function boldFields(markdown) {
  const fields = {};
  const lines = markdown.split('\n');
  let current = null;
  for (const line of lines) {
    const match = line.match(/^\s*\*\*([A-Za-z][A-Za-z /_-]*):\*\*\s*(.*)$/);
    if (match) {
      current = match[1].trim().toLowerCase().replace(/\s+/g, '-');
      const value = match[2].trim();
      fields[current] = value ? [value] : [];
      continue;
    }
    if (current && /^\s*[-*]\s+\S/.test(line)) {
      fields[current].push(line.replace(/^\s*[-*]\s+/, '').trim());
      continue;
    }
    if (line.trim() === '') continue;
    current = null;
  }
  const flat = {};
  for (const [key, values] of Object.entries(fields)) {
    flat[key] = values.length <= 1 ? (values[0] ?? '') : values;
  }
  return flat;
}

export function checkboxCounts(markdown) {
  const done = (markdown.match(/^\s*-\s*\[[xX]\]/gm) || []).length;
  const open = (markdown.match(/^\s*-\s*\[\s\]/gm) || []).length;
  return { done, open, total: done + open };
}

export function layerOf(fields) {
  const raw = fields.layer;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const match = String(value).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

/** A date from an ISO-ish string or from a leading `YYYY-MM-DD` in a name. */
export function dateFrom(value) {
  if (!value) return null;
  const text = String(value);
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):?(\d{2})?/);
  if (iso) {
    const [, y, mo, d, h = '00', mi = '00'] = iso;
    return `${y}-${mo}-${d}T${h}:${mi}`;
  }
  const day = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (day) return `${day[1]}-${day[2]}-${day[3]}T00:00`;
  const dmy = text.match(/(\d{2})-(\d{2})-(\d{4})[-T ]?(\d{2})?:?(\d{2})?/);
  if (dmy) {
    const [, d, mo, y, h = '00', mi = '00'] = dmy;
    return `${y}-${mo}-${d}T${h}:${mi}`;
  }
  return null;
}

const ARTIFACT_KINDS = [
  [/^E\d+-analysis/i, 'analysis'],
  [/^E\d+-plan/i, 'plan'],
  // `E<nn>-epic.md` is the plan under the name the retired `x-epic` gave it, so it reads where the plan reads: a run
  // folder holding one is not orphaned by the skill being gone.
  [/^E\d+-epic/i, 'plan'],
  [/^E\d+-tasks/i, 'tasks'],
  [/^E\d+-triage/i, 'triage'],
  [/^E\d+-repro/i, 'repro'],
  [/^E\d+-investigate/i, 'investigate'],
  [/^E\d+-review/i, 'review'],
  [/^E\d+-summary/i, 'summary'],
  [/^E\d+-reflection/i, 'reflection'],
  [/^E\d+[-_]/i, 'artifact'],
  // A task file is `task-1.2-…` where a run named it, `1.2-…` where x-decompose did, and `L0-0.1-…` where it
  // numbered the layer into the name.
  [/^task[-_]/i, 'task'],
  [/^\d+(\.\d+)?[-_]/, 'task'],
  [/^L\d+[-_]\d/, 'task'],
  [/^state\.json$/i, 'state'],
  [/^memory\.md$/i, 'memory'],
  [/^questions\.md$/i, 'questions'],
];

export function artifactKind(name) {
  for (const [pattern, kind] of ARTIFACT_KINDS) {
    if (pattern.test(name)) return kind;
  }
  return 'doc';
}

/**
 * The `E<nn>` a run numbered an artifact with. The skills write every artifact of a run as
 * `E<nn>-<kind>.md` or `E<nn>-<kind>/` in execution order (`x-plan`: "a plain name sort lists the run in the
 * order it was built"), so the number is the rung an artifact occupies and the kind is which rung it is. Anything
 * without a number — `memory.md`, a bench note — is not part of the ladder and reads here as `null`.
 */
export function stageStep(name) {
  const match = name.match(/^E(\d+)[-_]/i);
  return match ? Number(match[1]) : null;
}

/**
 * The fields an artifact may name another artifact in. The skills hand a path forward rather than a copy — x-plan
 * passes `E00-plan.md` to the run that decomposes it, and an analysis routed onward is
 * named in the artifact it fed (`**Input:**`). Reading them is what turns "the plan came from this analysis" into
 * something a reader can follow, so the keys are listed rather than guessed at — including the keys only a legacy
 * artifact wrote (`spec:` was the handshake the retired `x-epic` used; `epic:` is what a legacy document was named
 * back by). The last six are only ever written as properties: an edge between tasks, a review or a fix and what it
 * answers, the run's hub note, and the tag notes an artifact is about.
 */
const LINK_FIELDS = new Map([
  ['input', 'Input'],
  ['spec', 'Spec'],
  ['plan', 'Plan'],
  ['epic', 'Epic'],
  ['tasks', 'Tasks'],
  ['analysis', 'Analysis'],
  ['source', 'Source'],
  ['from', 'From'],
  ['depends_on', 'Depends on'],
  ['reviews', 'Reviews'],
  ['fixes', 'Fixes'],
  ['related', 'Related'],
  ['run', 'Run'],
  ['topics', 'Topics'],
]);

/**
 * A path, as an artifact writes one: a file this app reads, or a folder a run numbered. `**Goal:** one shared
 * KMS key …` is prose about the work, so it is not a link; `E00-analysis.md` under a run folder is.
 */
const LINK_VALUE = /(?:^|\/)[\w.-]+\.(?:md|markdown|json|txt|ya?ml|js|mjs|cjs|ts|tsx|py|sh|toml|csv)$|^[\w./-]+\/$/i;

function cleanLinkValue(value) {
  return value
    .trim()
    // A path is written in backticks, in quotes, or bare, and a note may follow it after a dash.
    .replace(/^[`'"]+/, '')
    .split(/[`'"]/)[0]
    .split(/\s+[—–]\s+|\s+-\s+/)[0]
    .trim();
}

const FIELD_LINE = /^\s*(?:\*\*)?([A-Za-z][A-Za-z /_-]*?)(?:\*\*)?:\s*(?:\*\*)?\s*(.*)$/;
const LIST_ITEM = /^\s*-\s+(.+)$/;
const WIKILINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/;

/**
 * A wikilink as a path from the vault root and the text it is shown as. Obsidian writes `[[runs/R/E00-plan]]` with no
 * extension, maybe a heading (`#…`) and an alias (`|the plan`); the path gets `.md` and the text is the alias, else the
 * note's own name. Anything that is not a wikilink is `null`.
 */
export function parseWikilink(value) {
  const match = String(value).trim().match(WIKILINK);
  if (!match) return null;
  const note = match[1].trim();
  return { path: /\.[a-z0-9]+$/i.test(note) ? note : `${note}.md`, text: match[2]?.trim() || note.split('/').pop() };
}

function linkTarget(value) {
  const cleaned = cleanLinkValue(value);
  return parseWikilink(cleaned)?.path ?? cleaned;
}

/** The line that closes a leading `---` property block, or -1 when the document has none. */
function propertyBlockEnd(lines) {
  if (lines[0]?.trim() !== '---') return -1;
  return lines.findIndex((line, index) => index > 0 && line.trim() === '---');
}

/** The values a card may show for each property it reads; anything else a file says is not carried. */
const PROPERTY_VALUES = {
  size: new Set(['XS', 'S', 'M', 'L', 'XL']),
  complexity: new Set(['clear', 'complicated', 'complex']),
  done: new Set(['true', 'false']),
};

/** The card's properties from the leading `---` block, each kept only when it is one of its allowed values. */
export function propertyFields(markdown) {
  return Object.fromEntries(
    splitProperties(markdown)
      .properties.filter(({ key, values }) => values.length === 1 && PROPERTY_VALUES[key]?.has(values[0]))
      .map(({ key, values }) => [key, values[0]]),
  );
}

/**
 * The leading `---` block as `{ key, values }` in the order it was written, and the document after it. A value is
 * returned as written, quotes aside: the block is the file's own data, and what to make of it is the reader's call.
 */
export function splitProperties(markdown) {
  const lines = markdown.split('\n');
  const end = propertyBlockEnd(lines);
  if (end === -1) return { properties: [], body: markdown };
  return { properties: propertyEntries(lines.slice(1, end)), body: lines.slice(end + 1).join('\n') };
}

function propertyEntries(lines) {
  const entries = [];
  for (const line of lines) {
    const item = line.match(LIST_ITEM);
    const field = !item && line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (item && entries.length) entries.at(-1).values.push(unquote(item[1]));
    if (field) entries.push({ key: field[1], values: inlineValues(field[2].trim()) });
  }
  return entries;
}

/** `[]` and `[a, b]` are YAML's inline lists; `[[x]]` is a wikilink written without its quotes, so it is one value. */
function inlineValues(value) {
  if (!value) return [];
  const list = !value.startsWith('[[') && value.match(/^\[(.*)\]$/);
  if (!list) return [unquote(value)];
  return list[1].split(',').map((part) => unquote(part.trim())).filter(Boolean);
}

function unquote(value) {
  return value.trim().replace(/^(["'])(.*)\1$/, '$2');
}

/**
 * The `key: value` pairs of a header. Inside the leading `---` property block a bare `key:` opens a YAML list, one
 * pair per `- item` under it; outside it a bullet is prose, so a legacy document's lists never turn into links.
 */
function headerEntries(lines) {
  const closing = propertyBlockEnd(lines);
  const entries = [];
  let listKey = null;
  lines.forEach((line, index) => {
    const item = listKey && line.match(LIST_ITEM);
    if (item) {
      entries.push([listKey, item[1]]);
      return;
    }
    const field = line.match(FIELD_LINE);
    const value = field?.[2].trim();
    listKey = field && !value && index < closing ? field[1] : null;
    if (value) entries.push([field[1], value]);
  });
  return entries;
}

/**
 * The artifacts one document names, in the order they were written: `{ label, value }` with the value as a path from
 * the vault root or as the document spelled it. Whether the path leads anywhere is the caller's question — it is the
 * one holding the root.
 */
export function linkFields(markdown) {
  const found = [];
  const seen = new Set();
  // The header is where a stage names its input; a `Plan:` further down is prose about a plan.
  for (const [key, raw] of headerEntries(markdown.split('\n').slice(0, 60))) {
    const label = LINK_FIELDS.get(key.trim().toLowerCase().replace(/\s+/g, '-'));
    if (!label) continue;
    const value = linkTarget(raw);
    if (!value || !LINK_VALUE.test(value) || seen.has(value)) continue;
    seen.add(value);
    found.push({ label, value });
  }
  return found;
}

export function excerpt(markdown, limit = 240) {
  const body = markdown
    .replace(/^---[\s\S]*?---\s*/m, '')
    .split('\n')
    .filter((line) => {
      const text = line.trim();
      if (!text) return false;
      // A heading, a bold field line, a table row, a fence or a bullet is structure, not prose.
      if (/^#/.test(text) || /^\*\*/.test(text)) return false;
      if (/^\|/.test(text) || /^```/.test(text) || /^[-*+]\s/.test(text) || /^\d+\.\s/.test(text)) return false;
      return true;
    });
  const text = body.join(' ').replace(/[`*_>]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "3/8" style progress for a task file; null when the file has no checklist. */
export function progressOf(markdown) {
  const { done, total } = checkboxCounts(markdown);
  if (!total) return null;
  return { done, total, ratio: done / total };
}

export function statusFromProgress(progress) {
  if (!progress) return 'unknown';
  if (progress.done === 0) return 'todo';
  if (progress.done >= progress.total) return 'done';
  return 'active';
}