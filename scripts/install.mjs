#!/usr/bin/env node
/**
 * `npm run install` — link this checkout's skills where the agents that run them look.
 *
 * This repository is the source of truth for the skills: they live in `skills/`, and the agents read them from
 * `~/.agents/skills/`, with a second symlink per skill under `~/.claude/skills/` on a machine that has that
 * directory. Both point back here, so a skill edited in this checkout is the skill the next agent runs and nothing
 * has to be installed again.
 *
 * The MCP server is installed the same way, into the config of each agent that already has one on this machine. The
 * entry names this checkout's `scripts/mcp.mjs` rather than the published bin, because a checkout can guarantee its
 * own path and the bin is not published yet.
 *
 * The name is `install`, which npm also fires by itself for `npm install` and `npm ci`. Those are dependency
 * installs rather than this one, and they are skipped — a published copy of the app does not ship `skills/` at all.
 *
 * Usage:
 *   npm run install                # link every skill, replacing whatever is installed under its name
 *   npm run install -- --dry-run   # say what would change and write nothing
 *   npm run install -- --target ~/.agents/skills
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'skills');
const TOOL = 'otter-skills install';
const SERVER = 'otter-skills';
const MCP_SCRIPT = join(ROOT, 'scripts', 'mcp.mjs');

/**
 * Where each agent keeps its MCP servers and what its entry needs beyond the command. Both shapes were read off the
 * clients rather than guessed: Claude Code holds them under `mcpServers`, and Crush holds them directly under `mcp`,
 * where every entry carries its `type`.
 */
const AGENTS = [
  { config: join(home(), '.claude.json'), section: 'mcpServers', extra: {} },
  { config: join(configHome(), 'crush', 'crush.json'), section: 'mcp', extra: { type: 'stdio' } },
];

const USAGE = [
  "otter-skills install — link this checkout's skills, and its MCP server, where the agents look for them.",
  '',
  'Usage:',
  '  npm run install [-- --dry-run] [-- --target <dir>]',
  '',
  'Flags:',
  '  --dry-run       Say what would change, write nothing',
  '  --target <dir>  Where to link the skills (default $HOME/.agents/skills)',
  '  --help, -h      Show this help',
  '',
  'An agent whose MCP config already exists is given an `otter-skills` server entry; one without a config is left alone.',
  '',
].join('\n');

function home() {
  return process.env.HOME || homedir();
}

function configHome() {
  return process.env.XDG_CONFIG_HOME || join(home(), '.config');
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

/**
 * An entry compared as we would write it, so a run that changed nothing does nothing, and a key order somebody edited
 * by hand is not mistaken for a change.
 */
const canonical = (entry) => JSON.stringify(Object.fromEntries(Object.entries(entry ?? {}).sort()));

/** One rename, so a kill mid-write cannot leave an agent holding a half-written config. */
function writeJson(file, document) {
  const temporary = `${file}.otter-skills-install`;
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
  renameSync(temporary, file);
}

/** The JSON an agent left behind, or the reason it cannot be used. */
function readDocument(file) {
  let document;
  try {
    document = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { failed: error.message };
  }
  if (typeof document !== 'object' || document === null) return { failed: 'it does not hold a JSON object' };
  return { document };
}

/**
 * One agent's config and the servers already in it, or the reason it cannot be filled.
 *
 * A file this process did not write is read defensively: one that cannot be parsed, or whose server section is not an
 * object, is reported rather than replaced — it belongs to the agent, and losing it would cost more than the entry.
 */
function openConfig(agent) {
  if (!existsSync(agent.config)) return { action: 'absent' };

  const read = readDocument(agent.config);
  if (read.failed) return { action: 'failed', detail: read.failed };

  const servers = read.document[agent.section] ?? {};
  if (typeof servers !== 'object' || Array.isArray(servers)) {
    return { action: 'failed', detail: `\`${agent.section}\` is not an object` };
  }
  return { document: read.document, servers };
}

/** One agent's config: the entry added, updated or kept, or the reason it was left alone. */
function registerOne(agent, launch, args) {
  const config = openConfig(agent);
  if (config.action) return config;

  const wanted = { ...launch, ...agent.extra };
  const current = config.servers[SERVER];
  if (canonical(current) === canonical(wanted)) return { action: 'kept' };

  const action = current === undefined ? 'added' : 'updated';
  if (!args.dryRun) {
    writeJson(agent.config, { ...config.document, [agent.section]: { ...config.servers, [SERVER]: wanted } });
  }
  return { action };
}

/**
 * Register this checkout's MCP server with every agent that already has a config — the rule the skills follow too:
 * this fills a config that exists rather than writing one into a directory the agent does not use.
 */
function registerMcp(args) {
  const launch = { command: 'node', args: [MCP_SCRIPT] };
  const lines = [];
  let registered = 0;
  let failed = 0;

  for (const agent of AGENTS) {
    const { action, detail } = registerOne(agent, launch, args);
    if (action === 'failed') {
      process.stderr.write(`${TOOL}: ${agent.config}: ${detail}\n`);
      failed += 1;
    }
    if (action === 'added' || action === 'updated') registered += 1;
    lines.push(`${TOOL}: ${action.padEnd(8)} ${SERVER} mcp in ${agent.config}`);
  }

  return { lines, registered, failed };
}

/** Link every skill, collecting the line each one earns and how many were not already right. */
function installSkills(args) {
  const names = skills();
  const mirror = existsSync(join(home(), '.claude'));
  const lines = [];
  let linked = 0;

  for (const name of names) {
    const action = link(join(args.target, name), relative(args.target, join(SOURCE, name)), args);
    const mirrored = mirror ? mirrorSkill(name, args.target, args) : 'absent';
    if (action === 'linked') linked += 1;
    lines.push(`${TOOL}: ${action.padEnd(6)} ${name}${mirror ? ` (${mirrored})` : ''}`);
  }

  return { names, mirror, linked, lines };
}

/** What the run did, in two lines, so that `main` only has to print them. */
function summary(args, installed, mcp) {
  const skillsLine =
    `${TOOL}: ${args.dryRun ? 'would link' : 'linked'} ${installed.linked} of ${installed.names.length}` +
    ` skills to ${ROOT} from ${args.target}` +
    (installed.mirror ? `, mirrored under ${join(home(), '.claude', 'skills')}` : '');
  const mcpLine =
    `${TOOL}: ${args.dryRun ? 'would register' : 'registered'} ${SERVER} mcp with ` +
    `${mcp.registered} of ${AGENTS.length} agents`;

  return `${skillsLine}\n${mcpLine}\n`;
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

  const installed = installSkills(args);
  const mcp = registerMcp(args);

  for (const line of [...installed.lines, ...mcp.lines]) process.stdout.write(`${line}\n`);
  process.stdout.write(summary(args, installed, mcp));

  if (mcp.failed) process.exitCode = 1;
}

main();
