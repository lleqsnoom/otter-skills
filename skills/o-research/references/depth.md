# The depth bar

`ledger.mjs` decides whether a question is answered. These are the rules it applies, and what to do when one blocks.
`ledger.mjs status --dir <dir>` names the exact gap for every open question.

## Source tiers

A source's tier follows from the `--kind` you give it. You never choose the tier yourself.

| Tier | Kinds | What it is |
|------|-------|------------|
| A | `spec`, `paper`, `docs`, `code`, `data`, `experiment` | The source that owns the claim: a standard, a peer-reviewed or preprint paper, the vendor's or project's own documentation, the source code, a dataset, our own measurement |
| B | `survey`, `textbook`, `course`, `talk` | An expert's synthesis: a survey or review paper, a textbook chapter, a university course, a conference talk or course (SIGGRAPH, GDC, USENIX, OWASP) |
| C | `article`, `forum`, `video`, `other` | Everything else: blogs, Stack Overflow, Reddit, tutorials, Medium |

- **`docs` means first-party.** Use it for documentation by the people who make the thing. A third party's
  tutorial is an `article`, even on a polished site. Fix a misfiled source with
  `reclassify --source <S> --kind <kind> --reason <why>`.
- **Tier C never answers alone.** It may add one voice to a question that already has tier A or B behind it. The
  bar counts at most one tier C origin.
- **The field map comes from tier B.** Only topics from surveys, textbooks, courses and talks count toward the
  map's sources (`references/map.md`).

## Independent sources

Sources count by **origin**, meaning who stands behind them, not by page:

- Two pages of NVIDIA's docs are one voice. Two GitHub repositories by different owners are two voices.
- Each arXiv paper and each DOI is its own voice, and an archived page keeps the voice of the page it archives.
- **All of the project's own files are one voice, and all of the run's experiments are one more.** Both are written
  or chosen by the agent. A standard or deep question also needs at least one source from outside the project.
- A file under `.o-skills/` (a run's own notes) is never a source.

`ledger.mjs` derives the origin from the URL. Give `--origin "<who>"` only on a URL source, when two domains share an
author (a vendor's docs and the same vendor's blog) or one domain hosts independent authors. Never use it to make
one author count twice. `ledger.md` marks every origin the agent named, and the reviewer checks them.

## What a question needs

| Depth | Independent sources | Primary (tier A) | From outside the project | Claim kinds | Newest tier A or B source | Quotes that count |
|-------|:---:|:---:|:---:|---|---|---|
| quick | 1 | 0 | — | any | any | any not shown missing |
| standard | 2 | 1 | 1 | `mechanism` | any | any not shown missing; all must be checked |
| deep | 3 | 1 | 1 | `mechanism`, `limit` | within 5 years | only found or confirmed by hand, and at least one found by `check-quotes` |

- **`mechanism`** explains how or why it works, not just that it does. A recommendation without its mechanism
  teaches nothing the user can carry to the next case.
- **`limit`** says when it does *not* apply, what it costs, or where it breaks. A deep answer always has one, and
  most bad advice comes from a technique used outside its limits.
- **`--quantitative`** questions ("how much faster", "how many rows") also need a `number` claim backed by a tier A
  source: a measurement, a paper, a spec or our own experiment. Blog benchmarks are where wrong numbers come from.
- **Recency comes from tier A or B.** A recent blog post does not make an answer current. Dates in the future are
  refused.
- **`--timeless`** exempts a question about a settled result (Hashlife, 1984; B-trees) from the recency rule.
  Never use it for anything that moves: GPU architectures, security advice, library APIs.
- **`--needs <kinds>`** adds claim kinds a question must have, such as `comparison` for an "X or Y" question. It
  never removes the depth's own kinds.
- **A question with sub-questions** is answered when they are. Its own claims are optional.
- **`--recent-years <n>`** on `init` sets the recency window for the whole run, and 0 turns it off. Use a shorter
  window for fast-moving fields.

## Quotes

- **Copy, never paraphrase.** Copy at least five words in a row exactly as the source writes them. Punctuation,
  markup, accents and quote styles are ignored when matching, but the words and their order must match.
- **An ellipsis joins phrases, not words.** `…` may skip words between parts, but every part needs at least three
  words in a row, and the longest needs five.
- **One sentence backs one claim.** The same words from the same source cannot stand behind two claims. Quote the
  sentence that says *this* claim; a mechanism and its limit are rarely in the same sentence.
- **Pick a quote that carries the claim.** A quote that only mentions the topic does not back the claim. The
  reviewer reads quotes against claims.
- **Local files are checked as you write them.** A misquote of a `--path` source or of an experiment's output is
  refused on the spot.
- **URLs are checked by `check-quotes`.** It fetches each cited page once, reading HTML as visible text in the page's
  charset, GitHub file pages as raw files and PDFs through `pdftotext`, and records one result:
  - `found`: the quote is on the page.
  - `missing` or `dead` (404/410): the citation stops counting. Citing the same words again keeps the result.
    Re-cite with the words the source actually uses, or `retract` the claim.
  - `unverifiable`: a 403, a paywall, a page drawn by JavaScript, a PDF without `pdftotext`, or a page that only
    echoes its own URL, such as a search page. Only this result may be confirmed by hand: open the page yourself
    and record `confirm-quote --how "<how you checked it>"`. The report's Evidence section must name every claim
    whose quote rests on a hand check or was never machine-checked.
- **Use `--quote -`** to read the quote from stdin when its words hold shell quotes.

## Disputes

When a source contradicts a claim, `dispute --claim <C> --by <S|C> --note "<what disagrees>"`. The question stays
open until the dispute is resolved:

- **`upheld` or `refuted`, with `--by`.** The source, claim or experiment that settled it. Settle with stronger
  evidence: a newer version of the spec, a primary source over a secondary one, a measurement over an opinion. A
  refuted claim stops counting.
- **`debate`, with a `--note` on why both sides hold.** Experts genuinely disagree, or each side is right in a
  different context (hardware, scale, threat model). The report must cite the claim under "Where experts
  disagree", at any depth.

Look for disputes. A topic with no recorded disagreement was usually not read widely enough.

## Saturation

The run is deep enough when reading more stopped teaching anything. The gate walks back from the newest source and
counts the **authors** whose tier A or B pages, from outside the project, only confirmed what the ledger already
held. Each page was cited on an existing claim (`cite`), and none started a claim, raised a question or topic, or
disputed anything. Five pages of one site are one author. A source cited by nothing was not shown to be read, so it
counts neither way. Tier C sources, the project's files and experiments are skipped. Deep runs need 5 authors and
standard runs 3.

When saturation will not come, the field is bigger than the tree. Add the questions the new sources keep raising,
or park them with a reason.

## Experiments

When a claim is cheap to test, test it. A measurement beats any number of opinions:

- **Shaders:** compile the variants and compare instruction counts or cycle estimates from the vendor's offline
  compiler (Arm's Mali Offline Compiler, AMD's Radeon GPU Analyzer), or time them in a benchmark scene.
- **Databases:** run the policy, query or isolation level against a disposable database in Docker, and attempt the
  attack it should stop.
- **Algorithms:** implement the contenders at small scale and measure them on the same input.

Write the script, then let the ledger run it:

```bash
node <skill>/scripts/ledger.mjs experiment --dir <dir> --path experiments/bench.mjs \
  --command "node experiments/bench.mjs" --title "naive vs Hashlife on a 1024² glider gun"
```

The command runs from the project root. A non-zero exit is refused, because a failed run is not evidence. What it
printed is saved under the run folder with a hash, and an output edited afterwards stops counting. Quote the
printed output in the claim. Never run anything against production data or a system you were not given; an
experiment is local and disposable.

## What no script can check

The ledger closes the gaps a script can see. These it cannot, so the reviewer (`references/review.md`) checks them
by hand:

- **The depth itself.** `quick` is easy to reach, so it is only for one narrow fact.
- **Claim kinds are labels.** Nothing proves a `limit` claim states a limit.
- **The fit between quote and claim.** A quote can be real and still not say what the claim says.
- **Dates are self-reported.** So is an experiment's honesty: a command that only echoes a number is recorded as
  that command, in `ledger.md`.
- **Reviews and hand checks are attested, not proven.** `review --by` and `confirm-quote --how` are the agent's word.
- **Park reasons.** Nothing proves the user ruled a topic out.
- **What was left out.** An agent that stops recording new sources keeps saturation.

`<skill>` in this file is the skill's own folder.
