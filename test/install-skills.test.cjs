'use strict';

/**
 * The skills are the other half of the loop the board reads: they write the `.x-skills` trees, and this checkout is
 * where they are edited. `npm run install` is how an edit reaches the agents that run them, so what is asserted here
 * is that every skill ends up pointed at this tree rather than copied out of it, that an older copy under a skill's
 * name is replaced by that link, that a run npm starts on its own does nothing, and that the `~/.claude/skills`
 * mirror follows.
 *
 * The MCP server is installed by the same command, and is asserted here too: into the config of each agent that
 * already has one, leaving that agent's other keys and other servers alone, and nothing at all for an agent that has
 * none. A config this process cannot read is reported rather than overwritten.
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
const SERVER = 'otter-pm';

/** The entry the installer is expected to write, as each client holds it. */
const launch = { command: 'node', args: [path.join(ROOT, 'scripts', 'mcp.mjs')] };

const claudeConfig = (home) => path.join(home, '.claude.json');
const crushConfig = (home) => path.join(home, '.config', 'crush', 'crush.json');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

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

/**
 * `XDG_CONFIG_HOME` is pointed at the scratch home as well: a real environment exports it, and a run that only moved
 * `HOME` would reach the user's own Crush config instead of the fixture's.
 */
function run(home, args = [], env = {}) {
  const environment = { ...process.env };
  delete environment.npm_command;
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...environment, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), ...env },
  });
}

/** An agent config as its client leaves it, written before a run so the installer has something to fill. */
function withAgentConfigs(home, { claude, crush }) {
  if (claude !== undefined) fs.writeFileSync(claudeConfig(home), `${JSON.stringify(claude, null, 2)}\n`);
  if (crush !== undefined) {
    fs.mkdirSync(path.dirname(crushConfig(home)), { recursive: true });
    fs.writeFileSync(crushConfig(home), `${JSON.stringify(crush, null, 2)}\n`);
  }
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

test('the MCP server is added to each agent config that has one, and nothing else in the file moves', () => {
  const home = scratchHome();
  withAgentConfigs(home, {
    claude: { numStartups: 3 },
    crush: { $schema: 'https://charm.land/crush.json', theme: 'dark', mcp: { other: { command: 'x' } } },
  });

  const result = run(home);

  assert.equal(result.status, 0, result.stderr);

  const claude = readJson(claudeConfig(home));
  assert.deepEqual(claude.mcpServers[SERVER], launch, 'Claude Code keeps its servers under mcpServers');
  assert.equal(claude.numStartups, 3, "and the agent's own keys survive");

  const crush = readJson(crushConfig(home));
  assert.deepEqual(crush.mcp[SERVER], { ...launch, type: 'stdio' }, 'Crush holds them under mcp, each with a type');
  assert.deepEqual(crush.mcp.other, { command: 'x' }, "another server's entry survives");
  assert.equal(crush.theme, 'dark', 'as does the rest of its config');
});

test('a second run finds the MCP entry already right and does not rewrite the file', () => {
  const home = scratchHome();
  withAgentConfigs(home, { claude: { numStartups: 3 } });
  run(home);
  const before = fs.readFileSync(claudeConfig(home), 'utf8');

  const again = run(home);

  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /kept\s+otter-pm mcp/, 'the entry is reported as already right');
  assert.equal(fs.readFileSync(claudeConfig(home), 'utf8'), before, 'and the file is byte for byte what it was');
});

test('an agent with no config gets no entry, and no file is created for it', () => {
  const home = scratchHome();

  const result = run(home);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(claudeConfig(home)), false, 'no config is written for an agent that has none');
  assert.equal(fs.existsSync(crushConfig(home)), false);
  assert.match(result.stdout, /registered otter-pm mcp with 0 of 2 agents/);
});

test('a config it cannot read is reported and left exactly as it was', () => {
  const home = scratchHome();
  const broken = 'not json at all\n';
  fs.writeFileSync(claudeConfig(home), broken);

  const result = run(home);

  assert.equal(result.status, 1, 'an install that could not register its server says so');
  assert.match(result.stderr, /\.claude\.json/, 'and names the file it could not read');
  assert.equal(fs.readFileSync(claudeConfig(home), 'utf8'), broken, 'the file is untouched');

  fs.writeFileSync(claudeConfig(home), '{ "mcpServers": 5 }\n');
  const wrongShape = run(home);

  assert.equal(wrongShape.status, 1);
  assert.match(wrongShape.stderr, /`mcpServers` is not an object/, 'a section of the wrong shape is named too');
  assert.equal(readJson(claudeConfig(home)).mcpServers, 5, 'and left alone rather than replaced');
});

test('a dry run registers no MCP entry', () => {
  const home = scratchHome();
  withAgentConfigs(home, { claude: { numStartups: 3 } });
  const before = fs.readFileSync(claudeConfig(home), 'utf8');

  const result = run(home, ['--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /would register otter-pm mcp with 1 of 2 agents/);
  assert.equal(fs.readFileSync(claudeConfig(home), 'utf8'), before, 'nothing is written');
});
