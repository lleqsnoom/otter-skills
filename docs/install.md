# Installing Otter PM as an app

This is the long-running setup: the board starts with your session, and opens from the app launcher — one entry for a
window, one for a browser tab. If you only want to work on the app, [`../README.md`](../README.md)'s *Running it* is
the shorter path and stays the right one.

Nothing here needs root, and every path is inside your home directory.

## What you need

| Needed | Why | Check |
|---|---|---|
| Node 22.12.0 or newer | `engines` in `package.json`; the build refuses older | `node -v` |
| A `systemd --user` instance | the board runs as a per-user service | `systemctl --user status` |
| `git` | to get the code | `git --version` |
| A desktop session | only the launchers need one; the service does not | you are in one |

On Arch and Omarchy everything above is present or one `pacman` away. On Fedora and Ubuntu the same commands apply —
`systemctl --user` is identical — but the distribution's `nodejs` package is often older than 22.12, so install Node
from a current source (nvm, mise, NodeSource) rather than the distro package.

## 1. Get the code

```bash
git clone https://github.com/lleqsnoom/otter-pm.git
cd otter-pm
```

An existing checkout works too. The path matters in exactly one place (step 3), so you do not have to move it.

## 2. Install and build

```bash
npm install
npm run build
```

Expected: `npm install` ends with `added N packages`, and the build ends with

```
[build] Server built in ...
[build] Complete!
```

`dist/server/entry.mjs` now exists. You do not have to build again after this — the service builds by itself if
`dist/` is ever missing.

## 3. The wrapper

The service and the launchers all call one command, `oc-otter-pm`, which lives in your `~/.local/bin`:

```bash
install -Dm 0755 scripts/oc-otter-pm ~/.local/bin/oc-otter-pm
```

Its one variable is the checkout it runs. If your checkout is not at `~/orca/workspaces/otter-pm/feat-app-version`,
either export `OTTER_PM_ROOT` in your shell profile or add `Environment=OTTER_PM_ROOT=/your/path` to the unit in the
next step. Check it:

```bash
oc-otter-pm port
```

Expected, before the service is running: `oc-otter-pm: nothing is serving: no URL has been published` on stderr and
exit status 1. That is the correct answer at this point — it proves the wrapper found the launcher.

## 4. The service

```bash
install -Dm 0644 scripts/service/oc-otter-pm.service ~/.config/systemd/user/oc-otter-pm.service
systemctl --user daemon-reload
systemctl --user enable --now oc-otter-pm
```

Expected: `enable --now` prints nothing on success. The unit starts the board at login, restarts it if it dies
(`Restart=on-failure`), and gives up after five failed starts in a minute rather than retrying forever.

## 5. The two launchers

```bash
install -Dm 0644 scripts/service/oc-otter-pm.desktop ~/.local/share/applications/oc-otter-pm.desktop
install -Dm 0644 scripts/service/oc-otter-pm-browser.desktop ~/.local/share/applications/oc-otter-pm-browser.desktop
install -Dm 0644 public/favicon.svg ~/.local/share/icons/hicolor/scalable/apps/otter-pm.svg
```

Expected: **Otter PM** (a chrome-less window) and **Otter PM (browser)** (an ordinary tab) appear in your app
launcher. Desktop entries are read from disk, so the launcher menu picks them up without a re-login; if yours caches
its list, re-open the menu or restart the shell you launch apps from.

## Verifying the install

Run these in order. Each line is the command and what it should print.

```bash
systemctl --user is-active oc-otter-pm        # active
oc-otter-pm port                              # http://127.0.0.1:4321/  (or 4322, 4323, … — see below)
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$(oc-otter-pm port)api/snapshot"
# 200
```

Then launch each entry from the app launcher: the window entry opens a chrome-less window on the board, and the
browser entry opens a browser tab on it. The board's project list comes from the Orca IDE when it is installed, which
the overview states on screen (`9 of 10 repositories in the Orca IDE …`).

Finally, prove the service comes back:

```bash
systemctl --user kill --signal=SIGKILL oc-otter-pm   # nothing printed
sleep 5
systemctl --user is-active oc-otter-pm               # active again
```

## Switching the machine to another checkout

The checkout the machine runs is not hard-coded: `oc-otter-pm` resolves it from `OTTER_PM_ROOT`, then from a
pointer file, then from its built-in default. The pointer is one line — the path of the checkout to run:

```bash
install -Dm 0755 scripts/oc-otter-pm-here ~/.local/bin/otter-pm-here   # once
cd ~/code/otter-pm-some-branch
otter-pm-here use
```

Expected: `otter-pm-here: building <path> (sources are newer than dist/)` when the build is stale, then
`otter-pm-here: the machine now runs <path>`. The service restarts itself, so the running board, the app launcher
and `oc-otter-pm port` all point at that checkout — no unit edit, and nothing to remember. `OTTER_PM_ROOT` in the
unit's environment still overrides the pointer, and deleting `$XDG_STATE_HOME/otter-pm/root` returns the machine to
the default.

**One checkout per machine at a time.** The pointer is read by the service and by the launchers, so pointing it
elsewhere replaces the running version rather than adding a second one. To run two side by side, serve the second by
hand with its own state directory: `otter-pm-here serve --port 4700` (with `XDG_STATE_HOME` set to somewhere else
if you do not want it to become the published URL).

## Updating

```bash
git pull
npm install          # only if package.json changed
npm run build        # optional: the service builds on its next start if dist/ is missing
systemctl --user restart oc-otter-pm
oc-otter-pm port     # may print a different port; it is published, not fixed
```

## The MCP server

The board's data is also an MCP server, for an agent that wants to ask about a repository rather than read it by
hand. It is the same checkout, so nothing is installed twice:

```json
{
  "mcp": {
    "servers": {
      "otter-pm": { "command": "otter-pm-mcp" }
    }
  }
}
```

`otter-pm-mcp` is the second bin in this repository's `package.json` (`scripts/mcp.mjs`), and it takes no
arguments: it reads `otter-pm.config.json`, `$OTTER_PM_ROOTS` and the Orca list exactly as the board does, so both
halves see the same repositories.

It is a command a client starts itself, not a service — there is no unit for it and nothing to restart. Each
project keeps its own index at `<repo>/.x-skills/knowledge.lance/`; deleting that directory is safe, and the next
fuzzy search rebuilds it. The first build downloads the embedding model once per machine, so a machine that must
stay offline is better served by the exact tools, which read the files and need neither a model nor the index.

## Troubleshooting

**The port is not 4321.** Nothing is broken: the board takes the first free port at or after `--port`/`$PORT`/4321, so
it moves aside for anything already there — a dev server of your own, most often. The URL it actually took is what
`oc-otter-pm port` prints and what the launchers read; never hard-code 4321 anywhere.

**`oc-otter-pm open` exits 1** — nothing has been published: the service has never run in this session. `systemctl
--user start oc-otter-pm`.

**`oc-otter-pm open` exits 2** — it published a URL that nothing answers on. The port was taken by something else
after the service started, or the service died. `systemctl --user restart oc-otter-pm` publishes a new one.

**`oc-otter-pm open` exits 3** — the state file or the front door itself is wrong: the published file is not a URL
(restart the service to rewrite it), or `omarchy-launch-webapp` / `xdg-open` is not on `PATH`.

**The service will not start.** `journalctl --user -u oc-otter-pm -n 50` says why. The three it can report are a
checkout the wrapper cannot find (the message names the path), a start that cannot build (`npm install`, with the Node
version in the message), and no free port in the range it searched.

**The board opens but says there are no projects.** See the next section.

## Without the Orca IDE or gh

The default root source is the Orca IDE's own project list (`"orca": true` in `otter-pm.config.json`). A machine
without the IDE does not fail — it falls back, and the fallback is worth knowing about: with no IDE and no `roots`,
the board reads **the directory the service runs from**, which is this checkout. Observed on a machine without Orca
data: `"orca": false` and an empty `roots` showed one project, `feat-app-version` — the checkout itself, whose
`.x-skills/` holds the runs. That is not an error, but it is not your work either, so add roots.

Two things work everywhere regardless: reading any repository that has a `.x-skills` tree, and the `+ add existing`
flow. Add roots either in `otter-pm.config.json`:

```json
{ "orca": false, "roots": ["/home/you/code/app", "/home/you/code/api"] }
```

or per run, with `--root /home/you/code/app` (or `OTTER_PM_ROOTS=/home/you/code/app,/home/you/code/api`). The
`+ new project` flow is the exception: it shells out to `git` and `gh`, so on a machine without an authenticated
`gh` it refuses with 501 and says as much, and everything else in the app is unaffected.
