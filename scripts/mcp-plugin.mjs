#!/usr/bin/env node
/**
 * The MCP server as the Claude Code plugin starts it.
 *
 * A plugin is copied into Claude Code's cache without `node_modules`, so the server's packages live in the plugin's
 * data directory, which survives plugin updates. They install in two stages, because a client gives a server
 * seconds, not minutes, to answer its handshake:
 *
 *   core/   the MCP SDK and zod — small, pure JavaScript — installed before the server starts;
 *   index/  LanceDB and transformers.js — hundreds of megabytes with native parts — installed by a detached
 *           background process. Until they land, the knowledge tools say the index is unavailable and the exact
 *           tools (find_symbols, search_code, read_code) work.
 *
 * A checkout with its own node_modules (the npm install route) skips both. stdout belongs to the protocol, so npm's
 * output goes to stderr in the first stage and to index/install.log in the second.
 *
 * Usage: node mcp-plugin.mjs <plugin data dir>                  start the server (the plugin's .mcp entry)
 *        node mcp-plugin.mjs --install-index <plugin data dir>  the background stage, run by the first
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CORE = ['@modelcontextprotocol/sdk', 'zod'];
/** A background install that has not finished in this long died with its machine; the next start retries it. */
const STALE_INSTALL_MS = 30 * 60 * 1000;

const USAGE = `Usage: node mcp-plugin.mjs <plugin data dir>
       node mcp-plugin.mjs --install-index <plugin data dir>
Starts the otter-skills MCP server for the Claude Code plugin, installing its packages into the data directory.`;

/** The dependencies one stage installs, split from the package's own list so a version bump reaches both. */
export function stages(dependencies) {
  const pick = (keep) => Object.fromEntries(Object.entries(dependencies).filter(([name]) => keep(name)));
  return { core: pick((name) => CORE.includes(name)), index: pick((name) => !CORE.includes(name)) };
}

/** Whether a stage directory holds exactly these dependencies: the stamp is written only after npm succeeded. */
export function installed(dir, dependencies) {
  try {
    return readFileSync(join(dir, '.installed'), 'utf8') === JSON.stringify(dependencies);
  } catch {
    return false;
  }
}

function npm(dir, stdio) {
  // npm is a .cmd on Windows, which only a shell can run; the arguments are fixed, so the shell parses nothing else.
  const windows = process.platform === 'win32';
  execFileSync(windows ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: dir, stdio, shell: windows });
}

/** Install one stage: its package.json, npm, then the stamp. */
export function installStage(dir, dependencies, { stdio = ['ignore', 2, 2], run = npm } = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ private: true, name: 'otter-skills-plugin-deps', dependencies }, null, 2)}\n`);
  run(dir, stdio);
  writeFileSync(join(dir, '.installed'), JSON.stringify(dependencies));
}

/** Start the background stage unless it is done or already running. */
export function startIndexInstall(data, dependencies, { spawnInstall = spawnDetached, now = Date.now() } = {}) {
  const dir = join(data, 'index');
  if (installed(dir, dependencies)) return 'installed';
  const lock = join(dir, '.installing');
  if (existsSync(lock) && now - statSync(lock).mtimeMs < STALE_INSTALL_MS) return 'running';
  mkdirSync(dir, { recursive: true });
  writeFileSync(lock, String(now));
  spawnInstall(data);
  return 'started';
}

function spawnDetached(data) {
  const log = openSync(join(data, 'index', 'install.log'), 'a');
  spawn(process.execPath, [fileURLToPath(import.meta.url), '--install-index', data], { detached: true, stdio: ['ignore', log, log] }).unref();
}

function installIndex(data) {
  const { index } = stages(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies);
  try {
    installStage(join(data, 'index'), index, { stdio: 'inherit' });
  } finally {
    rmSync(join(data, 'index', '.installing'), { force: true });
  }
}

function hasOwnModules() {
  return existsSync(join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
  if (args[0] === '--install-index') {
    installIndex(resolve(args[1]));
    return;
  }
  if (!hasOwnModules()) {
    const data = args[0] ?? process.env.CLAUDE_PLUGIN_DATA;
    if (!data) throw new Error(`no plugin data directory: pass it as the first argument\n${USAGE}`);
    const { core, index } = stages(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).dependencies);
    if (!installed(join(data, 'core'), core)) installStage(join(data, 'core'), core);
    startIndexInstall(data, index);
    const parents = ['core', 'index'].map((stage) => pathToFileURL(join(data, stage, 'package.json')).href);
    register(new URL('./plugin-resolve.mjs', import.meta.url), { data: { parents } });
  }
  await import('./mcp.mjs');
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`otter-skills-mcp: ${error.message}\n`);
    process.exit(1);
  });
}
