# Installing Otter Skills

The skills and the MCP server are installed by one command, which links them into the agents on this machine.

## What you need

| Needed | Why | Check |
|---|---|---|
| Node 22.12.0 or newer | `engines` in `package.json` | `node -v` |
| `git` | to get the code | `git --version` |

## 1. Get the code

```bash
git clone https://github.com/lleqsnoom/otter-skills.git
cd otter-skills
```

## 2. Install

```bash
npm install
npm run install
```

`npm run install` links every skill in `skills/` into `~/.agents/skills/` (with a `~/.claude/skills/` mirror on a
machine that has that directory), and registers the MCP server in the config of each agent that already has one. It
points at this checkout's `scripts/mcp.mjs`, so an edit to a skill here is the skill the next agent runs and nothing
has to be installed again.

## The MCP server

`otter-skills-mcp` exposes a project's `.o-skills` tasks, documents and code over stdio. It is started and stopped by the
client, takes no arguments, and reads its roots from `otter-skills.config.json`, Orca's project list, `--root` flags,
`$OTTER_SKILLS_ROOTS`, discovery, or the current directory. The bin is `scripts/mcp.mjs`, registered as `otter-skills-mcp` in
`package.json`; `npm run install` writes the entry into each agent's config, and a global install of this checkout
resolves to `{ "command": "otter-skills-mcp" }`.

## Or: the Claude Code plugin

```
/plugin marketplace add lleqsnoom/otter-skills
/plugin install otter-skills@otter-skills
```

The plugin installs the skills, the loop commands (`/otter-skills:o-plan` and the others), the hooks in
`hooks/hooks.json`, and the MCP server. The server's packages go into the plugin's data directory
(`${CLAUDE_PLUGIN_DATA}`), which survives plugin updates, in two stages started by `scripts/mcp-plugin.mjs`:

- the MCP SDK and zod (about 27 MB) before the server answers its first request, so the exact tools work within
  seconds;
- LanceDB and transformers.js (about 1.8 GB, mostly the embedding runtime) in the background, logged to
  `index/install.log`. Until they land, the semantic tools say the index is unavailable.

The first semantic search also downloads the embedding model (a few hundred MB, cached once per machine). Use one
route per machine, not both.

## Obsidian metadata

Run artifacts start with a property block, and by default it carries what an Obsidian vault over `.o-skills/` uses:
wikilinks between a run's artifacts, `topics`, tag notes under `.o-skills/tags/`, and `.base` files. A repo that does
not use Obsidian turns those off with `.o-skills/config/vault.json`:

```json
{ "enabled": false }
```

The fields the scripts and the board read (`type`, `size`, `complexity`, the status stamps) are written either way.

## Hooks with `npm run install`

`npm run install` does not touch your Claude Code settings. To get the hooks the plugin registers, add them to
`~/.claude/settings.json` with this checkout's path in place of `<checkout>`:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"<checkout>/hooks/session-start-summary.mjs\"" }] }],
    "PostToolUse": [{ "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "node \"<checkout>/hooks/review-plan-gate.mjs\"" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"<checkout>/hooks/background-reflection.mjs\"", "timeout": 45 }] }]
  }
}
```

Each is optional: the review-plan gate only judges files named `*-review-plan.md`, and the background reflection
only counts in a project that already keeps a `.o-skills/` tree.
