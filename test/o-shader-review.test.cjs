'use strict';

/**
 * o-shader-review's check decides only what a pattern can: each rule fires on the defect and stays quiet on its
 * fixed twin, a file no validator can compile is unrated rather than clean, and the extensions it reads are the
 * ones o-review puts in a review's scope.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CHECK = path.join(ROOT, 'skills', 'o-shader-review', 'scripts', 'shader-check.mjs');
const DISCOVERY = path.join(ROOT, 'skills', 'o-review', 'scripts', 'file-discovery.mjs');
const shaderCheck = () => import(CHECK);

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shader-check-'));

function writeAll(dir, files) {
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), source);
  return Object.keys(files).map((name) => path.join(dir, name));
}

/** The rule findings for one file, as `rule@line`; validators are left out so the result is the same on any machine. */
async function rulesFor(name, source) {
  const { check } = await shaderCheck();
  const dir = tempDir();
  const [file] = writeAll(dir, { [name]: source });
  return check([file], { root: dir }).findings.filter((f) => f.rule !== 'does-not-compile').map((f) => `${f.rule}@${f.line}`);
}

const CASES = [
  {
    rule: 'godot3-name',
    name: 'old.gdshader',
    bad: 'shader_type spatial;\nuniform vec4 tint : hint_color;\nvoid vertex() { VERTEX = (WORLD_MATRIX * vec4(VERTEX, 1.0)).xyz; }\n',
    good: 'shader_type spatial;\nuniform vec4 tint : source_color;\nvoid vertex() { VERTEX = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }\n',
    lines: [2, 3],
  },
  {
    rule: 'int-to-float',
    name: 'speed.gdshader',
    bad: 'shader_type canvas_item;\nuniform float speed : hint_range(0, 2) = 1;\n',
    good: 'shader_type canvas_item;\nuniform float speed : hint_range(0, 2) = 1.0;\n',
    lines: [2],
  },
  {
    rule: 'reversed-smoothstep',
    name: 'edge.gdshader',
    bad: 'shader_type canvas_item;\nvoid fragment() { COLOR.a = smoothstep(1.0, 0.5, UV.x); }\n',
    good: 'shader_type canvas_item;\nvoid fragment() { COLOR.a = 1.0 - smoothstep(0.5, 1.0, UV.x); }\n',
    lines: [2],
  },
  {
    rule: 'opaque-alpha-write',
    name: 'opaque.gdshader',
    bad: 'shader_type spatial;\nvoid fragment() {\n  ALBEDO = vec3(1.0);\n  ALPHA = 1.0;\n}\n',
    good: 'shader_type spatial;\nvoid fragment() {\n  ALBEDO = vec3(1.0);\n}\n',
    lines: [4],
  },
  {
    rule: 'silenced-uniformity',
    name: 'quiet.wgsl',
    bad: 'diagnostic(off, derivative_uniformity);\n@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }\n',
    good: '@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }\n',
    lines: [1],
  },
  {
    rule: 'variant-explosion',
    name: 'Lit.shader',
    bad: 'Shader "X" { SubShader { Pass {\nHLSLPROGRAM\n#pragma multi_compile _ A B C D E F G\n#pragma multi_compile _ H I J K L M N\n#pragma multi_compile _ O P Q R S T U\nENDHLSL\n} } }\n',
    good: 'Shader "X" { SubShader { Pass {\nHLSLPROGRAM\n#pragma shader_feature_local _ A B C D E F G\n#pragma multi_compile _ H I J K L M N\nENDHLSL\n} } }\n',
    lines: [3],
  },
];

for (const { rule, name, bad, good, lines } of CASES) {
  test(`${rule} fires on the defect and not on its fix`, async () => {
    assert.deepEqual(await rulesFor(name, bad), lines.map((line) => `${rule}@${line}`));
    assert.deepEqual(await rulesFor(name, good), []);
  });
}

test('a GLSL ES fragment shader nothing validated is checked for its precision and its casts', async () => {
  const { check } = await shaderCheck();
  const dir = tempDir();
  // A `.glsl` names no stage, so glslang never runs on it and the rules stand in for it on every machine.
  const [file] = writeAll(dir, { 'es.glsl': '#version 300 es\nout vec4 frag;\nvoid main() { float a = 2; gl_FragColor = vec4(a); }\n' });
  const report = check([file], { root: dir });
  assert.equal(report.files[0].validator.status, 'unrated');
  assert.deepEqual(report.findings.map((f) => `${f.rule}@${f.line}`), ['missing-precision@1', 'int-to-float@3']);
});

test("a ported Godot 4 uniform named SCREEN_TEXTURE and a 3.x name inside a comment are not findings", async () => {
  const source = [
    'shader_type canvas_item;',
    '// WORLD_MATRIX was the 3.x name',
    'uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;',
    'void fragment() { COLOR = texture(SCREEN_TEXTURE, SCREEN_UV); }',
  ].join('\n');
  assert.deepEqual(await rulesFor('port.gdshader', source), []);
});

test('a multi_compile line with no keywords counts once, not the line after it', async () => {
  const source = 'HLSLPROGRAM\n#pragma multi_compile _ A B C\n#pragma multi_compile_fog\nfloat4 frag() : SV_Target { return 1; }\nENDHLSL\n';
  const { check } = await shaderCheck();
  const dir = tempDir();
  const [file] = writeAll(dir, { 'fog.shader': source });
  assert.deepEqual(check([file], { root: dir, maxVariants: 3 }).findings.map((f) => f.detail.match(/builds (\d+)/)[1]), ['4']);
  assert.deepEqual(check([file], { root: dir, maxVariants: 4 }).findings, []);
});

test('a .shader is Godot 3 when it opens with shader_type, and Unity ShaderLab otherwise', async () => {
  const { languageOf } = await shaderCheck();
  assert.equal(languageOf('a.shader', 'shader_type spatial;\n'), 'godot');
  assert.equal(languageOf('a.shader', 'Shader "Custom/X" { SubShader { } }\n'), 'unity');
  assert.equal(languageOf('a.usf', ''), 'unreal');
});

test('a file no validator can compile says why, and is listed as unrated', async () => {
  const { check } = await shaderCheck();
  const dir = tempDir();
  const files = writeAll(dir, {
    'chunk.glsl': 'uniform float t;\n',
    'snippet.frag': 'uniform float t;\nvoid main() { gl_FragColor = vec4(t); }\n',
    'bevy.wgsl': '#import bevy_pbr::forward_io::VertexOutput\n@fragment fn fragment(in: VertexOutput) -> @location(0) vec4f { return vec4f(1.0); }\n',
    'blur.hlsl': 'float4 main() : SV_Target { return 1; }\n',
  });
  const report = check(files, { root: dir });
  const reasons = Object.fromEntries(report.files.map((f) => [f.file, f.validator.reason]));
  assert.match(reasons['chunk.glsl'], /names no stage/);
  assert.match(reasons['snippet.frag'], /no #version/);
  assert.match(reasons['bevy.wgsl'], /naga_oil/);
  assert.match(reasons['blur.hlsl'], /dxc -T/);
  assert.equal(report.unrated.length, 4);
});

test('the CLI exits 2 with no shader file, 1 on a finding and 0 on a clean file', () => {
  const dir = tempDir();
  writeAll(dir, { 'notes.md': '# not a shader\n', 'bad.gdshader': 'shader_type spatial;\nuniform vec4 c : hint_color;\n', 'ok.gdshader': 'shader_type spatial;\n' });
  const run = (...args) => spawnSync(process.execPath, [CHECK, ...args], { cwd: dir, encoding: 'utf8' });
  assert.equal(run('notes.md').status, 2);
  assert.equal(run('bad.gdshader').status, 1);
  const clean = run('ok.gdshader');
  assert.equal(clean.status, 0, clean.stderr);
  assert.deepEqual(JSON.parse(clean.stdout).findings, []);
  assert.equal(run('--help').status, 0);
});

test("the check reads every shader extension o-review puts in a review's scope, and no other", async () => {
  const { LANGUAGES } = await shaderCheck();
  const { SHADER_EXTENSIONS } = await import(DISCOVERY);
  assert.deepEqual(Object.keys(LANGUAGES).sort(), SHADER_EXTENSIONS.map((ext) => `.${ext}`).sort());
});
