#!/usr/bin/env node
/**
 * o-test-gen — test stubs for the functions a source file exports, in the project's own test framework.
 *
 * Every stub fails until a person or agent writes it: a stub that passes is a test that checks nothing, which is
 * the exact thing o-floor and o-verify exist to catch. Existing test files are never overwritten.
 *
 * Usage:
 *   node generate.mjs <file-or-dir> [--output <dir>] [--framework node|jest|vitest|mocha|pytest] [--dry-run]
 * Output (stdout): JSON — the framework and where it was detected from, each file written, each file skipped.
 * Exit: 0 done (including "nothing to generate") · 1 a path does not exist · 2 usage error
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const JS_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"];
const SOURCE_EXTENSIONS = [...JS_EXTENSIONS, ".py"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".o-skills", "__pycache__", ".venv", "venv"]);
const FRAMEWORKS = ["node", "jest", "vitest", "mocha", "pytest"];

export function parseArgs(argv) {
  const args = { target: null, output: null, framework: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--output") args.output = argv[++i];
    else if (argv[i] === "--framework") args.framework = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--all") continue; // older callers; a directory target already means every file in it
    else if (!argv[i].startsWith("--")) args.target = argv[i];
    else throw new Error(`unknown option ${argv[i]}`);
  }
  if (!args.target) throw new Error("a file or directory is required");
  if (args.framework && !FRAMEWORKS.includes(args.framework)) throw new Error(`--framework is one of ${FRAMEWORKS.join(", ")}`);
  return args;
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const firstExisting = (root, names) => names.find((name) => fs.existsSync(path.join(root, name))) ?? null;

/** The JS test framework a project uses, and the file or field that says so. Built-in node:test when nothing does. */
export function detectJsFramework(root) {
  const config = (prefix) => firstExisting(root, ["js", "mjs", "cjs", "ts", "mts", "cts"].map((ext) => `${prefix}.${ext}`));
  const vitest = config("vitest.config");
  if (vitest) return { framework: "vitest", from: vitest };
  const jest = config("jest.config");
  if (jest) return { framework: "jest", from: jest };
  const mocha = firstExisting(root, [".mocharc.yml", ".mocharc.yaml", ".mocharc.json", ".mocharc.js", ".mocharc.cjs"]);
  if (mocha) return { framework: "mocha", from: mocha };

  const pkg = readJson(path.join(root, "package.json")) ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const framework of ["vitest", "jest", "mocha"]) if (framework in deps) return { framework, from: `package.json dependency ${framework}` };
  if (pkg.jest) return { framework: "jest", from: "package.json jest field" };
  if (/node\s+(--test|-r\s+node:test)/.test(pkg.scripts?.test ?? "")) return { framework: "node", from: "package.json scripts.test" };
  return { framework: "node", from: "default: no framework found, using the built-in node:test" };
}

export function detectPyFramework(root) {
  const marker = firstExisting(root, ["pytest.ini", "conftest.py", "tox.ini"]);
  if (marker) return { framework: "pytest", from: marker };
  const pyproject = fs.existsSync(path.join(root, "pyproject.toml")) ? fs.readFileSync(path.join(root, "pyproject.toml"), "utf8") : "";
  if (/\[tool\.pytest/.test(pyproject)) return { framework: "pytest", from: "pyproject.toml [tool.pytest]" };
  return { framework: "pytest", from: "default: pytest" };
}

/** ESM or CommonJS, the way Node would load this file. */
export function moduleKind(file, root) {
  const ext = path.extname(file);
  if ([".mjs", ".mts"].includes(ext)) return "esm";
  if ([".cjs", ".cts"].includes(ext)) return "cjs";
  if ([".ts", ".tsx"].includes(ext)) return "esm";
  return readJson(path.join(root, "package.json"))?.type === "module" ? "esm" : "cjs";
}

const paramsOf = (text) =>
  String(text ?? "")
    .split(",")
    .map((p) => p.trim().replace(/[=:].*$/s, "").replace(/^\.\.\./, "").trim())
    .filter((p) => p && /^[A-Za-z_$][\w$]*$/.test(p));

/** Where a local name is defined, so an `export { name }` still gets its parameters. */
function localFunction(source, name) {
  const declared = new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?function\\s*\\*?\\s*${name}\\s*\\(([^)]*)\\)`).exec(source);
  if (declared) return { params: paramsOf(declared[1]) };
  const arrow = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s+)?(?:function\\s*\\*?\\s*\\w*\\s*)?\\(([^)]*)\\)`).exec(source);
  if (arrow) return { params: paramsOf(arrow[1]) };
  const klass = new RegExp(`(?:^|\\n)\\s*class\\s+${name}\\b`).exec(source);
  if (klass) return { kind: "class", params: [] };
  return null;
}

/** Every function or class a JS/TS file exports — inline, through an export list, or through CommonJS. */
export function jsExports(source) {
  const found = new Map();
  const add = (name, info) => {
    if (name && !found.has(name)) found.set(name, { name, kind: "function", params: [], ...info });
  };
  let m;
  const inline = /export\s+(default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g;
  while ((m = inline.exec(source))) add(m[2] ?? "default", { params: paramsOf(m[3]), isDefault: Boolean(m[1]) });
  const arrows = /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*\w*\s*)?\(([^)]*)\)/g;
  while ((m = arrows.exec(source))) add(m[1], { params: paramsOf(m[2]) });
  const classes = /export\s+(default\s+)?class\s+([A-Za-z_$][\w$]*)/g;
  while ((m = classes.exec(source))) add(m[2], { kind: "class", isDefault: Boolean(m[1]) });
  const lists = /export\s*\{([^}]*)\}(?!\s*from)/g;
  while ((m = lists.exec(source))) {
    for (const entry of m[1].split(",").map((e) => e.trim()).filter(Boolean)) {
      const [local, exported = local] = entry.split(/\s+as\s+/).map((s) => s.trim());
      const info = localFunction(source, local);
      if (info) add(exported, info);
    }
  }
  const cjsObject = /module\.exports\s*=\s*\{([^}]*)\}/g;
  while ((m = cjsObject.exec(source))) {
    for (const entry of m[1].split(",").map((e) => e.trim()).filter(Boolean)) {
      const [exported, local = exported] = entry.split(":").map((s) => s.trim());
      const info = localFunction(source, local);
      if (info) add(exported, info);
    }
  }
  const cjsProps = /(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\w*\s*)?\(([^)]*)\)/g;
  while ((m = cjsProps.exec(source))) add(m[1], { params: paramsOf(m[2]) });
  return [...found.values()];
}

export function pyExports(source) {
  const out = [];
  let m;
  const defs = /^def\s+([A-Za-z]\w*)\s*\(([^)]*)\)/gm;
  while ((m = defs.exec(source))) out.push({ name: m[1], kind: "function", params: m[2].split(",").map((p) => p.trim().replace(/[:=].*$/, "")).filter((p) => p && p !== "self" && p !== "cls") });
  const classes = /^class\s+([A-Za-z]\w*)/gm;
  while ((m = classes.exec(source))) out.push({ name: m[1], kind: "class", params: [] });
  return out;
}

/** Where tests live in this project: a `test/` or `tests/` folder when it has one, otherwise beside the source. */
export function testDirFor(file, root, output) {
  if (output) return path.resolve(root, output);
  const folder = firstExisting(root, ["test", "tests", "__tests__"]);
  return folder ? path.join(root, folder) : path.dirname(file);
}

export function testFileName(file) {
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  return ext === ".py" ? `test_${base}.py` : `${base}.test${ext}`;
}

const importSpecifier = (fromDir, file) => {
  const relative = path.relative(fromDir, file).split(path.sep).join("/");
  const withDot = relative.startsWith(".") ? relative : `./${relative}`;
  return [".ts", ".tsx", ".mts", ".cts"].includes(path.extname(file)) ? withDot.replace(/\.(ts|tsx|mts|cts)$/, "") : withDot;
};

const FAILING = {
  node: (what) => `assert.fail("TODO: ${what}");`,
  jest: (what) => `throw new Error("TODO: ${what}");`,
  vitest: (what) => `throw new Error("TODO: ${what}");`,
  mocha: (what) => `throw new Error("TODO: ${what}");`,
};

function jsHeader(framework, kind, names, spec, defaultName) {
  const named = names.filter((n) => n !== defaultName);
  const lines = [];
  if (kind === "esm") {
    if (framework === "node") lines.push('import { describe, it } from "node:test";', 'import assert from "node:assert/strict";');
    if (framework === "vitest") lines.push('import { describe, it } from "vitest";');
    if (framework === "jest") lines.push('import { describe, it } from "@jest/globals";');
    const parts = [defaultName ? defaultName : null, named.length ? `{ ${named.join(", ")} }` : null].filter(Boolean);
    lines.push(`import ${parts.join(", ")} from "${spec}";`);
  } else {
    if (framework === "node") lines.push('const { describe, it } = require("node:test");', 'const assert = require("node:assert/strict");');
    lines.push(`const { ${named.join(", ")} } = require("${spec}");`);
  }
  return lines.join("\n");
}

export function renderJs({ framework, kind, exportsFound, spec }) {
  const defaultExport = exportsFound.find((e) => e.isDefault);
  const defaultName = defaultExport ? (defaultExport.name === "default" ? "subject" : defaultExport.name) : null;
  const names = exportsFound.map((e) => (e.isDefault ? defaultName : e.name));
  const fail = FAILING[framework];
  const blocks = exportsFound.map((e, index) => {
    const name = names[index];
    const args = e.params.length ? ` (${e.params.join(", ")})` : "";
    const cases =
      e.kind === "class"
        ? [`constructs ${name} and exercises its main method`]
        : [`returns the expected result for a typical input${args}`, "handles an invalid or edge-case input"];
    return [`describe("${name}", () => {`, ...cases.map((c) => `  it("${c}", () => {\n    ${fail(`write this test for ${name}`)}\n  });`), "});"].join("\n");
  });
  return `${jsHeader(framework, kind, names, spec, defaultName)}\n\n${blocks.join("\n\n")}\n`;
}

export function renderPy({ exportsFound, module }) {
  const lines = [`from ${module} import ${exportsFound.map((e) => e.name).join(", ")}`, ""];
  for (const e of exportsFound) {
    for (const c of e.kind === "class" ? ["constructs_and_runs"] : ["typical_input", "invalid_input"]) {
      lines.push("", `def test_${e.name.toLowerCase()}_${c}():`, `    raise NotImplementedError("TODO: write this test for ${e.name}")`, "");
    }
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n\n")}`;
}

function sourceFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return SOURCE_EXTENSIONS.includes(path.extname(target)) ? [target] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(path.join(target, entry.name));
    const file = path.join(target, entry.name);
    const isTest = /\.(test|spec)\.[^.]+$/.test(entry.name) || /^test_.*\.py$/.test(entry.name);
    return SOURCE_EXTENSIONS.includes(path.extname(entry.name)) && !isTest ? [file] : [];
  });
}

export function generate({ target, output = null, framework = null, dryRun = false, root = process.cwd() }) {
  const written = [];
  const skipped = [];
  const detected = { js: detectJsFramework(root), py: detectPyFramework(root) };
  for (const file of sourceFiles(path.resolve(root, target))) {
    const source = fs.readFileSync(file, "utf8");
    const isPy = path.extname(file) === ".py";
    const exportsFound = isPy ? pyExports(source) : jsExports(source);
    if (!exportsFound.length) {
      skipped.push({ source: path.relative(root, file), reason: "exports no function or class this script can see" });
      continue;
    }
    const use = framework ?? (isPy ? detected.py : detected.js).framework;
    const dir = testDirFor(file, root, output);
    const testFile = path.join(dir, testFileName(file));
    if (fs.existsSync(testFile)) {
      skipped.push({ source: path.relative(root, file), reason: `${path.relative(root, testFile)} already exists — never overwritten` });
      continue;
    }
    const content = isPy
      ? renderPy({ exportsFound, module: path.relative(root, file).replace(/\.py$/, "").split(path.sep).join(".") })
      : renderJs({ framework: use, kind: moduleKind(file, root), exportsFound, spec: importSpecifier(dir, file) });
    if (!dryRun) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(testFile, content);
    }
    written.push({ source: path.relative(root, file), test: path.relative(root, testFile), framework: use, functions: exportsFound.map((e) => e.name) });
  }
  return { framework: framework ? { framework, from: "--framework" } : detected, dryRun, written, skipped };
}

const USAGE = `Usage: node generate.mjs <file-or-dir> [--output <dir>] [--framework node|jest|vitest|mocha|pytest] [--dry-run]
Writes one failing stub per exported function into the project's test location; an existing test file is skipped.`;

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}\n${USAGE}`);
    process.exit(2);
  }
  if (!fs.existsSync(path.resolve(args.target))) {
    console.error(`Error: ${args.target} does not exist`);
    process.exit(1);
  }
  console.log(JSON.stringify(generate(args), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
