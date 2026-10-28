# o-shader-review — pass card

Read this when another skill runs o-shader-review as a pass. A standalone run, when the user asks for a shader
review or a port, reads `SKILL.md`.

## Per host

- **o-review** (report only): the plan's `[Shaders]` heading names the shader files in scope. Review those files and
  write every finding under that heading. A light review runs this pass in full: a shader's defects are
  correctness defects, and the check is cheap.
- **o-fix** (edits): per `[Shaders]` finding, make the fix it names, then rerun the check on the file. A finding
  that rests on target hardware (precision, cost) is fixed as written and marked unverified until it runs there.

## Steps

1. `node <skills>/o-shader-review/scripts/shader-check.mjs <the files the heading names>`. Copy each rule finding
   as written, with its rule name. A `does-not-compile` finding is CRITICAL unless the file is a snippet the engine
   completes; say which.
2. Read each file against `<skills>/o-shader-review/references/checklist.md`, in this order: correctness,
   portability, precision, cost. Open the file's section of `references/languages.md` beside it.
3. Name the stage (vertex, fragment, compute) and the target (mobile, desktop, web) of every cost or precision
   finding: they decide its severity.
4. Copy the check's `rated` and `unrated` lists verbatim. An unrated file is not clean.

`<skills>` is the folder that holds every o-* skill.

## Rules

- A finding names the input or platform that shows it: "`n` is zero at the pole", "WebGL on mobile".
- Undefined behaviour reached on a real path is CRITICAL; reachable but unshown is MAJOR.
- Never flag what a comment or a guard already handles (`max(x, 1e-6)` before `pow`, `normalize` of a value
  proven non-zero).
- Write `none` when the pass found nothing; the heading is never left pending.

**Finding format:**

```markdown
- [ ] **Severity:** CRITICAL / MAJOR / MINOR
  - **File:** `shaders/water.frag:42`
  - **Category:** correctness / portability / precision / cost
  - **Issue:** what breaks, and where (the input, the stage, the target)
  - **Suggestion:** the fix, and the spec or doc it rests on
```

**shader-check:** `rated: [...]`, `unrated: [...]`, copied verbatim.

## Full rules

Open `SKILL.md` when a case is unclear: `## What the Check Decides`, `## Severity`.
