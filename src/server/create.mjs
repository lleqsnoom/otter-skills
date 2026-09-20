import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { configFilePath } from './config.mjs';

/**
 * Making a project — the one write in this app that creates a repository rather than editing one.
 *
 * The tree is built in a dot-prefixed sibling of the target and renamed into place at the end, so the target path
 * never holds a half-made project and a failure leaves nothing behind: removing the temp directory is the whole
 * rollback. Every command goes through one seam, so the GitHub half is drivable by a stub and no test can reach the
 * network or the account it would push to.
 */

const TEMP_PREFIX = '.';
const TEMP_SUFFIX = '.otter-pm-tmp';

/** `run(command, args, { cwd }) -> { status, stdout, stderr }`; the default spawns, tests pass a stub. */
export function defaultRun(command, args, { cwd = process.cwd() } = {}) {
  const done = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return {
    status: done.status ?? 1,
    stdout: done.stdout ?? '',
    stderr: done.stderr || done.error?.message || '',
  };
}

export function slugOf(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

const isFolderName = (slug) => Boolean(slug) && slug !== '.' && slug !== '..';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Where projects go: an explicit override, then the desktop's own Documents directory, then the conventional one.
 * The desktop answer has to come from `xdg-user-dir`, because Documents is a translated name, not always `Documents`.
 */
function documentsDir({ run, env }) {
  if (env.OTTER_PM_PROJECTS_DIR) return resolve(env.OTTER_PM_PROJECTS_DIR);
  const answered = run('xdg-user-dir', ['DOCUMENTS'], { cwd: homedir() });
  const path = answered.status === 0 ? answered.stdout.trim() : '';
  return path ? resolve(path) : join(homedir(), 'Documents');
}

function resolveBaseDir(asked, deps) {
  const base = resolve(asked || documentsDir(deps));
  const stat = statSync(base, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return { error: `base directory does not exist: ${base}` };
  return { base };
}

const readmeFor = (spec) => `# ${spec.name}\n\n${spec.about}\n`;
const planFor = (spec) => `# Plan — ${spec.name}\n\n**Date:** ${today()}\n\n## Goal\n\n${spec.about}\n`;

/** The raster types an icon may be: an SVG opened on its own origin is a document that can run script. */
const ICON_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' };
const MAX_ICON_BYTES = 2 * 1024 * 1024;

/** The image a project was given, decoded and named: `.x-skills/icon.<ext>` inside the project it belongs to. */
function iconFor(spec) {
  const file = spec.icon?.file;
  if (!file) return { relPath: null, bytes: null };
  const extension = ICON_TYPES[file.type];
  if (!extension) return { error: `not an image this app can store: ${file.type ?? 'nothing'}` };
  const bytes = Buffer.from(String(file.data ?? ''), 'base64');
  if (!bytes.length) return { error: 'the icon file is empty' };
  if (bytes.length > MAX_ICON_BYTES) return { error: `the icon is larger than ${MAX_ICON_BYTES} bytes` };
  return { relPath: `.x-skills/icon.${extension}`, fileName: `icon.${extension}`, bytes };
}

/** The project's own brief: what it is about, and how it is drawn. A file a reader can edit, which is the point. */
const projectFor = (spec, iconPath) => {
  const fields = [`**About:** ${spec.about}`];
  if (spec.icon?.text) fields.push(`**Icon:** ${spec.icon.text}`);
  if (spec.icon?.color) fields.push(`**Color:** ${spec.icon.color}`);
  if (spec.icon?.src) fields.push(`**Icon URL:** ${spec.icon.src}`);
  if (iconPath) fields.push(`**Icon file:** ${iconPath}`);
  return `# ${spec.name}\n\n${fields.join('\n')}\n`;
};

/** `.x-skills/plans/` is what makes the folder a root at all, so the first plan is part of the skeleton. */
function writeTree(dir, spec, slug, icon) {
  writeFileSync(join(dir, 'README.md'), readmeFor(spec), 'utf8');
  mkdirSync(join(dir, '.x-skills', 'plans'), { recursive: true });
  writeFileSync(join(dir, '.x-skills', 'plans', `${today()}-${slug}.md`), planFor(spec), 'utf8');
  if (icon.bytes) writeFileSync(join(dir, '.x-skills', icon.fileName), icon.bytes);
  writeFileSync(join(dir, '.x-skills', 'project.md'), projectFor(spec, icon.relPath), 'utf8');
}

/**
 * The account a repository would be made under. `gh` answering nothing is a fact the form shows and a create
 * refuses: 501, because nothing about the request was wrong.
 */
function ghLogin({ run }) {
  const answered = run('gh', ['api', 'user', '--jq', '.login'], { cwd: homedir() });
  const login = answered.status === 0 ? answered.stdout.trim() : '';
  if (!login) return { error: 'gh is not installed or not authenticated', detail: answered.stderr };
  return { login };
}

/**
 * GitHub's own license text, with the two placeholders it publishes filled in. The file is fetched rather than
 * kept here so a repository carries the canonical text, and `[fullname]` is the account because that is the only
 * holder this app can name.
 */
function licenseText(key, owner, run) {
  const fetched = run('gh', ['api', `/licenses/${key}`, '--jq', '.body'], { cwd: homedir() });
  if (fetched.status !== 0) return { error: `gh could not read the ${key} license`, detail: fetched.stderr };
  const text = fetched.stdout
    .replaceAll('[year]', String(new Date().getUTCFullYear()))
    .replaceAll('[fullname]', owner)
    .trim();
  return text ? { text: `${text}\n` } : { error: `gh returned no text for the ${key} license` };
}

/** The licenses `gh repo license list` names, for a machine where gh cannot answer. */
const FALLBACK_LICENSES = [
  ['agpl-3.0', 'AGPL-3.0'],
  ['apache-2.0', 'Apache-2.0'],
  ['bsd-2-clause', 'BSD-2-Clause'],
  ['bsd-3-clause', 'BSD-3-Clause'],
  ['bsl-1.0', 'BSL-1.0'],
  ['cc0-1.0', 'CC0-1.0'],
  ['epl-2.0', 'EPL-2.0'],
  ['gpl-2.0', 'GPL-2.0'],
  ['gpl-3.0', 'GPL-3.0'],
  ['lgpl-2.1', 'LGPL-2.1'],
  ['mit', 'MIT'],
  ['mpl-2.0', 'MPL-2.0'],
  ['unlicense', 'Unlicense'],
].map(([key, name]) => ({ key, name }));

const parseLicenses = (stdout) =>
  stdout
    .split('\n')
    .map((line) => line.split('\t').map((part) => part.trim()))
    .filter((columns) => columns.length >= 2 && columns[0])
    .map(([key, spdx, name]) => ({ key, name: name || spdx || key }));

/** What the form offers before anything is typed: the account, the directory and the licenses GitHub publishes. */
export function projectDefaults({ run = defaultRun, env = process.env } = {}) {
  const who = ghLogin({ run });
  const listed = run('gh', ['repo', 'license', 'list'], { cwd: homedir() });
  const licenses = listed.status === 0 ? parseLicenses(listed.stdout) : [];
  return {
    owner: who.login ?? null,
    baseDir: documentsDir({ run, env }),
    licenses: [{ key: '', name: 'None' }, ...(licenses.length ? licenses : FALLBACK_LICENSES)],
  };
}

/** A fixed identity, so a machine with no global git user can still make the first commit. */
function commitAll(dir, spec, run) {
  const steps = [
    ['git', ['init']],
    ['git', ['add', '-A']],
    ['git', ['-c', 'user.name=otter-pm', '-c', 'user.email=otter-pm@localhost', 'commit', '-m', `chore: start ${spec.name}`]],
  ];
  for (const [command, args] of steps) {
    const done = run(command, args, { cwd: dir });
    if (done.status !== 0) return { ok: false, error: `${command} ${args[0]} failed`, detail: done.stderr };
  }
  return { ok: true };
}

/**
 * The push. The name is passed explicitly, so the temp directory's own name cannot decide the repository's; `--push`
 * and a visibility are both passed because gh prompts for either one it is missing, and a request that prompts hangs.
 */
function pushRepo({ dir, spec, slug, owner, run }) {
  const argv = [
    'repo',
    'create',
    `${owner}/${slug}`,
    '--source',
    dir,
    '--push',
    '--remote',
    'origin',
    '--description',
    spec.about,
    spec.visibility === 'public' ? '--public' : '--private',
  ];
  const done = run('gh', argv, { cwd: dir });
  if (done.status !== 0) return { error: 'gh repo create failed', detail: done.stderr };
  return { ok: true, url: `https://github.com/${owner}/${slug}` };
}

/** The name, as the slug the folder and the repository take, and the sentence the project is described with. */
function validateSpec(spec) {
  const slug = slugOf(spec.name);
  if (!isFolderName(slug)) return { error: 'name is required' };
  const about = String(spec.about ?? '').trim();
  if (!about) return { error: 'what the project is about is required' };
  return { slug, about };
}

/** Where the project lands and where it is built first. Either path being taken is a conflict, never an overwrite. */
function targetPaths(base, slug) {
  const dir = join(base, slug);
  const temp = join(base, `${TEMP_PREFIX}${slug}${TEMP_SUFFIX}`);
  if (existsSync(dir)) return { dir, temp, conflict: `${dir} already exists` };
  if (existsSync(temp)) return { dir, temp, conflict: `${temp} already exists` };
  return { dir, temp, conflict: null };
}

function buildProject({ dir, spec, slug, run }) {
  const seeded = seedTree(dir, spec, slug);
  if (!seeded.ok) return seeded;

  const who = ghLogin({ run });
  if (who.error) return { ok: false, status: 501, error: who.error, detail: who.detail };

  const licensed = writeLicense(dir, spec, who.login, run);
  if (!licensed.ok) return licensed;

  const committed = commitAll(dir, spec, run);
  if (!committed.ok) return { ok: false, status: 502, ...committed };

  const pushed = pushRepo({ dir, spec, slug, owner: who.login, run });
  if (!pushed.ok) return { ok: false, status: 502, ...pushed };

  return { ok: true, owner: who.login, url: pushed.url };
}

function seedTree(dir, spec, slug) {
  const icon = iconFor(spec);
  if (icon.error) return { ok: false, status: 400, error: icon.error };
  try {
    mkdirSync(dir, { recursive: true });
    writeTree(dir, spec, slug, icon);
    return { ok: true };
  } catch (error) {
    return { ok: false, status: 500, error: `could not write ${dir}`, detail: error.message };
  }
}

/** The license is fetched rather than kept here, so a repository carries GitHub's canonical text. */
function writeLicense(dir, spec, login, run) {
  if (!spec.license) return { ok: true };
  const licensed = licenseText(spec.license, login, run);
  if (licensed.error) return { ok: false, status: 502, error: licensed.error, detail: licensed.detail };
  try {
    writeFileSync(join(dir, 'LICENSE'), licensed.text, 'utf8');
  } catch (error) {
    return { ok: false, status: 500, error: `could not write ${dir}/LICENSE`, detail: error.message };
  }
  return { ok: true };
}

const readConfig = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

/** The path a created project is remembered by, so the next scan finds it. Every other key survives. */
function addRoot(file, dir) {
  const config = readConfig(file);
  const roots = Array.isArray(config.roots) ? config.roots : [];
  if (roots.includes(dir)) return { ok: true, file };
  try {
    writeFileSync(file, `${JSON.stringify({ ...config, roots: [...roots, dir] }, null, 2)}\n`, 'utf8');
  } catch (error) {
    return { ok: false, status: 500, error: `could not write ${file}`, detail: error.message };
  }
  return { ok: true, file };
}

export function createProject(spec = {}, { run = defaultRun, env = process.env } = {}) {
  const valid = validateSpec(spec);
  if (valid.error) return { ok: false, status: 400, error: valid.error };

  const resolved = resolveBaseDir(spec.baseDir, { run, env });
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };

  const target = targetPaths(resolved.base, valid.slug);
  if (target.conflict) return { ok: false, status: 409, error: target.conflict };

  const built = buildProject({ dir: target.temp, spec: { ...spec, about: valid.about }, slug: valid.slug, run });
  if (!built.ok) {
    rmSync(target.temp, { recursive: true, force: true });
    return { ok: false, status: built.status ?? 502, error: built.error, detail: built.detail };
  }

  renameSync(target.temp, target.dir);
  const configFile = configFilePath({ env });
  const rooted = addRoot(configFile, target.dir);
  if (!rooted.ok) return rooted;

  return {
    ok: true,
    status: 200,
    id: valid.slug,
    slug: valid.slug,
    dir: target.dir,
    root: join(target.dir, '.x-skills'),
    configFile,
    owner: built.owner,
    url: built.url,
  };
}