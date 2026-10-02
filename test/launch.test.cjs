'use strict';

/**
 * The launcher is what turns "the app is built" into "the board is open": it takes a port, publishes the URL it
 * actually took, and the front doors read that. These tests drive the real script as a child process against a
 * temp state home, so a change that hard-codes 4321, forgets to publish, or leaves a stale URL behind fails here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LAUNCH = path.join(ROOT, 'scripts', 'launch.mjs');

function tempStateHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-state-'));
}

function urlFile(stateHome) {
  return path.join(stateHome, 'otter-pm', 'url');
}

function readPublished(stateHome) {
  const file = urlFile(stateHome);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}

/** A port nothing is listening on right now, asked of the kernel rather than guessed. */
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

/** Hold a port for the length of a test, so the launcher has to step past it. */
function holdPort(port) {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise(server));
  });
}

/**
 * Hold `count` consecutive ports. A free first port says nothing about the ports after it, so a range with a busy
 * port is released whole and another start is tried; nothing held is left open when a range is abandoned.
 */
async function holdRange(count, nextStart = freePort, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const first = await nextStart();
    const held = [];
    try {
      for (let port = first; port < first + count; port += 1) held.push(await holdPort(port));
      return { first, held };
    } catch {
      await Promise.all(held.map((server) => new Promise((done) => server.close(done))));
    }
  }
  throw new Error(`no ${count} consecutive free ports after ${attempts} tries`);
}

function run(args, stateHome, { entry = LAUNCH, ...options } = {}) {
  return spawn(process.execPath, [entry, ...args], {
    cwd: ROOT,
    env: { ...process.env, XDG_STATE_HOME: stateHome },
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
    detached: true,
  });
}

/**
 * A front door that records what it was asked to open. A stub rather than the real one, because these tests run
 * with no display: what is under test is which URL the launcher hands over, not that Chromium can draw a window.
 */
/** Stop the launcher *and* the server it started: they share a process group, and only the group is complete. */
function stop(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function stubFrontDoor(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-door-'));
  const record = path.join(dir, `${name}.args`);
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$1" > "${record}"\n`, { mode: 0o755 });
  return { name, dir, file, record, opened: () => (fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim() : null) };
}

const WINDOW_DOOR = 'omarchy-launch-webapp';
const BROWSER_DOOR = 'xdg-open';

/** The launcher's environment with both front doors stubbed, so no test needs a display. */
function openable(stateHome) {
  const doors = [stubFrontDoor(WINDOW_DOOR), stubFrontDoor(BROWSER_DOOR)];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-path-'));
  for (const door of doors) fs.symlinkSync(door.file, path.join(dir, door.name));
  const [window, browser] = doors;
  return { env: { ...process.env, XDG_STATE_HOME: stateHome, PATH: `${dir}:${process.env.PATH}` }, window, browser };
}

function runToCompletion(args, stateHome, options = {}) {
  const child = run(args, stateHome, options);
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
    if (Date.now() > deadline) throw new Error('timed out waiting for the launcher');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
}

/** The status the app answers with, or null while it is not answering yet. */
async function statusOf(url, pathname = '/') {
  try {
    return (await fetch(new URL(pathname, url))).status;
  } catch {
    return null;
  }
}

/** Move `dist/` aside for one test: the launcher is meant to put it back by building. */
function hideBuildOutput(t) {
  const dist = path.join(ROOT, 'dist');
  const hidden = path.join(ROOT, `dist.test-hidden-${process.pid}`);
  fs.renameSync(dist, hidden);
  t.after(() => {
    if (!fs.existsSync(hidden)) return;
    if (fs.existsSync(dist)) fs.rmSync(hidden, { recursive: true, force: true });
    else fs.renameSync(hidden, dist);
  });
}

async function serve({ stateHome, port }) {
  const child = run(['serve', '--port', String(port)], stateHome);
  const url = await waitFor(() => readPublished(stateHome));
  await waitFor(async () => (await statusOf(url)) === 200);
  return { child, url, stop: () => child.kill('SIGTERM') };
}

test('serve publishes the URL it took, and that URL answers the app', async (t) => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const server = await serve({ stateHome, port });
  t.after(() => server.stop());

  assert.equal(server.url, `http://127.0.0.1:${port}/`);
  assert.equal(
    fs.readFileSync(urlFile(stateHome), 'utf8'),
    `${server.url}\n`,
    'published as one line, so a reader can take the whole file as the URL',
  );
  assert.equal((await statusOf(server.url)), 200, 'the shell is served');
  assert.equal(await statusOf(server.url, '/api/snapshot'), 200, 'and so is the API');
});

test('serve steps past a port that is already taken', async (t) => {
  const stateHome = tempStateHome();
  const taken = await freePort();
  const held = await holdPort(taken);
  t.after(() => held.close());

  const server = await serve({ stateHome, port: taken });
  t.after(() => server.stop());

  assert.equal(server.url, `http://127.0.0.1:${taken + 1}/`, 'the first free port at or after the one asked for');
  assert.equal(await statusOf(server.url), 200);
});

test('serve removes the published URL when it is stopped', async (t) => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const server = await serve({ stateHome, port });
  t.after(() => server.stop());

  server.stop();
  await waitFor(() => (readPublished(stateHome) === null ? true : false));
  assert.equal(readPublished(stateHome), null, 'nothing is published once nothing serves');
});

test('port prints the URL a server published', async (t) => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const server = await serve({ stateHome, port });
  t.after(() => server.stop());

  const printed = await runToCompletion(['port'], stateHome);

  assert.equal(printed.code, 0);
  assert.equal(printed.out.trim(), server.url);
});

test('port fails when nothing has been published', async () => {
  const printed = await runToCompletion(['port'], tempStateHome());

  assert.equal(printed.code, 1, 'a port that was never published is a failure, not an empty answer');
  assert.match(printed.complaint, /nothing is serving/i);
});

test('open hands the published URL to the window front door, and starts no server', async (t) => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const server = await serve({ stateHome, port });
  t.after(() => server.stop());

  const { env, window, browser } = openable(stateHome);

  const opened = await runToCompletion(['open'], stateHome, { env });
  assert.equal(opened.code, 0, opened.complaint);

  // The door is spawned detached and unref'd, so the launcher exits before the door has run: wait for the
  // record rather than reading it on the next line.
  await waitFor(() => window.opened());
  assert.equal(window.opened(), server.url, 'the window door is given the URL that was published');
  assert.equal(browser.opened(), null, 'and the browser door is left alone');

  assert.equal(await statusOf(server.url), 200, 'opening a window did not disturb the server');
  assert.equal(readPublished(stateHome), server.url, 'and did not rewrite what is published');
});

test('open --browser uses the browser front door instead', async (t) => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const server = await serve({ stateHome, port });
  t.after(() => server.stop());

  const { env, window, browser } = openable(stateHome);

  const opened = await runToCompletion(['open', '--browser'], stateHome, { env });
  assert.equal(opened.code, 0, opened.complaint);
  await waitFor(() => browser.opened());
  assert.equal(browser.opened(), server.url);
  assert.equal(window.opened(), null);
});

test('open refuses when nothing has been published, and publishes nothing itself', async () => {
  const stateHome = tempStateHome();
  const { env, window } = openable(stateHome);

  const opened = await runToCompletion(['open'], stateHome, { env });

  assert.notEqual(opened.code, 0, 'a board that cannot open is a failure');
  assert.match(opened.complaint, /oc-otter-pm\.service/, 'the message names the service to start');
  assert.equal(window.opened(), null, 'no window is opened on nothing');
  assert.equal(readPublished(stateHome), null, 'and no URL is invented');
});

test('open refuses a published URL that does not answer', async () => {
  const stateHome = tempStateHome();
  const port = await freePort();
  fs.mkdirSync(path.dirname(urlFile(stateHome)), { recursive: true });
  const stale = `http://127.0.0.1:${port}/`;
  fs.writeFileSync(urlFile(stateHome), `${stale}\n`);

  const { env, window } = openable(stateHome);

  const opened = await runToCompletion(['open'], stateHome, { env });

  assert.notEqual(opened.code, 0, 'a stale URL is a failure, not a window');
  assert.match(opened.complaint, new RegExp(String(port)), 'the message names the port it tried');
  assert.equal(window.opened(), null, 'and no dead window is opened');
});

test('open --dry-run says what it would open, and opens nothing', async (t) => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const server = await serve({ stateHome, port });
  t.after(() => server.stop());

  const { env, window, browser } = openable(stateHome);

  const windowRun = await runToCompletion(['open', '--dry-run'], stateHome, { env });
  assert.equal(windowRun.code, 0, windowRun.complaint);
  assert.match(windowRun.out, new RegExp(server.url.replace(/[/:.]/g, '\\$&')), 'the URL it would open');
  assert.match(windowRun.out, /window/, 'and which front door');
  assert.equal(window.opened(), null, 'nothing is opened by a dry run');

  const browserRun = await runToCompletion(['open', '--dry-run', '--browser'], stateHome, { env });
  assert.equal(browserRun.code, 0, browserRun.complaint);
  assert.match(browserRun.out, /browser/);
  assert.equal(browser.opened(), null, 'nor is the browser');
});

test('open --dry-run reports the same refusals as a real open', async () => {
  const stateHome = tempStateHome();
  const { env, window } = openable(stateHome);

  const neverStarted = await runToCompletion(['open', '--dry-run'], stateHome, { env });
  assert.notEqual(neverStarted.code, 0);
  assert.match(neverStarted.complaint, /oc-otter-pm\.service/);

  const dead = await freePort();
  fs.mkdirSync(path.dirname(urlFile(stateHome)), { recursive: true });
  fs.writeFileSync(urlFile(stateHome), `http://127.0.0.1:${dead}/\n`);
  const stale = await runToCompletion(['open', '--dry-run'], stateHome, { env });
  assert.notEqual(stale.code, 0);
  assert.match(stale.complaint, new RegExp(String(dead)));
  assert.equal(window.opened(), null);
});

test('serve builds the app when the build output is missing', async (t) => {
  hideBuildOutput(t);
  const stateHome = tempStateHome();
  const port = await freePort();

  const child = run(['serve', '--port', String(port)], stateHome);
  t.after(() => stop(child));
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));

  const url = await waitFor(() => readPublished(stateHome), 60000);
  await waitFor(async () => (await statusOf(url)) === 200, 60000);

  assert.match(log, /building/i, 'the build is announced rather than silent');
  assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'server', 'entry.mjs')), 'and the output is there to serve');
});

test('serve refuses when the app cannot be built, and publishes nothing', async () => {
  const stateHome = tempStateHome();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-scratch-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(scratch, 'scripts'), { recursive: true });

  const ran = await serveFrom(scratch, [], stateHome);

  assert.notEqual(ran.code, 0, 'a checkout that cannot build is a failure, not a server that serves nothing');
  assert.match(ran.complaint, /npm install/, 'the message names the command that fixes it');
  assert.match(ran.complaint, new RegExp(process.version.replace(/\./g, '\\.')), 'and the Node version in use');
  assert.equal(readPublished(stateHome), null, 'and no URL is published for a server that never started');
});

test('open tells "never started" from "the URL is stale", by exit code', async () => {
  const stateHome = tempStateHome();
  const { env, window } = openable(stateHome);

  const neverStarted = await runToCompletion(['open', '--dry-run'], stateHome, { env });
  assert.equal(neverStarted.code, 1, 'nothing has ever been published');
  assert.match(neverStarted.complaint, /systemctl --user start oc-otter-pm\.service/, 'and it says what to run');

  const dead = await freePort();
  fs.mkdirSync(path.dirname(urlFile(stateHome)), { recursive: true });
  fs.writeFileSync(urlFile(stateHome), `http://127.0.0.1:${dead}/\n`);
  const stale = await runToCompletion(['open', '--dry-run'], stateHome, { env });

  assert.equal(stale.code, 2, 'a published URL nothing answers on is its own kind of failure');
  assert.match(stale.complaint, new RegExp(String(dead)), 'the message carries the URL it tried');
  assert.equal(window.opened(), null, 'and no dead window is opened');
});

test('open refuses a published file that is not a URL', async () => {
  const stateHome = tempStateHome();
  const { env, window } = openable(stateHome);
  fs.mkdirSync(path.dirname(urlFile(stateHome)), { recursive: true });
  fs.writeFileSync(urlFile(stateHome), 'not a url\n');

  const ran = await runToCompletion(['open', '--dry-run'], stateHome, { env });

  assert.equal(ran.code, 3, 'an unreadable state file is neither "never started" nor "stale"');
  assert.match(ran.complaint, /not a URL/i);
  assert.equal(window.opened(), null);
});

test('open gives up on a URL that never answers instead of hanging', async () => {
  const stateHome = tempStateHome();
  const { env, window } = openable(stateHome);
  const silent = net.createServer(() => {});
  await new Promise((resolvePromise) => silent.listen(0, '127.0.0.1', resolvePromise));
  const { port } = silent.address();
  fs.mkdirSync(path.dirname(urlFile(stateHome)), { recursive: true });
  fs.writeFileSync(urlFile(stateHome), `http://127.0.0.1:${port}/\n`);

  const startedAt = Date.now();
  const ran = await runToCompletion(['open', '--dry-run'], stateHome, { env });
  silent.close();

  assert.notEqual(ran.code, 0, 'a port that accepts but never answers is not a board');
  assert.ok(Date.now() - startedAt < 60000, 'and the wait is bounded');
  assert.equal(window.opened(), null);
});

/** A checkout-shaped directory the launcher can be pointed at, with the app's real dependencies linked in. */
function scratchCheckout({ page }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-scratch-'));
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  for (const file of ['package.json', 'astro.config.mjs', 'tsconfig.json']) {
    fs.symlinkSync(path.join(ROOT, file), path.join(root, file));
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'pages', 'index.astro'), page);
  return root;
}

/** Run the launcher that lives in another checkout, so a test can hand it a tree that cannot build. */
function serveFrom(root, args, stateHome) {
  return runToCompletion(['serve', ...args], stateHome, {
    entry: path.join(root, 'scripts', 'launch.mjs'),
    cwd: root,
  });
}

test('serve names the state path it cannot write', async () => {
  const stateHome = tempStateHome();
  fs.mkdirSync(path.join(stateHome, 'otter-pm'), { recursive: true });
  fs.chmodSync(path.join(stateHome, 'otter-pm'), 0o500);
  const port = await freePort();

  const ran = await runToCompletion(['serve', '--port', String(port)], stateHome);

  fs.chmodSync(path.join(stateHome, 'otter-pm'), 0o700);
  assert.notEqual(ran.code, 0);
  assert.match(ran.complaint, /^oc-otter-pm: /, 'the message says who is complaining');
  assert.ok(ran.complaint.includes(path.join(stateHome, 'otter-pm', 'url')), `it names the path (${ran.complaint.trim()})`);
});

test('holding a range skips a range with a busy port and frees what it held there', async (t) => {
  const busyStart = await freePort();
  const busy = await holdPort(busyStart + 3);
  t.after(() => busy.close());
  const elsewhere = await freePort();
  const starts = [busyStart, elsewhere];

  const range = await holdRange(5, async () => starts.shift());
  t.after(() => range.held.forEach((server) => server.close()));

  assert.equal(range.first, elsewhere);
  assert.equal(range.held.length, 5);
  const reused = await holdPort(busyStart);
  reused.close();
});

test('serve names the port range when nothing in it is free', async (t) => {
  const stateHome = tempStateHome();
  const { first, held } = await holdRange(20);
  t.after(() => held.forEach((server) => server.close()));

  const ran = await runToCompletion(['serve', '--port', String(first)], stateHome);

  assert.notEqual(ran.code, 0);
  assert.ok(ran.complaint.includes(String(first)), `the search is named (${ran.complaint.trim()})`);
  assert.match(ran.complaint, new RegExp(String(first + 19)), 'and so is its end');
  assert.equal(readPublished(stateHome), null, 'nothing is published when nothing could start');
});

test('serve reports a build that fails, and publishes nothing for it', async () => {
  const stateHome = tempStateHome();
  const root = scratchCheckout({ page: '---\nconst broken = ;\n---\n<h1>nope</h1>\n' });
  const port = await freePort();

  const ran = await serveFrom(root, ['--port', String(port)], stateHome);

  assert.notEqual(ran.code, 0, 'a build that fails is not a server');
  assert.match(ran.complaint, /^oc-otter-pm: the build failed/m, `the reason is named (${ran.complaint.slice(-200)})`);
  assert.equal(readPublished(stateHome), null, 'and nothing is published for it');
});

test('serve clears a URL it cannot stand behind', async (t) => {
  const stateHome = tempStateHome();
  fs.mkdirSync(path.dirname(urlFile(stateHome)), { recursive: true });
  fs.writeFileSync(urlFile(stateHome), 'http://127.0.0.1:4999/\n');
  const first = await freePort();
  const held = [];
  for (let port = first; port < first + 20; port += 1) held.push(await holdPort(port));
  t.after(() => held.forEach((server) => server.close()));

  const ran = await runToCompletion(['serve', '--port', String(first)], stateHome);

  assert.notEqual(ran.code, 0);
  assert.equal(readPublished(stateHome), null, 'a URL from a run that is gone is not left for a launcher to trust');
});

/** `childPid` below reads Linux procfs, so the one case that needs it is skipped where procfs does not exist. */
const HAS_PROC = fs.existsSync('/proc');

test('a server that dies by signal is a failure, so the unit restarts it', {
  skip: HAS_PROC ? false : 'needs /proc to find the server pid the launcher started',
}, async () => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const child = run(['serve', '--port', String(port)], stateHome);
  const url = await waitFor(() => readPublished(stateHome));
  await waitFor(async () => (await statusOf(url)) === 200);

  const server = await waitFor(() => childPid(child.pid));

  process.kill(server, 'SIGKILL');

  const code = await new Promise((resolvePromise) => child.on('exit', resolvePromise));

  assert.notEqual(code, 0, 'a crash must not look like a clean stop, or Restart=on-failure never fires');
});

/** The pid the launcher started, read from `/proc`: the server is its direct child, so this is exact. */
function childPid(launcherPid) {
  try {
    const children = fs.readFileSync(`/proc/${launcherPid}/task/${launcherPid}/children`, 'utf8').trim();
    return children ? Number(children.split(/\s+/)[0]) : null;
  } catch {
    return null;
  }
}

test('a launcher that is told to hang up takes its server with it', async () => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const child = run(['serve', '--port', String(port)], stateHome);
  const url = await waitFor(() => readPublished(stateHome));
  await waitFor(async () => (await statusOf(url)) === 200);

  process.kill(child.pid, 'SIGHUP');

  await waitFor(async () => (await statusOf(url)) === null, 5000);
  assert.equal(await statusOf(url), null, 'the port is free: the server did not outlive the launcher');
  await waitFor(() => (readPublished(stateHome) === null ? true : false), 5000);
});
