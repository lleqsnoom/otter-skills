import { statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { findSymbols, readRepoFile, repoFiles } from './repo.mjs';

/**
 * What a document claims, and whether the code still agrees.
 *
 * Code is the authority here, so the useful thing to report is not "this document exists" but "this document names
 * a file that is gone". Only shapes that can actually be checked are extracted — a path, a command, a symbol — and
 * anything recognised but not decidable comes back `uncheckable` with the reason rather than as drift. Calling an
 * uncheckable sentence drift would be a lie about the code, which is the one thing this pass exists to prevent.
 */

const MAX_CLAIMS = 200;

/**
 * Fences whose contents are read. An unlabelled fence is an illustration — pseudo-code, a sketch — and reporting
 * the paths inside it would fill a report with claims nobody made.
 */
const SCANNED_LANGUAGES = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'json', 'yaml', 'yml', 'toml']);

const COMMANDS = ['npm', 'node', 'npx', 'git', 'gh', 'python', 'python3', 'cargo', 'go', 'make', 'pnpm', 'yarn', 'deno', 'bun'];

const PATH_EXTENSIONS = new Set([
  'md', 'markdown', 'json', 'txt', 'yml', 'yaml', 'sh', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'mmd', 'csv', 'toml',
  'rs', 'go', 'rb', 'java', 'css', 'html', 'svg',
]);

const FENCE = /^```(\S*)/;
const BACKTICKED = /`([^`\n]+)`/g;
const IDENTIFIER = /^[A-Za-z_$][\w$.-]*$/;

/** Every token a document claims with, and the line it was on. */
function tokensOf(lines) {
  const found = [];
  let fence = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const opening = FENCE.exec(line.trim());
    if (opening) {
      fence = fence === null ? opening[1].toLowerCase() : null;
      return;
    }

    if (fence === null) {
      for (const match of line.matchAll(BACKTICKED)) found.push({ token: match[1].trim(), line: lineNumber });
      return;
    }

    // Inside a fence that names a language this repository reads, the line is the code: a command there is not
    // written in backticks, and skipping it would miss the examples a document is most explicit about.
    if (!SCANNED_LANGUAGES.has(fence)) return;
    const bare = line.trim();
    if (bare && !bare.startsWith('#') && !bare.startsWith('//')) found.push({ token: bare, line: lineNumber });
  });

  return found;
}

const looksLikePath = (token) => {
  const bare = token.replace(/^\.\//, '').replace(/[),.;]+$/, '');
  if (bare.includes(' ')) return false;
  const extension = bare.slice(bare.lastIndexOf('.') + 1).toLowerCase();
  return bare.includes('/') || PATH_EXTENSIONS.has(extension);
};

/** The kind a token is, or `null` for one that makes no claim at all. */
function kindOf(token) {
  const first = token.split(/\s+/)[0];
  if (COMMANDS.includes(first)) return 'command';
  if (looksLikePath(token)) return 'path';
  if (IDENTIFIER.test(token)) return 'symbol';
  return null;
}

/** Every claim a document makes, in the order it makes them, with duplicates on one line collapsed. */
export function claimsOf(markdown) {
  const claims = [];
  const seen = new Set();

  for (const { token, line } of tokensOf(String(markdown ?? '').split('\n'))) {
    if (claims.length >= MAX_CLAIMS) break;
    const kind = kindOf(token);
    if (!kind) continue;
    const key = `${kind}:${token}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ claim: token, kind, line });
  }

  return claims;
}

const contained = (tracked, exists, candidate) => tracked.has(candidate) && exists(candidate);

/** Where a relative path claim points, trying the document's own directory first and the repository root second. */
function resolvePath(claim, { docPath, tracked, exists }) {
  const bare = claim.replace(/^\.\//, '').replace(/[),.;]+$/, '');
  const beside = posix.normalize(join(dirname(docPath ?? ''), bare)).replace(/^\.\//, '');
  if (contained(tracked, exists, beside)) return beside;
  if (contained(tracked, exists, bare)) return bare;
  return null;
}

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/** A script name, checked against the manifest's `scripts`. */
function resolveScript(name, readText) {
  const manifest = readText('package.json');
  if (!manifest) return { verdict: 'uncheckable', reason: 'there is no package.json to read the scripts from' };

  let scripts;
  try {
    scripts = JSON.parse(manifest).scripts ?? {};
  } catch {
    return { verdict: 'uncheckable', reason: 'package.json is not valid JSON' };
  }

  return Object.hasOwn(scripts, name)
    ? { verdict: 'resolves', reason: `package.json defines the script ${name}` }
    : { verdict: 'missing', reason: `package.json defines no script named ${name}` };
}

function resolveCommand(claim, { tracked, readText }) {
  const [first, second, third] = claim.split(/\s+/);

  if (PACKAGE_MANAGERS.has(first)) {
    return second === 'run' && third
      ? resolveScript(third, readText)
      : { verdict: 'uncheckable', reason: 'only `run <script>` can be checked against package.json' };
  }

  if (first === 'node' && second) {
    const file = second.replace(/^\.\//, '');
    return tracked.has(file)
      ? { verdict: 'resolves', reason: `${file} exists` }
      : { verdict: 'missing', reason: `there is no ${file}` };
  }

  return { verdict: 'uncheckable', reason: `nothing here can decide whether \`${claim}\` works` };
}

/**
 * The verdict per claim. `tracked`, `readText` and `findDeclarations` are arguments rather than imports so a test
 * can resolve claims without a disk.
 */
export function resolveClaims(claims, { repoPath, tracked, exists, readText, findDeclarations }) {
  return claims.map((claim) => {
    if (claim.kind === 'path') {
      const found = resolvePath(claim.claim, { docPath: claim.docPath, tracked, exists });
      return {
        ...claim,
        verdict: found ? 'resolves' : 'missing',
        reason: found ? `the repository holds ${found}` : `the repository holds no ${claim.claim}`,
      };
    }

    if (claim.kind === 'command') {
      return { ...claim, ...resolveCommand(claim.claim, { tracked, readText }) };
    }

    const declared = findDeclarations(repoPath, claim.claim).matches;
    return {
      ...claim,
      verdict: declared.length ? 'declared' : 'missing',
      reason: declared.length
        ? `declared at ${declared[0].relPath}:${declared[0].line}`
        : `no declaration of ${claim.claim} in the tracked source`,
    };
  });
}

const textReader = (repoPath, tracked) => (relPath) => {
  if (!tracked.has(relPath)) return null;
  const read = readRepoFile(repoPath, relPath);
  return read.status === 200 ? read.text : null;
};

/** The whole pass for one document: what it claims, and what the code says about each claim. */
export function driftFor({ docPath, markdown, repoPath }) {
  const { mode, files } = repoFiles(repoPath);
  const tracked = new Set(files);
  const claims = claimsOf(markdown).map((claim) => ({ ...claim, docPath }));

  return {
    docPath,
    checked: mode,
    capped: claims.length >= MAX_CLAIMS,
    claims: resolveClaims(claims, {
      repoPath,
      tracked,
      exists: (relPath) => statSync(join(repoPath, relPath), { throwIfNoEntry: false })?.isFile() === true,
      readText: textReader(repoPath, tracked),
      findDeclarations: findSymbols,
    }),
  };
}
