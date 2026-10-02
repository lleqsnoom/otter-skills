---
name: x-interview
description: Interview the user to stress-test a decision, design, or idea — poke holes in it, challenge assumptions, surface the edge cases, and ask the hard questions until every branch of the design tree is resolved; work the frontier in rounds, each question carrying a recommended answer, facts fetched by sub-agents and decisions reserved for the user. Use when asked to grill, interview, or pressure-test the user's thinking.
version: 1.0.0
author: Community
tags: [interview, clarification, design-tree, frontier, stress-test]
user-invocable: true
---

# X-Interview — The Whole-Session Interview

A plan with an unasked question inside it fails later and costs more. This skill spends the conversation
upfront: interview the user until every branch of the design tree is visited and nothing is silently assumed,
then stop — do not act until the user confirms you have reached a shared understanding.

## The design tree and the frontier

Map the topic as a **design tree**: every decision branches into the decisions that hang off it. The
**frontier** is every question whose prerequisites are already settled — the questions you can ask now without
guessing at answers you have not heard yet.

**Work it in rounds.** Ask the whole frontier in one round — number each question and give your recommended
answer beside it — then wait. Each round of answers reshapes the tree: settled decisions push the frontier
outward and unblock what depended on them. Recompute, ask the next round. A question that depends on a sibling
still open this round waits for a later round.

## Facts are yours, decisions are theirs

A frontier question the filesystem, the repo, the run history, or the web could answer is never asked: dispatch
a sub-agent to find it and move on. Do not block on it either — only the questions downstream of a running
sub-agent wait for its report; ask the rest of the frontier now. What remains for the user is genuinely
theirs: trade-offs, preferences, intent. Put each to them and wait.

## Done

The session is done when the frontier is empty: every branch visited, no silently assumed answer left. The
self-check is the user's own restatement: they can say back every settled decision and its one-line reason
without you filling a gap — anything they cannot restate was never settled. Say the shared understanding back
in a few lines, and do not act on it until the user confirms.

## Relation to the other skills

- **x-plan** and **x-analyze** embed the frontier-rounds mechanic inside their clarify phases, with graph
  guards around it; this skill is the standalone, user-invoked whole-session version.
- **x-domain** — when a round keeps stalling on vocabulary, bring the terms there before asking more questions.
- **x-brief** — when the session must end before the frontier is empty, compact what is settled into a brief
  for the next agent.
