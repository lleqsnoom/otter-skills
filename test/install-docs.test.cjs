'use strict';

/**
 * The guide is the only part of this work another person sees before the code, and the README is where they start.
 * Both are checked here the way the rest of the app's promises are: the steps the guide tells someone to run have to
 * match what this repository actually ships, and the README may not offer a way to run the app that does not exist.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const README = path.join(ROOT, 'README.md');
const GUIDE = path.join(ROOT, 'docs', 'install.md');

const read = (file) => fs.readFileSync(file, 'utf8');

test('the README points at the guide and stops offering a package that is not published', () => {
  const readme = read(README);

  assert.match(readme, /docs\/install\.md/, 'a reader who wants it installed, not developed, is sent to the guide');
  assert.doesNotMatch(
    readme,
    /`npx @lleqsnoom\/otter-pm` or `otter-pm`/,
    'the npm package answers 404, so the README may not present it as a way to run anything',
  );
  assert.match(readme, /npm run dev/, 'and the development loop is still documented');
});

test('the guide installs what the repository ships, by path', () => {
  const guide = read(GUIDE);

  assert.match(guide, /scripts\/oc-otter-pm\b/, 'the wrapper comes from the repository, not a paste of its text');
  assert.match(guide, /scripts\/service\/oc-otter-pm\.service/, 'so does the unit');
  assert.match(guide, /scripts\/service\/oc-otter-pm\.desktop/, 'and the window entry');
  assert.match(guide, /scripts\/service\/oc-otter-pm-browser\.desktop/, 'and the browser entry');
  assert.match(guide, /public\/favicon\.svg/, 'and the icon the entries name');
});

test('the guide states the ground it stands on', () => {
  const guide = read(GUIDE);

  assert.match(guide, /systemd --user|systemctl --user/, 'the supervisor the unit needs is named');
  assert.match(guide, /22\.12\.0/, 'the Node floor from `engines` is stated');
  assert.match(guide, /OTTER_PM_ROOT/, 'the one variable that pins the checkout is explained');
  assert.match(guide, /journalctl --user -u oc-otter-pm/, 'and where the service explains itself');
});

test('every verification step says what to expect', () => {
  const guide = read(GUIDE);
  const verification = guide.slice(guide.indexOf('## Verifying'));

  assert.ok(verification.length > 200, 'there is a verification section');
  assert.match(verification, /```/, 'its steps are commands');
  assert.match(verification, /(prints|answers|shows|expect)/i, 'and each says what the output should be');
});

test('the guide says what a machine without gh or the Orca IDE still gets', () => {
  const guide = read(GUIDE);
  const section = guide.slice(guide.indexOf('## Without'));

  assert.ok(section.length > 200, 'the case is covered');
  assert.match(section, /roots/, 'the config key that replaces the IDE list is named');
  assert.match(section, /gh/, 'and the feature that needs it is named');
});
