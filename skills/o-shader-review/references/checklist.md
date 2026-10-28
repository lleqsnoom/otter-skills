# Shader review checklist

The defect classes every shading language shares. Each line is a finding class, not an instruction to fix; the
bracketed key names the source it rests on, listed at the end. Read them in this order — a wrong pixel outranks a
slow one.

## 1. Correctness — undefined is per vendor

- **Math outside its domain.** `pow(x, y)` for `x < 0`, or `x = 0` with `y ≤ 0` [K-pow]; `sqrt(x < 0)` [K-sqrt];
  `log`, `log2` and `inversesqrt` at `x ≤ 0`; `atan(y, x)` at `x = 0` [K-atan]. Ask what the argument is at the
  edges: a `dot` that goes negative, a distance that reaches zero, a `pow(color, 2.2)` fed by a value below zero.
  The fix is a clamp or `max(x, ε)` at the call, not after.
- **`normalize` of a vector that can be zero** (a normal at a degenerate vertex, a direction between two equal
  points): the spec gives no result, and NaN spreads to every pixel it touches.
- **Guards the compiler may remove.** WGSL lets an implementation "assume that overflow, infinities, and NaNs are
  not present" [W-15.7]; HLSL and GLSL fast-math do the same. An `isnan(x)` check after the fact is not a guard:
  keep the value in range before the operation.
- **`smoothstep(e0, e1, x)` with `e0 ≥ e1`** is undefined in GLSL [K-smoothstep]; write
  `1.0 - smoothstep(e1, e0, x)`. WGSL defines the reversed form, so a WGSL → GLSL port breaks silently [W-17.5.57].
- **Derivatives in divergent flow.** `dFdx`/`ddx`, `fwidth`, and every implicit-LOD sample (`texture`,
  `Sample`, `textureSample`) are undefined inside a branch whose condition varies per pixel [K-dFdx][G-8.9]. WGSL
  makes it a compile error [W-2.3.2]. Hoist the sample above the branch, or pass explicit gradients or a level
  (`textureLod`, `SampleLevel`, `SampleGrad`).
- **Division by zero.** A float division by zero "can result in NaN, zero, or another value", differently on
  desktop and mobile [U-platform]; WGSL defines integer division by zero to return the dividend [W-int]. Guard
  every divisor that comes from data: a length, a `w`, a texel size, a count.
- **Out-of-bounds indexing.** An index computed from a uniform, a varying or a buffer is undefined out of range
  [G-5.11]; Godot's renderer crashes on it [D-shading]. Clamp it or prove its range.
- **Outputs partly written.** Set every component of every output on every path, an early return included
  [U-platform].

## 2. Portability — the port that compiles and is wrong

- **Matrix order.** GLSL constructs and stores matrices column by column [G-mat]; HLSL constructors fill rows,
  while its uniforms pack by column, and swapping `mul` operands transposes [H-mat]. A matrix literal or a
  `M * v` copied verbatim between them is transposed.
- **`mod` ≠ `fmod`.** GLSL `mod(x, y) = x − y·floor(x/y)` [K-mod]; HLSL `fmod` keeps the sign of `x` [H-fmod]. They
  differ for every negative `x`: a scrolling or tiling effect that crosses zero.
- **Coordinate conventions.** WebGPU, D3D and Metal: NDC depth 0..1, framebuffer origin top-left, y down
  [WG-3.3]; OpenGL: depth −1..1, origin bottom-left. A port flips V, the depth mapping or both. Unity hides it
  behind `UNITY_UV_STARTS_AT_TOP` and `UNITY_REVERSED_Z` [U-platform].
- **Reversed-Z.** D3D, Metal and Vulkan in Unity store 1.0 near and 0.0 far [U-platform], and Godot reversed its
  depth in 4.3 [D-revz]: a hard-coded clip-space depth or a `>` depth comparison written for the old direction
  has to flip.
- **Precision qualifiers map unevenly.** `mediump` ≈ `min16float`, `lowp` ≈ `min10float` [H-glsl], and Metal and
  Unity spell it `half`. A desktop-only test never exercises them.

## 3. Precision

- **16-bit ranges.** `half`/`f16` hold ±65504 [W-15.7], with about three decimal digits. World positions, depth,
  time and UVs on a large texture do not fit; `half` is for colors and normalized directions [U-perf].
- **Time grows without bound.** A `sin(time * k)` loses precision as `time` grows (and Godot's `TIME` wraps at
  `time_rollover_secs`, 3600 s by default [D-time]). Wrap the phase on the CPU, or choose periods that divide
  the rollover.
- **GLSL ES fragment shaders have no default float precision**; declare one (`precision highp float;`), and
  remember `mediump` may be 16-bit on mobile.

## 4. Color, alpha and buffers

- **sRGB vs linear.** An `-srgb` render target or texture converts on every read and write [WG-format]; doing it
  again in the shader darkens or washes the image. In Godot a color uniform or texture without `source_color`
  is read as linear [D-shading].
- **Premultiplied alpha.** A premultiplied target holding RGB greater than A composites undefined [WG-21.6]; a
  blend mode and a shader that disagree on premultiplication fringe every edge.
- **Buffer layout.** HLSL constant buffers pack so that no value crosses a 16-byte boundary and every array element
  takes a `float4` slot [H-pack]; WGSL's `vec3<f32>` aligns to 16 and occupies 12 [W-14.4.1]. A CPU struct written
  with `vec3` fields and no padding shifts every field after it.

## 5. Cost — every line runs per pixel

- **Work at the wrong rate.** Per-pixel work that is per-vertex (interpolate it) or per-draw (a uniform the CPU sets
  once) [U-perf]. A constant written in both the CPU code and the shader is also a DRY finding.
- **Branches.** Registers are allocated for the most complex branch "even if that branch never executes", and a
  group whose pixels disagree runs both sides [U-perf]. A branch on a uniform is cheap; one on a texture value in
  a full-screen pass is not. A per-material feature switch belongs in a variant or a specialization constant.
- **Texture reads dominate.** Count the samples per pixel; pack channels, enable mipmaps, replace a lookup with math
  where it is cheap [U-perf][D-gpu].
- **`discard`, `clip` and alpha test** cost early depth rejection, most on tile-based mobile GPUs; gate them per
  material [U-perf][D-shading].
- **Transparency and overdraw.** Overlapping transparent surfaces multiply fill cost [D-gpu]; a material that writes
  alpha it does not need pays it (Godot: `ALPHA` sends it to the transparent pipeline [D-spatial]).
- **Variants.** Each keyword set multiplies the variants: ten sets of two make 1024, paid in build time, memory and
  compile stutter [U-variants].
- **Loops.** A loop bound from a uniform or a texture is unbounded to the compiler; one that never ends freezes the
  editor [D-shading]. Give it a constant cap.

## Sources

- [K-pow] [K-sqrt] [K-atan] [K-smoothstep] [K-mod] [K-dFdx] — Khronos GLSL reference pages,
  https://registry.khronos.org/OpenGL-Refpages/gl4/html/ (`pow.xhtml`, `sqrt.xhtml`, `atan.xhtml`,
  `smoothstep.xhtml`, `mod.xhtml`, `dFdx.xhtml`)
- [G-mat] [G-5.11] [G-8.9] — The OpenGL Shading Language 4.60, https://registry.khronos.org/OpenGL/specs/gl/GLSLangSpec.4.60.html
- [W-2.3.2] [W-6.5.7] [W-int] [W-14.4.1] [W-15.7] [W-17.5.57] — WGSL, https://www.w3.org/TR/WGSL/
- [WG-3.3] [WG-format] [WG-21.6] — WebGPU, https://www.w3.org/TR/webgpu/
- [H-mat] — https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-per-component-math
- [H-fmod] — https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-fmod
- [H-pack] — https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-packing-rules
- [H-glsl] — https://learn.microsoft.com/en-us/windows/uwp/gaming/glsl-to-hlsl-reference
- [U-perf] — https://docs.unity.com/en-us/engine/current/manual/materials-and-shaders/shaders/sl-shader-performance
- [U-variants] — https://docs.unity.com/en-us/engine/current/manual/materials-and-shaders/shaders/shader-troubleshooting/shader-reducing/shader-variants/shader-variants
- [U-platform] — https://docs.unity.com/en-us/engine/current/manual/materials-and-shaders/shaders/writing-custom/shader-writing/sl/writing-shader-writing-shader-programs-hlsl/sl-platform-differences
- [D-shading] — https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/shading_language.html
- [D-spatial] — https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/spatial_shader.html
- [D-gpu] — https://docs.godotengine.org/en/stable/tutorials/performance/gpu_optimization.html
- [D-time] — Godot ProjectSettings, `rendering/limits/time/time_rollover_secs`
- [D-revz] — https://godotengine.org/article/introducing-reverse-z/
