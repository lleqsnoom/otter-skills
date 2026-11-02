# Frame the goal, then map the field

A user new to a topic cannot list the right questions. Their first list misses what experts consider basic, and
it asks about the parts that happen to have names they know. So the run asks the user only what they know (their
goal), and lets the field supply its own structure.

## Frame: ask about the user, not the domain

Ask in panel rounds (`references/questions.md`), with a recommended answer on each question. Good framing
questions:

- **What is the answer for?** To decide between options, to implement something, to learn the field, or to
  review someone's work.
- **What is the context?** The platform, engine, language, scale, hardware, team and deadline. ("Godot 4 Mobile
  renderer, mid-range Android", "Postgres 16, multi-tenant SaaS, 50 tenants".)
- **What does good look like?** Faster by how much, secure against whom, simple enough for whom.
- **What is already known or tried?** This spares the run the parts the user has done.
- **Which depth?** `deep` unless the question is one narrow fact.

Never ask the user to judge the domain ("should we look at occupancy?"). If they could answer that, they would not
need the research.

## Map: read the field's own structure first

Before choosing questions, read the sources where experts lay out the whole topic:

1. **Surveys and review papers.** Search for "survey", "review", "state of the art", "a taxonomy of",
   "systematic review", plus the topic, on Google Scholar, Semantic Scholar and arXiv. Their section headings are a
   map the field agreed on.
2. **Textbooks and courses.** Use a textbook's table of contents and a university course syllabus (search
   `site:edu` with "syllabus" or "lecture notes"). They show the order in which the topic is taught, and so what
   rests on what.
3. **Canonical talks and courses** by practitioners: SIGGRAPH courses, GDC talks, vendor optimization guides,
   OWASP cheat sheets, conference keynotes. They show what people actually do, which papers often do not.
4. **Official docs' tables of contents** for the platform in the user's context.
5. **Reference implementations.** Search GitHub for the most-used implementations of the technique and read how
   they are structured.

For a deep run, draw the map from **at least two** surveys, textbooks, courses or talks by different authors,
from different angles, such as a review paper and a practitioner's course. Only those tier B sources count toward
the map's sources; official docs' tables of contents may add topics but do not count. Where the sources disagree on
what matters, that disagreement is the first finding.

## Go deeper than search results

- **Backward snowballing:** read the references of the strongest survey or paper, and follow the ones cited for
  claims that matter.
- **Forward snowballing:** find who cited a key paper since it came out. Use the Semantic Scholar API
  (`https://api.semanticscholar.org/graph/v1/paper/arXiv:<id>/citations?fields=title,year,url`) or OpenAlex
  (`https://api.openalex.org/works?filter=cites:<W id>`). Newer work that cites an old result often corrects or
  supersedes it.
- **Search the critiques:** "<technique> pitfalls", "<technique> considered harmful", "<technique> vs",
  "<technique> myth", "<technique> benchmark". They point to limits and disputes.
- **Find the people:** the authors and groups whose names recur. Their newest work is often ahead of the surveys.
- **Read the primary source** behind every secondary claim that matters (rule 3 of SKILL.md).

## Record the map

```bash
node <skill>/scripts/ledger.mjs source --dir <dir> --url <survey URL> --kind survey --title "<title>" --date <YYYY>
node <skill>/scripts/ledger.mjs topic --dir <dir> --text "Register pressure and occupancy" --from S1
node <skill>/scripts/ledger.mjs question --dir <dir> --topic T1 --text "When does register pressure limit a fragment shader, and how is it measured?"
node <skill>/scripts/ledger.mjs park --dir <dir> --topic T7 --reason "ray tracing: the user targets mobile GPUs without it"
```

Every topic must be asked as a question or parked with a reason. That is the run's defence against the expert's
"you missed X". A question covers at most two topics, and only topics asked by an in-scope question count toward
the map, so parking cannot stand in for asking. Write questions an expert would ask: about mechanisms, trade-offs, limits and measurements, not
just definitions. Use `--parent` to nest sub-questions. Mark `--quantitative` any question whose answer is a
number.

Then show the user the tree in plain words, in one panel round (a `multi` panel of branches, with your
recommendation), so they can choose which branches matter for their goal. Park the rest with the user's reason.

Questions keep growing after the map. Every source can raise one (`question --from S<n>`), and so can the reviewer
(`--from review`). A tree that never grew after the map was usually not read closely.

`<skill>` in this file is the skill's own folder.
