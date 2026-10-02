'use strict';

/**
 * This package is not published, and it should stay that way by construction rather than by a secret happening to be
 * absent. `private` is the field `npm publish` refuses on, so the manifest is checked to carry it; and every workflow
 * is checked to publish nothing, because a `publish` step that only fails on a missing token is one token away from
 * putting a version on the registry. The last test is the other half of that: removing the publish step must not have
 * removed the checks that catch a broken merge.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const manifest = () => JSON.parse(read('package.json'));

const workflows = () => fs.readdirSync(path.join(ROOT, '.github', 'workflows'));

test('the package is private, which is what npm publish refuses on', () => {
  assert.equal(manifest().private, true, 'without it, a publish step is one command away from the registry');
  assert.equal(manifest().publishConfig, undefined, 'and no access level is configured for a publish');
});

test('no workflow can put a version on the registry', () => {
  const names = workflows();
  assert.ok(names.length > 0, 'there is a workflow to check');

  for (const name of names) {
    const workflow = read(path.join('.github', 'workflows', name));
    assert.doesNotMatch(workflow, /npm publish|NPM_TOKEN|--provenance/, `${name} publishes nothing`);
  }
});

test('the workflow still runs what would have caught a broken merge', () => {
  const workflow = read(path.join('.github', 'workflows', 'ci.yml'));

  assert.match(workflow, /npm test/, 'the tests run');
  assert.match(workflow, /skill-lint/, 'and so does the skill lint');
  assert.match(workflow, /pull_request/, 'on a pull request, where a broken skill is cheaper to find than on main');
});
