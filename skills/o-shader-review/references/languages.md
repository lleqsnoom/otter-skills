# Per-language traps and validators

Open the section for the file under review beside `checklist.md`. Source keys are listed at the end of
`checklist.md`. A trap marked *(verify)* comes from practice rather than from a spec this skill has read: report it
as MAJOR at most, and say so.

## GLSL — desktop OpenGL and Vulkan (`.vert .frag .comp .geom .tesc .tese`, ray-tracing stages, `.glsl`)

- **Validator:** `glslangValidator <file>` reads the stage from the extension; `-S <stage>` names it for a `.glsl`,
  `.vsh` or `.fsh`. A file with no `#version` is a snippet the engine completes (three.js chunks, Godot's
  RenderingDevice `#[vertex]` sections): read it, do not validate it alone.
- Desktop GLSL converts `int` to `float` implicitly; GLSL ES does not. A shader shared between the two needs `2.0`.
- Matrices are column-major in construction and storage [G-mat]: `mat3(a, b, c)` takes columns.
- `texture()` with an implicit LOD inside a varying branch is undefined [G-8.9]; `textureLod` or `textureGrad` is not.

## GLSL ES — WebGL, three.js, mobile OpenGL ES (`#version 300 es`, `#version 100`)

- A fragment shader must declare a float precision; `precision mediump float;` can be 16-bit on mobile, so
  positions and time want `highp`.
- No implicit conversions at all: `float a = 2;` fails to compile (glslang: "cannot convert from ' const int'").
- Uniform defaults are not allowed in GLSL ES (`uniform float edge = 0.05;` fails); set them from the host.
- three.js's `ShaderMaterial` prepends its own `#version` and precision; a `RawShaderMaterial` does not *(verify)*.
  Know which one loads the file before flagging a missing header.

## HLSL — D3D, Vulkan through DXC, Unity and Unreal (`.hlsl .hlsli .fx .fxh`; Unity `.shader .cginc .compute`; Unreal `.usf .ush`)

- **Validator:** `dxc -T <ps_6_0|vs_6_0|cs_6_0> -E <entry> <file>`, plus `-spirv` for Vulkan. It needs the entry
  point and the profile, so the check leaves HLSL unrated: run it when both are known. Unity and Unreal compile
  their files themselves (the Console, the Output Log).
- Constructors fill **rows**, uniforms pack by **column**, and `mul(v, M)` is `mul(transpose(M), v)` [H-mat]. A
  matrix ported from GLSL is transposed until proven otherwise.
- `fmod` keeps the sign of `x` [H-fmod]; GLSL `mod` does not.
- Constant buffers: nothing crosses a 16-byte boundary and each array element takes a `float4` slot [H-pack]. A
  `float arr[4]` in a cbuffer spans four registers, so a host array of four packed floats feeds it wrong.
- `min16float` / `half` are a minimum precision, not a guarantee [H-glsl]: the desktop may run them at 32 bits and
  hide the overflow mobile shows.
- **Unity:** keyword sets multiply the variants [U-variants]; `multi_compile` builds every combination, while
  `shader_feature` builds only what materials use *(verify)*. Depth reverses on D3D, Metal and Vulkan (`UNITY_REVERSED_Z`); render textures start at the top
  there (`UNITY_UV_STARTS_AT_TOP`) [U-platform]. Keep per-material properties inside the `UnityPerMaterial` cbuffer
  so the SRP Batcher can batch them *(verify)*.

## WGSL — WebGPU, wgpu, Bevy (`.wgsl`)

- **Validator:** `naga <file>` validates fully. A file with `#import` or `#define_import_path` goes through
  naga_oil (Bevy) first; validate it in the app.
- The uniformity analysis is a compile error by default [W-2.3.2]. `diagnostic(off, derivative_uniformity)` is
  legal, but it hides an undefined derivative; the fix is to hoist the sample or use `textureSampleLevel`.
- `smoothstep` with `edge0 > edge1` is defined and descends [W-17.5.57]; equal constant edges are a compile error.
- Integer division by zero returns the dividend [W-int]. An out-of-bounds access is a dynamic error: the
  invocation may stop with zeroed outputs, or the load may return any value from the bound buffer [W-6.5.7] —
  a wrong value, not a crash.
- `vec3<f32>` has size 12 and alignment 16 in a uniform or storage buffer [W-14.4.1]: the host struct pads it.
- `f16` needs `enable f16;` and a device with the `shader-f16` feature, and holds ±65504 [W-15.7].
- NDC depth 0..1, framebuffer y down, texel (0, 0) first in memory, as in D3D [WG-3.3].

## Metal — iOS, macOS (`.metal`)

- **Validator:** `xcrun -sdk macosx metal -c <file> -o <out.air>`, macOS with Xcode only.
- Coordinates follow D3D and WebGPU: depth 0..1, texture origin top-left [U-platform].
- `half` for colors and directions, `float` for positions and depth *(verify against Apple's Metal Shading Language
  Specification; no Apple source was read for this skill)*.
- A per-material switch read from a buffer in every fragment can be a function constant, specialized when the
  pipeline is built *(verify)*.

## Slang (`.slang`)

- **Validator:** `slangc <file> -target <spirv|hlsl|metal> -entry <name> -stage <stage>`; unrated until the entry
  points are known.
- It compiles to every target above, so every target's traps apply: review the generated code for the one that
  ships when a port is in question.

## Godot shading language (`.gdshader`, `.gdshaderinc`; Godot 3 `.shader`)

- **Validator:** none outside the editor here; the shader panel shows the errors.
- No implicit casts: `float a = 2;` and `uniform float speed = 1;` fail [D-shading].
- Godot 3 names do not compile in 4: `hint_color` / `hint_albedo` → `source_color`, `SCREEN_TEXTURE` → a
  `sampler2D` uniform with `hint_screen_texture`, `WORLD_MATRIX` → `MODEL_MATRIX`, `CAMERA_MATRIX` →
  `INV_VIEW_MATRIX`, `NORMALMAP` → `NORMAL_MAP` [D-spatial].
- A color uniform or texture without `source_color` is read as linear; required on Forward+ and Mobile [D-shading].
- Reading or writing `ALPHA` in a spatial shader moves the material to the transparent pipeline: no shadows, absent
  from `hint_screen_texture` and `hint_depth_texture` [D-spatial]. A cut-out wants `ALPHA_SCISSOR_THRESHOLD`.
- Reading `hint_screen_texture` copies the screen every frame the material draws: name what needs it.
- `TIME` wraps at `rendering/limits/time/time_rollover_secs` (3600 s) [D-time].
- Depth is reversed since 4.3: a full-screen quad writes `POSITION = vec4(VERTEX.xy, 1.0, 1.0)` rather than
  `vec4(VERTEX, 1.0)`, a clip-space `DEPTH = 0.0` becomes `1.0`, and `clip_pos > depth` becomes `<` [D-revz].
- An out-of-bounds array index crashes the renderer; an infinite loop freezes the editor [D-shading].
- The GDScript that sets the uniforms is reviewed by o-review's `references/lang-gdscript.md`.
