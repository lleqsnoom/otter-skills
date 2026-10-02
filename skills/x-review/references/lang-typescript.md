# TypeScript review checklist

Language-specific criteria for the `[PRINCIPLE]` pass. Read this when the change is
TypeScript; each line is a finding class, not an instruction to fix.

## Strictness is the contract

- A `strict`-mode escape (`as any`, `@ts-ignore`, `@ts-expect-error` without the reason, a
  `!` non-null assertion) is a MAJOR finding unless the diff explains why the narrower type
  cannot be written. An escape that silences a real error is CRITICAL.
- `any` leaks: a value typed `any` that crosses a function boundary makes the return type
  untrustworthy. Report the first place the narrow type could have been written.

## Async and errors

- A `Promise` whose rejection is swallowed — a `catch {}`, a missing `await`, a fire-and-forget
  call with no error path — is a silent-failure finding, MAJOR or CRITICAL by blast radius.
- A callback or `.then` chain that drops the error path when an `async/await` spelling would
  carry it is reported with the narrower spelling as the fix.

## Narrowing and state

- A union narrowed by an `if` that later widens again, or a discriminant checked in one branch
  and re-checked in another, is a MAJOR sign the state could be made impossible with two types.
- An optional field that every consumer null-checks belongs on the one type that really
  carries it; report the check and name the narrower type.

## Test layout

- A `.test.ts` beside its module is the convention; a test that asserts the happy path only,
  or mocks away the boundary it claims to cover, is reported under the standing bar, not here.
