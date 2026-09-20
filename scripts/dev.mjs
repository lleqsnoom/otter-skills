#!/usr/bin/env node
/**
 * `npm run dev` — Otter PM, with hot reload.
 *
 * Astro owns both halves of this app (the shell and the `/api` routes are one server), so the dev loop is one
 * process: Vite is inside Astro, and an edit to a component or to the scanner hot-reloads it.
 *
 * **It always takes the next free port, even when another dev server is running.** Astro keeps a lock file and,
 * left to itself, refuses to start a second server — `Another astro dev server is already running.` — which is
 * the wrong answer for a local app: a dev loop should never be blocked by another one. So this passes
 * `--ignore-lock`, and the two coexist on two ports. The trade-off is the one Astro names when it prints its own
 * note: a server started this way is not tracked by `astro dev stop`, `astro dev status` or `astro dev logs`.
 * Ctrl-c in the terminal that started it is the stop, which is what the banner says.
 *
 * Flags:
 *   --port <n>    Port to start looking from (default 4321).
 *   --host <addr> Address to bind (default 127.0.0.1).
 *   --help        Show this help.
 *
 * Anything else is passed through to `astro dev` (`--open`, `--allowed-hosts`).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnAstro, hasAstro } from './astro.mjs';
import { findFreePort, requestedPort } from './ports.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = [
  'otter-pm dev — Otter PM with hot reload.',
  '',
  'Usage:',
  '  npm run dev [-- --port 4321]',
  '',
  'Flags:',
  '  --port <n>    Port to start looking from (default 4321), stepping to the next free one',
  '  --host <addr> Address to bind (default 127.0.0.1)',
  '  --help        Show this help',
  '',
  '  A dev server already running does not block this one: it is stepped over, and the new server lands on the',
  '  next free port. Anything else is passed to `astro dev` (--open, --allowed-hosts).',
  '',
].join('\n');

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(USAGE);
  process.exit(0);
}

if (!hasAstro(TOOL_ROOT)) {
  process.stderr.write("Otter PM's dependencies are not installed: npm install\n");
  process.exit(1);
}

// Walked rather than scanned: `--host 127.0.0.1` is two arguments, and filtering by pattern would leave the value
// behind for Astro to read as a positional. `--force` is dropped because Astro refuses it alongside
// `--ignore-lock`, and replacing a running server is the one thing this script exists not to do.
const passed = [];
let host = process.env.HOST || '127.0.0.1';
let portFlag = null;
let askedToForce = false;
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--host') host = argv[(index += 1)] ?? host;
  else if (arg.startsWith('--host=')) host = arg.slice('--host='.length);
  else if (arg === '--port') portFlag = Number(argv[(index += 1)]);
  else if (arg.startsWith('--port=')) portFlag = Number(arg.slice('--port='.length));
  else if (arg === '--ignore-lock') continue;
  else if (arg === '--force') askedToForce = true;
  else passed.push(arg);
}

if (askedToForce) {
  process.stderr.write(
    '  --force is ignored: this always starts alongside a running dev server rather than replacing it.\n' +
      "  A server started this way is not in Astro's lock file — ctrl-c in its own terminal is how it stops.\n",
  );
}

const port = await findFreePort(portFlag || requestedPort([], 4321), host);

console.log(
  [
    '',
    `  otter-pm         http://${host}:${port}/`,
    `  reading          every root in otter-pm.config.json`,
    '  ctrl-c to stop',
    '',
  ].join('\n'),
);

const child = spawnAstro(TOOL_ROOT, ['dev', '--port', String(port), '--host', host, '--ignore-lock', ...passed], {
  stdio: 'inherit',
  env: {
    ...process.env,
    // Astro detects an agent CLI (see its `am-i-vibing` check) and, when it finds one, re-spawns itself detached
    // and returns — so `npm run dev` would hand the prompt back while the server ran on, and the signal handlers
    // below would be watching a process that had already gone. Setting this skips that detection, so the dev loop
    // is the foreground process ctrl-c stops.
    ASTRO_DEV_BACKGROUND: '1',
  },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => process.exit(code ?? 0));