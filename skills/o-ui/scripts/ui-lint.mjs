#!/usr/bin/env node
/**
 * The pre-flight items a search can settle, settled by a search: removed focus rings, `transition: all`,
 * clickable divs, font sizes off the type scale, pure black text and justified or centred paragraphs — in CSS, in
 * JSX style objects and in Tailwind classes. Everything visual — hierarchy, grouping, the one loud thing — still
 * needs the screen in front of you; this only takes the mechanical items off the checklist.
 *
 * Usage: node ui-lint.mjs <file-or-dir>... [--scale 12,14,16,18,20,24,30]
 * Output: JSON { files, violations: [{ rule, file, line, detail }] }.  Exit: 0 clean · 1 a violation · 2 usage
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EXTENSIONS = new Set([".css", ".scss", ".sass", ".less", ".html", ".vue", ".svelte", ".jsx", ".tsx", ".astro"]);
const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".nuxt", "vendor"]);
export const DEFAULT_SCALE = [12, 14, 16, 18, 20, 24, 30];

// A value as CSS writes it (`outline: none`), as a JSX style object writes it (`outline: "none"`), or as a Tailwind
// class (`outline-none`).
const RULES = [
  {
    rule: "focus-ring-removed",
    test: (line, ctx) => (/outline\s*:\s*["']?(?:none|0)\b/.test(line) || /\boutline-(?:none|0)\b/.test(line)) && !ctx.hasFocusVisible,
    detail: "outline removed with no :focus-visible replacement in this file",
  },
  {
    rule: "transition-all",
    test: (line) => /transition(?:-property|Property)?\s*:\s*["']?all\b/.test(line) || /(?<![\w-])transition-all\b/.test(line),
    detail: "`transition: all` — name the properties (transform, opacity)",
  },
  { rule: "clickable-div", test: (line) => /<(?:div|span)\b[^>]*\s(?:onclick|onClick|@click|v-on:click|on:click)\s*=/.test(line), detail: "a clickable div or span — use <button> or <a>" },
  {
    rule: "pure-black-text",
    test: (line) => /(?<![\w-])color\s*:\s*["']?(?:#000(?:000)?\b|black\b)/i.test(line) || /(?<![\w-])text-black\b/.test(line),
    detail: "pure black text — use a near-black (#111 to #333)",
  },
  {
    rule: "justified-text",
    test: (line) => /text-?align\s*:\s*["']?justify\b|textAlign\s*:\s*["']justify/i.test(line) || /(?<![\w-])text-justify\b/.test(line),
    detail: "justified text — align body text left",
  },
  {
    rule: "centred-paragraph",
    test: (line) => /<p\b[^>]*(?:text-align\s*:\s*center|textAlign\s*:\s*["']center|(?<![\w-])text-center\b)/.test(line),
    detail: "a centred paragraph — align body text left",
  },
];

/** Every px font size on a line: `font-size: 15px`, `fontSize: 15`, `fontSize: "15px"`, `text-[15px]`. */
function fontSizes(line) {
  const sizes = [];
  for (const [, px] of line.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) sizes.push(px);
  for (const [, px] of line.matchAll(/fontSize\s*:\s*["']?(\d+(?:\.\d+)?)(?:px)?["']?\s*[,}]/g)) sizes.push(px);
  for (const [, px] of line.matchAll(/(?<![\w-])text-\[(\d+(?:\.\d+)?)px\]/g)) sizes.push(px);
  return sizes.map(Number);
}

export function lintText(file, text, { scale = DEFAULT_SCALE } = {}) {
  const ctx = { hasFocusVisible: /:focus-visible|focus-visible:/.test(text) };
  const violations = [];
  text.split("\n").forEach((line, index) => {
    for (const { rule, test, detail } of RULES) if (test(line, ctx)) violations.push({ rule, file, line: index + 1, detail });
    for (const px of fontSizes(line)) {
      if (!scale.includes(px)) violations.push({ rule: "off-scale-font-size", file, line: index + 1, detail: `${px}px is not on the type scale ${scale.join("/")}` });
    }
  });
  return violations;
}

function collect(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return EXTENSIONS.has(path.extname(target)) ? [target] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => (SKIP.has(entry.name) ? [] : collect(path.join(target, entry.name))));
}

const USAGE = `Usage: node ui-lint.mjs <file-or-dir>... [--scale 12,14,16,18,20,24,30]
Reports removed focus rings, transition: all, clickable divs, off-scale font sizes, pure black text and justified or
centred paragraphs, in CSS, JSX style objects and Tailwind classes. Exit 0 clean, 1 a violation, 2 usage.`;

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const args = process.argv.slice(2);
  const scaleAt = args.indexOf("--scale");
  const scale = scaleAt === -1 ? DEFAULT_SCALE : args[scaleAt + 1].split(",").map(Number);
  const targets = args.filter((arg, i) => !arg.startsWith("--") && (scaleAt === -1 || i !== scaleAt + 1));
  if (!targets.length || targets.some((t) => !fs.existsSync(t))) {
    console.error(USAGE);
    process.exit(2);
  }
  const files = targets.flatMap(collect);
  const violations = files.flatMap((file) => lintText(file, fs.readFileSync(file, "utf8"), { scale }));
  console.log(JSON.stringify({ files: files.length, violations }, null, 2));
  process.exitCode = violations.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
