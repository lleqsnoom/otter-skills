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
import * as shared from "./shared.mjs";

/**
 * The artifact whose layers these tasks belong to: the plan, or the epic of a run written before the merge. A run
 * holding both is read from its plan, which is where the epic came from — the same rule `x-decompose` applies when
 * it writes the tasks folder this file sits beside.
 */
function layersArtifact(runDir) {
  return (
    ["plan", "epic"]
      .map((kind) => ({ kind, file: shared.resolveArtifact(runDir, kind, "md") }))
      .find((candidate) => fs.existsSync(candidate.file)) ?? null
  );
}

/** A header declaration, aligned the way the artifact's own fields are. */
function declaration(label, value) {
  return `${`${label}:`.padEnd(14)}${value}\n\n`;
}

function main() {
  const args = shared.parseArgs(process.argv.slice(2), {
    "--epic": "epic", "-e": "epic",
    "--branch": "branch",
    "--run": "run",
  });

  shared.log("x-implement", "parsing arguments");

  if (!args.epic) {
    process.stderr.write("Usage: node save-plan.mjs --epic <slug> [--branch <name>]\n");
    process.exit(1);
  }

  const slug = shared.sanitizeSlug(args.epic);
  const branch = args.branch || shared.getBranch();
  const date = shared.formatStamp();

  const runDir = shared.resolveRunDir(slug, { run: args.run === undefined ? null : Number(args.run) });
  const source = layersArtifact(runDir);

  const fullPath = shared.resolveArtifact(runDir, "implement", "md");

  try {
    shared.ensureDir(runDir);

    let header = `# Tasks — ${args.epic}\n\n**Date:** ${date}\n**Branch:** ${branch}\n\n---\n\n`;

    if (source) {
      header += declaration(source.kind, path.relative(process.cwd(), source.file));
      shared.log("x-implement", `resolved ${source.kind} path: ${path.relative(process.cwd(), source.file)}`);
    } else {
      header += declaration("plan", "<run folder>/E00-plan.md");
      shared.log("x-implement", "no plan or epic file found for slug — placeholder left");
    }

    shared.log("x-implement", `writing tasks file: ${fullPath}`);
    shared.writeFile(fullPath, header);

    shared.log("x-implement", `plan ready: ${fullPath}`);
    console.log(fullPath);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
