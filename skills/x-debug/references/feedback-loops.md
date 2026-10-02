# Feedback loops for hard bugs

The loop is the skill: everything downstream — bisection, hypothesis testing, instrumentation — consumes a
signal that goes red on *this* bug. Build it first, spend disproportionate effort on it, and treat it as a
product: once it runs, tighten it.

## Ways to build one, in roughly this order

1. **Failing test** at whatever seam reaches the bug: unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (Playwright / Puppeteer) driving the UI, asserting on DOM, console or network.
5. **Replay a captured trace.** Save a real request, payload or event log to disk; replay it through the code
   path in isolation.
6. **Throwaway harness.** A minimal subset of the system (one service, mocked deps) that exercises the bug path
   with one call.
7. **Property / fuzz loop.** When the bug is "sometimes wrong output", run hundreds of random inputs and look
   for the failure mode.
8. **Bisection harness.** When the bug appeared between two known states, automate "boot at state X, check,
   repeat" so `git bisect run` can drive it.
9. **Differential loop.** Run the same input through old and new versions (or two configs) and diff outputs.
10. **HITL script.** Last resort, when a human must click: structure their clicks into a scripted loop whose
    captured output feeds back to you.

## Tighten the loop

- **Faster:** cache setup, skip unrelated init, narrow the test scope.
- **Sharper:** assert on the specific symptom, not "didn't crash".
- **More deterministic:** pin time, seed the RNG, isolate the filesystem, freeze the network.

A 30-second flaky loop is barely better than none; a 2-second deterministic one is tight.

## Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger many times, parallelise,
add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; a 1% flake is not, so keep
raising the rate until it is.

## When no loop can be built

Stop and say so. List what you tried, then ask for: access to the environment that reproduces it, a redacted
captured artifact (HAR, log dump, core dump, timed screen recording), or permission to add temporary
instrumentation. Never hypothesise without a loop.
