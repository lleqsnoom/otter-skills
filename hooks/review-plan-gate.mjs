#!/usr/bin/env node

/**
 * The review-plan gate: refuses an o-review plan missing one of the five pass headings. o-review's prose already
 * says a plan without [Comments], [Bloat], [Architecture], [Floor] and [Spec] is incomplete, not clean; this makes
 * that enforced rather than remembered, with one actionable line per missing heading.
 *
 * Run by hand, it judges the text it is given — raw stdin or a file path argument — and exits 1 on a gap. Run as
 * a PostToolUse hook (hooks/hooks.json), it receives the tool payload, ignores every file that is not a
 * `*-review-plan.md`, and exits 2 on a gap: the code Claude Code hands back to the model, so the agent that wrote
 * the plan is the one told to finish it. save-plan.mjs writes every heading before the review starts, so a plan
 * filled in one edit at a time never trips the gate halfway.
 */

import { readFileSync } from "node:fs";

const HEADINGS = [
  ["[Comments]", "comments pass (o-comments)"],
  ["[Bloat]", "bloat pass (o-unbloat)"],
  ["[Architecture]", "architecture pass (o-arch)"],
  ["[Floor]", "floor pass (o-floor)"],
  ["[Spec]", "spec pass"],
];

const REVIEW_PLAN = /-review-plan\.md$/;

const headingLines = (text, heading) =>
  text.split("\n").some((line) => line.replace(/^[ \t]*(#+[ \t]*)?/, "").startsWith(heading));

const missing = (text) => HEADINGS.filter(([heading]) => !headingLines(text, heading));

const linesFor = (missingHeadings) =>
  missingHeadings.map(
    ([heading, pass]) =>
      `review plan is missing ${heading} — o-review requires the ${pass} to report under this heading; add a "## ${heading}" section to the plan`,
  );

const readFileOrNull = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const nonEmpty = (value) => typeof value === "string" && value.trim() !== "";

const parsePayload = (stdin) => {
  const trimmed = stdin.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const payload = JSON.parse(trimmed);
    return payload && typeof payload === "object" && "tool_input" in payload ? payload : null;
  } catch {
    return null;
  }
};

/** What a hook payload asks the gate to judge: the plan text, or null when the write was not a review plan. */
const planFromPayload = (payload) => {
  const input = payload.tool_input ?? {};
  if (!nonEmpty(input.file_path) || !REVIEW_PLAN.test(input.file_path)) return null;
  if (nonEmpty(input.content)) return input.content;
  return readFileOrNull(input.file_path);
};

const judge = (text, failCode) => {
  const gaps = missing(text ?? "");
  if (gaps.length === 0) process.exit(0);
  for (const line of linesFor(gaps)) console.error(line);
  process.exit(failCode);
};

const stdin = readFileOrNull(0) ?? "";
const [file] = process.argv.slice(2);
const payload = file ? null : parsePayload(stdin);

if (file) judge(readFileOrNull(file) ?? stdin, 1);
else if (payload) {
  const plan = planFromPayload(payload);
  if (plan === null) process.exit(0);
  judge(plan, 2);
} else judge(stdin, 1);
