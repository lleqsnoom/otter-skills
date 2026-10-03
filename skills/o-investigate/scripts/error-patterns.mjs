/**
 * Error patterns shared by o-debug and o-investigate. The file is kept byte-identical in both skills —
 * o-skill-lint's copy-drift rule fails the build when the copies differ — so a runtime's new wording is taught to
 * both at once. Each runtime words the same fault its own way, and V8 changed its wording in Node 16.9
 * ("Cannot read properties of undefined (reading 'x')"), so every reading a current runtime prints is listed.
 *
 * `test` says how to tell the hypothesis apart from the others — never how to silence the error.
 */

export const ERROR_PATTERNS = [
  {
    category: "undefined-reference",
    likelihood: "high",
    pattern: /Cannot (read|set) propert(ies|y) .*\bundefined\b/,
    description: "A property is read or set on a value that is undefined",
    test: "Log or assert the value just before the failing access, then trace where it should have been set: a missing return, an unawaited promise, a wrong key",
  },
  {
    category: "null-reference",
    likelihood: "high",
    pattern: /Cannot (read|set) propert(ies|y) .*\bnull\b|'NoneType' object has no attribute|nil pointer dereference|called `Option::unwrap\(\)` on a `None` value|NullPointerException/,
    description: "A value that can be null or empty is used as if it were present",
    test: "Find which input produces the null (a missing row, an empty lookup, a failed parse) and reproduce with exactly that input",
  },
  {
    category: "not-a-function",
    likelihood: "high",
    pattern: /is not a function|object is not callable/,
    description: "A value that is not callable is called",
    test: "Print the type of the value at the call site; check the import or export shape (default vs named, CommonJS vs ESM)",
  },
  {
    category: "infinite-recursion",
    likelihood: "medium",
    pattern: /Maximum call stack size exceeded|RecursionError|stack overflow/,
    description: "A recursion has no reachable base case",
    test: "Count the depth on a small input and check whether the base case is reachable for it",
  },
  {
    category: "syntax-error",
    likelihood: "high",
    pattern: /Unexpected token|SyntaxError/,
    description: "Malformed source, or input parsed as JSON that is not JSON",
    test: "Run the language's syntax check on the file named in the trace, or print the raw input handed to the parser",
  },
  {
    category: "missing-module",
    likelihood: "high",
    pattern: /Module not found|Cannot find module|ModuleNotFoundError|ERR_MODULE_NOT_FOUND/,
    description: "A module is missing, misnamed, or resolved from the wrong place",
    test: "Resolve the module from the failing file's directory (`node -p \"require.resolve('<name>')\"`, `python -c 'import <name>'`) and compare with the lockfile",
  },
  {
    category: "connection-error",
    likelihood: "medium",
    pattern: /ECONNREFUSED|Connection refused/,
    description: "The target service is not listening where the code expects it",
    test: "Check the host and port the code actually uses (config and environment), then whether anything listens there",
  },
];

/** The patterns an error text matches, most likely first. */
export function matchErrors(text) {
  const rank = { high: 0, medium: 1, low: 2 };
  return ERROR_PATTERNS.filter((entry) => entry.pattern.test(String(text ?? "")))
    .sort((a, b) => rank[a.likelihood] - rank[b.likelihood])
    .map(({ category, likelihood, description, test }) => ({ category, likelihood, description, test }));
}
