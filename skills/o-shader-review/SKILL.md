---
name: o-shader-review
description: Review shaders — GLSL, HLSL with Unity's ShaderLab and Unreal's .usf, WGSL, Metal, Slang and Godot's shading language — for what breaks on the GPU: math and derivatives the specs leave undefined, precision, ports that flip a matrix, a UV or the depth range, and per-pixel cost. Compiles each file with the installed glslang, naga or Metal compiler, reports mechanical rules as file:line, and names every file no validator could check. Use when asked to review or check a shader for problems — a material, a .gdshader, .hlsl, .wgsl or .frag file, a port between engines, or a shader that looks wrong on mobile; o-review calls it as a pass when a change touches a shader.
version: 1.0.0
author: Community
tags: [shaders, glsl, hlsl, wgsl, msl, godot, unity, gpu, code-review]
user-invocable: true
---

# O-Shader-Review — Does It Render What It Claims, Everywhere It Ships?

A shader that compiles can still be wrong. The GLSL spec leaves `smoothstep` with reversed edges, `pow` of a
negative base and a derivative taken in divergent control flow undefined, so the pixel that looks right on the
author's GPU is garbage on another vendor's. A port between languages compiles cleanly and transposes a matrix,
flips a texture or reverses the depth test. And every line of a fragment shader runs once per pixel.

This skill reads shaders for those three things — correctness, portability, cost — in that order: a wrong pixel
outranks a slow one.

`<skill>` below is this skill's folder; its script answers `--help`.

## Two Ways It Runs

**As a pass inside o-review.** When a review's scope holds a shader file, `save-plan.mjs` writes a `[Shaders]`
heading naming those files. Read `references/pass.md` and fill it in.

**On its own**, when the user asks for a shader review or a port: every section below applies. Report the findings
in the reply in the pass card's format. When the user wants a fix plan, run o-review on the same files: this pass
then lands in its plan, and o-fix works from there.

## Procedure

1. **Check.** `node <skill>/scripts/shader-check.mjs <files or dirs>` (or `--all` for every tracked shader). It
   prints each file's language, the validator that compiled it or why none could, the rule findings as
   `file:line`, and `rated` / `unrated`. Exit 1 means a finding or a file that does not compile; exit 2 means it
   found no shader file, which is not a clean result.
2. **Read each file** against `references/checklist.md` (every language) and its language's section of
   `references/languages.md`. The script decides only what a pattern can; undefined math on a computed value, a
   space mismatch or a branch's cost is yours to find.
3. **Name the stage and the target.** Per-vertex or per-pixel, desktop or mobile, which renderer: the same line
   is MINOR in a vertex shader and MAJOR in a full-screen fragment pass.
4. **Write each finding** with its category (correctness, portability, precision, cost), severity, `file:line`,
   the input or platform that shows it, and the fix. For a rule that rests on a spec, name it.
5. **Copy `rated` and `unrated`.** A file with no validator is unrated, never clean.

## What the Check Decides

| Rule | Languages | Severity | Why |
|---|---|---|---|
| `does-not-compile` | GLSL, WGSL, Metal | CRITICAL | the installed compiler rejected it |
| `missing-precision` | GLSL ES fragment, unvalidated | CRITICAL | ES has no default float precision in the fragment stage |
| `int-to-float` | Godot; GLSL ES, unvalidated | CRITICAL | no implicit int → float there (`float a = 2;` fails) |
| `godot3-name` | `.gdshader` | CRITICAL | `hint_color`, `WORLD_MATRIX`, `SCREEN_TEXTURE`… do not exist in Godot 4 |
| `reversed-smoothstep` | GLSL, Godot | MAJOR | undefined when edge0 ≥ edge1 (WGSL defines it) |
| `silenced-uniformity` | WGSL | MAJOR | `diagnostic(off, derivative_uniformity)` hides an undefined derivative |
| `opaque-alpha-write` | Godot spatial | MAJOR | writing `ALPHA`, even 1.0, moves the material to the transparent pipeline |
| `variant-explosion` | Unity, HLSL | MAJOR | `multi_compile` builds every combination; `--max-variants` sets the bar |

## Severity

| Level | For a shader |
|---|---|
| CRITICAL | does not compile on a target it ships to, or reaches a wrong pixel, a NaN in a render target or an out-of-bounds read on a real input |
| MAJOR | undefined behaviour not yet shown, a port trap, precision that breaks on a shipped target, or avoidable work per pixel |
| MINOR | per-vertex or per-draw cost, style, a constant that could be a uniform |

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "It looks right on my GPU." | Undefined means each vendor chooses. One machine's result is a sample of one. |
| "The validator passed." | It checks the language, not the math: `pow(x, 2.2)` on a negative `x` compiles everywhere. |
| "No validator is installed, so that part is done." | That file is unrated. Say so and name the command that would rate it. |
| "The branch only runs for a few pixels." | Registers are sized by the larger branch even when it never runs, and a divergent group runs both sides. |
| "It's desktop-only, precision does not matter." | `half` and `mediump` hold ±65504 at best; time, world positions and UVs at scale do not fit. |
| "I ported it line by line, so it is the same shader." | `mod` ≠ `fmod` for negatives, constructors fill rows in HLSL and columns in GLSL, and depth runs 0..1 or −1..1. |

## Files

- `scripts/shader-check.mjs` — languages, validators, mechanical rules, `rated` / `unrated`.
- `references/pass.md` — the card o-review reads for its `[Shaders]` pass.
- `references/checklist.md` — the defect classes every language shares, each with its source.
- `references/languages.md` — per-language traps and validators: GLSL, GLSL ES, HLSL and its engine wrappers, WGSL, Metal, Slang, Godot.

## Related Skills

- **o-review** runs this as its `[Shaders]` pass; its `references/lang-gdscript.md` covers the GDScript side of a
  Godot change.
- **o-fix** applies the findings; **o-debug** takes a shader that renders wrong at runtime and needs a reproduction.
