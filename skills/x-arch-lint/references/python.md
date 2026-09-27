# A Declaration for a Python or Go Tree

Nothing in `arch-check.mjs` knows what a language is. A layer is a set of path prefixes, and an import of
that layer is a regular expression matched line by line, so the same declaration shape carries a Python tree
or a Go one. This file is the worked version of that claim, and the Python half of it is the case
"a Python tree, declared with line markers" in `evals/fixtures/arch-cases.json`, so it is checked rather than
asserted.

## Python

```json
{
  "layers": {
    "domain": {
      "roots": ["src/domain"],
      "import_markers": ["^from src\\.domain", "^import src\\.domain"]
    },
    "application": {
      "roots": ["src/application"],
      "import_markers": ["^from src\\.application", "^import src\\.application"]
    }
  },
  "allowed_dependencies": {
    "domain": [],
    "application": ["domain"]
  },
  "naming": [
    { "applies_to": "domain", "must_not_match": "controller", "message": "a controller belongs in the interface layer" }
  ]
}
```

Why the markers look like that:

- **Anchored at the line start.** An import is the first thing on its line in Python, and anchoring keeps a
  marker out of a comment and out of a string that happens to contain the path.
- **Two markers per layer, one per import form.** `from src.domain import pricing` and
  `import src.domain.pricing` are different text, so the layer needs both regexes. A tree that uses relative
  imports (`from ..domain import pricing`) needs a third, and the form is the tree's own: the marker follows
  the code rather than a convention this file prefers.
- **The escape is doubled.** The marker is JSON, so a literal `.` is written `\\.`; the regex the checker
  compiles is then `\.`, which is the point of the escaping.

The failure the fixture pins is the inward-pointing one: `src/domain/pricing.py` opening with
`from src.application import checkout` is reported as `dependency-direction src/domain/pricing.py:1`, because
`domain`'s `allowed_dependencies` is empty. The clean fixture is the mirror image and reports nothing.

Two things this declaration cannot see, both mechanical:

- **A re-export.** `src/domain/__init__.py` holding `from .pricing import total` is invisible to a marker
  written against `src.domain`, so a layer reached only that way is reached silently.
- **An import built at run time.** `importlib.import_module("src." + name)` matches no line-oriented marker in
  any language. `unplaced` is the partial answer: a file no layer claims was never checked for direction.

## Go

Go has no import statement to anchor on in the Python sense, so the marker is the quoted import path:

```json
{
  "layers": {
    "domain": {
      "roots": ["internal/domain"],
      "import_markers": ["\"github.com/acme/app/internal/domain"]
    },
    "application": {
      "roots": ["internal/application"],
      "import_markers": ["\"github.com/acme/app/internal/application"]
    }
  },
  "allowed_dependencies": {
    "domain": [],
    "application": ["domain"]
  }
}
```

The trailing half of the quote is left off on purpose: `"…/internal/domain"` is the import, and
`"…/internal/domainkit"` is a different package that a stricter pattern would have to exclude explicitly. The
same caveat applies here as everywhere else: a declaration records the directions the tree takes, and this
one is a shape to widen by hand rather than a proposal to trust as written.
