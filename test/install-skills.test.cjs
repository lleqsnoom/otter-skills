'use strict';

/**
 * The skills are the other half of the loop the board reads: they write the `.x-skills` trees, and this checkout is
 * where they are edited. `npm run install` is how an edit reaches the agents that run them, so what is asserted here
 * is that every skill ends up pointed at this tree rather than copied out of it, that an older copy under a skill's
 * name is replaced by that link, that a run npm starts on its own does nothing, and that the `~/.claude/skills`
 * mirror follows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'install.mjs');
const SOURCE = path.join(ROOT, 'skills');

const skillNames = () =>
  fs
    .readdirSync(SOURCE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(SOURCE, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();

function scratchHome(withClaude = false) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'otter-pm-install-'));
  if (withClaude) fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  return home;
}

function run(home, args = [], env = {}) {
  const environment = { ...process.env };
  delete environment.npm_command;
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...environment, HOME: home, ...env },
  });
}

test('every skill in skills/ is linked to this checkout, and the link resolves', () => {
  const home = scratchHome();
  const result = run(home);

  assert.equal(result.status, 0, result.stderr);

  const target = path.join(home, '.agents', 'skills');
  const installed = fs.readdirSync(target).sort();
  assert.deepEqual(installed, skillNames(), 'the set linked is the set this checkout has');
  assert.ok(installed.length > 0, 'and it is not empty');

  for (const name of installed) {
    const entry = path.join(target, name);
    assert.ok(fs.lstatSync(entry).isSymbolicLink(), `${name} is a link, not a copy`);
    assert.equal(fs.realpathSync(entry), path.join(SOURCE, name), `${name} points at this tree`);
  }
});

test('an older copy under a skill name is replaced by the link', () => {
  const home = scratchHome();
  const [name] = skillNames();
  const entry = path.join(home, '.agents', 'skills', name);
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(path.join(entry, 'SKILL.md'), 'an older copy\n');

  const result = run(home);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.lstatSync(entry).isSymbolicLink(), 'the copy is gone and a link is in its place');
  assert.equal(
    fs.readFileSync(path.join(entry, 'SKILL.md'), 'utf8'),
    fs.readFileSync(path.join(SOURCE, name, 'SKILL.md'), 'utf8'),
    'and reading through it gives this checkout',
  );
});

test('a second run has nothing left to do', () => {
  const home = scratchHome();
  run(home);
  const again = run(home);

  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /kept\s+x-plan/, 'the links are already right');
});

test('a dry run writes nothing', () => {
  const home = scratchHome();
  const result = run(home, ['--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(home, '.agents', 'skills')), false, 'the target is still absent');
});

test("npm install's own run of the script installs nothing, and says so", () => {
  const home = scratchHome();
  const result = run(home, [], { npm_command: 'install' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm install installs dependencies, not skills/, 'it names the command to use instead');
  assert.equal(fs.existsSync(path.join(home, '.agents', 'skills')), false, 'and it wrote nothing');
});

test('a machine with ~/.claude gets a link per skill, and one without is left alone', () => {
  const mirrorless = scratchHome();
  run(mirrorless);
  assert.equal(fs.existsSync(path.join(mirrorless, '.claude')), false, 'no directory is created for it');

  const home = scratchHome(true);
  run(home);

  const mirror = path.join(home, '.claude', 'skills');
  for (const name of skillNames()) {
    const entry = path.join(mirror, name);
    assert.ok(fs.lstatSync(entry).isSymbolicLink(), `${name} is reached through a link`);
    assert.equal(fs.realpathSync(entry), path.join(SOURCE, name), `${name}'s link reaches this checkout`);
  }
  assert.deepEqual(fs.readdirSync(mirror).sort(), skillNames());
});
