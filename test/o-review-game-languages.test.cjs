'use strict';

/**
 * Games are written in C, C++, C#, Rust and a shading language, and before these tests o-review's discovery never
 * handed a `.cpp`, `.cs` or `.frag` file to its analyzers: a change to an engine measured "no changed source files".
 * These pin what discovery finds and skips, how shaders are measured, the [Shaders] heading the plan gains, and
 * the C-family functions tree-sitter finds once its grammar is installed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'skills', 'o-review', 'scripts');
const ANALYZER = path.join(SCRIPTS, 'analyze-complexity.mjs');
const GATE = path.join(ROOT, 'hooks', 'review-plan-gate.mjs');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'game-languages-'));

function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}

const analyze = (dir, files) => {
  const run = spawnSync(process.execPath, [ANALYZER, ...files], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, run.stderr);
  return { report: JSON.parse(run.stdout), stderr: run.stderr };
};

const byName = (report, file) => Object.fromEntries(report.files.find((f) => f.file === file).functions.map((fn) => [fn.name, fn]));

test('discovery finds the languages games are written in and their shaders', async () => {
  const { SOURCE_EXTENSIONS, SHADER_FILE } = await import(path.join(SCRIPTS, 'file-discovery.mjs'));
  for (const file of ['Engine.cpp', 'Actor.h', 'Mesh.hpp', 'Math.inl', 'Player.cs', 'lib.rs', 'main.zig', 'game.lua', 'ui.luau', 'Main.hx', 'View.mm', 'player.gd']) {
    assert.ok(SOURCE_EXTENSIONS.test(file), `${file} is source`);
    assert.ok(!SHADER_FILE.test(file), `${file} is not a shader`);
  }
  for (const file of ['water.frag', 'sky.vert', 'blur.hlsl', 'Lit.shader', 'Common.cginc', 'Post.usf', 'pbr.wgsl', 'lit.metal', 'fx.slang', 'grass.gdshader']) {
    assert.ok(SOURCE_EXTENSIONS.test(file) && SHADER_FILE.test(file), `${file} is a shader`);
  }
  for (const file of ['README.md', 'scene.tscn', 'data.json', 'Mesh.hpp.orig']) assert.ok(!SOURCE_EXTENSIONS.test(file), `${file} is not source`);
});

test("a walk skips Unity's Library, Unreal's Intermediate, Cargo's target and MSBuild's obj", async () => {
  const { walkDir } = await import(path.join(SCRIPTS, 'file-discovery.mjs'));
  const dir = tempDir();
  for (const rel of ['Assets/Player.cs', 'Library/PackageCache/x/Gen.cs', 'Source/Actor.cpp', 'Intermediate/Build/Actor.gen.cpp', 'src/lib.rs', 'target/debug/build/out.rs', 'obj/Debug/AssemblyInfo.cs']) {
    write(dir, rel, '\n');
  }
  const found = [];
  walkDir(dir, found);
  assert.deepEqual(found.map((file) => path.relative(dir, file)).sort(), ['Assets/Player.cs', 'Source/Actor.cpp', 'src/lib.rs']);
});

test('shaders are measured by braces: HLSL attributes and semantics, WGSL fn, Metal stage qualifiers', () => {
  const dir = tempDir();
  write(dir, 'blur.hlsl', [
    'cbuffer Params : register(b0) { float4 tint; };',
    '[numthreads(8, 8, 1)]',
    'void CSMain(uint3 id : SV_DispatchThreadID, uint gi : SV_GroupIndex)',
    '{',
    '    if (id.x > 4 && id.y < 2) { return; }',
    '    for (int i = 0; i < 4; i++) { }',
    '}',
    'static float3 lift(float3 c) { return c.x > 0.5 ? c : 0; }',
  ].join('\n'));
  write(dir, 'water.wgsl', '@fragment\nfn fs(@location(0) uv: vec2f, @builtin(front_facing) facing: bool) -> @location(0) vec4f {\n  if (facing) { return vec4f(uv, 0.0, 1.0); }\n  return vec4f(0.0);\n}\n');
  write(dir, 'lit.metal', 'fragment float4 fragment_main(VertexOut in [[stage_in]], texture2d<float> tex [[texture(0)]]) {\n  return tex.sample(s, in.uv);\n}\n');
  const { report } = analyze(dir, ['blur.hlsl', 'water.wgsl', 'lit.metal']);

  const hlsl = byName(report, 'blur.hlsl');
  assert.deepEqual(Object.keys(hlsl), ['CSMain', 'lift'], 'a cbuffer is not a function');
  assert.equal(hlsl.CSMain.line, 3);
  assert.equal(hlsl.CSMain.paramCount, 2);
  assert.equal(hlsl.CSMain.complexity, 4, 'if, &&, for');
  assert.equal(hlsl.lift.complexity, 2, 'the ternary');
  assert.deepEqual(Object.keys(byName(report, 'water.wgsl')), ['fs']);
  assert.equal(byName(report, 'water.wgsl').fs.paramCount, 2);
  assert.equal(byName(report, 'lit.metal').fragment_main.paramCount, 2);
  for (const file of report.files) assert.equal(file.engine, 'shader (brace-based)');
});

test('a plan gains a [Shaders] heading only when a shader is in scope, and the gate still passes it', async () => {
  const { passSkeleton } = await import(path.join(SCRIPTS, 'save-plan.mjs'));
  assert.doesNotMatch(passSkeleton(), /\[Shaders\]/);
  const files = Array.from({ length: 12 }, (_, i) => `shaders/s${i}.frag`);
  const plan = passSkeleton(files);
  assert.match(plan, /## \[Shaders\] — pass 9 of the review/);
  assert.match(plan, /`shaders\/s0\.frag`/);
  assert.match(plan, /and 2 more/);
  const gate = spawnSync(process.execPath, [GATE], { input: plan, encoding: 'utf8' });
  assert.equal(gate.status, 0, gate.stderr);
});

/**
 * Whether a package resolves from where the analyzer looks: the project, then the global tree. web-tree-sitter
 * exports no `package.json`, so the bare name is tried too.
 */
const grammar = (pkg) => {
  const dirs = [ROOT, ...(spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }).stdout || '').trim().split('\n')];
  return dirs.some((dir) => [`${pkg}/package.json`, pkg].some((spec) => {
    try {
      return Boolean(require.resolve(spec, { paths: [dir] }));
    } catch {
      return false;
    }
  }));
};

test('C and C++ functions are named from their declarator, with every parameter counted', (t) => {
  if (!grammar('tree-sitter-cpp') || !grammar('web-tree-sitter')) return t.skip('tree-sitter-cpp is not installed');
  const dir = tempDir();
  write(dir, 'Actor.cpp', [
    'int Foo::bar(const std::vector<int>& v, float* out) const { for (auto x : v) {} return 0; }',
    'static int add(int a, char **argv, void (*cb)(int)) { while (a) { a--; } return a ? 1 : 0; }',
    'void none(void) {}',
  ].join('\n'));
  const fns = byName(analyze(dir, ['Actor.cpp']).report, 'Actor.cpp');
  assert.deepEqual(Object.keys(fns), ['Foo::bar', 'add', 'none']);
  assert.equal(fns['Foo::bar'].paramCount, 2);
  assert.equal(fns['Foo::bar'].complexity, 2, 'the range-for');
  assert.equal(fns.add.paramCount, 3);
  assert.equal(fns.add.complexity, 3, 'while and the ternary');
  assert.equal(fns.none.paramCount, 0, 'f(void) declares none');
});

test('Rust functions and C# methods are found once their grammars are installed', (t) => {
  const rust = grammar('tree-sitter-rust');
  const csharp = grammar('tree-sitter-c-sharp');
  if (!grammar('web-tree-sitter') || (!rust && !csharp)) return t.skip('neither tree-sitter-rust nor tree-sitter-c-sharp is installed');
  const dir = tempDir();
  write(dir, 'lib.rs', 'impl S { pub fn m(&self, x: u8, y: u8) -> u8 { match x { 0 => y, _ => 2 } } }\n');
  write(dir, 'Player.cs', 'class P { public P(int hp) {} int Hit(int dmg, string src) { foreach (var c in src) {} return dmg; } }\n');
  const { report } = analyze(dir, ['lib.rs', 'Player.cs']);
  if (rust) assert.deepEqual(byName(report, 'lib.rs').m.paramCount, 2, 'self is not counted');
  if (csharp) {
    const fns = byName(report, 'Player.cs');
    assert.deepEqual(Object.keys(fns), ['P', 'Hit']);
    assert.equal(fns.Hit.paramCount, 2);
    assert.equal(fns.Hit.complexity, 2, 'the foreach');
  }
});

test('a missing C# grammar is named by its real npm package', (t) => {
  if (grammar('tree-sitter-c-sharp')) return t.skip('tree-sitter-c-sharp is installed, so nothing is missing');
  if (!grammar('web-tree-sitter')) return t.skip('web-tree-sitter is not installed, so every grammar is missing');
  const dir = tempDir();
  write(dir, 'Player.cs', 'class P { int Hit(int dmg) { return dmg; } }\n');
  const { stderr } = analyze(dir, ['Player.cs']);
  assert.match(stderr, /tree-sitter-c-sharp/);
  assert.doesNotMatch(stderr, /tree-sitter-c_sharp/);
});
