# Go review checklist

Language-specific criteria for the `[PRINCIPLE]` pass. Read this when the change is Go;
each line is a finding class, not an instruction to fix.

## Errors are values, and every one is a decision

- An ignored error — `_ =`, a bare `err` shadowed and dropped, a `defer` whose error is never
  checked — is a silent-failure finding, MAJOR by blast radius. An error returned without the
  context that would let a caller act on it (`return err` with no `fmt.Errorf("...: %w", err)`)
  is MINOR.
- An error returned and then also handled by the same function is a SRP finding; the caller
  owns the decision, the function either returns the error or handles it, not both.

## Goroutines leak when nobody can stop them

- A goroutine started without a way to exit — no context, no done channel, a loop that reads a
  channel nobody closes — is a CRITICAL leak. Every goroutine needs a cancellation path named in
  the review.
- A `go func()` that captures a loop variable, or a WaitGroup whose `Done` is easy to miss, is
  MAJOR.

## Interfaces should be small and earned

- An interface with a dozen methods invented for one caller is a speculative abstraction, MAJOR;
  the consumer should define the interface it needs. An interface polluting the package's public
  surface for a single use is the same finding.

## Test layout

- A table test is the convention; a test that only walks the happy path, or a `t.Skip` left in,
  is reported under the standing bar, not here.
