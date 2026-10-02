# Python review checklist

Language-specific criteria for the `[PRINCIPLE]` pass. Read this when the change is Python;
each line is a finding class, not an instruction to fix.

## Typing as documentation

- A function whose signature lies — a `-> None` that mutates its argument, a parameter typed
  `Any` where the body narrows it, a return annotated `Optional` that can never be `None` —
  is a MAJOR finding: the type is the contract, and a wrong one is worse than none.
- A `# type: ignore` without a reason is a MINOR escape; one that silences a real type error
  is MAJOR.

## The mutable-default and shared-state footguns

- A mutable default argument (`def f(x=[])`) is MAJOR, and the fix is the `None`-sentinel
  pattern, not a comment.
- A module-level list or dict mutated by more than one function is a shared-state finding; the
  narrower design returns the value instead.

## Exceptions as control flow

- A bare `except:` or `except Exception:` that swallows the error is a silent-failure finding,
  MAJOR by blast radius. Narrow the exception type; if the error is truly ignorable, say why in
  the `pass` block, not in a review summary.
- Using an exception for normal control flow (a `try` where an `if` states the same check) is
  MINOR.

## Packaging and boundaries

- A new module that invents its own argument parsing, config loading, or logging instead of
  the project's established one is a MAJOR boundary finding — the pattern already exists in the
  repo, and re-implementing it is the duplication this pass exists to name.
