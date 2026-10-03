#!/usr/bin/env node
/**
 * o-arch-lint scaffold — propose `.o-skills/config/arch.json` from the tree as it is.
 *
 * A declaration should say what the code does before it says what the code should do, so this reads the
 * tree, works out which directories are layers, and records the directions the imports already take. The
 * result is a proposal to ratify by hand: it prints it, and replaces an existing declaration only with
 * `--force`.
 *
 * Usage: node scaffold.mjs [--root <dir>] [--out <path>] [--force] [--self-test]
 * Exit:  0 printed or written · 2 usage or read error
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_CONFIG_PATH, DEFAULT_EXCLUDE, runCheck, walk } from "./arch-check.mjs";

// A layer is a directory of code. Everything else (a README, an image, a lockfile) is not one.
const CODE_EXTENSIONS = new Set([
  ".astro", ".c", ".clj", ".cpp", ".cs", ".cxx", ".dart", ".ex", ".exs", ".go", ".h", ".hpp", ".hs",
  ".java", ".js", ".jsx", ".kt", ".kts", ".lua", ".mjs", ".cjs", ".php", ".pl", ".py", ".rb", ".rs",
  ".scala", ".sh", ".swift", ".ts", ".tsx", ".zig",
]);

const IMPORT_SPECIFIERS = [/from\s+['"]([^'"]+)['"]/g, /import\(\s*['"]([^'"]+)['"]/g, /require\(\s*['"]([^'"]+)['"]/g];

const isCode = (rel) => CODE_EXTENSIONS.has(path.extname(rel));

/** The import specifiers a file names, without duplicates: relative ones, and those an alias maps into the tree. */
export function specifiersIn(text, aliases = []) {
  const found = IMPORT_SPECIFIERS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]));
  return [...new Set(found)].filter((spec) => spec.startsWith("./") || spec.startsWith("../") || aliases.some((alias) => spec.startsWith(alias.prefix)));
}

/** JSON with the comments and trailing commas tsconfig allows. */
/**
 * JSON with comments and trailing commas, as tsconfig and .eslintrc allow. Comments are removed outside strings
 * only: a glob such as "src/**\/*.ts" holds both `/*` and `*\/`, and a regex that ignores strings eats the text
 * between them.
 */
export function stripJsonComments(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function readLenientJson(file) {
  try {
    return JSON.parse(stripJsonComments(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Path aliases from tsconfig.json or jsconfig.json (`"@domain/*": ["src/domain/*"]`), as prefix → root-relative
 * target. An alias import is invisible to a relative-only scan, which is how a declaration ends up missing the
 * directions a TypeScript project actually takes.
 */
export function readAliases(root) {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const config = readLenientJson(path.join(root, name));
    const paths = config?.compilerOptions?.paths;
    if (!paths) continue;
    const base = config.compilerOptions.baseUrl ?? ".";
    return Object.entries(paths).flatMap(([key, targets]) => {
      const [target] = Array.isArray(targets) ? targets : [];
      if (!target) return [];
      return [{ prefix: key.replace(/\*$/, ""), target: path.posix.normalize(path.posix.join(base, target.replace(/\*$/, ""))) }];
    });
  }
  return [];
}

/** The root-relative path a specifier points at, through an alias when one matches. */
function resolveSpecifier(root, rel, spec, aliases) {
  const alias = aliases.find((entry) => spec.startsWith(entry.prefix));
  if (alias) return path.posix.join(alias.target, spec.slice(alias.prefix.length));
  return path.relative(root, path.resolve(root, path.dirname(rel), spec)).split(path.sep).join("/");
}

export function layerOf(rel) {
  const parts = rel.split("/");
  return parts.length > 1 ? parts[0] : null;
}

/** Every directory at the root that holds code, as a layer name to the files under it. */
export function readLayers(root, exclude) {
  const byLayer = new Map();
  for (const rel of walk(root, exclude)) {
    const layer = layerOf(rel);
    if (layer === null || !isCode(rel)) continue;
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), rel]);
  }
  return byLayer;
}

/** The other layers a file's relative imports reach, resolved rather than guessed at. */
export function outgoingLayers(root, rel, aliases = []) {
  const from = layerOf(rel);
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  const reached = specifiersIn(text, aliases)
    .map((spec) => layerOf(resolveSpecifier(root, rel, spec, aliases)))
    .filter((layer) => layer !== null && layer !== from);
  return [...new Set(reached)];
}

/**
 * A marker that matches an import of a path, not any string that happens to start with it: `from "../src/a"`,
 * `import("../src/a")`, `require("../src/a")` or a bare `import "../src/a"`. A quoted path in a fixture or a log
 * line is data, and reading it as an import reported every test that names a file.
 */
export const importMarker = (pathPattern) => `(?:\\bfrom\\s+|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|^\\s*import\\s+)['"]${pathPattern}`;

/**
 * The declaration the tree already keeps: one layer per code directory, each allowed the directions its
 * imports take today. The marker covers every relative depth, so a file moved one level deeper still matches.
 */
/** A glob that names one folder (`src/domain/*`, `src/domain/**`) as that folder; anything richer is not a root. */
const globRoot = (pattern) => {
  const folder = String(pattern).replace(/\/\*\*(?:\/\*)?$|\/\*$/, "").replace(/^\.\//, "");
  return /^[\w.@-]+(?:\/[\w.@-]+)*$/.test(folder) ? folder : null;
};

/** The boundaries declaration in a JSON ESLint config: `.eslintrc.json`, `.eslintrc`, or package.json's eslintConfig. */
function eslintBoundaries(root) {
  for (const [file, pick] of [[".eslintrc.json", (j) => j], [".eslintrc", (j) => j], ["package.json", (j) => j.eslintConfig]]) {
    const config = fs.existsSync(path.join(root, file)) ? pick(readLenientJson(path.join(root, file)) ?? {}) : null;
    if (config?.settings?.["boundaries/elements"]) return { file, config };
  }
  return null;
}

/** Each element type's allowed targets: an allow list under default "disallow", every other type minus the deny list otherwise. */
function boundariesAllowed(types, rule) {
  const options = Array.isArray(rule) ? rule[1] ?? {} : {};
  const list = (value) => [value ?? []].flat();
  const denyByDefault = options.default !== "allow";
  return Object.fromEntries(types.map((type) => {
    const rules = (options.rules ?? []).filter((entry) => list(entry.from).includes(type));
    const allowed = rules.flatMap((entry) => list(entry.allow));
    const denied = rules.flatMap((entry) => list(entry.disallow));
    const targets = denyByDefault ? allowed : types.filter((other) => other !== type && !denied.includes(other));
    return [type, [...new Set(targets)].filter((other) => types.includes(other) && other !== type).sort()];
  }));
}

/**
 * A declaration the project already keeps elsewhere, so it is not declared twice. eslint-plugin-boundaries in a JSON
 * config becomes the proposal: its elements are the layers and its element-types rule the allowed dependencies.
 * A JavaScript config or a dependency-cruiser file is named, not read — reading it means running the project's code.
 */
export function existingDeclaration(root) {
  const found = eslintBoundaries(root);
  const unread = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", ".eslintrc.js", ".eslintrc.cjs", ".dependency-cruiser.js", ".dependency-cruiser.cjs", ".dependency-cruiser.json"].filter((file) => fs.existsSync(path.join(root, file)));
  if (!found) return { declaration: null, unread };
  const elements = found.config.settings["boundaries/elements"].map((element) => ({ type: element.type, roots: [element.pattern].flat().map(globRoot).filter(Boolean) })).filter((element) => element.type && element.roots.length);
  const types = elements.map((element) => element.type);
  const allowed = boundariesAllowed(types, found.config.rules?.["boundaries/element-types"]);
  const layers = Object.fromEntries(elements.map((element) => [element.type, { roots: element.roots, import_markers: element.roots.map((folder) => importMarker(`(?:\\.\\.?/)+${folder.split("/").at(-1)}/`)) }]));
  return { declaration: { source: found.file, layers, allowed_dependencies: allowed }, unread: unread.filter((file) => file !== found.file) };
}

export function proposeDeclaration({ root, exclude = [] }) {
  const rootAbs = path.resolve(root);
  const existing = existingDeclaration(rootAbs);
  const unreadNote = existing.unread.length ? ` Also found ${existing.unread.join(", ")}: a JavaScript config is not executed, so transcribe any layers it declares by hand.` : "";
  if (existing.declaration) {
    const { source, ...declared } = existing.declaration;
    return {
      note: `Imported from eslint-plugin-boundaries in ${source}: its elements are the layers and its element-types rule the allowed dependencies, so the two declarations agree. Element patterns richer than one folder were left out; add them as roots by hand.${unreadNote}`,
      ...declared,
    };
  }
  const byLayer = readLayers(rootAbs, [...DEFAULT_EXCLUDE, ...exclude]);
  const aliases = readAliases(rootAbs);
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const layers = {};
  const allowed = {};
  for (const layer of [...byLayer.keys()].sort()) {
    const aliasMarkers = aliases.filter((alias) => layerOf(`${alias.target}x`) === layer).map((alias) => importMarker(escape(alias.prefix)));
    layers[layer] = { roots: [layer], import_markers: [importMarker(`(?:\\.\\.?/)+${layer}/`), ...aliasMarkers] };
    allowed[layer] = [...new Set(byLayer.get(layer).flatMap((rel) => outgoingLayers(rootAbs, rel, aliases)))].sort();
  }
  return {
    note: "Proposed from the tree as it is: these directions are the ones a static relative import already takes. An import built at run time (path.join with __dirname), an absolute specifier and a re-export are all invisible here, so an empty list means nothing was observed rather than nothing is imported: widen each entry to what the layer may do before ratifying, and treat a later change to this file as a decision rather than an edit. Once it is ratified, check that the commit takes: `.o-skills/` is ignored in some repos, and `git check-ignore -v .o-skills/config/arch.json` names the rule that does it, so force-add the file or keep the declaration where the repo already tracks its configuration." + unreadNote,
    layers,
    allowed_dependencies: allowed,
  };
}

// #region self-test

const FIXTURE = {
  "core/value.mjs": "export const value = 1;\n",
  "app/use.mjs": 'import { value } from "../core/value.mjs";\nexport const used = value;\n',
  "web/page.mjs": 'import { used } from "../app/use.mjs";\nexport const page = used;\n',
};

function writeTree(root, tree) {
  for (const [rel, text] of Object.entries(tree)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

const expectedOutcome = (proposed, checked) => ({
  "one layer per code directory": JSON.stringify(Object.keys(proposed.layers)) === JSON.stringify(["app", "core", "web"]),
  "the observed directions": proposed.allowed_dependencies.app.join(",") === "core" && proposed.allowed_dependencies.web.join(",") === "app",
  "the leaf layer depends on nothing": proposed.allowed_dependencies.core.length === 0,
  "the proposal passes the checker": checked.violations.length === 0 && checked.unrated.length === 0,
});

/**
 * Scaffold a tree, then check the tree against what was scaffolded. A proposal that does not pass its own
 * checker is not a proposal, so the decisive case is the checker's verdict rather than a shape comparison.
 */
export function selfTest() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "arch-scaffold-selftest-"));
  const cases = [];
  try {
    writeTree(scratch, FIXTURE);
    const proposed = proposeDeclaration({ root: scratch });
    const configPath = path.join(scratch, DEFAULT_CONFIG_PATH);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(proposed, null, 2));
    const checked = runCheck({ root: scratch, configPath });
    for (const [name, pass] of Object.entries(expectedOutcome(proposed, checked))) cases.push({ name, pass, expected: true, got: pass });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return { pass: cases.every((entry) => entry.pass), cases };
}

// #endregion self-test

const USAGE = "usage: scaffold.mjs [--root <dir>] [--out <path>] [--force] [--self-test]";

const KNOWN_FLAGS = ["--root", "--out", "--force", "--self-test", "--help", "-h"];
const VALUED_FLAGS = ["--root", "--out"];

/**
 * The first option the scaffold does not take, or undefined. An unrecognised option is a usage error rather
 * than a word to ignore, so a mistyped flag cannot quietly write a declaration somewhere you did not name.
 */
function unknownFlag(argv) {
  return argv.find((arg, at) => arg.startsWith("-") && !KNOWN_FLAGS.includes(arg) && !VALUED_FLAGS.includes(argv[at - 1]));
}

const readFlag = (argv, flag) => {
  const at = argv.indexOf(flag);
  if (at === -1) return { given: false, value: null };
  const value = argv[at + 1];
  return { given: true, value: value && !value.startsWith("--") ? value : null };
};

/** Print the proposal, and write it only where nothing would be replaced, or when `--force` says so. */
function writeOrPrint(target, text, force) {
  if (fs.existsSync(target) && !force) {
    console.log(text);
    console.error(JSON.stringify({ note: `${target} exists, so this is printed rather than written; pass --force to replace it`, wrote: null }, null, 2));
    return 0;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  console.log(JSON.stringify({ wrote: target }, null, 2));
  return 0;
}

function run(argv) {
  const root = readFlag(argv, "--root");
  const out = readFlag(argv, "--out");
  if ((root.given && !root.value) || (out.given && !out.value)) {
    console.error(USAGE);
    return 2;
  }
  const rootAbs = path.resolve(root.value ?? ".");
  const proposed = proposeDeclaration({ root: rootAbs });
  return writeOrPrint(out.value ?? path.join(rootAbs, DEFAULT_CONFIG_PATH), `${JSON.stringify(proposed, null, 2)}\n`, argv.includes("--force"));
}

function main(argv) {
  const unknown = unknownFlag(argv);
  if (unknown) {
    console.error(`${USAGE}\nunknown option: ${unknown}`);
    process.exit(2);
  }
  if (argv.includes("--self-test")) {
    const { pass, cases } = selfTest();
    console.log(JSON.stringify({ selfTest: pass, cases }, null, 2));
    // `process.exit` would discard whatever of that write had not drained, and the caller parses this document.
    // Setting the code keeps the exit status identical and lets Node flush stdout first.
    process.exitCode = pass ? 0 : 1;
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  // `run` prints the config it proposes, so exiting here would truncate that too; the value it returns is the status.
  process.exitCode = run(argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2));
}
