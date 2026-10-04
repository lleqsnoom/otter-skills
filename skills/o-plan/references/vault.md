# Tagging a run in a vault

Only when the repo keeps a vault: `.o-skills/tags/` exists and `.o-skills/config/vault.json` does not say
`"enabled": false`. Otherwise skip this file.

Pass the tags at `start` as `--topics domain/<name>,area/<name>`:

- **Reuse before creating.** List what exists first (`ls .o-skills/tags/domain .o-skills/tags/area`). A
  near-duplicate (`auth` beside `authentication`) splits the index in two.
- **domain** says what the work is about (`payments`, `teacher-panel`), at most three per run.
- **area** names a part of the code: a workspace package (`apps/<x>`, `packages/<x>`, `skills/<x>`), else the
  top-level folder under `src/`.

The plan carries them as `topics`. A tag note that does not exist yet is created at
`.o-skills/tags/<kind>/<name>.md`, embedding the shared `tag.base` that lists everything linked to it. The plan's
property block (`type: plan`, `run`, and `input` when `start` had `--input`) is written by the script, so
Obsidian links the plan to the analysis or research it came from.
