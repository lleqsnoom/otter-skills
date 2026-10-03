#!/usr/bin/env node
/**
 * o-domain's format check. A glossary entry without its "not to be confused with" line is unfinished — the
 * boundary is what the next argument will be about — and an ADR without context, decision, consequences and a
 * status cannot be read by whoever re-litigates it next.
 *
 * Usage: node check-domain.mjs [--root .]
 * Output: JSON { glossaries, adrDir, adrs, violations }.  Exit: 0 clean · 1 a violation · 2 usage error
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Where a repo keeps its decision records, in the order people most often choose. */
export const ADR_DIRS = ["docs/adr", "docs/adrs", "docs/decisions", "docs/architecture/decisions", "adr", "doc/adr", "decisions"];

const NOT_LINE = /\bnot to be confused with\b|\bnot the same as\b|^\s*\*\*?not\*\*?[:\s]|^\s*not:\s/im;
const ADR_SECTIONS = ["context", "decision", "consequences"];
const ADR_STATUS = /^(?:##\s*status\b|\*\*status:?\*\*|status:)/im;

/** Each `## Term` entry in a glossary, with the line it starts on. */
export function glossaryEntries(text) {
  const entries = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) entries.push({ term: heading[1], line: index + 1, body: [] });
    else if (entries.length) entries.at(-1).body.push(line);
  });
  return entries.map((entry) => ({ ...entry, body: entry.body.join("\n") }));
}

export function checkGlossary(file, text) {
  return glossaryEntries(text)
    .filter((entry) => !NOT_LINE.test(entry.body))
    .map((entry) => ({ rule: "glossary-no-not-line", file, line: entry.line, detail: `"${entry.term}" has no line saying what it is not` }));
}

export function checkAdr(file, text) {
  const headings = [...text.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1].toLowerCase());
  const missing = ADR_SECTIONS.filter((section) => !headings.some((heading) => heading.startsWith(section)));
  const out = missing.map((section) => ({ rule: "adr-section-missing", file, line: 1, detail: `no ## ${section[0].toUpperCase()}${section.slice(1)} section` }));
  if (!ADR_STATUS.test(text)) out.push({ rule: "adr-no-status", file, line: 1, detail: "no status (proposed, accepted, superseded by NNNN)" });
  return out;
}

export function findAdrDir(root) {
  return ADR_DIRS.find((dir) => fs.existsSync(path.join(root, dir)) && fs.statSync(path.join(root, dir)).isDirectory()) ?? null;
}

/** GLOSSARY.md at the root, plus every glossary a GLOSSARY-MAP.md links to. */
export function findGlossaries(root) {
  const found = fs.existsSync(path.join(root, "GLOSSARY.md")) ? ["GLOSSARY.md"] : [];
  const map = path.join(root, "GLOSSARY-MAP.md");
  if (fs.existsSync(map)) {
    for (const [, target] of fs.readFileSync(map, "utf8").matchAll(/\]\(([^)]+GLOSSARY[^)]*\.md)\)/g)) {
      if (fs.existsSync(path.join(root, target)) && !found.includes(target)) found.push(target);
    }
  }
  return found;
}

export function checkDomain(root) {
  const glossaries = findGlossaries(root);
  const adrDir = findAdrDir(root);
  const adrs = adrDir ? fs.readdirSync(path.join(root, adrDir)).filter((name) => /^\d{3,4}[-_].+\.md$/.test(name)).map((name) => `${adrDir}/${name}`) : [];
  const violations = [
    ...glossaries.flatMap((file) => checkGlossary(file, fs.readFileSync(path.join(root, file), "utf8"))),
    ...adrs.flatMap((file) => checkAdr(file, fs.readFileSync(path.join(root, file), "utf8"))),
  ];
  return { glossaries, adrDir, adrs: adrs.length, violations };
}

const USAGE = `Usage: node check-domain.mjs [--root <dir>]
Checks GLOSSARY.md not-lines and ADR sections. Exit 0 clean, 1 violations, 2 usage.`;

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const args = process.argv.slice(2);
  const at = args.indexOf("--root");
  if (args.some((arg, i) => arg.startsWith("--") && arg !== "--root" && args[i - 1] !== "--root")) {
    console.error(USAGE);
    process.exit(2);
  }
  const result = checkDomain(path.resolve(at === -1 ? "." : args[at + 1]));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.violations.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
