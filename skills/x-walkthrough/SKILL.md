---
name: x-walkthrough
description: Generate an interactive bash script that walks a human through steps only they can perform — setting up credentials or API keys by hand in a vendor dashboard, provisioning a cloud resource, adding a CI secret, or running a one-off migration or cutover — stage by stage with hidden secret entry and confirmation gates. Use when the remaining steps need a human in a browser or console; never for what can be automated.
version: 1.0.0
author: Community
tags: [walkthrough, human-steps, provisioning, credentials, migration]
user-invocable: true
---

# X-Walkthrough — Human-Only Steps, Scripted

The agent cannot click through a vendor dashboard, paste a secret into a CI settings page, or approve a
migration with production hands. Those steps stall a run. This skill turns them into an interactive bash
script that walks the person through them, stage by stage, and captures every value where it belongs.

The interaction design is already solved by `references/template.sh` — stage-by-stage progress, URL opening,
hidden secret entry, `.env` upserts, confirmation gates, a closing summary. Your job is only to scope the
stages and author them. Never hand-edit the library above the `STAGES` marker; that consistency is the point.

The script is ephemeral by default: built for one run, deleted when done. Commit it only when the user wants a
repeatable setup path that should live in the repo. A worked two-stage example with a CI secret and a confirm
gate is in `references/worked-example.md`.

## Process

### 1. Scope the procedure

Read the repo before asking: `.env*`, README, docker-compose, framework config, and every `secrets.*` /
`vars.*` reference in CI workflows — each is a value the script must produce. For a migration: the current
state, the target state, and the irreversible actions between them.

Show the user the ordered stage list and what each captures; they may add, drop, or reorder.

**Done when:** every stage is named, and for each captured value you know where the human gets it, where it
lands (`.env`, a CI secret, both, nowhere), and whether it is secret.

### 2. Map each stage's journey

Write the precise path a stranger follows: which URL to open, what to click, where the value appears, which
variable it fills. Where you do not actually know the dashboard or the command, say so and ask — **never invent
steps that may not exist**.

**Done when:** every stage traces to instructions a stranger could follow.

### 3. Author the script

Copy `references/template.sh` to the target path and write one `stage` per step, in dependency order, using
its helpers: `stage`, `say`/`step`, `open_url`, `ask`/`ask_secret`, `write_env`, `set_secret`/`set_var`,
`pause`/`confirm`. Set `TOTAL_STAGES`. Hold the template's bar: open the URL before asking for its value,
`ask_secret` for anything secret, `confirm` before any irreversible action, one focused task per stage.

### 4. Verify statically, then hand off

- `bash -n <script>`; run `shellcheck` if available; `chmod +x`.
- Do **not** run it end-to-end yourself — it opens browsers and blocks on human input. Trace it instead: every
  value from step 1 is captured and lands where step 1 said, and every `set_secret` name matches a `secrets.*`
  reference in CI.
- Tell the user how to run it. A committed walkthrough gets linked from the README so the next person runs the
  script instead of asking an agent.

## Relation to the other skills

- **x-plan / x-decompose** — a stage-only human sequence inside a larger effort becomes a walkthrough task; the
  task's DoD references the script, not the clicks.
- **x-brief** — a walkthrough interrupted mid-way resumes from a brief, not from memory.
