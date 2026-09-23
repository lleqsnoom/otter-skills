#!/usr/bin/env node

/**
 * Create .x-skills/runs/<stamp>-R<nn>-<topic>/E00-plan.md with a header skeleton.
 * Usage: node save-spec.mjs --topic <slug> [--branch <name>] [--run <nn>|--new-run]
 * Output (stdout): path to the created spec file.
 */

import { parseArgs, sanitizeSlug, getBranch, formatStamp, resolveRunDir, resolveArtifact, log, ensureDir, writeFile } from "./shared.mjs";

function main() {
  const args = parseArgs(process.argv.slice(2), {
    "--topic": "topic", "-t": "topic",
    "--branch": "branch",
    "--run": "run",
    "--new-run": "newRun",
  });

  log("x-plan", "parsing arguments");

  if (!args.topic) {
    process.stderr.write("Usage: node save-spec.mjs --topic <slug> [--branch <name>]\n");
    process.exit(1);
  }

  const slug = sanitizeSlug(args.topic);
  const branch = args.branch || getBranch();
  log("x-plan", `resolved branch: ${branch}`);

  const date = formatStamp();
  log("x-plan", `using date stamp: ${date}`);

  const runDir = resolveRunDir(slug, {
    fresh: args.newRun === true,
    run: args.run === undefined ? null : Number(args.run),
  });
  const fullPath = resolveArtifact(runDir, "plan", "md");
  log("x-plan", `resolved run folder: ${runDir}`);

  try {
    const header = `# Plan — ${args.topic}

**Date:** ${date}
**Branch:** ${branch}

---

goal:         <outcome in one sentence>
contract:     <interface or API shape>
invariant:    <what must always hold>
test:         <acceptance criterion with given/when/then>
constraint:   <non-functional requirements>

## Layers

### L0 — Skeleton / Prototype

**Objective:** working end-to-end flow with mocks/stubs
**Scope in:**
- <the flow that completes end to end>
**Scope out:**
- <real logic, error handling>
**Prerequisite:** clean project state
**Definition of Done:**
- [ ] <automated check>: \`<command>\`
- [ ] System starts without errors

### L1 — Real Implementation

**Objective:** replace the mocks with the real logic
**Scope in:**
- <the real algorithm, the real data>
**Scope out:**
- <error handling, monitoring>
**Prerequisite:** Layer 0 complete and passing
**Definition of Done:**
- [ ] All L0 tests still pass (regression)
- [ ] <new testable behavior>

## Working notes
<scratch space for hypotheses and edge cases>
`;

    log("x-plan", `creating directory: ${runDir}`);
    ensureDir(runDir);

    log("x-plan", `writing spec file: ${fullPath} (${header.length} bytes)`);
    writeFile(fullPath, header);

    log("x-plan", `spec ready: ${fullPath}`);
    console.log(fullPath);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
