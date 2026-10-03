---
name: o-interview
description: Grill the user on a decision, design or plan before it is built — stress-test it, poke holes, challenge assumptions and surface what they are not thinking about, in rounds where every question carries a recommended answer; facts are looked up by sub-agents and decisions stay with the user. Use when asked to grill, interview, stress-test or pressure-test the user's approach, or to find what they are missing.
version: 1.1.0
author: Community
tags: [interview, clarification, design-tree, frontier, stress-test]
user-invocable: true
---

# O-Interview — The Whole-Session Interview

A plan with an unasked question inside it fails later and costs more. This skill spends the conversation
upfront: interview the user until every branch of the design tree is visited and nothing is silently assumed,
then stop — do not act until the user confirms you have reached a shared understanding.

## The design tree and the frontier

Map the topic as a **design tree**: every decision branches into the decisions that hang off it. The
**frontier** is every question whose prerequisites are already settled — the questions you can ask now without
guessing at answers you have not heard yet.

**Work it in rounds.** Ask the frontier in rounds of at most four questions — the most a host's question tool
shows at once — each a panel with your recommended answer beside it, then wait. Each round of answers reshapes the tree: settled decisions push the frontier
outward and unblock what depended on them. Recompute, ask the next round. A question that depends on a sibling
still open this round waits for a later round.

## Facts are yours, decisions are theirs

A frontier question the filesystem, the repo, the run history, or the web could answer is never asked: dispatch
a sub-agent to find it and move on (a subagent in Claude Code, a background `codex exec` or `crush run` elsewhere;
with neither, look it up yourself between rounds). Do not block on it either — only the questions downstream of a running
sub-agent wait for its report; ask the rest of the frontier now. What remains for the user is genuinely
theirs: trade-offs, preferences, intent. Put each to them and wait.

## Keep the record as you go

Write `<run folder>/E<nn>-interview.md` — the run the decision belongs to, or a new
`.o-skills/runs/<YYYY-MM-DD-hhmm>-R01-<topic>/` when there is none — and update it after every round:

```markdown
# Interview — <topic>

## Settled
- <decision> — <its one-line reason>

## Open
- <question> — waits on <what>
```

The conversation will be compacted or closed; this file is what survives it, and what `o-plan`, `o-domain` or
`o-brief` start from.

## Done

The session is done when the frontier is empty: every branch visited, no silently assumed answer left. The
self-check is the user's own restatement: they can say back every settled decision and its one-line reason
without you filling a gap — anything they cannot restate was never settled. Say the shared understanding back
in a few lines, and do not act on it until the user confirms.

## Relation to the other skills

- **o-plan** and **o-analyze** embed the frontier-rounds mechanic inside their clarify phases, with graph
  guards around it; this skill is the standalone, user-invoked whole-session version.
- **o-domain** — when a round keeps stalling on vocabulary, bring the terms there before asking more questions.
- **o-brief** — when the session must end before the frontier is empty, compact what is settled into a brief
  for the next agent.
