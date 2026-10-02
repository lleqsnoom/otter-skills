#!/usr/bin/env node

/**
 * Create .x-skills/runs/<stamp>-R<nn>-<slug>/E<nn>-implement.md with a resolved header skeleton.
 * Auto-finds the plan the tasks came from — or the epic of a run written before the merge — by topic slug.
 * Usage: node save-plan.mjs --epic <slug> [--branch <name>]
 * Output (stdout): path to the created plan file.
 * NOTE: Timestamps are always JS-generated. No --date flag is accepted.
 */

import fs from "node:fs";
import path from "node:path";
import * as runFolder from "./run-folder.mjs";

/**
 * The artifact whose layers these tasks belong to: the plan, or the epic of a run written before the merge. A run
 * holding both is read from its plan, which is where the epic came from — the same rule `o-decompose` applies when
 * it writes the tasks folder this file sits beside.
 */
function layersArtifact(runDir) {
  return (
    ["plan", "epic"]
      .map((kind) => ({ kind, file: runFolder.resolveArtifact(runDir, kind, "md") }))
      .find((candidate) => fs.existsSync(candidate.file)) ?? null
  );
}

/** A header declaration, aligned the way the artifact's own fields are. */
function declaration(label, value) {
  return `${`${label}:`.padEnd(14)}${value}\n\n`;
}

function main() {
  const args = runFolder.parseArgs(process.argv.slice(2), {
    "--epic": "epic", "-e": "epic",
    "--branch": "branch",
    "--run": "run",
  });

  runFolder.log("o-implement", "parsing arguments");

  if (!args.epic) {
    process.stderr.write("Usage: node save-plan.mjs --epic <slug> [--branch <name>]\n");
    process.exit(1);
  }

  const slug = runFolder.sanitizeSlug(args.epic);
  const branch = args.branch || runFolder.getBranch();
  const date = runFolder.formatStamp();

  const runDir = runFolder.resolveRunDir(slug, { run: args.run === undefined ? null : Number(args.run) });
  const source = layersArtifact(runDir);

  const fullPath = runFolder.resolveArtifact(runDir, "implement", "md");

  try {
    runFolder.ensureDir(runDir);

    let header = `# Tasks — ${args.epic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n\n---\n\n`;

    if (source) {
      header += declaration(source.kind, path.relative(process.cwd(), source.file));
      runFolder.log("o-implement", `resolved ${source.kind} path: ${path.relative(process.cwd(), source.file)}`);
    } else {
      header += declaration("plan", "<run folder>/E00-plan.md");
      runFolder.log("o-implement", "no plan or epic file found for slug — placeholder left");
    }

    runFolder.log("o-implement", `writing tasks file: ${fullPath}`);
    runFolder.writeFile(fullPath, header);

    runFolder.log("o-implement", `plan ready: ${fullPath}`);
    console.log(fullPath);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
