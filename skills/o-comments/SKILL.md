---
name: o-comments
description: Comment management — add only precise, meaningful comments and remove noisy or obvious ones; refactor overly commented code into self-explanatory functions instead of describing it. Use when asked to fix noisy, obvious or missing comments; runs as a pass inside o-review and o-implement.
version: 1.2.1
author: Community
tags: [comments, code-cleaning, self-documenting-code, readability, refactoring]
user-invocable: true
---

# O-Comments — Meaningful Comments Only

Manage code comments: write only the ones that earn their place, remove the noise, and refactor blocks that need long explanations into smaller self-explanatory functions.

## Two Ways It Runs

**As a pass inside another skill:** read `references/pass.md`; it owns the per-host steps.

**On its own**, when the user asks to clean up comments: run every step below and make the edits.

## Comment Rules

1. **Don't comment the obvious.** If the line reads fine on its own (`i++`, `return user`, `close()`), a comment adds zero information. Delete it.

2. **No noise.** A comment must carry information the code cannot express by itself. If you can remove it and nothing of value is lost, it is noise. Silence beats filler: `// increment i` is worse than nothing.

3. **Long comments signal a code problem.** If a block needs a paragraph to explain what it does, the code is the problem, not the docs. Split it into smaller functions with descriptive names, then delete the paragraph — the name carries the meaning.

## What a Good Comment Explains

Only the *why*, never the *what*. Justify a comment if it answers one of:

- **Why** this non-obvious choice exists (workaround, constraint, historical reason).
- **Where** a magic value comes from or what invariant it must satisfy.
- **What will break** if this is changed, and how to detect it.
- **Intent** that is not recoverable from the code (performance tradeoff, order dependency, cross-module contract).

If a comment restates the code, describes *what* the code does, or paraphrases the function name, it should not exist.

## What to Do When Invoked

1. **Determine the target** — a file, a set of changed files, or a block the user points at. Do not ask which; inspect what is available.
2. **Pass 1 — remove noise**: delete every comment that restates the code or states the obvious.
3. **Pass 2 — refactor instead of explain**: for each comment block longer than ~2 lines that explains *what* a chunk does, extract that chunk into a small, descriptively named function and drop the comment.
4. **Pass 3 — keep and sharpen the *why***: rewrite remaining comments to be precise and non-obvious, or delete them if they cannot be made to earn their place.
5. **Report** what you removed, what you refactored, and what you kept (and why it stayed), led by the counts —
   `removed N · refactored into functions M · kept K · added J` — so the result can be checked against the diff
   instead of taken on your word. The removed count is the number of comment lines `git diff` shows deleted.

## Never Cut

A comment that a tool reads, or a law requires, is not commentary. Leave these alone whatever the rules above say:

- **Directives** — `eslint-disable…`, `@ts-expect-error`, `@ts-ignore`, `# noqa`, `# type: ignore`,
  `// prettier-ignore`, `//go:build`, `#pragma`, `// @ts-check`, `/* istanbul ignore */`. Removing one changes
  what a linter or compiler does; whether it should exist is `o-floor`'s question, not this skill's.
- **License and copyright headers.**
- **Shebangs, encoding lines and magic comments** (`#!/usr/bin/env node`, `# -*- coding: utf-8 -*-`,
  `// @flow`, `"use client"`).
- **Doc comments a tool consumes** — JSDoc or docstrings on a public API that generate types, API docs or editor
  hints. Trim their prose; keep the tags.

## Rules

- Never add a comment that can be replaced by a better name.
- Prefer extracting a function over writing an explanatory comment.
- One meaningful sentence beats a full paragraph of description.
- If in doubt whether a comment is noise, delete it — code should be readable without a running commentary.
- Removing comments must never change behavior; refactoring must preserve it. Run the project's tests after refactoring.
