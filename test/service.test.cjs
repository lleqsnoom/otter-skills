'use strict';

/**
 * The service and the two launchers are the machine's own furniture, but their shape is this repository's contract:
 * the unit may only start the wrapper, and the entries may only call it. Both are easy to "fix" by hard-coding a
 * port or a path here — and that is exactly what the launcher exists to avoid, so the shape is asserted, not
 * assumed by whoever reads it next.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVICE = path.join(ROOT, 'scripts', 'service');
const UNIT = path.join(SERVICE, 'oc-otter-pm.service');
const WINDOW_ENTRY = path.join(SERVICE, 'oc-otter-pm.desktop');
const BROWSER_ENTRY = path.join(SERVICE, 'oc-otter-pm-browser.desktop');

const read = (file) => fs.readFileSync(file, 'utf8');

test('the unit starts the wrapper, and lets it resolve both the checkout and the port', () => {
  const unit = read(UNIT);

  assert.match(unit, /^\[Unit\]$/m, 'it is a unit file');
  assert.match(unit, /^\[Service\]$/m);
  assert.match(unit, /^\[Install\]$/m);
  assert.match(unit, /^Type=simple$/m, 'the wrapper stays in the foreground, which is what simple means here');
  assert.match(unit, /^ExecStart=%h\/\.local\/bin\/oc-otter-pm serve$/m, 'the installed wrapper, with serve named');
  assert.match(unit, /^Restart=on-failure$/m, 'a server that dies comes back');
  assert.match(unit, /^RestartSec=\d+$/m, 'and not instantly');
  assert.match(unit, /^WantedBy=default\.target$/m, 'enabled for the user session, the way the other services here are');

  assert.match(unit, /^StartLimitBurst=\d+$/m, 'a permanently broken start must stop trying instead of looping');
  assert.match(unit, /^StartLimitIntervalSec=\d+$/m, 'and the window that limit is counted over is stated');

  assert.doesNotMatch(unit, /WorkingDirectory/, 'the launcher must not depend on a working directory');
  assert.doesNotMatch(unit, /\b\d{4}\b/, 'and no port is written down here');
  assert.doesNotMatch(unit, /OTTER_PM_ROOT/, 'the checkout path lives in the wrapper, not in two places');
});

test('the window entry opens the board through the wrapper', () => {
  const entry = read(WINDOW_ENTRY);

  assert.match(entry, /^\[Desktop Entry\]$/m);
  assert.match(entry, /^Type=Application$/m);
  assert.match(entry, /^Terminal=false$/m, 'no terminal window: the point of a front door');
  assert.match(entry, /^Exec=oc-otter-pm open$/m, 'the wrapper decides the URL, since a desktop Exec cannot');
  assert.match(entry, /^Name=/m);
  assert.doesNotMatch(entry, /\b\d{4}\b/, 'no port here either');
});

test('the browser entry is the same board, one flag apart', () => {
  const entry = read(BROWSER_ENTRY);

  assert.match(entry, /^Exec=oc-otter-pm open --browser$/m);
  assert.match(entry, /^Terminal=false$/m);
  assert.match(entry, /^Name=/m);
});

test('the guide installs the machine copy from the sources here', () => {
  const install = path.join(ROOT, 'docs', 'install.md');
  if (!fs.existsSync(install)) return;

  const guide = read(install);
  assert.match(guide, /scripts\/service\/oc-otter-pm\.service/, 'the guide installs the unit from here');
  assert.match(guide, /scripts\/service\/oc-otter-pm\.desktop/, 'and the entries, rather than pasting their text');
});
