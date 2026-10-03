#!/usr/bin/env node
/**
 * The mechanical half of a differential review: every hunk of the diff, the symbol it sits in, and every other
 * place that symbol is named. What each hunk replaced and how risky it is stay the reviewer's call; this only
 * makes sure no hunk and no caller is skipped.
 *
 * Usage: node hunks.mjs [--base <ref>] [--root <dir>] [--table]
 *   --base   diff against the merge base with this ref (default: the first of origin/main, main, master;
 *            HEAD reviews only uncommitted work)
 *   --table  print the markdown risk table skeleton instead of JSON
 * Exit: 0 · 2 not a git repo or no base
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
const tryGit = (root, ...args) => {
  try {
    return git(root, ...args);
  } catch {
    return null;
  }
};

/** Declarations in the languages a diff most often touches, with the name in group 1. */
const DECLARATION = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
];
/** Files whose declarations the patterns above can read: an untracked one of these is reviewed as new code. */
const DECLARATION_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|cs|php|swift|scala|c|cc|cpp|h|hpp)$/;
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "else"]);

export function parseHunks(diff) {
  const hunks = [];
  let file = null;
  for (const line of diff.split("\n")) {
    // The diff is taken with --no-prefix: a `diff.mnemonicPrefix` setting would otherwise turn b/ into w/.
    if (line.startsWith("+++ ")) file = line.slice(4);
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m && file && file !== "/dev/null") {
      hunks.push({ file, oldStart: Number(m[1]), oldLines: m[2] === undefined ? 1 : Number(m[2]), newStart: Number(m[3]), newLines: m[4] === undefined ? 1 : Number(m[4]) });
    }
  }
  return hunks;
}

/**
 * Whether a declaration is visible outside its file: an `export` or `pub` keyword, a top-level Python name without a
 * leading underscore, or a capitalised Go name — each language's own rule.
 */
function isExported(line, name, file) {
  if (/^\s*(?:export\b|pub\b)/.test(line)) return true;
  if (file.endsWith(".py")) return /^(?:async\s+)?(?:def|class)\s/.test(line) && !name.startsWith("_");
  if (file.endsWith(".go")) return /^[A-Z]/.test(name);
  return false;
}

/** The nearest declaration at or above a line: the symbol a hunk sits in, and whether it is exported. */
export function enclosingSymbol(lines, lineNumber, file = "") {
  for (let i = Math.min(lineNumber, lines.length) - 1; i >= 0; i--) {
    for (const pattern of DECLARATION) {
      const m = lines[i].match(pattern);
      if (m && !KEYWORDS.has(m[1])) return { name: m[1], line: i + 1, exported: isExported(lines[i], m[1], file) };
    }
  }
  return null;
}

function resolveBase(root, requested) {
  for (const ref of requested ? [requested] : ["origin/main", "main", "master"]) {
    if (tryGit(root, "rev-parse", "--verify", "--quiet", ref) !== null) return ref === "HEAD" ? "HEAD" : (tryGit(root, "merge-base", ref, "HEAD") ?? "").trim() || null;
  }
  return null;
}

/**
 * The other lines that name the symbol: in its own file always, and — only when it is exported — in the files that
 * mention its module by name. A private `main` has no callers outside its file, and searching the whole tree for
 * the word listed every `main` in the repository.
 */
/**
 * The files that import a module, for the languages whose imports name a path: JavaScript and TypeScript
 * (`from "./x/analyze.mjs"`, `require("../analyze")`) and Python (`from pkg.analyze import`, `import analyze`).
 * A mention of the word is not an import — a module called `analyze` or `index` is named in comments and in other
 * modules' own names all over a tree. Other languages keep the word search.
 */
const IMPORTS_BY_PATH = /\.(?:[cm]?[jt]sx?|py)$/;
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function importersOf(root, file) {
  const module = path.basename(file).replace(/\.[^.]+$/, "");
  if (!IMPORTS_BY_PATH.test(file)) return (tryGit(root, "grep", "-l", "-w", "--", module) ?? "").split("\n").filter(Boolean);
  const m = escapeRe(module);
  const pattern = `(from|require\\(|import\\()[[:space:]]*["'][^"']*\\b${m}(\\.[a-z]+)?["']|^[[:space:]]*(from[[:space:]]+[[:alnum:]_.]*\\b${m}[[:space:]]+import|import[[:space:]]+[[:alnum:]_.]*\\b${m}\\b)`;
  return (tryGit(root, "grep", "-l", "-E", "-e", pattern) ?? "").split("\n").filter(Boolean);
}

function callersOf(root, symbol, hunk) {
  const importers = symbol.exported ? importersOf(root, hunk.file) : [];
  const files = [...new Set([hunk.file, ...importers])];
  const out = tryGit(root, "grep", "-n", "-w", "-e", symbol.name, "--", ...files) ?? "";
  return out
    .split("\n")
    .filter(Boolean)
    .map((row) => row.match(/^(.+?):(\d+):/))
    .filter(Boolean)
    .map(([, file, line]) => ({ file, line: Number(line) }))
    .filter((hit) => !(hit.file === hunk.file && (hit.line === symbol.line || (hit.line >= hunk.newStart && hit.line < hunk.newStart + Math.max(1, hunk.newLines)))))
    .map((hit) => `${hit.file}:${hit.line}`);
}

/** The lines in `from..to` (1-based, inclusive) that declare something. */
function declarationLines(lines, from, to) {
  const out = [];
  for (let i = from; i <= Math.min(to, lines.length); i++) {
    if (DECLARATION.some((pattern) => (lines[i - 1].match(pattern) ?? [])[1] && !KEYWORDS.has(lines[i - 1].match(pattern)[1]))) out.push(i);
  }
  return out;
}

/**
 * An added block split at each declaration it holds, so three new functions are three rows, and the doc comment
 * above a function travels with it rather than being charged to the function above. A hunk that changes existing
 * lines stays whole: the behaviour it replaced belongs to the symbol it sits in.
 */
export function splitAdded(hunk, lines) {
  const end = hunk.newStart + Math.max(1, hunk.newLines) - 1;
  if (hunk.oldLines) return [hunk];
  const declared = declarationLines(lines, hunk.newStart, end);
  if (declared.length < 2) return [hunk];
  // A declaration's piece begins at the comment and decorator lines directly above it.
  const leading = (line) => /^\s*(?:\/\/|\/\*|\*|#|@)/.test(line ?? "");
  const starts = declared.map((start, i) => {
    let at = start;
    while (i > 0 && at - 1 > declared[i - 1] && leading(lines[at - 2])) at--;
    return at;
  });
  return starts.map((start, i) => {
    const from = i === 0 ? hunk.newStart : start;
    const to = i + 1 < starts.length ? starts[i + 1] - 1 : end;
    return { ...hunk, newStart: from, newLines: to - from + 1 };
  });
}

/** An untracked file is all addition: it is reviewed as one, rather than missed because git diff cannot see it. */
function untrackedHunks(root) {
  const files = (tryGit(root, "ls-files", "--others", "--exclude-standard") ?? "").split("\n").filter(Boolean);
  return files
    .filter((file) => DECLARATION_FILE.test(file))
    .map((file) => ({ file, isNew: true, oldStart: 0, oldLines: 0, newStart: 1, newLines: fs.readFileSync(path.join(root, file), "utf8").split("\n").length }));
}

export function differential(root, base) {
  const resolved = resolveBase(root, base);
  if (!resolved) throw new Error(`no base: none of ${base ?? "origin/main, main, master"} resolves`);
  const hunks = [...parseHunks(git(root, "diff", "-U0", "--no-color", "--no-prefix", resolved)), ...untrackedHunks(root)];
  const readLines = (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), "utf8").split("\n") : []);
  return {
    base: resolved,
    hunks: hunks.flatMap((whole) => {
      const lines = readLines(whole.file);
      return splitAdded(whole, lines).map((hunk) => {
        const inside = declarationLines(lines, hunk.newStart, hunk.newStart + Math.max(1, hunk.newLines) - 1)[0];
        const symbol = enclosingSymbol(lines, hunk.oldLines ? hunk.newStart : (inside ?? hunk.newStart), hunk.file);
        return {
          hunk: `${hunk.file}:${hunk.newStart}-${hunk.newStart + Math.max(0, hunk.newLines - 1)}`,
          replaced: hunk.oldLines ? `${base === "HEAD" ? "HEAD" : resolved.slice(0, 12)}:${hunk.file}:${hunk.oldStart}-${hunk.oldStart + hunk.oldLines - 1}` : hunk.isNew ? "nothing (new file)" : "nothing (pure addition)",
          symbol: symbol?.name ?? null,
          exported: symbol?.exported ?? false,
          callers: symbol ? callersOf(root, symbol, hunk) : [],
        };
      });
    }),
  };
}

export function renderTable(result) {
  const rows = result.hunks.map((h) => `| \`${h.hunk}\` | _${h.replaced}_ | ${h.callers.length ? h.callers.map((c) => `\`${c}\``).join(", ") : h.exported ? "_exported — callers outside this repo_" : "_none found_"} | | |`);
  return ["| Hunk | Replaced | Callers at stake | Risk | Why |", "|------|----------|------------------|------|-----|", ...rows].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node hunks.mjs [--base <ref>] [--root <dir>] [--table]");
    return;
  }
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  try {
    const result = differential(path.resolve(value("--root") ?? "."), value("--base"));
    console.log(args.includes("--table") ? renderTable(result) : JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
