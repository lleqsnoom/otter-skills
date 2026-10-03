#!/usr/bin/env node
/**
 * o-arch-lint arch-check — compare a code tree against the architecture it declares.
 *
 * Reads `.o-skills/config/arch.json` (found by walking up from the root, or named with --config),
 * walks the tree, and reports every place the code departs from the declaration. Detection only:
 * it never writes source, never touches the network, and never runs git.
 *
 * Usage: node arch-check.mjs [--root <dir>] [--config <path>] [--explain-coverage] [--self-test]
 * Exit:  0 clean (or nothing to be in parity with) · 1 violations · 2 usage or config error
 *
 * The self-test cases live beside the skill, in `evals/fixtures/arch-cases.json`, so a new case is data
 * rather than a change to this file.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_CONFIG_PATH = ".o-skills/config/arch.json";

// A repo may add to this list; it can never need to remove from it, because `utils` is not a smaller
// word for something, it is a decision nobody made.
export const DEFAULT_BANNED_NAMES = ["utils", "helpers", "common", "shared", "misc", "tools", "other"];

// Vendored, generated and tool-owned trees are not the repo's design, so they are not its violations.
export const DEFAULT_EXCLUDE = ["node_modules", ".git", "dist", ".astro", "vendor", ".venv", ".o-skills"];

// Naming needs no declaration, so it is rated on every run; the other two depend on what was declared.
const ALWAYS_RATED = ["naming"];
const DECLARED_GROUPS = ["dependency-direction", "boundaries"];

const asArray = (value) => (Array.isArray(value) ? value : []);

const stem = (name) => name.replace(/\.[^.]+$/, "");

/**
 * A name is banned when a banned word stands alone inside it, so `utils`, `date-utils` and
 * `string_utils` all hit while `utilities` (another word) and `toolsmith` do not. A file's
 * extension is stripped first, a directory's is not (`v1.2` is not `v1`).
 */
export function bannedWord(name, bannedNames, { file = false } = {}) {
  const lower = (file ? stem(name) : name).toLowerCase();
  return bannedNames.find((word) => new RegExp(`(^|[-_. ])${word}s?($|[-_. ])`, "i").test(lower)) ?? null;
}

/** The nearest declaration above `startDir`, or null when the tree declares nothing. */
export function findConfig(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, DEFAULT_CONFIG_PATH);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const excluded = (relPath, exclude) => exclude.some((part) => relPath.includes(part));

/** Every file under the root, relative and slash separated, minus the excluded trees. */
export function walk(root, exclude) {
  const visit = (dir, prefix) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excluded(rel, exclude)) return [];
      return entry.isDirectory() ? visit(path.join(dir, entry.name), rel) : [rel];
    });
  return visit(root, "").sort();
}

const mustMatch = (base, pattern) => Boolean(pattern) && !new RegExp(pattern).test(base);
const mustNotMatch = (base, pattern) => Boolean(pattern) && new RegExp(pattern).test(base);

function basenameFailures(base, rule) {
  const failures = [];
  if (mustMatch(base, rule.must_match)) failures.push(rule.message ?? `${base} must match ${rule.must_match}`);
  if (mustNotMatch(base, rule.must_not_match)) failures.push(rule.message ?? `${base} must not match ${rule.must_not_match}`);
  return failures;
}

/**
 * A rule with no `applies_to`, or `*`, judges every file. One that names a layer judges only the
 * files the declaration puts in that layer, which is what makes a per-layer naming rule a boundary.
 */
const ruleApplies = (rule, rel, layerOf) => !rule.applies_to || rule.applies_to === "*" || layerOf.get(rel) === rule.applies_to;

const ruleViolations = (rel, base, rule) =>
  rule.path_regex && !new RegExp(rule.path_regex).test(rel)
    ? []
    : basenameFailures(base, rule).map((message) => ({ rule: "naming", file: rel, line: 1, message }));

const bannedDirectory = (segments, banned) =>
  segments.slice(0, -1).flatMap((part, index) =>
    bannedWord(part, banned)
      ? [
          {
            rule: "naming",
            file: `${segments.slice(0, index + 1).join("/")}/`,
            line: 1,
            message: `directory name "${part}" says nothing about the domain: name it for the concept it holds`,
          },
        ]
      : [],
  );

const bannedFilename = (rel, base, banned) =>
  bannedWord(base, banned, { file: true })
    ? [{ rule: "naming", file: rel, line: 1, message: `file name "${base}" says nothing about the domain: name it for the concept it holds` }]
    : [];

/** A directory is reported once however many files it holds, so a bad folder does not bury the rest. */
const dedupe = (violations) => {
  const seen = new Set();
  return violations.filter(({ file, message }) => {
    const key = `${file}|${message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * A path the declaration exempts from the banned-name rule: a workspace package such as `packages/shared` that
 * has a stated purpose and an owner is a published boundary, not a bag. The exemption is written down, so it is
 * a decision a reader can see rather than a silent hole.
 */
const exemptFromBannedNames = (rel, exempt) => exempt.some((prefix) => rel === prefix || rel.startsWith(`${prefix.replace(/\/$/, "")}/`));

export function checkNaming(files, config, layerOf = new Map()) {
  const banned = config?.banned_names ?? DEFAULT_BANNED_NAMES;
  const rules = asArray(config?.naming);
  const exempt = asArray(config?.naming_exempt);
  const violations = files.flatMap((rel) => {
    const segments = rel.split("/");
    const base = segments.at(-1);
    const bannedChecks = exemptFromBannedNames(rel, exempt) ? [] : [...bannedDirectory(segments, banned), ...bannedFilename(rel, base, banned)];
    return [
      ...bannedChecks,
      ...rules.filter((rule) => ruleApplies(rule, rel, layerOf)).flatMap((rule) => ruleViolations(rel, base, rule)),
    ];
  });
  return dedupe(violations);
}

/**
 * Which layer a file belongs to, by the longest matching root. Longest wins so `src/domain/events`
 * can sit inside `src/domain` without the shorter prefix stealing its files.
 */
export function classifyLayers(files, layers) {
  const roots = Object.entries(layers ?? {})
    .flatMap(([layer, cfg]) => asArray(cfg?.roots).map((root) => ({ layer, root: root.replace(/\/+$/, "") })))
    .sort((a, b) => b.root.length - a.root.length);
  const map = new Map();
  for (const rel of files) {
    const hit = roots.find(({ root }) => rel === root || rel.startsWith(`${root}/`));
    if (hit) map.set(rel, hit.layer);
  }
  return map;
}

/**
 * The directory a declaration belongs to. A config in the conventional place declares paths against the
 * repo above it, so a run scoped to a subtree resolves them there; a config named elsewhere by `--config`
 * is read against the run root, which is the only root it can be assumed to describe.
 */
const DECLARATION_PATH = /[/\\]\.o-skills[/\\]config[/\\][^/\\]+$/;
const configHome = (configPath, root) => (configPath && DECLARATION_PATH.test(configPath) ? configPath.replace(DECLARATION_PATH, "") : root);

const missingRoots = (home, config) =>
  Object.entries(config?.layers ?? {}).flatMap(([layer, cfg]) =>
    asArray(cfg?.roots)
      .filter((rootPath) => !fs.existsSync(path.join(home, rootPath)))
      .map((rootPath) => ({ rule: "boundaries", file: `${rootPath}/`, line: 1, message: `layer "${layer}" declares a root that is not on disk` })),
  );

const unknownRuleLayer = (config) =>
  asArray(config?.naming)
    .filter((rule) => rule.applies_to && rule.applies_to !== "*" && !(rule.applies_to in (config.layers ?? {})))
    .map((rule) => ({
      rule: "boundaries",
      file: DEFAULT_CONFIG_PATH,
      line: 1,
      message: `a naming rule targets layer "${rule.applies_to}", which no layer declares`,
    }));

/**
 * A declaration the tree contradicts: a layer root that is not on disk, or a naming rule aimed at a
 * layer nobody declared. Roots are resolved against the declaration's own directory, so checking a
 * subtree of a declared repo with `--root` reports nothing rather than every root as missing.
 */
export function checkDeclaration(root, config, configPath = null) {
  return [...missingRoots(configHome(configPath, root), config), ...unknownRuleLayer(config)];
}

/**
 * Files whose lines can hold an import. A README that names `src/a.js` as an example, or a fixture holding a path
 * as data, is not a dependency — scanning them read every documented path as a wrong-way import.
 */
export const CODE_EXTENSIONS = new Set([
  ".astro", ".c", ".clj", ".cpp", ".cs", ".cxx", ".dart", ".ex", ".exs", ".go", ".h", ".hpp", ".hs",
  ".java", ".js", ".jsx", ".kt", ".kts", ".lua", ".mjs", ".cjs", ".mts", ".cts", ".php", ".pl", ".py", ".rb", ".rs",
  ".scala", ".sh", ".swift", ".ts", ".tsx", ".vue", ".svelte", ".zig",
]);

const isCodeFile = (rel, config) => CODE_EXTENSIONS.has(path.extname(rel)) || asArray(config?.code_extensions).includes(path.extname(rel));

const layerMarkers = (config) =>
  Object.entries(config?.layers ?? {}).flatMap(([layer, cfg]) => asArray(cfg?.import_markers).map((marker) => ({ layer, marker })));

/** A line that is only a comment cannot import anything, however much it quotes an import. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#)/;

const firstMatch = (lines, marker) => lines.findIndex((line) => !COMMENT_LINE.test(line) && new RegExp(marker).test(line));

const permits = (allowed) => (asArray(allowed).length ? asArray(allowed).join(", ") : "nothing");

/**
 * Dependency direction: a file in one layer whose text matches another layer's `import_markers`,
 * where that other layer is not in `allowed_dependencies`. Markers are regexes matched against the
 * file's lines, so detection stays language-agnostic and the reported line number is the real one.
 */
export function checkDependencies({ root, files, config, layerOf }) {
  const allowed = config?.allowed_dependencies ?? {};
  const markers = layerMarkers(config);
  return files.flatMap((rel) => {
    const from = layerOf.get(rel);
    if (!from || !isCodeFile(rel, config)) return [];
    const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
    return markers
      .filter(({ layer }) => layer !== from && !asArray(allowed[from]).includes(layer))
      .map(({ layer, marker }) => ({ layer, at: firstMatch(lines, marker) }))
      .filter(({ at }) => at !== -1)
      .map(({ layer, at }) => ({
        rule: "dependency-direction",
        file: rel,
        line: at + 1,
        message: `${from} must not import ${layer}: it may depend on ${permits(allowed[from])}`,
      }));
  });
}

/**
 * The first dependency cycle the declaration itself draws, or null. It reads the declared whitelist rather
 * than the imports, so it needs no parser and cannot report a cycle the markers merely failed to see.
 */
export function declaredCycle(config) {
  const declared = new Set(Object.keys(config?.layers ?? {}));
  const edges = Object.fromEntries(
    Object.entries(config?.allowed_dependencies ?? {})
      .filter(([, deps]) => Array.isArray(deps))
      .map(([layer, deps]) => [layer, deps.filter((dep) => declared.has(dep))]),
  );
  const settled = new Set();
  const walk = (layer, path) => {
    if (path.includes(layer)) return [...path.slice(path.indexOf(layer)), layer];
    if (settled.has(layer)) return null;
    const cycle = (edges[layer] ?? []).map((dep) => walk(dep, [...path, layer])).find(Boolean);
    if (cycle) return cycle;
    settled.add(layer);
    return null;
  };
  return Object.keys(edges).map((layer) => walk(layer, [])).find(Boolean) ?? null;
}

/** A declared cycle means the two layers are one component with two names, which is what ADP forbids. */
const cycleViolations = (config) => {
  const cycle = declaredCycle(config);
  return cycle
    ? [
        {
          rule: "dependency-direction",
          file: DEFAULT_CONFIG_PATH,
          line: 1,
          message: `the declaration allows a cycle (${cycle.join(" -> ")}): move the shared piece below both layers, or invert one edge with a port`,
        },
      ]
    : [];
};

const directionViolations = ({ root, files, config, layerOf, coverage }) =>
  coverage.unrated.includes("dependency-direction")
    ? []
    : [...checkDependencies({ root, files, config, layerOf }), ...cycleViolations(config)];

/**
 * Which declared groups the config rates and which it cannot, so a partial declaration is reported,
 * not obeyed. The dependency group is all-or-nothing: one layer without an entry would leave its
 * imports unchecked while the run still read as verified.
 */
export function groupCoverage(config) {
  const layers = Object.keys(config?.layers ?? {});
  const everyLayerHasAnEntry = layers.length > 0 && layers.every((layer) => Array.isArray(config?.allowed_dependencies?.[layer]));
  const rated = { "dependency-direction": everyLayerHasAnEntry, boundaries: layers.length > 0 };
  return {
    rated: [...ALWAYS_RATED, ...DECLARED_GROUPS.filter((group) => rated[group])],
    unrated: DECLARED_GROUPS.filter((group) => !rated[group]),
  };
}

function assertRoot(root) {
  const rootAbs = path.resolve(root);
  if (!fs.existsSync(rootAbs) || !fs.statSync(rootAbs).isDirectory()) throw new Error(`--root is not a directory: ${root}`);
  return rootAbs;
}

/** An omitted `configPath` searches upward; an explicit `null` means the tree declares nothing. */
function loadDeclaration(rootAbs, configPath) {
  const usedConfig = configPath === undefined ? findConfig(rootAbs) : configPath;
  if (!usedConfig) return { config: null, usedConfig: null };
  const config = JSON.parse(fs.readFileSync(usedConfig, "utf8"));
  if (config !== null && (typeof config !== "object" || Array.isArray(config))) {
    throw new Error(`config must be a JSON object: ${usedConfig}`);
  }
  return { config, usedConfig };
}

const byLocation = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;

/**
 * The files a declared layer does not claim, which is where a wrong-way import the markers never
 * describe would hide. A root-level file is repo metadata rather than a module looking for a layer,
 * and the declaration itself is not part of the tree's design, so neither is listed.
 */
const unplacedFiles = (files, { config, layerOf, rootAbs, usedConfig }) =>
  Object.keys(config?.layers ?? {}).length === 0
    ? []
    : files.filter((rel) => !layerOf.has(rel) && rel.includes("/") && path.resolve(rootAbs, rel) !== usedConfig);

const report = ({ rootAbs, usedConfig, coverage, unplaced, violations, explainCoverage }) => ({
  root: rootAbs,
  config: usedConfig,
  rated: coverage.rated,
  unrated: coverage.unrated,
  unplaced: unplaced.length,
  ...(explainCoverage ? { unplacedFiles: unplaced } : {}),
  violations,
});

/**
 * Compare one root against one config. Reads the tree and returns the finding, so the self-test can
 * run it over a fixture in-process. `explainCoverage` adds the files no declared layer placed.
 */
export function runCheck({ root, configPath, explainCoverage = false } = {}) {
  const rootAbs = assertRoot(root);
  const { config, usedConfig } = loadDeclaration(rootAbs, configPath);
  const files = walk(rootAbs, [...DEFAULT_EXCLUDE, ...asArray(config?.exclude)]);
  const coverage = groupCoverage(config);
  const layerOf = classifyLayers(files, config?.layers);
  const violations = [
    ...checkNaming(files, config, layerOf),
    ...checkDeclaration(rootAbs, config, usedConfig),
    ...directionViolations({ root: rootAbs, files, config, layerOf, coverage }),
  ];
  return report({
    rootAbs,
    usedConfig,
    coverage,
    unplaced: unplacedFiles(files, { config, layerOf, rootAbs, usedConfig }),
    violations: violations.sort(byLocation),
    explainCoverage,
  });
}

// #region self-test

/**
 * The cases `--self-test` runs. Kept as data so a third party adds one without editing this file:
 * a tree, the declaration it is checked against, and the report expected of it.
 */
const FIXTURE_FILE = new URL("../evals/fixtures/arch-cases.json", import.meta.url);

export function fixtureCases() {
  try {
    return JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8")).cases;
  } catch (error) {
    throw new Error(`the cases are read from ${fileURLToPath(FIXTURE_FILE)}, which ships beside this skill: ${error.message}`);
  }
}

function writeTree(dir, tree) {
  for (const [rel, text] of Object.entries(tree)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

/**
 * A fixture tree in its own directory, plus the declaration it is checked against. The declaration sits
 * beside the tree unless the case sends it inside the tree with `configHome`, which a subtree case needs.
 */
function fixture(scratch, { name, tree, config, configHome }) {
  const dir = path.join(scratch, name);
  writeTree(dir, tree);
  if (!config) return { name, dir, configPath: null };
  const configPath = configHome ? path.join(dir, configHome) : path.join(scratch, `${name}-arch.json`);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config));
  return { name, dir, configPath };
}

/** Both sides of a case pass through this, so a fixture compares values rather than key order. */
const caseShape = ({ violations, rated, unrated, unplaced, unplacedFiles }) => ({ violations, rated, unrated, unplaced, unplacedFiles: unplacedFiles ?? null });

const caseOf = ({ name, dir, configPath }, expected, { explainCoverage = false } = {}) => {
  const result = runCheck({ root: dir, configPath, explainCoverage });
  const got = caseShape({
    violations: result.violations.map((violation) => `${violation.rule} ${violation.file}:${violation.line}`).sort(),
    rated: result.rated,
    unrated: result.unrated,
    unplaced: result.unplaced,
    unplacedFiles: result.unplacedFiles ?? null,
  });
  const want = caseShape(expected);
  return { name, pass: JSON.stringify(got) === JSON.stringify(want), expected: want, got };
};

/**
 * Every case in `evals/fixtures/arch-cases.json`, run in-process so `--self-test` is hermetic: no network,
 * no git, and nothing written outside a temporary directory it removes. A case may check a subtree of its
 * tree (`root`) and may put the declaration inside the tree (`configHome`).
 */
export function selfTest() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "arch-check-selftest-"));
  let cases = [];
  try {
    cases = fixtureCases().map(({ name, tree, config = null, configHome, root = ".", explainCoverage = false, expect }) => {
      const target = fixture(scratch, { name: name.replace(/[^\w.-]+/g, "-"), tree, config, configHome });
      return caseOf({ name, dir: path.resolve(target.dir, root), configPath: target.configPath }, expect, { explainCoverage });
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return { pass: cases.every((entry) => entry.pass), cases };
}

// #endregion self-test

const USAGE = "usage: arch-check.mjs [--root <dir>] [--config <path>] [--explain-coverage] [--self-test]";

const KNOWN_FLAGS = ["--root", "--config", "--explain-coverage", "--self-test", "--help", "-h"];
const VALUED_FLAGS = ["--root", "--config"];

/**
 * The first option the checker does not take, or undefined. An unrecognised option is a usage error rather
 * than a word to ignore: a mistyped flag would otherwise drop what the caller asked for and still report a
 * clean tree, which is the reading this tool exists to prevent.
 */
function unknownFlag(argv) {
  return argv.find((arg, at) => arg.startsWith("-") && !KNOWN_FLAGS.includes(arg) && !VALUED_FLAGS.includes(argv[at - 1]));
}

/** A flag with no value is a usage error, not a silent fall back to the default. */
function readFlag(argv, flag) {
  const at = argv.indexOf(flag);
  if (at === -1) return { given: false, value: null };
  const value = argv[at + 1];
  return { given: true, value: value && !value.startsWith("--") ? value : null };
}

function parseTarget(argv) {
  const root = readFlag(argv, "--root");
  const config = readFlag(argv, "--config");
  if ((root.given && !root.value) || (config.given && !config.value)) return null;
  return {
    root: root.value,
    configPath: config.given ? config.value : undefined,
    explainCoverage: argv.includes("--explain-coverage"),
  };
}

function printSelfTest() {
  try {
    const { pass, cases } = selfTest();
    console.log(JSON.stringify({ selfTest: pass, cases }, null, 2));
    // `process.exit` would discard whatever of that write had not drained, and the caller parses this document.
    // Setting the code keeps the exit status identical and lets Node flush stdout first.
    process.exitCode = pass ? 0 : 1;
    return;
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(2);
  }
}

function runTarget(argv) {
  const target = parseTarget(argv);
  if (!target) {
    console.error(USAGE);
    process.exit(2);
  }
  let result;
  try {
    result = runCheck({ root: target.root ?? process.cwd(), configPath: target.configPath, explainCoverage: target.explainCoverage });
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(2);
  }
  console.log(JSON.stringify(result, null, 2));
  // The violation count is the exit contract; setting it rather than exiting keeps that contract and still lets
  // stdout drain, so a caller reading this document never gets a truncated one.
  process.exitCode = result.violations.length ? 1 : 0;
}

function main(argv) {
  const unknown = unknownFlag(argv);
  if (unknown) {
    console.error(`${USAGE}\nunknown option: ${unknown}`);
    process.exit(2);
  }
  if (argv.includes("--self-test")) {
    printSelfTest();
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  runTarget(argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2));
}
