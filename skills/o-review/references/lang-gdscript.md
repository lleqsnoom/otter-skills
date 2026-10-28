# GDScript and Godot review checklist

Language-specific criteria for the `[PRINCIPLE]` pass. Read this when the change is GDScript (`.gd`) or a Godot
shader (`.gdshader`, `.gdshaderinc`); each line is a finding class, not an instruction to fix. The metrics for
these files come from `godot-extractors.mjs` (GDScript by indentation, shaders by braces), not tree-sitter.

## Static typing is the contract

- An untyped `var`, parameter or return in code another script calls is a MINOR finding; a `Variant` return that
  every caller casts, or a `-> void` function whose callers read a result, is MAJOR: the signature lies.
- `@warning_ignore` without a reason beside it is a MINOR escape; one that silences `unsafe_*` or `unused_*`
  warnings on new code is MAJOR — the warning is the reviewer's question, unanswered.

## The node lifecycle

- `get_node()`, `$Path` or `find_child()` inside `_process` / `_physics_process` is a MAJOR hot-path finding: look
  it up once (`@onready`, or in `_ready`).
- Work in `_process` that only changes on an event — a signal, an input, a setter — is MAJOR: the frame pays for
  it every time and nothing changed.
- An `await` after which the node, or a node it holds, may have been freed, with no `is_instance_valid()` check,
  is a likely crash: MAJOR with the sequence that frees it.
- A node made with `.new()` that is never added to the tree nor freed is an orphan leak: MAJOR.

## Signals and references

- The 3.x string form (`connect("signal", self, "method")`, `call_deferred("method")` for a method that exists) is
  MINOR: the Callable form is checked when the script loads.
- A connection made to a node that outlives the receiver, with no disconnect or `CONNECT_ONE_SHOT`, is a MAJOR
  dangling-handler finding.

## Hot paths: per item, per frame

- A `Dictionary` or an `Object` allocated per item in a loop over hundreds of items is MAJOR: flat records in a
  `PackedFloat32Array` with constant offsets are the narrower design.
- An array or dictionary literal built inside a function called per item allocates on every call: MINOR, MAJOR in
  a per-frame or per-item path — hoist it to a `const`.
- A packed array held inside an `Array` and written through it copies on the first write: MAJOR in a loop.
- One RenderingServer or property call per item (`set_instance_transform` per instance) where one bulk write
  exists (`MultiMesh.buffer`) is MAJOR.
- `load()` of a fixed path in code that runs more than once, where `preload()` would resolve it once, is MINOR.

## Resources are shared

- Editing a material, mesh or other `Resource` that other nodes also use, without `duplicate()` first, changes all
  of them: MAJOR by blast radius, with the second user named.
- A `res://` path repeated across several scripts instead of one `const` or exported property is a DRY finding.

## Threads

- A `WorkerThreadPool` task or `Thread` that touches the scene tree, a node or a non-thread-safe server call is
  MAJOR; one never waited for (`wait_for_task_completion`) leaks its task.

## Shaders

The full shader review — validators, undefined math, Godot 3 names, `ALPHA` and the transparent pipeline — is
o-shader-review's `[Shaders]` pass. These are the Godot-design findings that sit beside it:

- A branch every fragment runs for a case few pixels hit is a MAJOR cost finding: code size and branches cost even
  where they do not run. Move the work to the pass or the material that needs it.
- A constant the CPU and the shader must agree on, written in both, is a DRY finding: make it a uniform the CPU sets.
- Reading `hint_screen_texture` costs a screen copy in every frame the material draws: name what needs it.

## Tests

- Godot tests are GUT (`extends GutTest`, `assert_eq`) or gdUnit4 (`extends GdUnitTestSuite`, `assert_that`), or a
  project's own `SceneTree` probes. A change to a pure module without a test beside it is the standing bar's
  question; `pending()` or a skipped case that makes a suite pass is the Floor pass's `test-made-easier`.
