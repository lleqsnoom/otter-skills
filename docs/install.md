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
