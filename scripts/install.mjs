#!/usr/bin/env node
/**
 * `npm run install` — link this checkout's skills where the agents that run them look.
 *
 * This repository is the source of truth for the skills: they live in `skills/`, and the agents read them from
 * `~/.agents/skills/`, with a second symlink per skill under `~/.claude/skills/` on a machine that has that
 * directory. Both point back here, so a skill edited in this checkout is the skill the next agent runs and nothing
 * has to be installed again.
 *
 * The name is `install`, which npm also fires by itself for `npm install` and `npm ci`. Those are dependency
 * installs rather than this one, and they are skipped — a published copy of the app does not ship `skills/` at all.
 *
 * Usage:
 *   npm run install                # link every skill, replacing whatever is installed under its name
 *   npm run install -- --dry-run   # say what would change and write nothing
 *   npm run install -- --target ~/.agents/skills
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'skills');
const TOOL = 'otter-pm install';

const USAGE = [
  "otter-pm install — link this checkout's skills where the agents read them.",
  '',
  'Usage:',
  '  npm run install [-- --dry-run] [-- --target <dir>]',
  '',
  'Flags:',
  '  --dry-run       Say what would change, write nothing',
  '  --target <dir>  Where to link them (default $HOME/.agents/skills)',
  '  --help, -h      Show this help',
  '',
].join('\n');

function home() {
  return process.env.HOME || homedir();
}

function parseArgs(argv) {
  const args = { dryRun: false, target: join(home(), '.agents', 'skills'), help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') args.help = true;
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--target') args.target = argv[(index += 1)] ?? args.target;
    else if (flag.startsWith('--target=')) args.target = flag.slice('--target='.length);
    else {
      process.stderr.write(`${TOOL}: unknown argument: ${flag}\n\n${USAGE}`);
      process.exit(2);
    }
  }
  args.target = resolve(args.target);
  return args;
}

/** Only a directory with a SKILL.md is a skill; anything else in `skills/` is not installed. */
function skills() {
  return readdirSync(SOURCE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SOURCE, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function isSymlink(file) {
  return lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true;
}

/** A path is either already the link we want, or it is an older copy of the same skill and is replaced by one. */
function link(file, wanted, args) {
  if (isSymlink(file) && readlinkSync(file) === wanted) return 'kept';
  if (args.dryRun) return existsSync(file) ? 'relink' : 'link';

  mkdirSync(dirname(file), { recursive: true });
  if (isSymlink(file)) unlinkSync(file);
  else rmSync(file, { recursive: true, force: true });
  symlinkSync(wanted, file);
  return 'linked';
}

/**
 * Agents that read `~/.claude/skills` reach a skill through a link of their own, so a machine that has that
 * directory gets one per skill. A machine without it is left alone: this fills that directory, it does not create it.
 */
function mirrorSkill(name, skillsHome, args) {
  const root = join(home(), '.claude');
  if (!existsSync(root)) return 'absent';

  const file = join(root, 'skills', name);
  return link(file, relative(dirname(file), join(skillsHome, name)), args);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (process.env.npm_command && process.env.npm_command !== 'run') {
    process.stdout.write(`${TOOL}: npm install installs dependencies, not skills — run \`npm run install\` for that\n`);
    return;
  }

  if (!existsSync(SOURCE)) {
    process.stderr.write(`${TOOL}: no skills/ in ${ROOT} — nothing to install\n`);
    process.exitCode = 1;
    return;
  }

  const names = skills();
  const mirror = existsSync(join(home(), '.claude'));
  let changed = 0;

  for (const name of names) {
    const action = link(join(args.target, name), relative(args.target, join(SOURCE, name)), args);
    const mirrored = mirror ? mirrorSkill(name, args.target, args) : 'absent';
    if (action === 'linked') changed += 1;
    process.stdout.write(`${TOOL}: ${action.padEnd(6)} ${name}${mirror ? ` (${mirrored})` : ''}\n`);
  }

  process.stdout.write(
    `${TOOL}: ${args.dryRun ? 'would link' : 'linked'} ${changed} of ${names.length} skills to ${ROOT} from ${args.target}` +
      (mirror ? `, mirrored under ${join(home(), '.claude', 'skills')}` : '') +
      '\n',
  );
}

main();
