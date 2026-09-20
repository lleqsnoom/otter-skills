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

function run(args, stateHome, options = {}) {
  return spawn(process.execPath, [LAUNCH, ...args], {
    cwd: ROOT,
    env: { ...process.env, XDG_STATE_HOME: stateHome },
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

/**
 * A front door that records what it was asked to open. A stub rather than the real one, because these tests run
 * with no display: what is under test is which URL the launcher hands over, not that Chromium can draw a window.
 */
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

test('port prints the published URL, and fails when nothing is published', async (t) => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const server = await serve({ stateHome, port });
  t.after(() => server.stop());

  const printed = run(['port'], stateHome);
  let out = '';
  printed.stdout.on('data', (chunk) => (out += chunk));
  const code = await new Promise((resolvePromise) => printed.on('exit', resolvePromise));
  assert.equal(code, 0);
  assert.equal(out.trim(), server.url);

  const empty = tempStateHome();
  const missing = run(['port'], empty);
  let complaint = '';
  missing.stderr.on('data', (chunk) => (complaint += chunk));
  const missingCode = await new Promise((resolvePromise) => missing.on('exit', resolvePromise));
  assert.equal(missingCode, 1, 'a port that was never published is a failure, not an empty answer');
  assert.match(complaint, /nothing is serving/i);
});

test('open hands the published URL to the window front door, and starts no server', async (t) => {
  const stateHome = tempStateHome();
  const port = await freePort();
  const server = await serve({ stateHome, port });
  t.after(() => server.stop());

  const { env, window, browser } = openable(stateHome);

  const opened = await runToCompletion(['open'], stateHome, { env });
  assert.equal(opened.code, 0, opened.complaint);
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
