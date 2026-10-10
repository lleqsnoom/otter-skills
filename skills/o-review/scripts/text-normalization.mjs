/**
 * Shared text normalization utilities for o-review scripts.
 */

/** Languages whose comments start with `#`; everything else this review reads uses `//` and `/* *\/`, PHP both. */
const HASH_COMMENTS = new Set([".py", ".rb", ".sh", ".bash", ".zsh", ".gd"]);
const BOTH_COMMENTS = new Set([".php"]);

/** Which comment markers a file's language uses, by its extension. */
export function commentStyle(ext) {
  const lower = String(ext || "").toLowerCase();
  if (HASH_COMMENTS.has(lower)) return { hash: true, slash: false };
  if (BOTH_COMMENTS.has(lower)) return { hash: true, slash: true };
  return { hash: false, slash: true };
}

/**
 * Strip comments from source code, line for line, so duplication detection works across languages and line numbers
 * survive. It scans rather than matches: a regex took `//` inside a string for a comment, so every
 * `preload("res://…")` and every `"https://…"` was cut short, and lines that differed after it compared equal. It
 * also read `#` only at the start of a line, so an indented comment was compared as code.
 */
function stripComments(source, ext) {
  const { hash, slash } = commentStyle(ext);
  const out = [];
  let block = false;
  let triple = null;
  for (const line of String(source).split("\n")) {
    let code = "";
    let i = 0;
    while (i < line.length) {
      if (block) {
        const end = line.indexOf("*/", i);
        if (end === -1) { i = line.length; break; }
        i = end + 2;
        block = false;
        continue;
      }
      if (triple) {
        const end = line.indexOf(triple, i);
        if (end === -1) { code += line.slice(i); i = line.length; break; }
        code += line.slice(i, end + 3);
        i = end + 3;
        triple = null;
        continue;
      }
      if (slash && line.startsWith("//", i)) break;
      if (slash && line.startsWith("/*", i)) { block = true; i += 2; continue; }
      if (hash && line[i] === "#") break;
      if (hash && (line.startsWith('"""', i) || line.startsWith("'''", i))) {
        triple = line.slice(i, i + 3);
        code += triple;
        i += 3;
        continue;
      }
      const ch = line[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        let j = i + 1;
        while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
        code += line.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      code += ch;
      i++;
    }
    out.push(code);
  }
  return out.join("\n");
}

/**
 * Normalize source lines for comparison: strip comments, trim, collapse whitespace, remove empty lines. Each kept
 * line carries its line number in the file, counted from 1, so a duplicate is reported where it is and not at its
 * index among the lines that survived.
 */
function normalizeLines(source, ext) {
  return stripComments(source, ext)
    .split("\n")
    .map((text, index) => ({ text: text.trim().replace(/\s+/g, " "), line: index + 1 }))
    .filter(({ text }) => text.length > 0 && !/^[*]/.test(text));
}

export { stripComments, normalizeLines };
