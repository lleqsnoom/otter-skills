# Rust review checklist

Language-specific criteria for the `[PRINCIPLE]` pass. Read this when the change is Rust;
each line is a finding class, not an instruction to fix.

## Panics are control flow with a cost

- An `unwrap()` or `expect()` on a value that can fail in production is MAJOR; a panic in a
  public function where the caller could return a `Result` is CRITICAL. An `unwrap()` on an
  invariant that is genuinely impossible is fine, and says so in a comment naming the invariant.
- An `expect("should not happen")` without the invariant that makes it impossible is a MAJOR
  sign the state could be narrowed into the type system instead.

## `unsafe` is a boundary, not a feature

- An `unsafe` block without a `// SAFETY:` comment naming the invariant it relies on is CRITICAL.
  An `unsafe` block wider than the invariant it needs is MAJOR; the safe wrapper should be as
  small as the invariant.

## Traits and ownership

- A trait object introduced to dodge a lifetime the design should express, or a `Box<dyn …>`
  where a generic would carry the type, is a MAJOR design finding.
- A clone that copies a large structure to satisfy the borrow checker, where a borrow would do,
  is MINOR; a clone that hides a shared-state bug is MAJOR.

## Clippy and test layout

- A `#[allow(clippy::…)]` without a reason is MINOR; one that silences a lint the code should
  fix is MAJOR. The `#[cfg(test)]` module beside the source is the convention; a test that only
  walks the happy path is reported under the standing bar, not here.
