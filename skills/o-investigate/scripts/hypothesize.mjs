#!/usr/bin/env node
/**
 * Ranked starting hypotheses from an error text, from the pattern library o-debug shares.
 * Usage: node hypothesize.mjs --error "<error text>"
 * Output: JSON array of { rank, id, description, test, likelihood }. An empty array means no known pattern
 * matched — write the hypotheses from the code and the trace instead.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { matchErrors } from "./error-patterns.mjs";

export function generateHypotheses(errorText) {
  return matchErrors(errorText).map((entry, index) => ({
    rank: index + 1,
    id: entry.category,
    description: entry.description,
    test: entry.test,
    likelihood: entry.likelihood,
  }));
}

const USAGE = `Usage: node hypothesize.mjs --error "<error text>"
Prints ranked hypotheses for the error, each with the check that would confirm or reject it, as JSON.`;

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const args = process.argv.slice(2);
  const at = args.indexOf("--error");
  const errorText = at === -1 ? "" : args[at + 1] ?? "";
  if (!errorText) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(1);
  }
  const hypotheses = generateHypotheses(errorText);
  if (!hypotheses.length) process.stderr.write("No known error pattern matched: write the hypotheses from the code and the trace.\n");
  console.log(JSON.stringify(hypotheses, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
