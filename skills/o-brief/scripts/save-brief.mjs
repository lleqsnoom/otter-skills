#!/usr/bin/env node
/**
 * Create the handoff brief where the next session will look for it, and leave the pointer it reads.
 *
 * Usage: node save-brief.mjs --slug <topic> [--dir <run folder>]
 *   --dir    the run the work belongs to; without it a new `.o-skills/runs/<stamp>-R<nn>-<slug>/` is made, R<nn>
 *            being this topic's next run number
 * Writes <run folder>/E<nn>-brief.md (the six sections, ready to fill) and .o-skills/runs/last-brief.json, and
 * prints the brief's path. The session-start hook prints that pointer, so the next session starts from it.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RUNS = path.join(".o-skills", "runs");
const pad = (n) => String(n).padStart(2, "0");

export function stamp(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** The next free `E<nn>` in a run folder. */
export function nextE(dir) {
  const used = fs.existsSync(dir) ? fs.readdirSync(dir).map((name) => name.match(/^E(\d{2})-/)?.[1]).filter(Boolean).map(Number) : [];
  return `E${pad(used.length ? Math.max(...used) + 1 : 0)}`;
}

/** The next `R<nn>` for a topic: runs are numbered per slug, as every other skill's run folder is. */
export function nextRun(runsDir, slug) {
  const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((name) => name.endsWith(`-${slug}`)) : [];
  const used = runs.map((name) => Number(name.match(/-R(\d+)-/)?.[1] ?? 0));
  return `R${pad(Math.max(0, ...used) + 1)}`;
}

/** The same check the run-folder region makes: a brief in a scratch folder outside any repository is lost with it. */
function outsideProjectWarning(dirAbs) {
  const temp = path.resolve(process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp");
  if (dirAbs !== temp && !dirAbs.startsWith(`${temp}${path.sep}`)) return null;
  for (let dir = dirAbs; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return null;
    if (path.dirname(dir) === dir) break;
  }
  return `${dirAbs} is in a temp folder outside any repository, which is cleared and is not the project: save the brief from the project root`;
}

export const SKELETON = (slug) => `# Brief — ${slug}

## Do next
1. 

## Where this stands


## Settled
- 

## Open
- 

## Suggested skills
- 

## Sources
- 
`;

export function saveBrief({ slug, dir = null, root = process.cwd(), now = new Date() }) {
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("--slug is a lower-case kebab-case topic");
  const runDir = dir ? path.resolve(root, dir) : path.join(root, RUNS, `${stamp(now)}-${nextRun(path.join(root, RUNS), slug)}-${slug}`);
  const warning = outsideProjectWarning(path.resolve(runDir));
  if (warning) process.stderr.write(`warning: ${warning}\n`);
  fs.mkdirSync(runDir, { recursive: true });
  const file = path.join(runDir, `${nextE(runDir)}-brief.md`);
  fs.writeFileSync(file, SKELETON(slug));
  const pointer = path.join(root, RUNS, "last-brief.json");
  fs.mkdirSync(path.dirname(pointer), { recursive: true });
  const relative = path.relative(root, file).split(path.sep).join("/");
  fs.writeFileSync(pointer, `${JSON.stringify({ brief: relative, at: now.toISOString() })}\n`);
  return { brief: relative, pointer: path.relative(root, pointer).split(path.sep).join("/") };
}

const USAGE = `Usage: node save-brief.mjs --slug <topic> [--dir <run folder>]
Writes <run folder>/E<nn>-brief.md with the six sections and points .o-skills/runs/last-brief.json at it.`;

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  try {
    console.log(JSON.stringify(saveBrief({ slug: value("--slug"), dir: value("--dir") }), null, 2));
  } catch (error) {
    console.error(`Error: ${error.message}\n${USAGE}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
