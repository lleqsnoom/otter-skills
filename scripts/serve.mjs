#!/usr/bin/env node
/**
 * `npm run serve` — the built app, served on the first free port at or after `--port`.
 *
 * The build is Astro's and the server is Astro's own node adapter entry (`dist/server/entry.mjs`), started with
 * `PORT`/`HOST` in the environment, which is what the adapter reads. Both are spawned directly rather than through
 * `npx`, so a ctrl-c here reaches the server rather than stopping a wrapper in front of it.
 *
 * Flags:
 *   --port <n>   Port to start looking from (default 4321).
 *   --no-build   Serve whatever is in dist/, without building first.
 *   --build      Build even when dist/ already exists.
 *
 * The roots are the ones otter-pm.config.json holds; this only serves the app that reads them.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnAstro } from './astro.mjs';
import { findFreePort, requestedPort } from './ports.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = resolve(TOOL_ROOT, 'dist', 'server', 'entry.mjs');

function waitFor(child, label) {
  return new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${label} exited ${code}`))));
  });
}

const argv = process.argv.slice(2);
const shouldBuild = !argv.includes('--no-build') && (!existsSync(ENTRY) || argv.includes('--build'));
const host = process.env.HOST || '127.0.0.1';

if (shouldBuild) {
  console.log('building Otter PM…');
  await waitFor(spawnAstro(TOOL_ROOT, ['build'], { stdio: 'inherit' }), 'astro build');
}

const port = await findFreePort(requestedPort(argv));
console.log(`Otter PM → http://${host}:${port}`);
console.log('press ctrl-c to stop');

const server = spawn(process.execPath, [ENTRY], {
  cwd: TOOL_ROOT,
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port), HOST: host },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code) => process.exit(code ?? 0));