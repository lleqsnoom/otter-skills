---
name: o-search
description: Search every repository this machine reads, by exact identifier or by meaning, through the otter-skills MCP server — declarations and text straight from the files, related tasks, documents and code from the project's index. Use before grepping for a symbol, when the file that owns a behaviour is unknown, or when the question spans repositories.
version: 0.2.0
author: Community
tags: [search, semantic, mcp, code-search, embeddings]
user-invocable: true
---

# O-Search — Ask where something is, in one repository or all of them

Reach for this before `grep` when you do not know the file, before `glob` when you do not know the
name, and whenever the question is "where does X happen" rather than "where is the string X".

## Prerequisite

The `otter-skills` MCP server must be registered with the CLI you are running in (`npm run install` in the
otter-skills checkout writes the entry; its tools show up as `search_code`, `search_knowledge` and the rest,
prefixed by the client — `mcp__otter-skills__search_code` in Claude Code). If none of its tools are available,
say so and work from the files directly; do not pretend the search ran.

A project is a repository with an `.o-skills/` tree. `list_projects` shows every one this machine reads — the roots
come from `otter-skills.config.json`, Orca's project list, `$OTTER_SKILLS_ROOTS`, discovery, or the current
directory. Leave `project` out to mean the repository the client was started in; pass an id from `list_projects`
to search another.

## The tools

| Tool | Answers | Exact? |
|------|---------|--------|
| `search_code(query, regex?, project?)` | every tracked line holding a literal or a regular expression, as `relPath:line` | exact |
| `find_symbols(name, project?)` | where a name is declared — function, class, const, type — by declaration shape | heuristic, and says so |
| `read_code(path, start?, end?, project?)` | a tracked file, or a line range of it, with line numbers | exact |
| `search_knowledge(query, limit?, project?)` | tasks, documents and code nearest a description, by meaning | from the index |
| `find_related(path, limit?, project?)` | what is nearest a file, task or document already in the index | from the index |
| `list_projects()` / `get_project(project)` | which repositories this machine reads, and one in full | exact |
| `list_tasks`, `get_task`, `list_docs`, `read_doc` | a project's `.o-skills` tasks and documents; `read_doc` adds a drift report against the code | exact |

## Which tool

- You know the identifier, file name or a distinctive string → `find_symbols` for a declaration,
  `search_code` for every use. Both read the files as they are now, with no index.
- You can describe the behaviour but not the name ("where does a run folder get created") →
  `search_knowledge`, then confirm with `search_code` or `read_code`.
- You have one file and want its neighbours — the task that built it, the doc that describes it →
  `find_related`.

## Reading a hit

- `search_code` and `find_symbols` give `relPath`, `line` and the line's `text`; `find_symbols` adds the
  declaration `kind`. `mode: "tracked"` means the list came from `git ls-files`; `"walk"` means the folder is not a
  checkout and was walked instead. `capped` and `reason` say when a search stopped early (200 matches, 8000 files
  or 4 MB) — narrow the query rather than reading a capped list as complete.
- `search_knowledge` and `find_related` rows give the `table` (`code`, `docs` or `tasks`), the `relPath`, the
  stored `text`, and a `distance` — smaller is nearer. A row is a whole file, not a line: open it with `read_code`
  before quoting it.
- `index.stamp` says which state of the repository the answer came from, and `index.rebuilt` that this call
  re-indexed first. The index is checked against the files on every call, so an edit is picked up by the next one.

## Failure modes, and what each means

| What you see | What to do |
|--------------|------------|
| `no project given, and <dir> is in none of them` | Pass `project`, one of the ids the message lists. |
| `unknown project <id>: known ids are …` | Use one of those ids; `list_projects` shows what each one is. |
| `The index is unavailable, so this answer cannot come from it.` | The fuzzy tools cannot run here — on a first run with no network the embedding model is not cached yet. The exact tools still work: fall back to `search_code`, `find_symbols` and `read_code`. |
| `not in the index: <path>` | `find_related` was given a path the index does not hold (untracked, binary, or outside the project). Check the path, or use `search_knowledge` with a description. |

## What it does not do

It does not read files for you: a hit is a pointer, so open the range. It does not search the web, and
it does not search a repository this machine does not read. It holds text files and `.o-skills` tasks and
documents — no PDFs, no images, no session transcripts. Its database lives at
`<repo>/.o-skills/knowledge.lance/` and is derived: deleting it costs the next fuzzy call a rebuild and nothing
else.
