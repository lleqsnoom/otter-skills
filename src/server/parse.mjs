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
  [/^E\d+-epic/i, 'epic'],
  [/^E\d+-tasks/i, 'tasks'],
  [/^E\d+-triage/i, 'triage'],
  [/^E\d+-repro/i, 'repro'],
  [/^E\d+-investigate/i, 'investigate'],
  [/^E\d+-review/i, 'review'],
  [/^E\d+-summary/i, 'summary'],
  [/^E\d+-reflection/i, 'reflection'],
  [/^E\d+[-_]/i, 'artifact'],
  // A task file is `task-1.2-…` where a run named it, and `1.2-…` where `x-decompose` did.
  [/^task[-_]/i, 'task'],
  [/^\d+(\.\d+)?[-_]/, 'task'],
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