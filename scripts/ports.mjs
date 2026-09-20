#!/usr/bin/env node
import { createServer } from 'node:net';

/** The first port at or after `start` that nothing is listening on. */
export function findFreePort(start, host = '127.0.0.1', attempts = 20) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = () => {
      if (port >= start + attempts) {
        reject(new Error(`no free port in ${start}..${start + attempts - 1}`));
        return;
      }
      const probe = createServer();
      probe.unref();
      probe.once('error', () => {
        port += 1;
        tryPort();
      });
      probe.listen(port, host, () => {
        const chosen = port;
        probe.close(() => resolve(chosen));
      });
    };
    tryPort();
  });
}

/** Reads `--port 4321` / `--port=4321` out of an argv, falling back to `$PORT` and then `fallback`. */
export function requestedPort(argv, fallback = 4321) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port' && argv[index + 1]) return Number(argv[index + 1]);
    if (arg.startsWith('--port=')) return Number(arg.slice('--port='.length));
  }
  const fromEnv = Number(process.env.PORT);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : fallback;
}