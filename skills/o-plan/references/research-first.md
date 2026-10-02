# Research before the first question

Never ask the user something you can find yourself. Spend the first pass of every run finding it.

## Order

1. **The index.** Search every indexed repository at once with `o-search` (`~/.agents/skills/o-search/SKILL.md`
   for a global install, `.agents/skills/o-search/SKILL.md` for a local one): by meaning when you know the
   behaviour but not the file that owns it, by exact identifier when you already have the symbol. It is the
   fastest way to find the file a question lives in, and it spans repositories a local grep cannot reach.
2. **The project.** Read the files, symbols, tests, and git history that touch the problem. Cite the
   exact location (`path/to/file.js:42`).
3. **The web.** Fetch official docs and prior art. Cite the URL. Prefer primary sources.
4. **For code tasks, GitHub.** Use the GitHub tools to search for reference repositories and real
   implementations of the same pattern; cite the repo and file.
5. **Record it.** Write each finding as a bullet in `memory.md` with its `file:line` or URL.
6. **Then ask.** Turn only the still-open items into panels (`references/questions.md`).

## Propose three solutions

Before you ask the user to choose, propose **three** distinct solutions (not three phrasings of one).
Record each with `--event option`, each with its trade-off. Then ask which one to take with a `single` panel.

## When a capability is missing

If the host has no shell, no web, or no GitHub access, do not guess:

- write a `memory.md` line saying which capability was missing (`not run (no web access)`),
- when it is the index that is unreachable, say so and fall back to reading the project directly: `o-search`
  is a faster way to the same answer, not the answer itself,
- lower confidence and say so,
- ask the user for the missing fact instead of inventing it.
