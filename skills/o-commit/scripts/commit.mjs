#!/usr/bin/env node
/**
 * Validate a conventional commit message and commit the staged change with it, in one step.
 *
 * Usage: node scripts/commit.mjs "<subject>" [--body "<one paragraph: why>"]
 *    or: echo "<message>" | node scripts/commit.mjs
 * Exit 0 = committed, 1 = validation or git failed (no commit made), 2 = no message.
 *
 * git runs without a shell, so nothing in a message — quotes, `$(…)`, backticks — is ever interpreted.
 * A body is accepted only for a large staged change; see validate-commit.mjs.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { validateBody, validateMessage } from "./validate-commit.mjs";

export function parseArgs(argv) {
  const words = [];
  let body = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--body") body = argv[++i] ?? "";
    else words.push(argv[i]);
  }
  return { message: words.join(" "), body };
}

/** Files and changed lines in the staged diff — the size a body has to be earned by. */
function stagedSize() {
  const numstat = execFileSync("git", ["diff", "--cached", "--numstat"], { encoding: "utf8" });
  const rows = numstat.split("\n").filter(Boolean).map((row) => row.split("\t"));
  const lines = rows.reduce((sum, [added, removed]) => sum + (Number(added) || 0) + (Number(removed) || 0), 0);
  return { files: rows.length, lines };
}

const USAGE = `Usage: node commit.mjs "<subject>" [--body "<one paragraph: why>"]
Validates the message, then commits what is staged. A body is accepted only for a change of 10+ files or 400+ lines.`;

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const fromArgs = process.argv.length > 2;
  const { message, body } = fromArgs ? parseArgs(process.argv.slice(2)) : { message: fs.readFileSync(0, "utf8"), body: null };
  if (!message.trim()) {
    console.error(`ERROR: no commit message provided.\n${USAGE}`);
    process.exit(2);
  }

  const problems = [...validateMessage(message), ...(body === null ? [] : validateBody(body, stagedSize()))];
  if (problems.length) {
    for (const problem of problems) console.error(`ERROR: ${problem}`);
    process.exit(1);
  }

  const [subject, , footer] = message.trim().split("\n");
  const parts = [subject, body?.trim(), footer].filter(Boolean).flatMap((part) => ["-m", part]);
  try {
    execFileSync("git", ["commit", ...parts], { stdio: "inherit" });
  } catch {
    console.error("ERROR: git commit failed.");
    process.exit(1);
  }
  console.log(`Committed: ${subject}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
