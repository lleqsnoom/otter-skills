# Otter PM

A local project board over one or more repositories' `.x-skills` trees: what is in progress, what is waiting, and
what is done — with the artifacts readable and editable in place.

One repository or twenty; a root is either a `.x-skills` directory or a repository that has one.

## Running it

**Open the board.** If it is already running, this is all there is:

```bash
oc-otter-pm open            # a chrome-less window on the board
oc-otter-pm open --browser  # the same board in a browser tab
oc-otter-pm port            # print the URL it is serving on, or fail if nothing is
```

The window and the tab are the same board: the URL is published by whichever process is serving it
(`~/.local/state/otter-pm/url`), so nothing has to know the port in advance.

**Keep it running.** Installed as a user service, the board starts with your session and restarts if it dies:

```bash
systemctl --user start oc-otter-pm
```

Installing that service, the two desktop entries and the wrapper is [`docs/install.md`](docs/install.md), which is
the right path for a machine that is going to keep the board. The three failure codes `open` can exit with, and what
each means, are in that guide's troubleshooting section.

**Run the version in this directory.** For a branch or a worktree you are testing, without disturbing the
installed one:

```bash
otter-pm-here use     # make this checkout the one the machine runs: rebuild if stale, then restart the service
otter-pm-here serve   # or just serve it here, in the foreground
```

`use` writes the pointer `~/.local/state/otter-pm/root`, and `oc-otter-pm` reads it — so the service, the app
launcher and the command all follow it, while an explicit `OTTER_PM_ROOT` still wins. `otter-pm-here` also
rebuilds when the sources are newer than `dist/`, which is the state a `git switch` leaves behind and the one
`serve` alone would serve stale.

**Develop it.**

```bash
npm install                  # once: the app's own dependencies
npm run dev                  # hot reload on http://127.0.0.1:4321/ (the first free port from 4321)
npm run serve                # build if needed, then serve the build on the first free port at or after 4321
npm run serve -- --port 8080
npm run serve -- --no-build  # serve the last build as it is
npm run build                # build only
npm test                     # the app's own tests
npm run typecheck
```

Installed as a package (`otter-pm` once `@lleqsnoom/otter-pm` is published), the same server is the command's whole job:
it builds the app if `dist/` is missing and then serves it, so the bin and `npm run serve` are one path. The package is
not on npm yet, so there is nothing to `npx` today.

`npm run dev` and `npm run serve` print the address and stay in the foreground; ctrl-c stops them. Both start
their port search at `--port` (or `$PORT`), and **a dev server already running does not block a new one** — the
next free port is taken, so two can sit side by side (4321 and 4322) without either being stopped. The cost is
that a server started this way is not in Astro's lock file: `astro dev status`, `logs` and `stop` do not see it,
and ctrl-c in its own terminal is how it stops.

The dev loop is one process rather than a shell in front of a server: Astro owns both halves of this app (the
shell and the `/api` routes are one server), so `scripts/dev.mjs` spawns Astro's own entry point with the Node
binary. It also sets `ASTRO_DEV_BACKGROUND`, because Astro detects an agent CLI and otherwise re-spawns itself
**detached** — the command would hand the prompt back while the server ran on.

## Choosing what to read

The default is **the Orca IDE's own project list**, so there is nothing to keep in step: add a repository to the
IDE and it appears here, remove it and it goes. Orca's profile store carries each repository's checkout path, which
is the only thing a root needs (`<path>/.x-skills`).

```json
{ "orca": true, "roots": [], "autoDiscover": [] }
```

| Source | Example |
|--------|---------|
| `orca` (the IDE's list) | `{ "orca": true }`, `--orca` / `--no-orca`, or `OTTER_PM_ORCA=1`. `$ORCA_CONFIG_DIR` points at a different profile root. |
| `--root` flags | `npm run serve -- --root /code/app --root /code/api` |
| `otter-pm.config.json` (`roots`) | `{ "roots": ["/code/app", "/code/api"] }` |
| `OTTER_PM_ROOTS` | `OTTER_PM_ROOTS=/code/app,/code/api npm run serve` |
| discovery (`autoDiscover`, `--discover`) | `{ "autoDiscover": ["/code"] }` — finds `*/.x-skills` and `*/*/.x-skills` two levels down |
| the current directory | the fallback when nothing else is given |

Every source is used, and the same path arriving twice is one root. When `orca` is on, the overview says what it
contributed — `9 of 10 repositories in the Orca IDE, read from …/orca-data.json · 1 without a .x-skills` — so
"is the sync working?" is answerable from the screen. A repository the IDE lists that has no run tree is reported
as skipped, not as an error; only a path someone asked for *by name* earns a warning when it is not a root.

A path is accepted either as the repository or as the `.x-skills` directory itself. `--config <file>` points at a
different config, and `$OTTER_PM_CONFIG` does the same.

The tree is read. Two things are written: `board.json` beside the config, which holds the reader's own decisions (a
card dragged to a lane and a place in it, the order each lane was left in, and an item archived), and an artifact
the reader edits in the app itself — see *Reading and editing* below.

## Making a project

`+ new project` in the rail asks for a name, what the project is about, where it goes, who may see it and which
license it carries, and then makes all of it: a folder in Documents, a git history, and a repository on GitHub. It
is the one thing on the board that is made from the app rather than read from a tree.

```text
~/Documents/<slug>/
  README.md                       the name and the about text
  LICENSE                         only when a license was chosen
  .x-skills/
    project.md                    the project's own mark: about, icon, colour, icon URL or file
    icon.png                      an image chosen or dropped in the form, if there was one
    plans/<date>-<slug>.md        the first plan, with the about text as its goal
```

The mark can be a drawn icon, an emoji, one or two letters, a colour, an image URL, or an image chosen or dropped
straight onto the form. An uploaded image is written into the project as `.x-skills/icon.<ext>` and named by
`**Icon file:**` in `project.md`, so the mark travels with the repository instead of living on the machine that made
it; `GET /api/asset?project=&path=` serves it (raster types only, `nosniff`, and nothing outside the project's root).

`POST /api/project` creates one and `GET /api/project` answers what the form offers (the account, the default
directory, the licenses GitHub publishes). The tree is built in `.<slug>.otter-pm-tmp` beside its target and renamed
into place only after `gh repo create … --source <tmp> --push` has succeeded, so a failure leaves nothing on disk and
the config unchanged; the directory the project lands in is then added to `roots` here. A refusal says which step
refused: 400 for a name or a directory, 409 for a folder that is already there, 501 when `gh` is missing or not
authenticated, 502 when a command failed, with its stderr as the reason. Every command goes through one
`run(command, args, { cwd })` seam, which is what lets the tests cover the whole flow without touching GitHub.

## Adding a project that already exists

`+ add existing` in the rail is for a repository that is already on this machine. It opens a picker: one level of
folders at a time, never a file, with a path field above the list for a path that is already in the clipboard.
Confirming adds **the folder the picker is standing in** — `POST /api/roots` with that path — and lands on it.

What is written is one line: the repository path in `roots`. Nothing else in the folder is touched — no `README.md`,
no `project.md`, no commit, and no repository is made. The one exception is a folder that has no `.x-skills` at all:
a repository with no run tree cannot be read, so it is given the least thing that makes it one, an empty
`.x-skills/tasks/`, and the screen says so before the button is pressed rather than after. A folder that already has
a tree is added exactly as it is.

A refusal says which step refused, the same way a create does: 400 for a path that is missing or is not a folder, 409
for one that is already on the board or that would answer to an id another root already has (an id is the repository
folder's name, and the board and the archive are keyed by it), 500 when the tree or the config could not be written.
The route answers with the project id it added, so the rail navigates to it, and both caches are dropped — the new
root is in the next snapshot with no restart and no `--root` flag.

## Adding and removing

**A repository** is one line in `otter-pm.config.json`: added by `+ new project`, by `+ add existing`, or by hand.
Delete the line and it is gone.

**A category** is one entry in `src/server/categories.mjs`:

```js
{ id: 'critique', label: 'Critique', order: 9, hint: 'What x-roast produced.' }
```

That is the whole change — the scanner walks whatever directories exist and the UI builds its navigation from the
snapshot, so an unknown directory still appears (labelled from its name) and a new entry only adds the label and
the ordering. Removing an entry leaves the category visible, just unsorted.

**Two folders can be one category.** `merge` lists the other names a category answers to:

```js
{ id: 'analysis', label: 'Analysis', order: 6, merge: ['anal'], hint: '…' }
```

`anal/` and `analysis/` are then one **Analysis** in the rail, one board, and both folders' collections and
documents sit in it together. A collection keeps the path it came from (`anal/session-a`), so it still links and
opens; the category panel says which folders it was read from.

**The parsers are generic.** A category is any directory in the root; a collection is any folder inside it; an
artifact is any markdown, JSON or text file inside that. Nothing is registered per category, so a skill that
starts writing a new folder is displayed without a code change.

## Diagrams and code

A ```` ```mermaid ```` fence is a graph in text, and it is drawn rather than shown as code. Mermaid is a megabyte
of parser and layout engine, so it is imported **on demand**: a document with no diagram never fetches it, and a
page without one loads 138 kB of JavaScript in four requests. The first diagram on a page costs about 930 kB more,
once.

Mermaid is initialised with `theme: 'base'` and `themeVariables` read from the live stylesheet, so a diagram is
drawn in the app's own tokens — node on `--muted`, border on `--border`, text on `--foreground`, edges on
`--muted-foreground`. A theme change redraws what is already on screen, because a diagram is mostly *shape* and a
light-mode diagram on a dark page is a white slab. `layout: 'dagre'` is pinned deliberately: mermaid otherwise
pulls in its optional ELK engine, measured at 1.4 MB of a 2.2 MB load for graphs that lay out the same way without
it.

A diagram mermaid cannot parse keeps its text on screen with the reason next to it (`Could not draw this diagram:
Parse error on line 2 …`) — a broken fence is not silently dropped. Labels are escaped by mermaid's own `strict`
security level.

**Every other fence is coloured, and so is every file that is not markdown.** Shiki (`src/server/highlight.mjs`)
turns a fence into tokenised markup on the server, in two themes at once: the light colour inline, the dark one in
a `--shiki-dark` custom property that `styles.css` walks to on `prefers-color-scheme`. The surface stays the app's
(`--muted`), never the theme's.

The dialect is the fence's own info string when it names one, and **the text itself when it does not** —
`detectLanguage` recognises JSON, YAML, TOML, shell, Python, JavaScript, TypeScript, CSS, SQL, HTML, XML, diff,
Markdown and GraphQL with the same signals a reader would use, and a JSON file with a `.txt` extension is read as
JSON. A guess is *disclosed*: the fence's label reads `json · detected`, and a code file's header says
`detected as json`. Text nothing recognises stays plain, which is honest. A whole file is coloured by the same
rules, with the extension deciding first and its own text only when the extension says nothing.

## What is recognised

| Signal | Where it comes from |
|--------|---------------------|
| Title | the first `#` heading, with a leading `Task:`/`Epic —`/`Design Spec:` stripped |
| Layer, effort, date, branch, scope | the `**Key:** value` lines of an artifact |
| Progress | the `- [x]` / `- [ ]` checklist, as `done/total` |
| State | a run's `state.json`: skill, node, guards, events, questions, options, decision |
| Status | finished node → done; some boxes ticked → in progress; none → to do; nothing counted → unsorted |

A run (a folder with `state.json`) and a task group (a folder of task files) are the same thing to the UI: a
collection with a head and a body of artifacts.

## The board

Five lanes, in this order: **To do**, **In progress**, **Unsorted**, **Done**, **Closed**. What an item's own data
says decides its lane — a finished run is done, a partly ticked checklist is in progress — with two exceptions:

- **Closed** is the window over what is finished: `Closed within 24h / 7 days / 30 days / 90 days / all`, default
  30 days. A finished item inside the window is *Closed*; an older one is *Done*, which is the archive. "all" puts
  every finished item in Closed and leaves Done empty, which is what that choice means.
- **A card can be filed by hand**, by dragging it onto a lane or pressing `Alt + ←` / `Alt + →` on a focused card.
  That is a decision *about* someone else's document rather than a change to it, so it is written to `board.json`
  **beside `otter-pm.config.json`** (or wherever `$OTTER_PM_BOARD` points) and never into the repository. A
  filed card says `moved`, and dropping it on the lane its data already gives it removes the entry rather than
  storing a preference that says nothing.
- **A card can be sorted within its lane**, and the sort is kept. A drag carries a card to a lane *and* to a place
  in it — the slot that opens between two cards, the size of the card in hand — and letting go writes that lane, top
  to bottom, into `board.json`. So the order survives a reload, a rescan and a restart, and a card dropped on the
  lane its own data gives it keeps its place even though it stops saying `moved`: the place was the decision, and the
  column never was. A card that turns up later — a new run, or one that was filtered off the board when the drop
  happened — is drawn after the ones the lane names. `Alt + ←/→` names a lane and no place, so a card filed that way
  lands where its own data would put it.
- **A card can be archived**, and that is a soft delete: the artifact is untouched, the board simply stops drawing
  it, and the `Archived` list at the bottom of the project page brings it back. Archiving a collection takes
  everything inside it off the board, while that list holds the entry the reader made rather than one line per file
  it covers; an artifact whose own entry was not made says it is inside an archived collection. Filing, sorting and
  archiving are three decisions in the same `board.json`, so none of them clears the others: an unarchive lands in
  the column and the place it was filed into, and unarchiving removes the entry rather than storing a `false`.

A lane shows twelve cards and folds the rest behind `+ N more`; while a card is being dragged every lane opens,
because the card you are carrying has to be droppable where you mean it.

Projects wear the **icon and badge colour the Orca IDE gives them** (`repoIcon`, `badgeColor`), so one
repository is one thing in the IDE and here. A root that did not come from the IDE gets the folder mark instead,
and a remote avatar that will not load leaves the tile rather than a broken-image glyph.

## Finding a file

Three ways in, and they are deliberately different widths:

| | What it covers |
|---|---|
| The rail's search box (⌘K / ctrl-K) | **Everything** — every collection *and every artifact inside one*. A file name is a hit even when the run it lives in says nothing about it, and the result says which collection it came from (`in cdk-high-traffic-security`). |
| A category's board (Runs, Tasks, …) | One card per collection, plus the documents loose in that folder. A collection is the unit of work, so it is the board's unit; the artifacts inside are not separate cards. |
| A collection's page | Its workflow state, and its artifact list — every file, in the order the run produced them (`E00`, `E01`, …, then the session's own notes). |

Search is a screen rather than a dropdown, and following a result clears the box: while it is up, every card is
still a link, so a query that stayed put would change the address without changing what is on screen.

Every screen draws the same trail, from the snapshot rather than the address — it renders
`Projects / Synetic_Studio / Runs / cdk-high-traffic-security`, with each step a link and only the current page in
the reading colour. Because it is resolved from the snapshot and not parsed from the address, a file opened
straight from a search result still says which run it came from, the one thing its address cannot say (`locateFile`
in `src/lib/items.ts`). A page's `h1` is the last crumb, so a category's own page is titled with the category.

## Reading and editing

An artifact is rendered on the server (`marked` for markdown, shiki for code) and arrives as markup, so the island
ships neither parser. The rendered view and the raw text are the same response: **`edit`** replaces the document
with the text it came from, the header carries `save` and `discard`, and `⌘S` / `ctrl-S` saves. Leaving by
clicking something else is deliberately not one of the ways out — that is how a draft disappears without anyone
deciding to lose it.

Whether a file may be edited is decided on the server and travels with the read (`editable`), next to the set of
**text extensions** the scanner reads: a markdown, a JSON, a script. A save cannot turn a screenshot into prose,
and a read truncated at 400 kB is never editable, because saving what was shown would throw away everything past
the cut. A save writes a dot-prefixed sibling and renames it over the original, so a scan landing mid-write cannot
see half a file, and a failure removes the temporary instead of leaving it in the tree. The answer is the file as
it now reads — re-rendered, with its new size — and both caches are dropped, so a checklist just ticked shows as
`2/2` in the list it sits in and in the collection's own progress.

## Markdown is set for reading

By the document's own rules rather than a screen's: one measure (92ch) and one left edge, and a heading scale that
steps down visibly — `h1` at the page title, `h2` at section size with the panel's own hairline under it, `h3`/`h4`
marked by weight and colour, because a heading that borrows the prose's size is still a heading. A link is
underlined where it appears rather than only under the pointer, because a document is read in order and "this is a
link" arrives too late on hover. A table is a record and is set as one: a muted head, a hairline per row, a zebra,
and every cell breaking a long token, so a session id or a path cannot set the table's width. A checklist has no
bullet beside its box, and a fence scrolls inside itself and holds a height, so a long one cannot bury the document
around it.

## Layout

```
otter-pm/
├── src/server/          # plain Node, no framework: what reads the tree
│   ├── config.mjs       # root resolution: flags, config, env, discovery
│   ├── categories.mjs   # the category registry, add one here or merge two folders into one
│   ├── create.mjs       # making a project: temp tree, git, gh, through one run seam
│   ├── roots.mjs        # adding a folder that exists: the picker's listing, the scaffold, the config line
│   ├── parse.mjs        # headings, bold fields, checklists, dates, artifact kinds
│   ├── highlight.mjs    # shiki, the two-theme wiring, and the dialect detector
│   ├── scan.mjs         # .x-skills root to project model, with an mtime-keyed cache
│   └── snapshot.mjs     # the whole snapshot + one file's rendered content, read and written
├── src/pages/api/       # GET /api/snapshot, GET|POST /api/file, POST /api/refresh, /api/project, /api/roots
├── src/pages/           # the shell, for / and for every other path
├── src/ui/              # shared primitives: Button, Input, Badge, ToggleGroup, cn
├── src/components/      # the screens, made of the primitives: Card, Board, GroupDetail
├── src/lib/             # types, the API client, the router, the work-item model
├── src/styles.css       # Orca's tokens, base, and the markdown an artifact is read in
├── src/tailwind.css     # Tailwind wired to those tokens
├── scripts/             # dev.mjs, serve.mjs: the ports, the foreground, the spawn
├── public/favicon.svg   # the app icon, see brand/README.md
├── brand/               # the mark's sources: the EPS, the traces, the proposals
├── skills/              # a mirror of the xskills skills — what writes the trees this app reads
├── test/                # the app's tests, over a fixture .x-skills tree
└── otter-pm.config.json # which repositories a machine reads
```

**Stack.** Astro serves the shell and the API routes (one process, `@astrojs/node` standalone); SolidJS renders
the app in the browser and owns the routing; Tailwind v4 is wired to the app's own CSS variables in
`src/tailwind.css`, so a utility and a hand-written rule read the same values and cannot drift. Kobalte supplies
the one control that needs behaviour a plain button does not have (the segmented switch).

**Shared components.** `src/ui/` are the primitives a control is built from, `src/components/` are the screens
built out of them, and `src/lib/` is what both use. Adding a screen means adding one file to `src/components/`
and one route in `src/lib/router.ts` — the shell, the rail and the styling come with it.

Two details in `src/ui/` are load-bearing and easy to undo by accident. `cn.ts` tells `tailwind-merge` that
`text-chrome`/`text-body`/`text-section`/`text-title` are *sizes*, not colours — without that, merging
`text-chrome` with `text-foreground` drops the size and every control renders at the inherited 14px. And
`styles.css` clears the browser's own widget chrome on `button` and `input` (its 13.33px font, its
`padding: 1px 6px`, its `buttonface` background), because this app does not import Tailwind's preflight — the rest
of that reset is deliberately absent, so anything a control needs must come from its utilities.

**Markdown and code are rendered on the server**, by `marked` and shiki in `src/server/snapshot.mjs`, and the raw
HTML a document may contain is stripped of anything that can run (script/style/iframe tags, `on*` attributes,
`javascript:` URLs) before it reaches the browser. The island therefore ships neither a markdown parser nor a
highlighter.

## Skills

`skills/` is a **mirror, not a source**: the 31 skills from [xskills](https://github.com/lleqsnoom/xskills), copied
whole so this repository carries both halves of the loop — the skills that write `.x-skills` trees and the board
that reads them. They are the skills' own files (each a `SKILL.md` with its `scripts/`, `references/` and `assets/`)
and they run from wherever they are installed, so the copy here is for reading, for an agent working in this
repository, and for having both halves in one checkout. Nothing in the app imports them, `files` keeps them out of
the published package, and xskills stays the source of truth.

To refresh the mirror after the skills change:

```bash
rsync -a --delete ../xskills/skills/ skills/     # from a checkout beside this one
```

## Endpoints

| Route | What it answers |
|-------|-----------------|
| `GET /api/snapshot` | every root, every category, every collection and artifact — the one payload the app loads |
| `GET /api/snapshot?force=1` | the same, re-read from disk |
| `GET /api/file?project=<id>&path=<relPath>` | one artifact, rendered (markdown HTML or coloured code) and raw; 400 on a path that escapes the root |
| `POST /api/file` | write one artifact back — `{ project, path, content }` — and answer with it as it now reads; 415 for a file that is not a text artifact, 413 for one over the size limit |
| `POST /api/refresh` | drop both caches and answer with a fresh snapshot |
| `GET /api/project` | what the new-project form offers before anything is typed: the account, the directory, the licenses GitHub publishes |
| `POST /api/project` | make a project — name, about, directory, visibility, license, icon — and answer what it made |
| `GET /api/browse?path=<dir>` | one level of folders for the picker, directories only; no path starts at the home directory, and every answer carries its own `parent` |
| `POST /api/roots` | add a folder that already exists — `{ path }` — giving it an empty `.x-skills/tasks/` when it has no tree, and answer the id it was added as; 400 for a path that is missing or not a folder, 409 for one already read or whose id is taken |
| `POST /api/move` | file a card into a lane, and answer with the whole board |
| `POST /api/delete` | archive or unarchive an item, and answer with the deletions map |
| `GET /api/asset?project=<id>&path=<relPath>` | an image a project carries, as bytes; raster types only, and nothing outside the project's root |

The snapshot is cached for four seconds and each parsed file is cached by `mtime` + size, so a reload of the UI
does not re-read the tree and a changed file is picked up on the first request after it changes.

## Tests

`npm test` runs `test/*.test.cjs` over a fixture `.x-skills` tree built in a temp directory, and drives the real
server modules the app serves — the scanner's contract (a category per directory, two spellings merging into one,
a run's `state.json`, a task file's fields, path-escape refusal) and the rendering and decision contracts beside it
(a named fence coloured as what it named, a `.png` refused a write, a save read back off the disk, a move and an
archive written and cleared, the create flow driven entirely through a stubbed `run`). Nothing in the suite touches
the network, GitHub or the Orca IDE.

## Releasing

The package is its own: `@lleqsnoom/otter-pm`, versioned and published on its own commits by
`.github/workflows/publish.yml`, which runs the tests and skips the publish when the version is already on npm.
Bump `version` in `package.json` and push to `main`.

The app it publishes is not a library: `files` carries the source, the scripts, `astro.config.mjs`, `tsconfig.json`
and the config template, and the first run builds `dist/` where the package was installed. `brand/` and `test/`
stay in the repository, out of the tarball.
