#!/usr/bin/env node

/**
 * Create .x-skills/runs/<stamp>-R<nn>-<topic>/E<nn>-tasks/ staging directory.
 * Auto-finds the plan the tasks come from, by topic slug, for logging.
 * Usage: node save-tasks.mjs --epic <slug> [--run <nn>]
 * Output (stdout): path to the created tasks directory.
 */

import fs from "node:fs";
import path from "node:path";
import * as shared from "./shared.mjs";

/**
 * The artifact whose layers these tasks belong to: the plan, or the epic of a run written before the merge. A
 * run holding both is read from its plan, which is where the epic came from.
 */
function layersArtifact(runDir) {
  return (
    ["plan", "epic"]
      .map((kind) => ({ kind, file: shared.resolveArtifact(runDir, kind, "md") }))
      .find((candidate) => fs.existsSync(candidate.file)) ?? null
  );
}

function main() {
  const args = shared.parseArgs(process.argv.slice(2), {
    "--epic": "epic", "-e": "epic",
    "--run": "run",
  });

  shared.log("x-decompose", "parsing arguments");

  if (!args.epic) {
    process.stderr.write("Usage: node save-tasks.mjs --epic <slug>\n");
    process.exit(1);
  }

  const slug = shared.sanitizeSlug(args.epic);

  const runDir = shared.resolveRunDir(slug, { run: args.run === undefined ? null : Number(args.run) });
  const source = layersArtifact(runDir);

  if (source) {
    shared.log("x-decompose", `resolved ${source.kind} path: ${path.relative(process.cwd(), source.file)}`);
  } else {
    shared.log("x-decompose", "no plan or epic file found for slug");
  }

  const taskDir = shared.resolveArtifact(runDir, "tasks", "");

  try {
    shared.ensureDir(taskDir);
    shared.log("x-decompose", `tasks directory ready: ${taskDir}`);
    console.log(taskDir);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
