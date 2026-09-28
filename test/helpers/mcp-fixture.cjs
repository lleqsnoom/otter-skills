'use strict';

/**
 * One repository for the MCP suite to read: a `.x-skills` tree with a task and a plan, a README and a source file
 * beside it, and a real git history so the tracked-file reader has something to find. Committed with an explicit
 * identity, because the machine running the tests may have no `user.email` configured and a fixture that depends on
 * one would fail for a reason that has nothing to do with the code.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

const TASK = `# Task: First task

**Layer:** 0 — Skeleton
**Effort:** 1h
**Files:** src/thing.mjs (new)

## Goal

Make the fixture's first task real.

## Definition of Done

- [x] the checked box
- [ ] the unchecked box
`;

const PLAN = `# Plan — fixture

contract:     the fixture answers
invariant:    nothing is written
test:         a test reads it

## Layers

### L0 — Skeleton
**Objective:** prove the reader works.
**Scope in:** one file.
**Scope out:** everything else.
**Prerequisite:** none.
**Definition of Done:**
- [ ] the fixture reads
`;

function makeRepo({ name = 'fixture-repo', git = true } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-mcp-'));
  const repo = path.join(parent, name);
  const root = path.join(repo, '.x-skills');

  write(path.join(repo, 'README.md'), `# Fixture\n\nSee \`src/thing.mjs\` for the one function.\n`);
  write(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }, null, 2)}\n`);
  write(path.join(repo, 'src', 'thing.mjs'), `export function thing() {\n  return 1;\n}\n`);
  write(path.join(root, 'tasks', '2026-01-01-1000-R01-first.md'), TASK);
  write(path.join(root, 'plan', 'E00-plan.md'), PLAN);

  if (git) {
    const gitIn = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    gitIn(['init', '--quiet']);
    gitIn(['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'add', '-A']);
    gitIn(['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '--quiet', '-m', 'fixture']);
  }

  return {
    parent,
    repo,
    root,
    name,
    taskPath: 'tasks/2026-01-01-1000-R01-first.md',
    planPath: 'plan/E00-plan.md',
    /** The id the scanner derives: the repository folder's name, lowercased. */
    id: name.toLowerCase(),
    write: (relative, contents) => write(path.join(repo, relative), contents),
    writeRoot: (relative, contents) => write(path.join(root, relative), contents),
    cleanup: () => fs.rmSync(parent, { recursive: true, force: true }),
  };
}

/** Runs `body` with the root sources pointed at `paths`, restoring the environment afterwards. */
async function withRoots(paths, body) {
  const previous = process.env.OTTER_PM_ROOTS;
  const previousOrca = process.env.OTTER_PM_ORCA;
  const previousConfig = process.env.OTTER_PM_CONFIG;
  // `$OTTER_PM_ROOTS` is comma-separated, not path-delimited: `splitList` in config.mjs reads commas, semicolons
  // and newlines, so a `:`-joined value would arrive as one path and be rejected as one.
  process.env.OTTER_PM_ROOTS = paths.join(',');
  process.env.OTTER_PM_ORCA = '0';
  // A config found beside the working directory would contribute roots of its own and make the test's answer
  // depend on where it was run from, so it is pointed at a path that does not exist.
  process.env.OTTER_PM_CONFIG = path.join(os.tmpdir(), 'otter-pm-mcp-no-config.json');
  try {
    return await body();
  } finally {
    for (const [key, value] of [
      ['OTTER_PM_ROOTS', previous],
      ['OTTER_PM_ORCA', previousOrca],
      ['OTTER_PM_CONFIG', previousConfig],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

module.exports = { makeRepo, withRoots, write };
