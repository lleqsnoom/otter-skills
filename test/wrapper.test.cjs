'use strict';

/**
 * The installed entry point is a wrapper script, and its whole job is to make "which checkout" a variable rather
 * than a working directory. That matters because a supervisor starts the service from a directory neither the
 * service nor the person chose: if the launcher leaned on `process.cwd()` for its config, the board's saved
 * decisions would land somewhere different depending on who started it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WRAPPER = path.join(ROOT, 'scripts', 'oc-otter-pm');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function publishedUrl(stateHome) {
  const file = path.join(stateHome, 'otter-pm', 'url');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}

function runWrapper(args, { cwd, stateHome, root = ROOT, extraEnv = {} }) {
  return spawn('bash', [WRAPPER, ...args], {
    cwd,
    env: { ...process.env, XDG_STATE_HOME: stateHome, OTTER_PM_ROOT: root, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
}

function collect(child) {
  let out = '';
  let complaint = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (complaint += chunk));
  return new Promise((resolvePromise) => {
    child.on('exit', (code) => resolvePromise({ code, out, complaint }));
  });
}

async function waitFor(check, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
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

/**
 * How the process *this test started* was launched, read from `/proc/${pid}/task/${pid}/children`.
 *
 * Scanning every process for the entry path looks equivalent and is not: a second board may be running on the
 * machine — `npm start` does exactly that, and passes no `--config` — and the scan would find it first.
 */
function childArgv(launcherPid) {
  try {
    const children = fs.readFileSync(`/proc/${launcherPid}/task/${launcherPid}/children`, 'utf8').trim().split(/\s+/);
    return fs.readFileSync(`/proc/${children[0]}/cmdline`, 'utf8').split('\0');
  } catch {
    return null;
  }
}

/** Stop the launcher *and* the server it started: they share a process group, and only the group is complete. */
function stop(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

test('the wrapper runs the launcher from the checkout it is pointed at, from any directory', async () => {
  const stateHome = tempDir('otter-pm-state-');
  const elsewhere = tempDir('otter-pm-cwd-');
  fs.mkdirSync(path.join(stateHome, 'otter-pm'), { recursive: true });
  fs.writeFileSync(path.join(stateHome, 'otter-pm', 'url'), 'http://127.0.0.1:4321/\n');

  const ran = await collect(runWrapper(['port'], { cwd: elsewhere, stateHome }));

  assert.equal(ran.code, 0, ran.complaint);
  assert.equal(ran.out.trim(), 'http://127.0.0.1:4321/', 'the published URL, read through the wrapper');
});

test('the wrapper names the path it could not find', async () => {
  const stateHome = tempDir('otter-pm-state-');
  const misplaced = path.join(tempDir('otter-pm-missing-'), 'not-a-checkout');

  const ran = await collect(runWrapper(['port'], { cwd: tempDir('otter-pm-cwd-'), stateHome, root: misplaced }));

  assert.notEqual(ran.code, 0, 'a checkout that is not there is a failure, not a silent no-op');
  assert.ok(ran.complaint.includes(misplaced), `the message names the path it looked for (${ran.complaint.trim()})`);
});

test('the wrapper serves with no arguments, the way the unit calls it', async (t) => {
  const stateHome = tempDir('otter-pm-state-');
  const port = await freePort();
  const child = runWrapper(['--port', String(port)], { cwd: tempDir('otter-pm-cwd-'), stateHome });
  t.after(() => stop(child));

  const url = await waitFor(() => publishedUrl(stateHome));
  await waitFor(async () => {
    try {
      return (await fetch(new URL('/api/snapshot', url))).status === 200;
    } catch {
      return false;
    }
  });

  assert.equal(url, `http://127.0.0.1:${port}/`);
  assert.equal((await fetch(new URL('/api/snapshot', url))).status, 200, 'and the app it serves answers');
});

test('the server is started with the checkout config named explicitly', async (t) => {
  if (!fs.existsSync('/proc')) {
    t.skip('reading another process’ arguments needs /proc');
    return;
  }

  const stateHome = tempDir('otter-pm-state-');
  const port = await freePort();
  const child = runWrapper(['--port', String(port)], { cwd: tempDir('otter-pm-cwd-'), stateHome });
  t.after(() => stop(child));
  await waitFor(() => publishedUrl(stateHome));

  const config = path.join(ROOT, 'otter-pm.config.json');
  const argv = await waitFor(() => childArgv(child.pid));

  assert.ok(argv.includes('--config'), `the server is told which config to use (got ${argv.join(' ')})`);
  assert.ok(argv.includes(config), 'and it is the checkout’s own config, not whatever cwd held');
});

test('the pointer file decides which checkout the wrapper runs', async () => {
  const stateHome = tempDir('otter-pm-state-');
  const elsewhere = tempDir('otter-pm-pointer-');
  fs.mkdirSync(path.join(elsewhere, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(elsewhere, 'scripts', 'launch.mjs'),
    "process.stdout.write('from the pointer\\n');\n",
  );
  fs.mkdirSync(path.join(stateHome, 'otter-pm'), { recursive: true });
  fs.writeFileSync(path.join(stateHome, 'otter-pm', 'root'), `${elsewhere}\n`);

  const ran = await collect(
    spawn('bash', [WRAPPER, 'port'], {
      cwd: tempDir('otter-pm-cwd-'),
      env: { ...process.env, XDG_STATE_HOME: stateHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );

  assert.equal(ran.code, 0, ran.complaint);
  assert.equal(ran.out.trim(), 'from the pointer', 'the pointer wins over the built-in default');
});

test('an explicit OTTER_PM_ROOT still wins over the pointer', async () => {
  const stateHome = tempDir('otter-pm-state-');
  const pointed = tempDir('otter-pm-pointer-');
  fs.mkdirSync(path.join(pointed, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pointed, 'scripts', 'launch.mjs'), "process.stdout.write('from the pointer\\n');\n");
  fs.mkdirSync(path.join(stateHome, 'otter-pm'), { recursive: true });
  fs.writeFileSync(path.join(stateHome, 'otter-pm', 'root'), `${pointed}\n`);

  const asked = tempDir('otter-pm-asked-');
  fs.mkdirSync(path.join(asked, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(asked, 'scripts', 'launch.mjs'), "process.stdout.write('from the ask\\n');\n");

  const ran = await collect(
    spawn('bash', [WRAPPER, 'port'], {
      cwd: tempDir('otter-pm-cwd-'),
      env: { ...process.env, XDG_STATE_HOME: stateHome, OTTER_PM_ROOT: asked },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );

  assert.equal(ran.out.trim(), 'from the ask', 'an explicit root is not overridden by what the machine was pointed at');
});
