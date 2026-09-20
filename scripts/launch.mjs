#!/usr/bin/env node
/**
 * Serve the built app on a port the machine can find again, and publish that URL where the front doors read it.
 *
 * The port is published because it cannot be known in advance: `ports.mjs` steps to the first free one, so a dev
 * server and this service can sit side by side and the service lands on 4322. The same file is also the state that
 * separates "never started" from "started and then died", which is what `open` reports on.
 *
 *   otter-pm serve [--port <n>]   the server, in the foreground, on the first free port at or after the one asked
 *   otter-pm open [--browser]     show the board in a chrome-less window, or in a browser tab
 *   otter-pm port                 the URL a server published, or a failure when nothing is serving
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findFreePort, requestedPort } from './ports.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(TOOL_ROOT, 'dist', 'server', 'entry.mjs');
const TOOL = 'oc-otter-pm';
const UNIT = 'oc-otter-pm.service';
const WINDOW_DOOR = 'omarchy-launch-webapp';
const BROWSER_DOOR = 'xdg-open';
const READY_WAIT_MS = 10000;

/** `refused` is the one answer that means "nothing is there" rather than "not yet". */
const UP = 'up';
const REFUSED = 'refused';
const SILENT = 'silent';

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function stateDir(env) {
  return join(env.XDG_STATE_HOME || join(env.HOME, '.local', 'state'), 'otter-pm');
}

function publishedUrlFile(env = process.env) {
  return join(stateDir(env), 'url');
}

function publishedUrl(env = process.env) {
  const file = publishedUrlFile(env);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

function publish(url, env) {
  mkdirSync(stateDir(env), { recursive: true });
  writeFileSync(publishedUrlFile(env), `${url}\n`);
}

function unpublish(env) {
  rmSync(publishedUrlFile(env), { force: true });
}

function fail(message) {
  process.stderr.write(`${TOOL}: ${message}\n`);
  process.exit(1);
}

async function serve(argv, env) {
  if (!existsSync(ENTRY)) {
    fail(`the app is not built: ${ENTRY} is missing (run npm run build)`);
  }

  const host = env.HOST || '127.0.0.1';
  const port = await findFreePort(requestedPort(argv), host);
  const url = `http://${host}:${port}/`;

  publish(url, env);
  process.stdout.write(`Otter PM → ${url}\npress ctrl-c to stop\n`);

  const server = spawn(process.execPath, [ENTRY], {
    cwd: TOOL_ROOT,
    stdio: 'inherit',
    env: { ...env, PORT: String(port), HOST: host },
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.kill(signal));
  }
  server.on('exit', (code) => {
    unpublish(env);
    process.exit(code ?? 0);
  });
}

function port(env) {
  const url = publishedUrl(env);
  if (!url) fail('nothing is serving: no URL has been published');
  process.stdout.write(`${url}\n`);
}

/** `/api/snapshot` is the app's own readiness signal: it answers only once the trees are read and the shell can render. */
async function probe(url) {
  try {
    const response = await fetch(new URL('/api/snapshot', url), { signal: AbortSignal.timeout(2000) });
    return response.status === 200 ? UP : SILENT;
  } catch (error) {
    return error.cause?.code === 'ECONNREFUSED' ? REFUSED : SILENT;
  }
}

async function reachable(url, timeoutMs = READY_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await probe(url);
    if (state !== SILENT) return state;
    if (Date.now() >= deadline) return SILENT;
    await delay(100);
  }
}

function frontDoor(argv) {
  return argv.includes('--browser')
    ? { command: BROWSER_DOOR, name: 'browser' }
    : { command: WINDOW_DOOR, name: 'window' };
}

async function open(argv, env) {
  const url = publishedUrl(env);
  if (!url) fail(`nothing is serving: no URL has been published (start it with systemctl --user start ${UNIT})`);

  if ((await reachable(url)) !== UP) {
    fail(`nothing answers on the published URL: ${url} (is ${UNIT} running?)`);
  }

  const door = frontDoor(argv);
  if (argv.includes('--dry-run')) {
    process.stdout.write(`${url} ${door.name}\n`);
    return;
  }

  const launcher = spawn(door.command, [url], { detached: true, stdio: 'ignore', env });
  launcher.on('error', () => fail(`cannot open a window: ${door.command} is not available`));
  launcher.unref();
}

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'serve';

if (command === 'serve') await serve(argv, process.env);
else if (command === 'open') await open(argv, process.env);
else if (command === 'port') port(process.env);
else fail(`unknown command: ${command} (serve, open, port)`);
