/**
 * Code, coloured — and the dialect it is read as.
 *
 * A JSON state file or a shell script read as one grey paragraph is a document to be decoded rather than read, so
 * fences and whole files are coloured with shiki. It paints **two themes at once**: the light colour inline, the
 * dark one in a `--shiki-dark` custom property, which the stylesheet walks between on `prefers-color-scheme` — the
 * same signal the app's own tokens move on, so a code block and the page around it change theme together.
 *
 * Three choices here are deliberate:
 *
 * - **The synchronous core.** `createHighlighterCoreSync` with the JavaScript engine loads grammars as plain
 *   modules, so a render stays synchronous; the full bundle is async, which would make reading one file async all
 *   the way up to the API route.
 * - **A curated grammar list.** Every grammar is loaded whether or not a repository holds one, so this is the set
 *   the artifacts actually use plus the scanner's text extensions. Anything else is plain text, which is honest.
 * - **Detection is ours.** Shiki colours the dialect it is told and does not guess, so `detectLanguage` guesses
 *   here and the answer travels marked `detected` — a reader is told a guess was made, not shown it as a fact.
 */
import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import bash from 'shiki/langs/bash.mjs';
import c from 'shiki/langs/c.mjs';
import cpp from 'shiki/langs/cpp.mjs';
import css from 'shiki/langs/css.mjs';
import diff from 'shiki/langs/diff.mjs';
import dockerfile from 'shiki/langs/dockerfile.mjs';
import go from 'shiki/langs/go.mjs';
import graphql from 'shiki/langs/graphql.mjs';
import html from 'shiki/langs/html.mjs';
import ini from 'shiki/langs/ini.mjs';
import java from 'shiki/langs/java.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import python from 'shiki/langs/python.mjs';
import rust from 'shiki/langs/rust.mjs';
import scss from 'shiki/langs/scss.mjs';
import sql from 'shiki/langs/sql.mjs';
import toml from 'shiki/langs/toml.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import xml from 'shiki/langs/xml.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import darkTheme from 'shiki/themes/github-dark-default.mjs';
import lightTheme from 'shiki/themes/github-light-default.mjs';

const THEMES = { light: 'github-light-default', dark: 'github-dark-default' };

const highlighter = createHighlighterCoreSync({
  themes: [lightTheme, darkTheme],
  langs: [json, javascript, typescript, tsx, jsx, bash, python, yaml, markdown, css, html, sql, diff, toml, go, rust, java, c, cpp, ini, xml, dockerfile, scss, graphql],
  engine: createJavaScriptRegexEngine(),
});

/**
 * Every name a dialect is asked for by. Shiki knows its own aliases (`js`, `ts`, `sh`, `yml`), but not the ones
 * a document uses loosely — `jsonc`, `golang`, `postgres` — so those are answered here, and anything still
 * unknown becomes `null`, which means plain text.
 */
const ALIASES = {
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  c: 'c', h: 'c',
  cpp: 'cpp', 'c++': 'cpp', cxx: 'cpp', hpp: 'cpp',
  css: 'css', scss: 'scss', sass: 'scss',
  diff: 'diff', patch: 'diff',
  docker: 'dockerfile', dockerfile: 'dockerfile',
  go: 'go', golang: 'go',
  graphql: 'graphql', gql: 'graphql',
  htm: 'html', html: 'html',
  ini: 'ini', properties: 'ini',
  java: 'java',
  javascript: 'javascript', js: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  json: 'json', jsonc: 'json', json5: 'json',
  jsx: 'jsx',
  markdown: 'markdown', md: 'markdown',
  python: 'python', py: 'python',
  rust: 'rust', rs: 'rust',
  sql: 'sql', postgres: 'sql', postgresql: 'sql', psql: 'sql', mysql: 'sql',
  toml: 'toml',
  ts: 'typescript', typescript: 'typescript',
  tsx: 'tsx',
  xml: 'xml', svg: 'xml',
  yaml: 'yaml', yml: 'yaml',
};

/** An extension decides its own dialect; nothing is guessed for a `.json` or a `.mjs`. */
const EXTENSIONS = {
  json: 'json', jsonc: 'json', json5: 'json',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'tsx', jsx: 'jsx',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown',
  css: 'css', scss: 'scss',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  sql: 'sql', toml: 'toml', go: 'go', rs: 'rust', java: 'java', c: 'c', cpp: 'cpp', ini: 'ini',
  graphql: 'graphql', gql: 'graphql',
  dockerfile: 'dockerfile',
};

/** `.mmd` is Mermaid, which has no grammar here: it is drawn as a diagram before any of this is asked. */
const PLAIN = null;

export function normalizeLanguage(name) {
  if (!name) return PLAIN;
  const key = String(name).trim().toLowerCase().replace(/^\./, '');
  return ALIASES[key] ?? PLAIN;
}

export function languageForExtension(extension) {
  if (!extension) return PLAIN;
  return EXTENSIONS[String(extension).trim().toLowerCase().replace(/^\./, '')] ?? PLAIN;
}

/**
 * The dialect of a whole file: its extension when that settles it, its own text when it does not. A `.txt` or a
 * `.csv` that parses as JSON is JSON on screen, and the reader is told the name was guessed.
 */
export function languageForFile(content, extension) {
  const known = languageForExtension(extension);
  if (known) return { language: known, detected: false };
  const guessed = detectLanguage(content ?? '');
  return guessed ? { language: guessed, detected: true } : { language: PLAIN, detected: false };
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The dialect a block of code is written in, from the code alone. Ordered strongest signal first, and every rule
 * is one a human would use: a parse that succeeds is JSON, a `@@` hunk header is a patch, a shebang is a shell,
 * and so on. `null` is a real answer — text that is none of these is shown as text.
 */
export function detectLanguage(code) {
  const text = String(code ?? '');
  if (!text.trim()) return PLAIN;

  const lines = text.split('\n');
  const first = lines.find((line) => line.trim()) ?? '';
  const head = lines.slice(0, 40).join('\n');

  if (looksJson(text)) return 'json';
  if (/^diff --git /m.test(text) || /^@@ .* @@/m.test(text) || (first.startsWith('--- ') && /\n\+\+\+ /.test(text))) return 'diff';
  if (/^#!.*\b(?:ba|z|k)?sh\b/.test(first) || /^\s*\$\s+\S/m.test(text) || /^\s*set -[eu]/m.test(text)) return 'bash';
  if (/^<!doctype html/i.test(first) || /^<html[\s>]/i.test(first)) return 'html';
  if (/^<(?:[a-z][\w:-]*)(?:\s[^>]*)?>/.test(first) && /<\/(?:[a-z][\w:-]*)>/.test(text)) return 'html';
  if (/^\s*<\?xml/.test(first) || /^<([a-z][\w:-]*)[^>]*\/>\s*$/i.test(first)) return 'xml';
  if (/^\s*\[[A-Za-z0-9_.-]+\]\s*$/m.test(head) && /^\s*[\w.-]+\s*=/m.test(head)) return 'toml';
  if (/^(?:def|class|import|from)\s+\w/m.test(head) || /^if __name__ ==/m.test(head)) return 'python';
  if (/^\s*(?:SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|ALTER TABLE)\b/im.test(head)) return 'sql';
  if (looksYaml(lines)) return 'yaml';
  if (/^\s*(?:interface|type|enum)\s+\w/m.test(head) || /:\s*(?:string|number|boolean|void|any|unknown|never|Record<|Array<)/.test(head)) return 'typescript';
  if (/^\s*(?:const|let|var|function|class|import|export)\s/m.test(head) || /=>|\.(?:map|filter|forEach|push)\(/.test(head)) return 'javascript';
  if (/^#{1,6}\s+\S/m.test(head) || /^\s*(?:[-*]\s+\[[ xX]\]|```)/m.test(head)) return 'markdown';
  if (/^[@.#:&]?[a-zA-Z][^{};]*\{[^{}]*:[^{}]*[;}]/m.test(head)) return 'css';
  if (/^fragment\s+\w+\s+on\s+\w+/m.test(head) || /^(?:query|mutation|subscription)\s+\w*\s*[({]/m.test(head)) return 'graphql';
  return PLAIN;
}

function looksJson(text) {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksYaml(lines) {
  const meaningful = lines.filter((line) => line.trim() && !line.trim().startsWith('#'));
  if (!meaningful.length) return false;
  if (meaningful.some((line) => /[{}]/.test(line))) return false;
  // A document fenced in `---` is YAML frontmatter, whatever its lines look like.
  if (lines[0]?.trim() === '---' && lines.slice(1).some((line) => line.trim() === '---')) return true;
  // A key (with or without a value) or a list item: the two things a YAML line can be. Prose has neither.
  const shaped = meaningful.filter((line) => /^(?:\s*-\s+\S|\s*[\w"'][\w ."'-]*:(?:\s|$))/.test(line));
  return shaped.length >= 2 && shaped.length / meaningful.length >= 0.6;
}

/**
 * The highlighted markup for a block of code, or `null` when the dialect is unknown — the caller decides what an
 * unknown block looks like, and it is never nothing.
 *
 * The dialect travels *in the markup* (`data-language`, and `data-detected` when it was guessed), which is what
 * lets the label above a block be CSS instead of another element to keep in step with the pre beside it.
 */
export function highlightCode(code, language, { detected = false } = {}) {
  const resolved = normalizeLanguage(language);
  if (!resolved) return null;
  try {
    const html = highlighter.codeToHtml(String(code), {
      lang: resolved,
      themes: THEMES,
      transformers: [
        {
          pre(node) {
            node.properties['data-language'] = resolved;
            if (detected) node.properties['data-detected'] = '1';
          },
        },
      ],
    });
    return { language: resolved, detected, html };
  } catch {
    // A grammar that cannot tokenize this text is a reason to show the text, not to fail the request.
    return null;
  }
}

/** The plain-text form of a block: escaped, and in the same shape a highlighted one has. */
export function plainCode(code) {
  return `<pre><code>${escapeHtml(code)}</code></pre>`;
}

/**
 * A fence's dialect: the info string when it names one, the text itself when it does not. `language` is the
 * dialect the block was coloured as; `detected` says the document did not name it.
 */
export function highlightFence(code, info) {
  const named = normalizeLanguage(String(info ?? '').split(/[\s,:]/)[0]);
  if (named) {
    const highlighted = highlightCode(code, named);
    if (highlighted) return highlighted;
    return { language: named, detected: false, html: plainCode(code) };
  }
  const guessed = detectLanguage(code);
  if (guessed) {
    const highlighted = highlightCode(code, guessed, { detected: true });
    if (highlighted) return highlighted;
  }
  return null;
}
