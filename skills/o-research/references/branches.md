# Branch researchers

A deep run reads more than one context window holds. Give each open branch of the question tree its own researcher
with a fresh context. The researchers write to the same ledger, which is safe from parallel writers. The main agent
keeps only the conclusions, records each round with `state.mjs`, and writes the report.

## Rules for the main agent

- **One researcher per branch,** started in parallel in one message. A branch is a question and its sub-questions,
  sized so one researcher can read 5–15 sources for it.
- **The researcher does the work itself.** Start it as an agent type that cannot spawn agents when the host offers
  one, and keep the "do not start agents" line in the brief either way. A researcher that delegates again repeats
  the run inside itself, and the cost multiplies without anyone seeing it.
- **Hand over pointers, not text.** Give the run folder, the question ids, the user's context in two lines and
  the depth. The researcher reads the rest from the ledger.
- **After the branches return:** run `check-quotes`, read `status`, settle or record disputes across branches, then
  `score | record`. Only the main agent runs `state.mjs`.
- **On a host without subagents,** work the branches yourself, one per round, with the same brief as your checklist.

## The brief

Copy this, and fill in the angle brackets:

```text
You are a branch researcher for an o-research run. Do the reading yourself: do not start agents or subagents.

Run folder: <dir>
Ledger tool: node <skill>/scripts/ledger.mjs <command> --dir <dir> --agent <branch name> ...  (--help lists commands)
Your questions: <Q ids with their text>
The user's context: <goal, platform, constraints, in two lines>
Depth: <deep|standard>. `ledger.mjs status --dir <dir>` shows what each of your questions still lacks.

How to work:
1. Read sources in full, never only search snippets or abstracts. Prefer the source that owns each claim: the
   spec, the paper, the vendor's docs, the source code. Follow a secondary source to its primary one.
2. Record every source you open: `source --url <u> --kind <kind> --title <t> --date <YYYY[-MM]>`. The kind sets
   the tier: spec, paper, docs (first-party only), code, data, experiment = A; survey, textbook, course, talk = B;
   article, forum, video, other = C.
3. Record what each source says about your questions as claims, quoting it word for word: at least five words
   in a row, copied, never paraphrased, and each sentence backs one claim only.
   `claim --question <Q> --kind mechanism|limit|number|definition|comparison|recommendation|history|other
   --text "<the claim in your words>" --source <S> --quote "<exact words>"`.
   A source that backs an existing claim: `cite --claim <C> --source <S> --quote "<exact words>"`.
4. Per question, cover how and why it works (mechanism), when it does not apply or what it costs (limit), and
   numbers backed by a tier A source when the question is quantitative. Find sources from different authors.
5. When a source contradicts a claim: `dispute --claim <C> --by <S> --note "<what disagrees>"`. If stronger
   evidence settles it, `resolve --outcome upheld|refuted --by <S> --note <why>`. If experts genuinely disagree,
   `resolve --outcome debate --note "<why both hold>"`.
6. When reading raises a question your branch needs, add it: `question --from <S> --parent <Q> --text <t>`.
   Outside your branch: add it and say so in your reply.
7. When a claim is cheap to test locally, write the script under <dir>/experiments/ and run it through the
   ledger: `experiment --path <script> --command "<cmd>" --title <t>`, then quote what it printed. Never touch
   production data or systems you were not given.
8. Stop when `status` shows your questions clear the bar and your last few sources added nothing new, or when you
   have read <15> sources.

Reply in under 15 lines: the claim ids you added, the disputes you found, the questions you added, and what is
still open with what would settle it. Do not paste source text into the reply; it is in the ledger.
```

`<skill>` in this file is the skill's own folder.
