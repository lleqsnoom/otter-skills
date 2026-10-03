#!/usr/bin/env node

/**
 * Session-start summary — a SessionStart hook that surfaces the last handoff brief, what the last heal
 * did and the last background reflection, so a session starts where the previous one stopped and a
 * rejected proposal is visible instead of silent. Prints one line; nothing when none of the files exists.
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

export function readBriefPointer(cwd = process.cwd()) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(cwd, ".o-skills", "runs", "last-brief.json"), "utf8"));
  } catch {
    return null;
  }
}

export function renderLine({ summary, report, brief } = {}) {
  const parts = [];
  if (brief?.brief) parts.push(`last brief: ${brief.brief} — read it before starting`);
  if (summary) {
    parts.push(`last heal: landed ${summary.landed?.length ?? 0}, rejected ${summary.rejected?.length ?? 0}`);
  }
  if (report?.report) {
    parts.push(`last background report: ${report.report}`);
  }
  return parts.length ? parts.join(" · ") : "";
}

function main() {
  const line = renderLine({ summary: readSummary(), report: readReportPointer(), brief: readBriefPointer() });
  if (line) process.stdout.write(`${line}\n`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
