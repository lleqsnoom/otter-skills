# Task links in a vault

Only when the repo keeps a vault: `.o-skills/tags/` exists and `.o-skills/config/vault.json` does not say
`"enabled": false`. Otherwise a task keeps only `type`, `title`, `size`, `complexity`, `complexity_why` and
`depends_on`.

In a vault, the property block also carries links, so Obsidian draws the run as a graph:

```yaml
run: "[[runs/<run folder>/index]]"
plan: "[[runs/<run folder>/E00-plan]]"
depends_on:
  - "[[runs/<run folder>/E<nn>-tasks/L<N>-T<M>-<slug>]]"
topics:
  - "[[tags/domain/<a domain tag of the plan>]]"
  - "[[tags/area/<a module this task touches>]]"
created: <YYYY-MM-DDThh:mm>
```

- Links are quoted wikilinks from the `.o-skills` root, without `.md`. Unquoted, YAML reads `[[x]]` as a
  nested list.
- `topics` copies the plan's `domain/` tags. It then adds one `area/` tag per module the task's **Files:**
  touch: a workspace package (`apps/<x>`, `packages/<x>`, `skills/<x>`), else the top-level folder under
  `src/`. Tests do not count.
- Tag notes are not created here. o-plan creates a run's tags.
- `title` is what Obsidian shows on the graph node in place of the file name, so it should read as the task.
- The links are navigation for people. The task body never relies on them.
