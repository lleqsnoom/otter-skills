# Composition Over Inheritance

Inheritance is the strongest coupling a language offers: the subclass inherits the base's whole interface,
including the parts it does not want, and it is welded to the base's construction order, protected state and
future changes. Use it for what it is good at (a framework's extension point, a closed set of value types) and
compose the rest.

## The table, with the reason

| Signal | What it costs | The move |
|--------|---------------|----------|
| A base class with one subclass | Two files to read for one behaviour, and the base cannot change without auditing a class nobody instantiates | Use the concrete class; if a boundary is wanted, extract a delegate |
| Depth beyond one level | Every level is a decision the reader must hold; overrides at three levels are untraceable | Flatten into small collaborators |
| A subclass overriding a method to do nothing | The base's interface is wider than its use | Delete the method from the base and the override together |
| A subclass reading the base's protected state | The two are one class with a seam in the middle | Pass the state in, or compose an object that owns it |
| Shared behaviour in two siblings | The base accumulates unrelated code for each new sibling | Move the shared piece to a collaborator both hold |
| A `switch` on a type selecting behaviour | Every new case edits a file unrelated to the case | A map from key to strategy; the map is the composition |
| Protected field set by the subclass constructor | Construction order becomes an invariant nobody can see | Constructor injection of the finished value |

## The rule of three

Two call sites may duplicate. The third is when a shared abstraction starts to pay, and until then the
duplication is cheaper than the guess:

- An abstraction extracted from two examples is fitted to those two. The third reveals the real axis of
  variation, and by then the abstraction is in use and hard to reshape.
- Copying twice is honest: it keeps both call sites readable and lets the shared concept emerge from evidence
  rather than from a hunch.
- When the third arrives, extract from all three at once and delete the copies in the same commit.

## Repairing a wrong abstraction

The signal: a shared function grown boolean flags, mode parameters, or conditionals that only one caller needs.
That is a concept fitted to cases it was not built for.

1. **Inline it back into each caller.** Each copy then contains only what that caller actually does.
2. **Delete the parts each caller does not need.** The flags and the branches disappear with them.
3. **Let the duplication stand** until a real shared concept shows up in three places.
4. **Name the price if you keep it anyway**: which second caller pays for the flags, in one sentence.

## Where inheritance is right

- The framework or language requires it (a component base, an exception class, a serialization interface).
- A closed set of value types that will never gain a case outside the module (a small expression tree, a state
  machine's states), sealed and tested.
- A template method whose skeleton is genuinely the same and whose steps genuinely differ, with one level and no
  protected state.

For everything else, prefer a delegate: an object the module holds, exposes through its own narrow interface,
and can swap in a test.

## Worked example

A `BaseRetryPolicy` with one subclass, `ExponentialRetryPolicy`, overridden only for the delay:

```
BaseRetryPolicy        (delay() abstract, attempt() loop)
  └─ ExponentialRetryPolicy  (delay() = 2 ** attempt)
```

Two files, one behaviour, and the loop cannot be tested without a subclass. Composed instead:

```js
const exponential = (base, factor) => ({ delay: (attempt) => base * factor ** attempt });

const withRetry = (policy, run) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return run();
    } catch (error) {
      if (attempt >= policy.attempts) throw error;
      wait(policy.delay(attempt));
    }
  }
};
```

One function owns the loop, one expression owns the delay, and a test substitutes either. The second policy
arrives as another small function rather than as a second subclass and a base-class audit.

## Checklist before adding a subclass

1. What does the subclass inherit that it does not want?
2. Could the caller hold a collaborator instead and get the same reuse?
3. Is this the second case or the third? If the second, wait.
4. If the base changes tomorrow, who has to read this subclass? If the answer is "everybody", compose.
