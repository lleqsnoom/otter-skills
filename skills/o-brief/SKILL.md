---
name: o-brief
description: "Write the handoff brief that hands this session's work off — a written note of where things stand: what is settled, what is open, what to do next, as context pointers rather than duplicated content. Use when handing off mid-work, when the session must stop soon or be compacted, when context is nearly full, when switching machines, or to leave a note for whoever continues this work."
version: 1.1.2
author: Community
tags: [handoff, brief, context, session, continuation]
user-invocable: true
---

# O-Brief — Hand the Work Over Clean

Sessions end mid-stream: context fills up, the user moves to another machine, a different agent picks the work
up. The brief is what makes the next session start where this one stopped instead of rediscovering it. Write
it for a reader who has none of this conversation — because they do not.

## What the brief holds

Create it with the script, so it lands where the next session looks — `<run folder>/E<nn>-brief.md`, with a
pointer the session-start hook prints:

```bash
node <skill>/scripts/save-brief.mjs --slug <topic> [--dir <the run folder the work belongs to>]
```

`<skill>` is this skill's folder. Every script answers `--help` with its commands and flags. Fill the six sections it writes, in this order:

- **Do next** — the first three actions for the next session, in order; the section the next session reads
  first, so it leads.
- **Where this stands** — the goal in one sentence, and what is working right now: the last green state, the
  branch, the run folder, the command that reproduces where things stopped.
- **Settled** — decisions made, each with its one-line reason, so the next agent does not re-litigate them.
- **Open** — what is unresolved and what each depends on; the next question to ask, if there is one.
- **Suggested skills** — which skills the next agent should run for the open work, by name.
- **Sources** — the artifacts that already hold the detail: specs, plans, task files, analyses, ADRs, commits.

Worked shape: `references/brief-format.md` — copy the shape, not the content.

## The rules

1. **Point, never duplicate.** Every artifact named above holds its own detail — reference it by path or link
   and do not restate it. A brief that copies the spec forks it, and the fork is wrong by the next edit.
2. **Redact.** No keys, tokens, passwords, or personal data; a secret in a brief is a secret in a repo.
3. **Write for a stranger.** No "as discussed above", no pronouns without antecedents: the next reader has no
   above.
4. **Tailor to the ask.** If the user says what the next session focuses on, re-order around it — the brief
   serves that session, not the archive.
5. **Verify the pointers.** Every path you cite must exist at the moment you cite it; a brief with a dead
   pointer sends the next session hunting.
