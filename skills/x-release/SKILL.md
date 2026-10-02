---
name: x-release
description: Write the PR body — the pull request description that shows the change, the evidence, and the danger in one screen: a summary as the smallest visual that makes this branch clear, before and after evidence that it works, and a merge-danger call naming one-way or two-way door and blast radius. Use when writing a PR description, opening a pull request, or asked what to put in the body.
version: 1.0.0
author: Community
tags: [pull-request, pr-body, review, risk, evidence]
user-invocable: true
---

# X-Release — The PR Body

A reviewer spends their attention on your diff; the body decides whether they spend it well. Write the smallest
body that makes the change clear, proves it works, and says what it endangers. Skip every preamble.

## Body template

```markdown
## Summary

<the smallest visual that makes the key point clear — a diagram, a diff sketch, or a tree>

## Evidence

- **Before:** <screenshot, output, or the failing run>
  **After:** <the same view, passing>

## Merge Danger

**Door:** <one-way or two-way>

**Blast Radius:** <one word>

<optional: what could break, and how to un-break it>
```

## Sections

### Summary — the smallest visual

Pick the smallest view that makes the key point. Logic or algorithm: pseudocode.

```text
on(save)
  if content is unchanged
    return cached result
  write new content
  return fresh result
```

Runtime control flow: a call tree.

```text
submitForm
  createSession
    persistPrompt
  navigateToSession
```

A shape change: a diff sketch or a tree. Prose is the last resort, not the default.

### Evidence — before and after

The same view twice: the failing run before, the passing run after; the broken screen before, the fixed screen
after. One pair per user-visible behavior. "Tests pass" is not evidence of behavior — show it.

### Merge Danger — door and blast radius

- **One-way door**: hard to reverse once merged (data migration, API removal, a config flip that half the
  fleet reads). Say what makes it one-way and what the escape hatch is, if one exists.
- **Two-way door**: revertable with a revert. Say so in one line and move on.
- **Blast radius**: one word — `none`, `this module`, `several modules`, `everything` — plus the one sentence
  on what else reads the changed contract, if anything does.

Use the project's own domain language, not generic filler; the glossary words, if the repo keeps one.

**Done when:** every section is present, and each Evidence pair is a real run or a real screenshot from this
branch — a body with an empty section or a claimed-but-unshown behavior is not finished.

## Relation to the other skills

- **x-commit** stays commit-scoped; this skill takes over when the work goes up as a PR.
- **x-review** ran before the PR opens; its plan is evidence the body can point at, not repeat.
- **x-brief** — a PR the reviewer must hand to someone else mid-review is where that body ends and a brief
  begins.
