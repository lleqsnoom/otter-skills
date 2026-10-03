# o-comments — pass card

Read this when another skill runs o-comments as a pass. A standalone run, when the user asks to clean up
comments, reads `SKILL.md` and runs every step.

## Per host

No record of its own; uncommitted work is the task. The host's scope is the scope.

- **o-review** (reports only): apply the rules to every file under review and list each finding under
  `[Comments]` in the review plan. Fix nothing; `o-fix` makes the edits.
- **o-implement** (edits): the rules bind every line written. REFACTOR strips comments that restate code and
  extracts over-explained blocks into named functions.
- **o-fix** (edits): per `[Comments]` finding, delete a comment that restates code, or extract the block it
  explains into a named function and delete the comment. Behavior never changes; run the tests after a refactor.

## Rules

- **No obvious comments.** If the line reads fine alone (`i++`, `return user`), the comment goes.
- **No noise.** A comment must carry what the code cannot say. Removing it should lose something.
- **A long comment is a code problem.** A block that needs a paragraph becomes smaller functions with names that
  carry the meaning; then the paragraph goes.
- **Only the why.** A comment earns its place by saying why a non-obvious choice exists, where a magic value
  comes from or what invariant it holds, what breaks if it changes, or intent the code cannot recover.
- Prefer a better name or an extracted function to any explanatory comment. One sentence beats a paragraph.
- When unsure whether a comment is noise, delete it — except what `SKILL.md`'s *Never Cut* protects: directives
  (`eslint-disable`, `@ts-expect-error`, `# noqa`), license headers, shebangs, and doc comments a tool consumes.

## Full rules

Open `SKILL.md` when a case is unclear: `## Comment Rules`, `## What a Good Comment Explains`.
