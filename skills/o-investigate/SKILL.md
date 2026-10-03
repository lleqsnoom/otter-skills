---
name: o-investigate
description: Deep root cause analysis for a bug a quick look could not explain — flaky, intermittent, only under load, or regressed since some commit: ranked hypotheses from the evidence, tested with platform tools, git bisect and blame, eliminated until one cause remains, then a fix plan for o-fix. Use when asked why something is flaky or regressed, which commit broke it, or to dig deeper after debugging found nothing.
version: 1.1.0
author: Community
tags: [debugging, root-cause, hypothesis-testing, git-bisect, triage]
user-invocable: true
---

# O-Investigate — Hypothesis-Driven Root Cause Analysis

The deep mode of debugging: when `o-debug`'s first look explains nothing, generate hypotheses, test them with
platform tools and git history, and eliminate until one root cause remains. This skill finds the cause and
writes the fix plan; it never edits source files.

`<skill>` below is this skill's folder, and `<skills>` the folder that holds it and every other o-* skill.

## Inputs

- **A reproduction** — `<run folder>/E<nn>-verify.<ext>`, the command that goes red on this bug. `o-debug`
  Step 1 builds it; if the run has none, build one first the same way (`<skills>/o-debug/SKILL.md`, and the
  recipes in `<skills>/o-debug/references/reproduction-recipes.md`). No hypothesis is tested without a loop: if
  the repro is slow, loosely asserted or flaky, tighten it first with `<skills>/o-debug/references/feedback-loops.md`.
- **The intake brief**, when there is one — `<run folder>/E<nn>-intake.md` from `o-triage`: platform, bug type,
  symptoms, evidence. Without one, ask for the platform and the symptom in one panel round.

## Workflow

### 1. Generate ranked hypotheses

```bash
node <skill>/scripts/hypothesize.mjs --error "<error text>"
```

It prints `{rank, id, description, test, likelihood}` from the pattern library it shares with o-debug. An empty
list means no known pattern matched — write the hypotheses from the code, the trace and the symptom. Add your
own either way: the script only knows error messages, not this codebase.

### 2. Narrow with git history

| Command | When to use |
|---------|-------------|
| `git log --oneline -20 -- <path>` | recent changes near the symptom |
| `git log -S '<identifier>'` | when a name or value appeared or disappeared |
| `git blame -L <start>,<end> <file>` | who changed the failing lines, and in which commit |
| `git bisect start; git bisect bad HEAD; git bisect good <sha>` then `git bisect run <repro command>` | "it worked last week" — the reproduction finds the commit for you |

### 3. Use the platform's tools

Pick the tools for the brief's platform from `<skills>/o-triage/scripts/route.mjs`:

| Platform | Tools |
|----------|-------|
| web | chrome-devtools MCP (`evaluate_script`, `list_network_requests`, `list_console_messages`), Lighthouse |
| backend / cli / library | the reproduction under a debugger (`node --inspect-brk`, `python -m pdb`, `dlv`), `strace`, flame graphs |
| desktop / mobile / tv | the platform's logger and profiler (`adb logcat`, Xcode Instruments, the vendor's dev tools) |
| infra | the pipeline's own logs, `kubectl describe` / `logs`, the provider's audit trail |
| gaming | the engine's profiler (Unity Profiler, Unreal Insights), RenderDoc |

### 4. Test each hypothesis

For each hypothesis, run the test that tells it apart from the others, against the reproduction. Log the result
in `<run folder>/E<nn>-investigate.md` as a plain bullet — **no checkboxes**, so o-fix never mistakes a
hypothesis for a change:

```markdown
## Hypothesis log
- Confirmed — undefined-reference: `user.profile` is unset on the SSO path (`auth/sso.mjs:41`), seen in the debugger
- Rejected — race: the failure reproduces with the handlers run one at a time
- Not testable — cache staleness: needs production cache contents; asked the user for a dump
```

Stop when exactly one cause remains confirmed. Two confirmed causes means the hypotheses overlap: split them and
test again.

### 5. Write the fix plan

Write `<run folder>/E<nn>-fix-plan.md` in o-fix's plan format (`<skills>/o-fix/references/plan-format.md`): a
`## Root cause` paragraph with its evidence, then `## Fixes` with one `- [ ]` item per change. One root cause per
plan; when that cause needs a coordinated change in more than one file, list each file in the item.

## Constraints

1. **Never applies fixes.** Write only the session notes and the fix plan; source files are o-fix's to change.
2. **Never masks the error.** Do not run the reproduction with changes that hide the original failure.
3. **Every hypothesis is tested or logged as not testable** with what it would need.
4. **One root cause per plan.** A second cause found along the way gets its own plan.

## Anti-Patterns

- Calling a cause "obvious" and skipping its test
- Fixing inline instead of writing the plan for o-fix
- Hypotheses with no evidence behind them — no trace, no log, no reproduction result
- Stopping at the first plausible cause without eliminating the rest
