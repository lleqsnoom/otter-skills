---
name: o-domain
description: Keep the project's words straight — start or sharpen a glossary of its terms (GLOSSARY.md), write an ADR for each decision that settles, test a definition with edge-case scenarios (is a draft shipment the same as a pending one?), and check what people say a term means against what the code does. Use when asked to start a glossary, write an ADR, or sharpen the terms; when terms mean different things to different people, the team argues about a name, or docs use two words for one concept.
version: 1.1.1
author: Community
tags: [domain-modeling, glossary, adr, ubiquitous-language, terminology]
user-invocable: true
---

# O-Domain — The Domain Model as Repo Artifacts

A shared vocabulary is infrastructure: every skill that reads the codebase reasons in its terms. This skill
builds and sharpens that vocabulary as files the repo keeps, so the model survives the session that produced
it. Merely *reading* `GLOSSARY.md` for wording is a one-line habit, not this skill — this is for when the
model itself is changing.

`<skill>` below is this skill's folder. Every script answers `--help` with its commands and flags.

## File structure

Most repos have one context:

```
/
├── GLOSSARY.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If `GLOSSARY-MAP.md` exists at the root, the repo has more than one context, and the map says where each
lives; context-specific glossaries and ADR directories sit beside the code they name.

Create files lazily: `GLOSSARY.md` when the first term is resolved, an ADR directory when the first decision needs
recording. An empty scaffold is noise. **Use the directory the repo already has** — `docs/adr/`, `docs/decisions/`,
`adr/` and the other usual places are looked for in that order — and its numbering and format; `docs/adr/` is
only the default for a repo with none.

## During the session

### Challenge terms against the glossary

When the user states how something works, check the words against `GLOSSARY.md`. When two terms overlap, ask
which one survives. When a term is missing, propose one and test it on the sentence that needs it — a term you
cannot use in a sentence is not a term yet.

### Stress-test with edge cases

When terms or rules are on the table, invent scenarios that probe their boundaries and force precision: does
a cancelled order release its payment? is a draft a shipment? The scenario that makes two people mean
different things by one word is the one that earns a glossary line.

### Cross-check with the code

When the user says how something works, check whether the code agrees. On a contradiction, surface it: "the
code cancels whole orders, you said partial cancellation is possible — which is right?" The answer changes
either the glossary or the code; leaving it silent forks the vocabulary.

### Write it down when it crystallises

The moment a term settles, add it to `GLOSSARY.md`: the term, one line of what it means, and one line of what
it is *not* (its nearest neighbour it must not be confused with). The moment a decision settles, write an ADR:
numbered, titled as the decision, with a status, the context, the choice, and the consequences — one page, no
history. The status is `proposed` until the people who own it agree, then `accepted`; a later ADR that replaces it
sets the old one to `superseded by NNNN` rather than editing its decision. A decision nobody wrote down gets
re-litigated.

The format is its own check: a glossary line without its not-line is not finished, and an ADR missing its
status, context, choice or consequences is not finished. `node <skill>/scripts/check-domain.mjs --root .` names
each one with its file and line, and exits 0 when none is left. Worked examples of both live in `references/glossary-format.md` — copy
their shape, not their content.

## Relation to the other skills

- **o-analyze** and **o-plan** — when a clarify round keeps stalling on vocabulary, bring the terms here before
  asking more questions.
- **o-arch** reads the glossary for seam naming and records structural choices as ADRs in the area it touches.
- **o-review**, **o-debug** and the research step of **o-plan**, **o-analyze** and **o-research** read
  `GLOSSARY.md` when the repo has one, so their reports speak the project's language; they never edit it —
  vocabulary changes route back here.
