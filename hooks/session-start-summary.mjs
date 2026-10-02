#!/usr/bin/env node

/**
 * Session-start summary — a SessionStart hook that surfaces what the last heal and the last
 * background reflection did, so a rejected proposal and a background report are visible instead of
 * silent. Reads two files and prints one line; prints nothing and exits 0 when neither exists.
 *
 * Usage: installed as a SessionStart hook. No arguments.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function readSummary(cwd = process.cwd()) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(cwd, ".o-skills", "runs", "last-heal-summary.json"), "utf8"));
  } catch {
    return null;
  }
}

export function readReportPointer(cwd = process.cwd()) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(cwd, ".o-skills", "runs", "last-background-report.json"), "utf8"));
  } catch {
    return null;
  }
}

export function renderLine({ summary, report } = {}) {
  const parts = [];
  if (summary) {
    parts.push(`last heal: landed ${summary.landed?.length ?? 0}, rejected ${summary.rejected?.length ?? 0}`);
  }
  if (report?.report) {
    parts.push(`last background report: ${report.report}`);
  }
  return parts.length ? parts.join(" · ") : "";
}

function main() {
  const line = renderLine({ summary: readSummary(), report: readReportPointer() });
  if (line) process.stdout.write(`${line}\n`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
