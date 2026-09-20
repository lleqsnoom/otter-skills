import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The project's own Astro CLI, run directly.
 *
 * `npx astro …` would put an `npm exec` wrapper between this script and the server, and that wrapper does not
 * forward signals — so a ctrl-c handled in the terminal would stop the wrapper while the server kept the port,
 * and `child.kill()` in these scripts would be killing the wrong process. Spawning the CLI's own entry point with
 * the running Node binary makes the server a direct child: one process less, and a signal that arrives where it
 * was aimed.
 *
 * The entry point is looked up the way Node resolves a module rather than at a fixed path, because there are two
 * installs: this app's own, where `node_modules/astro` sits beside it, and a project that depends on it, where npm
 * usually hoists Astro to the consumer's root. A fixed `join(toolRoot, 'node_modules', 'astro')` found only the
 * first, so the published package could build on the machine that packed it and nowhere else.
 */
function astroBin(toolRoot) {
  for (let dir = resolve(toolRoot); ; ) {
    const candidate = join(dir, 'node_modules', 'astro', 'bin', 'astro.mjs');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Whether Astro can be found from here at all — the question `dev` asks before it starts anything. */
export function hasAstro(toolRoot) {
  return astroBin(toolRoot) !== null;
}

export function spawnAstro(toolRoot, args, options = {}) {
  const bin = astroBin(toolRoot);
  if (!bin) throw new Error("Astro is not installed: npm install");
  return spawn(process.execPath, [bin, ...args], { cwd: toolRoot, ...options });
}