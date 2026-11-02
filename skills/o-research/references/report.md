# The report that teaches the field

Write the report below the findings marker in `research.md`; every `record` keeps it. The reader is the user, who
may be new to the topic. After reading it they should know the best answer for their situation, why it is the
best, and enough of the field to judge the next claim they meet.

`ledger.mjs check-report --dir <dir>` checks:

- the sections the depth needs, each with real content (a heading with a line under it is not a section);
- every `[C<n>]` names a live claim;
- every in-scope question has a claim cited;
- every open debate is cited under "Where experts disagree", which every depth then needs;
- every input that could not be read is named;
- the Evidence section links `ledger.md` and names every claim whose quote was confirmed by hand or never
  machine-checked.

Comments and code blocks are ignored: a citation hidden in `<!-- -->` does not count.

## Sections

Use these headings (`##`, numbering allowed). `quick` needs only **Answer** and **Evidence**. `standard` drops
**Next steps** and **Reading path**. Both skip **Where experts disagree** unless the ledger records a debate.

1. **Answer.** The best current answer *for the user's context*, in a short paragraph, and how sure it is
   (settled, well supported, contested). Give the recommendation first and the reasons after.
2. **Glossary.** The 10–20 terms the rest of the report uses, each in one plain sentence. The reader has met none
   of them, so define each one before using it.
3. **Map of the field.** The families of approaches and how they relate, drawn from the field map: what each
   family is for, and what it is not for. A small table or a short list per family.
4. **Decision guide.** A table, one row per option: when to use it, what it gains (with numbers where they exist),
   what it costs, its pitfalls, and its claims. This is the part the user will act on.
5. **Where experts disagree.** Each open debate: both sides, who holds each, and the context in which each is
   right. Never paper over a disagreement.
6. **Next steps.** What to do first in the user's project, in order, with how to tell it worked. Include the
   experiment worth running when a number matters.
7. **Reading path.** 5–10 sources ordered from first to read to advanced, each with one line on what it teaches.
   Prefer the sources the ledger rated tier A or B.
8. **Open questions.** What the run could not settle, and what would settle each: a source, an experiment, or a
   decision the user must make.
9. **Evidence.** Link [the ledger](ledger.md), and give the number of sources by tier. List the inputs that were
   not read and why, quotes that could not be machine-checked, and who reviewed it.

## Writing rules

- **Cite claims, not vibes.** Back every factual sentence with the claim it rests on: `Half precision cut the
  shader's register count from 32 to 18 in our test [C14]`. A sentence with no claim is your own reasoning; say
  so ("this suggests…"). A citation is a bracket holding only claim ids, `[C14]` or `[C3, C7]`, so a bracket with
  other words in it, such as `[C11 §6.5]`, is safe for anything else.
- **Lead with what matters for the user.** Context-free trivia goes, however interesting.
- **Numbers keep their conditions.** "2.1× faster on a Mali-G78 at 1080p [C22]", not "2× faster".
- **Say how sure you are,** and why: the number of independent sources, whether a primary source or our own
  experiment backs it, whether experts dispute it.
- **Plain words.** Run `o-humanize` on the Answer and the Glossary (B2 reading level); keep the terms the glossary
  defines.
- **No new facts at writing time.** A fact that is not in the ledger goes into the ledger first, with its quote.
