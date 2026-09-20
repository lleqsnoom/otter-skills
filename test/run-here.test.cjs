'use strict';

/**
 * `otter-pm-here` is for the moment you are standing in a checkout and want *that* build — a branch you just
 * switched to, a worktree, a dirty tree you are testing. It differs from `oc-otter-pm` in exactly one way: the
 * checkout comes from the working directory, not from a default path. The three things that make it useful are
 * that it finds the repository root from a subdirectory, that it refuses a directory that is not a checkout, and
 * that it rebuilds when the sources are newer than the build (the trap `serve` alone cannot see).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HERE = path.join(ROOT, 'scripts', 'otter-pm-here');

function tempStateHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-here-state-'));
}

function publishedUrl(stateHome) {
  const file = path.join(stateHome, 'otter-pm', 'url');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}

/** A buildable copy of the app. The build tests must not rebuild the shared dist/ other files are serving from. */
function buildableScratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-scratch-'));
  for (const dir of ['scripts', 'src', 'public']) {
    fs.cpSync(path.join(ROOT, dir), path.join(root, dir), { recursive: true });
  }
  for (const file of ['package.json', 'astro.config.mjs', 'tsconfig.json']) {
    fs.symlinkSync(path.join(ROOT, file), path.join(root, file));
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'));
  return root;
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePromise(port));
    });
  });
}

function runHere(args, { cwd, stateHome }) {
  return spawn('bash', [HERE, ...args], {
    cwd,
    env: { ...process.env, XDG_STATE_HOME: stateHome },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
}

/** Stop the launcher *and* the server it started: they share a process group, and only the group is complete. */
function stop(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function collect(child) {
  let out = '';
  let complaint = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (complaint += chunk));
  return { out: () => out, complaint: () => complaint };
}

async function waitFor(check, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for the launcher');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
}

async function statusOf(url, pathname = '/api/snapshot') {
  try {
    return (await fetch(new URL(pathname, url))).status;
  } catch {
    return null;
  }
}

test('it serves the build in the directory it is run from', async (t) => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const child = runHere(['serve', '--port', String(port)], { cwd: ROOT, stateHome });
  t.after(() => stop(child));
  const log = collect(child);

  const url = await waitFor(() => publishedUrl(stateHome));

  assert.equal(url, `http://127.0.0.1:${port}/`);
  await waitFor(async () => (await statusOf(url)) === 200);
  assert.match(log.out(), /Otter PM → http/, 'it says where it is serving');
});

test('from a subdirectory it runs the repository root', async (t) => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const child = runHere(['serve', '--port', String(port)], { cwd: path.join(ROOT, 'src'), stateHome });
  t.after(() => stop(child));

  const url = await waitFor(() => publishedUrl(stateHome));

  assert.equal(url, `http://127.0.0.1:${port}/`, 'the root, not src/');
  await waitFor(async () => (await statusOf(url)) === 200);
});

test('it names the path when there is no checkout to run', async () => {
  const stateHome = tempStateHome();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-nothing-'));

  const child = runHere(['serve'], { cwd: empty, stateHome });
  const log = collect(child);
  const code = await new Promise((resolvePromise) => child.on('exit', resolvePromise));

  assert.notEqual(code, 0, 'a directory that is not a checkout is a failure');
  assert.ok(
    log.complaint().includes(path.join(empty, 'scripts', 'launch.mjs')),
    `the message names where it looked (${log.complaint().trim()})`,
  );
});

test('it rebuilds when the sources are newer than the build', async (t) => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const scratch = buildableScratch();
  execFileSync('npm', ['run', 'build'], { cwd: scratch, stdio: 'ignore' });
  const built = path.join(scratch, 'dist', 'server', 'entry.mjs');
  const builtAt = fs.statSync(built).mtimeMs;
  fs.utimesSync(path.join(scratch, 'src', 'styles.css'), new Date(), new Date());

  const child = runHere(['serve', '--port', String(port)], { cwd: scratch, stateHome });
  t.after(() => stop(child));
  const log = collect(child);

  await waitFor(() => publishedUrl(stateHome));

  assert.match(log.out(), /building/i, 'a stale build is rebuilt rather than served');
  assert.ok(fs.statSync(built).mtimeMs > builtAt, 'and the build output is newer than it was');
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
});

/** A `systemctl` that records what it was asked to do, so a test can see the restart without a service manager. */
function stubSystemctl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-bin-'));
  const record = path.join(dir, 'systemctl.args');
  const file = path.join(dir, 'systemctl');
  fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${record}"\n`, { mode: 0o755 });
  return {
    dir,
    calls: () => (fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n') : []),
  };
}

function pointedRoot(stateHome) {
  const file = path.join(stateHome, 'otter-pm', 'root');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}

test('use points the machine at this checkout and restarts the service', async () => {
  const stateHome = tempStateHome();
  const systemctl = stubSystemctl();

  const child = spawn('bash', [HERE, 'use'], {
    cwd: ROOT,
    env: { ...process.env, XDG_STATE_HOME: stateHome, PATH: `${systemctl.dir}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = collect(child);
  const code = await new Promise((resolvePromise) => child.on('exit', resolvePromise));

  assert.equal(code, 0, `${log.complaint()}${log.out()}`);
  assert.equal(pointedRoot(stateHome), ROOT, 'the pointer names the checkout it was run in');
  assert.ok(
    systemctl.calls().some((call) => call === '--user restart oc-otter-pm'),
    `the running service is replaced (calls: ${systemctl.calls().join(' | ') || 'none'})`,
  );
});

test('use from a subdirectory points at the repository root', async () => {
  const stateHome = tempStateHome();
  const systemctl = stubSystemctl();

  const child = spawn('bash', [HERE, 'use'], {
    cwd: path.join(ROOT, 'src'),
    env: { ...process.env, XDG_STATE_HOME: stateHome, PATH: `${systemctl.dir}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const code = await new Promise((resolvePromise) => child.on('exit', resolvePromise));

  assert.equal(code, 0);
  assert.equal(pointedRoot(stateHome), ROOT);
});

test('use refuses a directory that is not a checkout, and changes nothing', async () => {
  const stateHome = tempStateHome();
  const systemctl = stubSystemctl();
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-nothing-'));

  const child = spawn('bash', [HERE, 'use'], {
    cwd: empty,
    env: { ...process.env, XDG_STATE_HOME: stateHome, PATH: `${systemctl.dir}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = collect(child);
  const code = await new Promise((resolvePromise) => child.on('exit', resolvePromise));

  assert.notEqual(code, 0, 'a directory that is not a checkout cannot become the version');
  assert.ok(log.complaint().includes(path.join(empty, 'scripts', 'launch.mjs')), 'the message names where it looked');
  assert.equal(pointedRoot(stateHome), null, 'and the pointer is left alone');
  assert.deepEqual(systemctl.calls(), [], 'and no service is touched');
});

test('use rebuilds before it swaps, so the new version is what starts', async () => {
  const stateHome = tempStateHome();
  const systemctl = stubSystemctl();
  const scratch = buildableScratch();
  execFileSync('npm', ['run', 'build'], { cwd: scratch, stdio: 'ignore' });
  const built = path.join(scratch, 'dist', 'server', 'entry.mjs');
  const builtAt = fs.statSync(built).mtimeMs;
  fs.utimesSync(path.join(scratch, 'src', 'styles.css'), new Date(), new Date());

  const child = spawn('bash', [HERE, 'use'], {
    cwd: scratch,
    env: { ...process.env, XDG_STATE_HOME: stateHome, PATH: `${systemctl.dir}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = collect(child);
  await new Promise((resolvePromise) => child.on('exit', resolvePromise));

  assert.match(log.out(), /building/i, 'a stale build is rebuilt before the service is restarted');
  assert.ok(fs.statSync(built).mtimeMs > builtAt, 'and the build output is newer than it was');
  fs.rmSync(scratch, { recursive: true, force: true });
});
