#!/usr/bin/env node
/**
 * o-shader-review — the shader check.
 *
 * For every shader file: its language, the compiler front-end that validates it when one is installed here, and
 * the mechanical rules below as `file:line` with a rule name. A rule fires only where a pattern decides the defect
 * on its own; everything that needs judgment is the reviewer's, by references/checklist.md.
 *
 * Usage: node shader-check.mjs [<file|dir> ...] [--all] [--max-variants <n>] [--help]
 * Exit:  0 clean · 1 a finding or a file that does not compile · 2 no shader file to check
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * A shader's language by extension. o-review's file-discovery.mjs lists the same extensions, kept equal by a test:
 * a shader it puts in a review's scope is one this check can read.
 */
export const LANGUAGES = {
  ".glsl": "glsl", ".vert": "glsl", ".frag": "glsl", ".geom": "glsl", ".comp": "glsl", ".tesc": "glsl", ".tese": "glsl",
  ".vsh": "glsl", ".fsh": "glsl", ".rgen": "glsl", ".rint": "glsl", ".rahit": "glsl", ".rchit": "glsl", ".rmiss": "glsl",
  ".rcall": "glsl",
  ".hlsl": "hlsl", ".hlsli": "hlsl", ".fx": "hlsl", ".fxh": "hlsl",
  ".cginc": "unity", ".compute": "unity", ".shader": "unity", ".usf": "unreal", ".ush": "unreal",
  ".wgsl": "wgsl", ".metal": "msl", ".slang": "slang", ".gdshader": "godot", ".gdshaderinc": "godot",
};

/** glslang reads the stage from these extensions; `.vsh` and `.fsh` it is told. */
const GLSL_STAGES = {
  ".vert": null, ".frag": null, ".geom": null, ".comp": null, ".tesc": null, ".tese": null, ".rgen": null,
  ".rint": null, ".rahit": null, ".rchit": null, ".rmiss": null, ".rcall": null, ".vsh": "vert", ".fsh": "frag",
};

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".godot", "Library", "Intermediate", "target", "obj"]);

/** Unity's multi_compile builds every combination whether a material uses it or not; above this a pass is flagged. */
const DEFAULT_MAX_VARIANTS = 256;

// ── Files ───────────────────────────────────────────────────────────────────────────────────

const isShader = (file) => Object.hasOwn(LANGUAGES, path.extname(file).toLowerCase());

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (isShader(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function trackedShaders(root) {
  const run = spawnSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" });
  if (run.status !== 0) return walk(root, []);
  return run.stdout.split("\0").filter((rel) => rel && isShader(rel)).map((rel) => path.join(root, rel)).filter((file) => fs.existsSync(file));
}

export function shaderFiles(args, root = process.cwd()) {
  const named = args.filter((arg) => !arg.startsWith("--")).map((arg) => path.resolve(arg)).filter((file) => fs.existsSync(file));
  const files = named.length ? named.flatMap((file) => (fs.statSync(file).isDirectory() ? walk(file, []) : [file])) : [];
  if (!named.length && args.includes("--all")) files.push(...trackedShaders(root));
  return [...new Set(files.filter(isShader))].sort();
}

/** A `.shader` is Unity's ShaderLab unless it opens with Godot 3's `shader_type`. */
export function languageOf(file, source) {
  const language = LANGUAGES[path.extname(file).toLowerCase()];
  if (language === "unity" && path.extname(file).toLowerCase() === ".shader" && /^\s*shader_type\b/m.test(source)) return "godot";
  return language;
}

/** The source with every comment blanked and every newline kept, so a rule never matches prose and lines still count. */
export function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, " "));
}

const lineAt = (text, index) => text.slice(0, index).split("\n").length;

// ── Validators ──────────────────────────────────────────────────────────────────────────────

const has = (tool, probe = ["--version"]) => spawnSync(tool, probe, { encoding: "utf8" }).status === 0;

const firstErrors = (text) => text.split("\n").filter((line) => /error/i.test(line)).slice(0, 5).map((line) => line.trim());

function runTool(tool, args) {
  const run = spawnSync(tool, args, { encoding: "utf8", timeout: 30_000 });
  if (run.status === 0) return { tool, status: "pass" };
  return { tool, status: "error", output: firstErrors(`${run.stdout}\n${run.stderr}`) };
}

function validateGlsl(file, source) {
  const ext = path.extname(file).toLowerCase();
  if (!Object.hasOwn(GLSL_STAGES, ext)) return { status: "unrated", reason: "a .glsl file names no stage: name it by stage (.vert, .frag, .comp) or run glslangValidator -S <stage>" };
  if (!/^\s*#version\b/m.test(source)) return { status: "unrated", reason: "no #version: a snippet the engine completes (three.js chunks, Godot RenderingDevice sections)" };
  if (!has("glslangValidator")) return { status: "unrated", reason: "glslangValidator is not installed (brew install glslang, apt install glslang-tools)" };
  return runTool("glslangValidator", GLSL_STAGES[ext] ? ["-S", GLSL_STAGES[ext], file] : [file]);
}

function validateWgsl(file, source) {
  if (/^\s*#(import|define_import_path|ifdef)\b/m.test(source)) return { status: "unrated", reason: "preprocessed by naga_oil (Bevy's #import): validate it in the app" };
  if (!has("naga")) return { status: "unrated", reason: "naga is not installed (cargo install naga-cli)" };
  return runTool("naga", [file]);
}

function validateMsl(file) {
  if (process.platform !== "darwin" || !has("xcrun", ["-sdk", "macosx", "--find", "metal"])) return { status: "unrated", reason: "the Metal compiler needs macOS with Xcode (xcrun metal)" };
  const air = path.join(os.tmpdir(), `shader-check-${process.pid}.air`);
  const result = runTool("xcrun", ["-sdk", "macosx", "metal", "-c", file, "-o", air]);
  fs.rmSync(air, { force: true });
  return { ...result, tool: "xcrun metal" };
}

const ENGINE_ONLY = {
  hlsl: "needs an entry point and a profile: dxc -T <vs_6_0|ps_6_0|cs_6_0> -E <entry> <file>",
  unity: "compiled by Unity: the Console shows its errors once the project imports it",
  unreal: "compiled by Unreal: the Output Log shows its errors when the shader map builds",
  slang: "needs its entry points: slangc <file> -target <spirv|hlsl|metal> -entry <name> -stage <stage>",
  godot: "compiled by Godot: the editor's shader panel shows its errors",
};

export function validate(file, source, language) {
  if (language === "glsl") return validateGlsl(file, source);
  if (language === "wgsl") return validateWgsl(file, source);
  if (language === "msl") return validateMsl(file);
  return { status: "unrated", reason: ENGINE_ONLY[language] };
}

// ── Rules ───────────────────────────────────────────────────────────────────────────────────

const isGlslEs = (code) => /^\s*#version\s+(?:\d+\s+es|100)\b/m.test(code);
const isFragment = (file, code) => /\.(frag|fsh)$/i.test(file) || /\bgl_Frag(Color|Data)\b/.test(code);

/** Godot 3 names a `.gdshader` (a Godot 4 file) can no longer compile with, and what replaced each. */
const GODOT3_NAMES = {
  hint_color: "source_color", hint_albedo: "source_color",
  SCREEN_TEXTURE: "a sampler2D uniform with hint_screen_texture", DEPTH_TEXTURE: "a sampler2D uniform with hint_depth_texture",
  WORLD_MATRIX: "MODEL_MATRIX", CAMERA_MATRIX: "INV_VIEW_MATRIX", INV_CAMERA_MATRIX: "VIEW_MATRIX",
  NORMALMAP: "NORMAL_MAP", NORMALMAP_DEPTH: "NORMAL_MAP_DEPTH",
};

const matchesOf = (code, pattern) => [...code.matchAll(pattern)].map((match) => ({ line: lineAt(code, match.index), match }));

function silencedUniformity({ code }) {
  return matchesOf(code, /diagnostic\s*\(\s*off\s*,\s*(derivative_uniformity|subgroup_uniformity)\s*\)/g).map(({ line, match }) => ({
    line, detail: `turns ${match[1]} off: where it would fire, the derivative or sample is undefined, not merely unproven`,
  }));
}

function missingPrecision({ file, code, validated }) {
  if (validated || !isGlslEs(code) || !isFragment(file, code) || /\bprecision\s+(lowp|mediump|highp)\s+float\s*;/.test(code)) return [];
  return [{ line: lineAt(code, code.search(/#version/)), detail: "a GLSL ES fragment shader has no default float precision; declare `precision highp float;` (or mediump)" }];
}

function intToFloat({ code, language, validated }) {
  if (language !== "godot" && (validated || !isGlslEs(code))) return [];
  return matchesOf(code, /\bfloat\s+[A-Za-z_]\w*\s*(?::[^=;]*)?=\s*-?\d+\s*[;,)]/g).map(({ line }) => ({
    line, detail: "an integer literal assigned to a float: no implicit conversion in GLSL ES or Godot; write it with a point (2.0)",
  }));
}

function reversedSmoothstep({ code, language }) {
  if (language !== "glsl" && language !== "godot") return [];
  return matchesOf(code, /\bsmoothstep\s*\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,/g)
    .filter(({ match }) => Number(match[1]) >= Number(match[2]))
    .map(({ line, match }) => ({ line, detail: `smoothstep(${match[1]}, ${match[2]}, x) is undefined when edge0 >= edge1; write 1.0 - smoothstep(${match[2]}, ${match[1]}, x)` }));
}

/** `uniform sampler2D SCREEN_TEXTURE : hint_screen_texture;` is Godot's own port of the old name, and legal. */
const declares = (code, name) => new RegExp(`\\b\\w+\\s+${name}\\s*[:;=,[]`).test(code);

function godot3Names({ file, code }) {
  if (!/\.gdshader(inc)?$/i.test(file)) return [];
  const removed = Object.keys(GODOT3_NAMES).filter((name) => !declares(code, name));
  if (!removed.length) return [];
  return matchesOf(code, new RegExp(`\\b(${removed.join("|")})\\b`, "g")).map(({ line, match }) => ({
    line, detail: `${match[1]} is a Godot 3 name that Godot 4 does not compile; use ${GODOT3_NAMES[match[1]]}`,
  }));
}

function opaqueAlphaWrite({ code, language }) {
  if (language !== "godot" || !/^\s*shader_type\s+spatial\b/m.test(code)) return [];
  return matchesOf(code, /\bALPHA\s*=\s*1(?:\.0*)?\s*;/g).map(({ line }) => ({
    line, detail: "writing ALPHA, even 1.0, moves the material to the transparent pipeline: no shadows, absent from hint_screen_texture and hint_depth_texture",
  }));
}

/** The keyword count of one `#pragma multi_compile…` line: `_` is an option too, the variant without a keyword. */
const keywordCount = (line) => line.trim().split(/\s+/).slice(2).length;

/** Each ShaderLab program block with where it starts; an include file (`.hlsl`, `.cginc`) is one program. */
function programs(code) {
  const blocks = [...code.matchAll(/\b(HLSLPROGRAM|CGPROGRAM)\b([\s\S]*?)(?:\bEND(?:HLSL|CG)\b|$)/g)];
  if (!blocks.length) return [{ text: code, start: 0 }];
  return blocks.map((block) => ({ text: block[2], start: block.index + block[1].length }));
}

function variantExplosion({ code, language, maxVariants }) {
  if (language !== "unity" && language !== "hlsl") return [];
  return programs(code).flatMap(({ text, start }) => {
    const pragmas = matchesOf(text, /^[ \t]*#pragma[ \t]+multi_compile\w*(?:[ \t]+[^\n]*)?$/gm);
    const variants = pragmas.reduce((product, { match }) => product * Math.max(1, keywordCount(match[0])), 1);
    if (variants <= maxVariants) return [];
    return [{ line: lineAt(code, start + pragmas[0].match.index), detail: `multi_compile builds ${variants} variants of this program (bar ${maxVariants}); move material-only keywords to shader_feature` }];
  });
}

/** Every rule, its severity, and what it checks. `rated` in the output names the ones that applied to a file. */
export const RULES = [
  { id: "silenced-uniformity", severity: "MAJOR", check: silencedUniformity },
  { id: "missing-precision", severity: "CRITICAL", check: missingPrecision },
  { id: "int-to-float", severity: "CRITICAL", check: intToFloat },
  { id: "reversed-smoothstep", severity: "MAJOR", check: reversedSmoothstep },
  { id: "godot3-name", severity: "CRITICAL", check: godot3Names },
  { id: "opaque-alpha-write", severity: "MAJOR", check: opaqueAlphaWrite },
  { id: "variant-explosion", severity: "MAJOR", check: variantExplosion },
];

// ── Report ──────────────────────────────────────────────────────────────────────────────────

function checkFile(file, options) {
  const source = fs.readFileSync(file, "utf8");
  const language = languageOf(file, source);
  const validator = validate(file, source, language);
  const context = { file, code: codeOnly(source), language, validated: validator.status !== "unrated", maxVariants: options.maxVariants };
  const rel = path.relative(options.root, file);
  const findings = RULES.flatMap((rule) => rule.check(context).map((hit) => ({ rule: rule.id, severity: rule.severity, file: rel, ...hit })));
  if (validator.status === "error") findings.unshift({ rule: "does-not-compile", severity: "CRITICAL", file: rel, line: 1, detail: validator.output.join(" · ") });
  return { file: rel, language, validator, findings };
}

export function check(files, { root = process.cwd(), maxVariants = DEFAULT_MAX_VARIANTS } = {}) {
  const results = files.map((file) => checkFile(file, { root, maxVariants }));
  const tools = [...new Set(results.filter((r) => r.validator.status !== "unrated").map((r) => r.validator.tool))];
  return {
    files: results.map(({ file, language, validator }) => ({ file, language, validator })),
    findings: results.flatMap((r) => r.findings),
    rated: [...RULES.map((rule) => rule.id), ...tools],
    unrated: results.filter((r) => r.validator.status === "unrated").map((r) => `${r.file}: ${r.validator.reason}`),
  };
}

const USAGE = `Usage: node shader-check.mjs [<file|dir> ...] [--all] [--max-variants <n>]
  <file|dir>          the shader files to check; a directory is walked
  --all               every shader file git tracks (the tree, outside a repository)
  --max-variants <n>  the multi_compile variants one Unity program may build (default ${DEFAULT_MAX_VARIANTS})
Prints JSON: files (language, validator), findings (rule, severity, file, line, detail), rated, unrated.
Exit: 0 clean · 1 a finding or a file that does not compile · 2 no shader file to check`;

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return console.log(USAGE);
  const args = [...argv];
  const at = args.indexOf("--max-variants");
  const maxVariants = at === -1 ? DEFAULT_MAX_VARIANTS : Number(args.splice(at, 2)[1]);
  const files = shaderFiles(args);
  if (!files.length || !Number.isFinite(maxVariants)) {
    console.error(files.length ? "--max-variants takes a number" : `No shader files found.\n${USAGE}`);
    process.exit(2);
  }
  const report = check(files, { maxVariants });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.findings.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2));
}
