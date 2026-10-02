#!/usr/bin/env node

/**
 * The review-plan gate: a hook that refuses an x-review plan missing one of the four pass headings.
 * x-review's prose already says a plan without [Comments], [Bloat], [Architecture] and [Floor] is
 * incomplete, not clean; this hook makes that enforced rather than remembered, exiting 1 with one
 * actionable line per missing heading and 0, silently, on a complete plan.
 *
 * The host that runs it is not fixed: the plan text arrives as raw stdin, as a positional file path,
 * or as the JSON payload a hook contract hands over (tool_input.content, or tool_input.file_path read
 * from disk). Clients differ in which event fires on the plan write and how they pass the file, so the
 * gate accepts all three and judges only the text.
 */

import { readFileSync } from "node:fs";

const HEADINGS = [
  ["[Comments]", "comments pass (x-comments)"],
  ["[Bloat]", "bloat pass (x-unbloat)"],
  ["[Architecture]", "architecture pass (x-arch)"],
  ["[Floor]", "floor pass (x-floor)"],
];

const headingLines = (text, heading) =>
  text.split("\n").some((line) => line.replace(/^[ \t]*(#+[ \t]*)?/, "").startsWith(heading));

const missing = (text) => HEADINGS.filter(([heading]) => !headingLines(text, heading));

const linesFor = (missingHeadings) =>
  missingHeadings.map(
    ([heading, pass]) =>
      `review plan is missing ${heading} — x-review requires the ${pass} to report under this heading; add a "## ${heading}" section to the plan`,
  );

const readFileOrNull = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const nonEmpty = (value) => typeof value === "string" && value.trim() !== "";

const planFromPayload = (payload) => {
  const input = payload?.tool_input;
  if (nonEmpty(input?.content)) return input.content;
  if (nonEmpty(input?.file_path)) return readFileOrNull(input.file_path);
  return null;
};

const planText = (args, stdin) => {
  const file = args[0];
  if (file) return readFileOrNull(file) ?? stdin;
  const trimmed = stdin.trim();
  if (!trimmed.startsWith("{")) return stdin;
  try {
    return planFromPayload(JSON.parse(trimmed)) ?? stdin;
  } catch {
    return stdin;
  }
};

const stdin = () => readFileOrNull(0) ?? "";

const text = planText(process.argv.slice(2), stdin());
const gaps = missing(text);
if (gaps.length === 0) process.exit(0);
for (const line of linesFor(gaps)) console.error(line);
process.exit(1);