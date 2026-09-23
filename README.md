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

The tree is read. Two things are written: `.x-skills/board.json` **inside the project**, which holds the reader's own
decisions (a card dragged to a lane and a place in it, the order each lane was left in, and an item archived), and an
artifact the reader edits in the app itself — see *Reading and editing* below.

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
| Stage | the `E<nn>` a run numbered an artifact with: `E00-plan.md` is rung 0, `E02-tasks/` is rung 2 |
| Epic | the epic a task belongs to: the run both are stages of, or the slug their folders share (see below) |
| Named in | the `**Input:**` / `Spec:` / `Plan:` paths an artifact names, when the path leads somewhere |

A run (a folder with `state.json`) and a task group (a folder of task files) are the same thing to the UI: a
collection with a head and a body of artifacts — except that a task group's files are drawn instead of the group,
because the folder is not the unit a reader picks up. See **Epics and their tasks**.

## Runs and their stages

The skills write one run folder per topic and number everything in it in the order they built it —
`E00-plan.md`, `E01-epic.md`, `E02-tasks/` — so a run is a chain of rungs and the folder name is the topic. That is
the right unit to work in and the wrong one to find things in: an analysis that has to be found inside a run is not
in **Analysis**, and the category that names it looks like a folder nothing has written to since the skills moved
into run folders.

So every rung is read **in the category that names its kind as well as in its run**. `E00-analysis.md` is a card
under Analysis and a file of the run that wrote it; `E01-epic.md` is under Epics; a `E02-tasks/` folder
(x-decompose writes a folder, not a file) is read under **Tasks**, where its task files are the cards and the folder
it came from travels with it as `runPath`.
Nothing is copied — a stage keeps the path it came from, so it is the same file in two places, and the card says
`in shared-media-kms-key-staging-sandbox` rather than leaving you to guess which of nine same-named files it is.

Which category that is falls out of the kind and what the repository has: `analysis` is Analysis, `epic` is
**Epics**, and `plan` is **Plan** where `plan/` exists and **Plans** where only `plans/` does. A kind no folder
claims (a summary, a critique, a repro script) is read where it was written. A kind the registry knows and the
repository has never used — **Triage**, in a tree with no `triage/` — gets its category from the registry, and the
category's own page says it was named by the runs rather than read from a folder. A run that is *already* filed in
the category its own stage belongs to (a session living in `anal/`) is not listed twice.

**The chain is one panel, and every view of a piece of work shows the same one.** A rung is a chain by construction
and a named path is another edge, so the pipeline a reader thinks in — analysis, plan, epic, tasks — is the component
those edges connect, and it is usually **two runs**: `x-analyze` writes the analysis into its own run and `x-plan`
opens the next one, so the analysis and the plan that read it are joined by one written path and nothing else.

**Related** draws that whole component (`chain.mjs`), from wherever you are:

- **Run** — the run the artifact belongs to, when it belongs to one.
- **Chain** — the run's rungs in `E<nn>` order, then the runs it reached, with the artifact you are reading marked
  rather than linked. A folder rung carries the files it is made of — `E02-tasks/` lists its task files — and a rung
  that has no collection of its own (a run filed inside the category its stage belongs to) opens the run instead.
- **Each line says how it was reached** — `named Input by E00-plan.md` — because that is what says which way the work
  flowed.

The edges are walked in both directions, which is why `scan.mjs` also publishes every path read backwards
(`references`): an epic names the plan and the plan names the analysis, but an analysis names nothing at all, so
following only what an artifact points at left the analysis looking like the end of the chain it began. From the
analysis you now see the plan run; from the epic you see the analysis. Only paths the repository actually holds are
edges at all: a skeleton's `<run folder>/E00-plan.md` placeholder and a mistyped path lead nowhere and stay text.

The same panel is on a run's own page and on every artifact's page, so "what else is part of this?" is answered
wherever you happen to be reading.

## Epics and their tasks

An epic and the work it was split into are written by two skills into two folders, and **neither document names the
other**: `x-epic` writes `epics/<stamp>-<slug>.md`, `x-decompose` writes `tasks/<stamp>-<slug>/`, and the two stamps
are minutes apart because they were written minutes apart. Read literally that is two cards with the same name under
two categories, each with a progress bar, and nothing on either saying which is which — which is what made **Tasks**
look like a duplicate of **Epics**.

The link is in the tree, and there are exactly two ways the two meet (`src/lib/epics.mjs`):

- **The same run.** A run numbers its epic `E<nn>-epic.md` and its tasks `E<nn>-tasks/`, at different rungs, so the
  run folder is the identity both carry and the rungs are what say whose tasks they are: the tasks belong to the epic
  *above* them. A run can number two epics — one run in this repository does, a second pass over the same topic — and
  taking the run alone would give both of them the same list, under the wrong one's name. `scan.mjs` stamps the run
  and the rung on the tasks folder as `runPath`/`step` when it files that folder under **Tasks**, because from there
  its own path can no longer say either.
- **The same slug.** `epics/01-09-2026-11:23-segmentation-webcodecs-proxy-upload.md` and
  `tasks/01-09-2026-11:26-segmentation-webcodecs-proxy-upload/` are one epic's work: the stamps differ, the name
  after them does not.

With that read, three things change on screen:

- **A task folder is not a card; its files are.** The folder that stood for it was named by the first task's heading
  — `groupFor` falls back to the first markdown's title — so the card read `Tasks: Extract SSE parser into
  sse-parser.ts`, a task's own name over a progress bar, beside the epic of the same name. One card per task is what
  a reader came for, and each counts only its own checklist. The folder is named after itself too, so a breadcrumb
  reads `Tasks / segmentation-webcodecs-proxy-upload / 0.1-segment-vlm-profile.md` rather than putting the file
  inside a task it is not inside of.
- **An epic holds its tasks.** Its card lists them — eight, then `+ N more`, and its own page lists all of them —
  its progress is counted over them rather than over the epic document's own checklist, and its colour runs down the
  card's leading edge.
- **Every task wears its epic** as a pill in that epic's colour: on the board, in the list, in search results, in
  **Newest across projects**, and beside the trail on the task's own page. Work no epic was written for is still
  work, and says nothing rather than guessing at a parent.

Work that is not task work is not claimed: a run is not a task, so the analysis inside it does not wear the run's
epic. Only the work filed in **Tasks** does.

The colours are a palette of eight in the theme — `--epic-0` … `--epic-7` in `src/styles.css`, one set per theme,
each step chosen to clear 4.5:1 on the surface it is read on — and an epic is painted by hashing its key rather than
by counting epics: a colour that moved when an unrelated epic was written would be worse than two epics sharing one,
and with fifty epics and eight colours they do share. The pill carries the epic's name as text and the colour only
agrees with it, which is the rule every badge here follows.

Hiding **Tasks** on the board does not empty the epics: the link is read from the whole project first and the
categories a reader asked to see are filtered out of the result, so a board drawing only **Epics** still shows what
is inside each one.

## The board

Five lanes, in this order: **To do**, **In progress**, **Unsorted**, **Done**, **Closed**. What an item's own data
says decides its lane — a finished run is done, a partly ticked checklist is in progress — with two exceptions:

- **Closed** is the window over what is finished: `Closed within 24h / 7 days / 30 days / 90 days / all`, default
  30 days. A finished item inside the window is *Closed*; an older one is *Done*, which is the archive. "all" puts
  every finished item in Closed and leaves Done empty, which is what that choice means.
- **A card can be filed by hand**, by dragging it onto a lane or pressing `Alt + ←` / `Alt + →` on a focused card.
  That is a decision *about* someone else's document rather than a change to it, so it is written to
  **`.x-skills/board.json` in the project the card belongs to** — a file beside the app's own config looked like
  per-machine state and was in fact per-checkout, so switching branch or serving a worktree hid everything a reader
  had filed. A filed card says `moved`, and dropping it on the lane its data already gives it removes the entry
  rather than storing a preference that says nothing.
- **A card can be sorted within its lane**, and the sort is kept. A drag carries a card to a lane *and* to a place
  in it — the slot that opens between two cards, the size of the card in hand — and letting go writes that lane, top
  to bottom, into the project's `board.json`. So the order survives a reload, a rescan and a restart, and a card
  dropped on the lane its own data gives it keeps its place even though it stops saying `moved`: the place was the
  decision, and the column never was. A card that turns up later — a new run, or one that was filtered off the board
  when the drop happened — is drawn after the ones the lane names. `Alt + ←/→` names a lane and no place, so a card
  filed that way lands where its own data would put it.
- **A card can be archived**, and that is a soft delete: the artifact is untouched, the board simply stops drawing
  it, and the `Archived` list at the bottom of the project page brings it back. Archiving a collection takes
  everything inside it off the board, while that list holds the entry the reader made rather than one line per file
  it covers; an artifact whose own entry was not made says it is inside an archived collection. Filing, sorting and
  archiving are three decisions in the same project file, so none of them clears the others: an unarchive lands in
  the column and the place it was filed into, and unarchiving removes the entry rather than storing a `false`.

One file per project, keyed by that project's own paths, because that is where a decision belongs: the repository is
the thing that has branches and worktrees, so filing a card once files it everywhere. The project that filed nothing
has no file. Whether it is committed is the repository's own business — commit it and the filing travels with the
clone, ignore it and it stays local, and the only thing that changes either way is who else sees it.

**An older board moves house with one command.** Every decision used to live in one `board.json` beside
`otter-pm.config.json`, keyed `<projectId>:<path>`; nothing reads that file now. Point the import at it once:

```bash
node scripts/import-board.mjs --from <old board.json> [--dry-run]
```

It reports per project what it took, fills in what a project does not already say, and never overwrites a decision
made since — a card filed in the new store after the change stays exactly as it is.

A lane shows twelve cards and folds the rest behind `+ N more`; while a card is being dragged every lane opens,
because the card you are carrying has to be droppable where you mean it.

Projects wear the **icon and badge colour the Orca IDE gives them** (`repoIcon`, `badgeColor`), so one
repository is one thing in the IDE and here. A root that did not come from the IDE gets the folder mark instead,
and a remote avatar that will not load leaves the tile rather than a broken-image glyph.

## Finding a file

Three ways in, and they are deliberately different widths:

| | What it covers |
|---|---|
| The rail's search box (⌘K / ctrl-K) | **Everything** — every collection *and every artifact inside one*. A file name is a hit even when the run it lives in says nothing about it, and the result says which collection it came from (`in cdk-high-traffic-security`). A stage found twice — under Analysis and inside its run — is one hit, because the first reading is kept. |
| A category's board (Runs, Tasks, …) | One card per collection, plus the documents loose in that folder. A collection is the unit of work, so it is the board's unit; the artifacts inside are not separate cards. A category of a stage kind also draws the runs' stages of that kind, each saying which run it came from. **Tasks** is the exception: a task is what a reader picks up there, so the folder is not drawn and each task inside it is a card of its own, wearing the epic that claims it. |
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
│   ├── categories.mjs   # the category registry: one entry per folder, and which holds the epics and which their tasks
│   ├── create.mjs       # making a project: temp tree, git, gh, through one run seam
│   ├── roots.mjs        # adding a folder that exists: the picker's listing, the scaffold, the config line
│   ├── board.mjs        # the reader's own decisions: one board file per project, and the import of the old one
│   ├── parse.mjs        # headings, bold fields, checklists, dates, artifact kinds
│   ├── highlight.mjs    # shiki, the two-theme wiring, and the dialect detector
│   ├── scan.mjs         # .x-skills root to project model, with an mtime-keyed cache
│   └── snapshot.mjs     # the whole snapshot + one file's rendered content, read and written
├── src/pages/api/       # GET /api/snapshot, GET|POST /api/file, POST /api/refresh, /api/project, /api/roots
├── src/pages/           # the shell, for / and for every other path
├── src/ui/              # shared primitives: Button, Input, Badge, ToggleGroup, cn
├── src/components/      # the screens, made of the primitives: Card, Board, GroupDetail, Related
├── src/lib/             # types, the API client, the router, the work-item model, the chain (chain.mjs), the epics (epics.mjs)
├── src/styles.css       # Orca's tokens, base, and the markdown an artifact is read in
├── src/tailwind.css     # Tailwind wired to those tokens
├── scripts/             # dev.mjs, serve.mjs, import-board.mjs: the ports, the foreground, the migration
├── public/favicon.svg   # the app icon, see brand/README.md
├── brand/               # the mark's sources: the EPS, the traces, the proposals
├── skills/              # the skills themselves: what writes the trees this app reads
├── test/                # the app's tests, over a fixture .x-skills tree
└── otter-pm.config.json # which repositories a machine reads
```

Every project is read from its own `<repo>/.x-skills`, and the one thing written there is `board.json`.

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

`skills/` is where the skills live: 29 of them, each a `SKILL.md` with its `scripts/`, `references/` and
`assets/`. They write the `.x-skills` trees this board reads, so both halves of the loop sit in one checkout.
They run from wherever they are installed, so this repository is the source of truth: edit a skill here, then
install it where an agent runs it (`xskills install <skill> -g` copies it to `~/.agents/skills/`).

Nothing in the app imports them, and `files` keeps them out of the published package.

A skill's scripts are `.mjs`: this repository's `package.json` says `"type": "module"`, and an installed skill is
a symlink into this tree, so a `.js` script that calls `require` or writes `module.exports` throws the moment
anyone runs it, installed or not. `x-skill-lint` fails on that (`commonjs-script`), and the fix is the extension
and `import`/`export` — a `.cjs` file is the escape hatch for a script that must stay CommonJS.

| Skill | Description |
|-------|-------------|
| `x-analyze` | Interactive analysis skill — research the project and web first, ask via panels (single / multi / open / confirm) until the user is sure, then produce a thesis with cited evidence and a mechanical check, propose three solutions with trade-offs, and route to fix or task creation; graph-driven with guards and a markdown memory. |
| `x-api-draft` | Draft API design from requirements — clarify scope, analyze endpoints and data models, produce a human-reviewable API design in markdown |
| `x-api-swagger` | Convert an API design draft to OpenAPI YAML — generate a valid spec from markdown drafts with endpoints, schemas, and auth definitions |
| `x-autoreflection` | Turn sessions into approved skill fixes — `x-autoreflection <period>` (24h, 7d, 2w) traverses every session of that window across every CLI and writes one skill-health report (JSON truth + markdown read) plus a fix plan, then asks whether an auto-heal session is wanted and, on yes, proposes each fix as one multi-select option carrying the original issue, the proposed edit and the rate it should move, applying only what is picked with a revert-on-failure ledger. Without a period it reflects on one session instead. |
| `x-browser` | Launch the real Chrome/Chromium with remote debugging and attach the chrome-devtools MCP to the project’s app URL — detects the URL from README/config/env, verifies the dev server, and opens the browser so you can drive it without manual setup. |
| `x-comments` | Comment management — add only precise, meaningful comments and remove noisy or obvious ones; refactor overly commented code into self-explanatory functions instead of describing it |
| `x-commit` | Write single-line conventional commit messages — one authoritative type map, imperative mood, no description body |
| `x-debug` | Evidence-based debugging — reproduce, hypothesize, fix root cause, verify |
| `x-decompose` | Decompose an approved plan (or an older run's epic) into layer-based tasks, triaging every candidate first — each candidate is decided as a task in this run, a run of its own (x-plan), an analysis (x-analyze), or dropped; outputs `<run folder>/E<nn>-triage.md` and `<run folder>/E<nn>-tasks/` for handoff to x-implement |
| `x-epic` | Convert approved spec into a layer-based epic — each layer is a coherent, testable increment from prototype to polished product; outputs `<run folder>/E01-epic.md` for handoff to x-decompose |
| `x-essay` | Write an article end-to-end on a fixed loop — x-analyze thesis, x-roast critique, x-humanize rewrite — repeating until it scores strong and reads clean. Use when asked to write or draft an article, blog post, or essay that must defend a claim. |
| `x-fix` | Resolve issues from fix plans — read, edit, verify, mark complete |
| `x-humanize` | Simplify text, an article, a commit or PR to a B2 reading level — measure sentence length and complexity, cut noise, rewrite, then verify no meaning was lost. Use when asked to humanize, simplify, make easy to read, or plain-language a piece of prose. |
| `x-implement` | Implement or fix with TDD — parallelize independent tasks with x-parallel, apply x-ui for frontend work, red-green-refactor per task, verify with x-review + x-fix, gate on plan completion |
| `x-investigate` | Hypothesis-driven root cause analysis — generate ranked hypotheses from evidence, test systematically with platform tools and git history, eliminate candidates until one root cause remains, output fix plan for x-fix |
| `x-migrate` | Framework/dependency migration assistant — generates migration plans with breaking changes, upgrade paths, and automated fix candidates from source analysis |
| `x-parallel` | Run multiple coding tasks in parallel — each task gets an isolated git worktree and its own background agent process with full tools and the parent's project rights, then committed results merge back into your branch |
| `x-plan` | Plan before coding — research the project and the web first, ask via panels (single / multi / open / confirm) until the user is sure, propose three approaches with trade-offs, then write a layered spec (contract, invariant, test) as a graph-driven scenario with guards and a memory file; gate on user approval |
| `x-refactor` | Automated refactoring suggestions (extract method, rename, replace conditional) — analyzes code against SOLID principles and outputs actionable before/after comparisons |
| `x-reproduce` | Generates minimal platform-aware reproducible test cases from triage briefs — exits 1 when bug is present, exits 0 after fix applied |
| `x-research` | Research a topic or tune a metric — research the project and web first, propose three candidate changes, then iterate one atomic change at a time, evaluating it mechanically (a command, or agent-judged criteria coverage) and keeping only measured improvements until the target, a guard, or a hard cap stops the run; graph-driven with guards, a memory file, and a report. Use for "research X", "compile/summarise sources on Y until N criteria are covered", filling knowledge gaps, literature/topic research with coverage criteria, or optimizing a measurable value. |
| `x-review` | Review code against engineering principles — small functions, SOLID, KISS, DRY — with automated AST-based complexity analysis across 30+ languages including Python, C, C++, Java, JavaScript, TypeScript, Go, Rust, Ruby, PHP, Swift, Kotlin, and more |
| `x-roast` | Roast any non-code artifact — articles, analyses, specs, epics, tasks, research, or another skill — where the reviewer fact-checks the claims, attacks the reasoning, proposes better angles, and scores it on a weighted, anchored rubric computed by a script. Use for "roast this", "poke holes in", "review this spec/skill/analysis", or any request for a reproducible number and reason. For source code use x-review instead. |
| `x-rollback` | Automated git revert with multi-step confirmation — identifies target commits, analyzes impact, requires approval, creates properly formatted revert commits via x-commit integration |
| `x-search` | Search every indexed repository by meaning or exact identifier through the `x-search` MCP server — use before grepping for a symbol, when the file that owns a behaviour is unknown, or when the question spans repositories. |
| `x-skill-lint` | Validate this repo’s own skills — frontmatter parses and `name` matches the folder, every referenced `scripts/*` and `references/*` exists, no stray template tokens, optional `evals/expectations.json` and `evals/triggers.json` are well-formed, and the README skills table lists every skill |
| `x-test-gen` | Generate test stubs from implementation — analyzes source code and creates scaffolded tests with happy path, error cases, and edge case placeholders |
| `x-triage` | Structured intake conversation — ask targeted panels (single / multi / open / confirm) to classify a bug’s platform, type, and evidence before touching any tools. Outputs `<run folder>/E<nn>-triage.md`. |
| `x-ui` | Design and audit app UIs to be clean, clear, and effective — framework-agnostic method (Vue/React/HTML) with component-selection, row-action, and pre-flight rules. |
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
| `POST /api/move` | file a card into a lane, and answer with that project's board and lanes |
| `POST /api/delete` | archive or unarchive an item, and answer with that project's deletions |
| `GET /api/asset?project=<id>&path=<relPath>` | an image a project carries, as bytes; raster types only, and nothing outside the project's root |

The snapshot is cached for four seconds and each parsed file is cached by `mtime` + size, so a reload of the UI
does not re-read the tree and a changed file is picked up on the first request after it changes.

## Tests

`npm test` runs `test/*.test.cjs` over a fixture `.x-skills` tree built in a temp directory, and drives the real
server modules the app serves — the scanner's contract (a category per directory, two spellings merging into one,
a run's `state.json`, a task file's fields, a run's tasks folder carrying the run it came from, path-escape refusal)
and the rendering and decision contracts beside it (a named fence coloured as what it named, a `.png` refused a
write, a save read back off the disk, a move and an archive written and cleared, the create flow driven entirely
through a stubbed `run`, and the two ways an epic and its tasks are read as one). Nothing in the suite touches the
network, GitHub or the Orca IDE.

## Releasing

The package is its own: `@lleqsnoom/otter-pm`, versioned and published on its own commits by
`.github/workflows/publish.yml`, which runs the tests and skips the publish when the version is already on npm.
Bump `version` in `package.json` and push to `main`.

The app it publishes is not a library: `files` carries the source, the scripts, `astro.config.mjs`, `tsconfig.json`
and the config template, and the first run builds `dist/` where the package was installed. `brand/` and `test/`
stay in the repository, out of the tarball.
