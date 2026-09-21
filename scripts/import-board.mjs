#!/usr/bin/env node

import { existsSync } from 'node:fs';

import { importLegacyBoard, legacyBoardFile } from '../src/server/board.mjs';
import { projectIdFor, resolveRoots } from '../src/server/config.mjs';

/**
 * Move a board filed before the store was per project into the projects it belongs to. Why this is a command rather
 * than something a read does quietly is in `src/server/board.mjs`; what this adds is the report — per project, what
 * was taken from the old file.
 *
 * Usage:
 *   node scripts/import-board.mjs [--from <old board.json>] [--dry-run]
 *
 * `--from` defaults to `$OTTER_PM_BOARD`, else the `board.json` beside this checkout's `otter-pm.config.json` — the
 * two places the old file could be.
 */
function parseArgs(argv) {
  const args = { from: null, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--help' || flag === '-h') args.help = true;
    else if (flag === '--from') args.from = argv[(index += 1)] ?? null;
    else if (flag.startsWith('--from=')) args.from = flag.slice('--from='.length);
    else {
      process.stderr.write(`Unknown argument: ${flag}\n`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write('Usage: node scripts/import-board.mjs [--from <old board.json>] [--dry-run]\n');
  process.exit(0);
}

const file = args.from || legacyBoardFile();
if (!existsSync(file)) {
  process.stderr.write(`Otter PM: no board to import — ${file} is not there.\n`);
  process.stderr.write('Name the old file with --from <path>.\n');
  process.exit(1);
}

const { roots } = resolveRoots({});
const projects = roots.map((root) => ({ id: projectIdFor(root), root }));
if (!projects.length) {
  process.stderr.write('Otter PM: this machine lists no projects, so there is nowhere to import into.\n');
  process.exit(1);
}

const report = importLegacyBoard({ file, projects, dryRun: args.dryRun });

process.stdout.write(`Otter PM: reading ${report.file}${args.dryRun ? ' (dry run — nothing written)' : ''}\n`);
for (const entry of report.projects) {
  const counted = `${entry.counts.moves} moves · ${entry.counts.deleted} archived · ${entry.counts.orders} lanes`;
  if (entry.status === 'imported') process.stdout.write(`  ${entry.id}: ${counted} → ${entry.file}\n`);
  else if (entry.status === 'merged' && entry.added)
    process.stdout.write(`  ${entry.id}: ${counted} → ${entry.file} (into the board it already had; ${entry.added} new)\n`);
  else if (entry.status === 'merged')
    process.stdout.write(`  ${entry.id}: nothing new — its own board already answers for every one of these\n`);
  else if (entry.status === 'failed') process.stderr.write(`  ${entry.id}: could not write ${entry.file}: ${entry.error}\n`);
}

const written = report.projects.filter((entry) => entry.status === 'imported' || (entry.status === 'merged' && entry.added));
const failed = report.projects.filter((entry) => entry.status === 'failed');
if (failed.length) process.exit(1);
if (!written.length) {
  process.stdout.write('  nothing to import — no project in that file is waiting for its decisions\n');
  process.exit(1);
}

const decisions = written.reduce((sum, entry) => sum + entry.added, 0);
process.stdout.write(
  `  ${decisions} decision${decisions === 1 ? '' : 's'} into ${written.length} project${written.length === 1 ? '' : 's'}\n`,
);
