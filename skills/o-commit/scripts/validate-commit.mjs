#!/usr/bin/env node
/**
 * Validate a conventional commit message against the spec.
 * Usage: node scripts/validate-commit.mjs "<message>"
 *    or: echo "<message>" | node scripts/validate-commit.mjs
 * Exit 0 = valid, exit 1 = invalid, exit 2 = no message.
 *
 * A message is one subject line, optionally followed by one blank line and a single `BREAKING CHANGE:` footer.
 * A body paragraph is passed separately to commit.mjs (`--body`) and checked by `validateBody`.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const VALID_TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"];

const SUBJECT = new RegExp(`^(${VALID_TYPES.join("|")})(\\([^()\\s][^()]*\\))?!?: \\S.*$`);
const ATTRIBUTION = /\b(assisted-by|co-authored-by|signed-off-by|generated[- ]by|generated with)\b/i;

/** Body limits: a short "why" for a large change, not a changelog. */
export const BODY_MAX_CHARS = 600;
/** A body is allowed only when the staged change is at least this large. */
export const BODY_MIN_FILES = 10;
export const BODY_MIN_LINES = 400;

/** The problems with a message, or [] when it is valid. */
export function validateMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) return ["no commit message provided"];
  const [subject, ...rest] = text.split("\n");
  const problems = [];

  if (ATTRIBUTION.test(text)) problems.push("the message must not carry attribution or co-author lines");
  if (subject.endsWith(".")) problems.push("the subject must not end with a period");
  if (!SUBJECT.test(subject)) problems.push(`"${subject}" is not a conventional subject: type[(scope)][!]: description — types: ${VALID_TYPES.join(", ")}`);

  if (rest.length) {
    const [blank, footer, ...more] = rest;
    const isFooter = blank === "" && /^BREAKING CHANGE: \S/.test(footer ?? "") && more.length === 0;
    if (!isFooter) problems.push("the message must be a single line; the only exception is one blank line and a single `BREAKING CHANGE:` footer");
  }
  return problems;
}

/** The problems with a body for a change of this size, or [] when it may be used. */
export function validateBody(body, { files, lines }) {
  const text = String(body ?? "").trim();
  if (!text) return ["the body is empty"];
  const problems = [];
  if (files < BODY_MIN_FILES && lines < BODY_MIN_LINES) {
    problems.push(`a body is for a large change (${BODY_MIN_FILES}+ files or ${BODY_MIN_LINES}+ lines); this one touches ${files} file(s), ${lines} line(s) — keep it to the subject`);
  }
  if (text.includes("\n\n")) problems.push("the body is one paragraph");
  if (text.length > BODY_MAX_CHARS) problems.push(`the body is at most ${BODY_MAX_CHARS} characters; this one is ${text.length}`);
  if (ATTRIBUTION.test(text)) problems.push("the body must not carry attribution or co-author lines");
  return problems;
}

const USAGE = `Usage: node validate-commit.mjs "<message>"
Exit 0 when the message is a valid conventional commit, 1 with the reason otherwise.`;

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const message = process.argv.length > 2 ? process.argv.slice(2).join(" ") : fs.readFileSync(0, "utf8");
  if (!message.trim()) {
    console.error(USAGE);
    process.exit(2);
  }
  const problems = validateMessage(message);
  for (const problem of problems) console.error(`ERROR: ${problem}`);
  if (problems.length) process.exit(1);
  console.log(`OK: ${message.trim()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
