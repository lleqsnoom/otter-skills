"use strict";

/**
 * o-research stopped a run the moment every question had one link, logged a second source on an answered question as
 * a revert, froze its questions at start and took any URL as proof. The ledger scores what a deep run needs instead:
 * independent sources, a primary one, how it works and where it fails, quotes found on their pages, disputes settled,
 * a field map covered, a reviewer, and a report that teaches it; state.mjs records that score unchanged.
 *
 * A first review of the ledger then reached a deep score of 1 with no web source, with made-up quotes, with one
 * question covering the whole map and with five copies of one page as saturation; each of those has a test here.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const SCRIPTS = path.join(__dirname, "..", "skills", "o-research", "scripts");
const LEDGER = path.join(SCRIPTS, "ledger.mjs");
const STATE = path.join(SCRIPTS, "state.mjs");
const YEAR = new Date().getUTCFullYear();
const QUOTE = "the quick brown fox jumps over the lazy dog";
const OTHER = "a second sentence that this page also carries in full";
const FILLER = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");

let server;
let base;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/q/")) return res.end(`<html><body><p>${QUOTE}.</p><p>${OTHER}.</p> ${FILLER}</body></html>`);
    if (url.pathname === "/good") return res.end(`<html><body><p>The <em>quick</em> brown&nbsp;fox &mdash; jumps over the <b>lazy</b> dog.</p><script>var no = "${OTHER}";</script> ${FILLER}</body></html>`);
    if (url.pathname === "/accents") return res.end(`<html><body><p>Poincar&eacute; wrote about inter&shy;national recurrence in dynamical systems.</p> ${FILLER}</body></html>`);
    if (url.pathname === "/script-only") return res.end(`<html><body><script>document.write("${QUOTE}")</script></body></html>`);
    if (url.pathname === "/search") return res.end(`<html><body><h1>Results for ${url.searchParams.get("q")}</h1> ${FILLER}</body></html>`);
    if (url.pathname === "/forbidden") {
      res.statusCode = 403;
      return res.end("no");
    }
    if (url.pathname === "/gone") {
      res.statusCode = 404;
      return res.end("not found");
    }
    res.end(`<html><body><p>${FILLER}</p></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function exec(script, cwd, args, input) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", input });
}

function ok(script, cwd, args, input) {
  const out = exec(script, cwd, args, input);
  assert.equal(out.status, 0, out.stderr || out.stdout);
  return out.stdout.trim().startsWith("{") ? JSON.parse(out.stdout) : out.stdout;
}

/** check-quotes fetches from this process's server, so it runs without blocking the event loop. */
function checkQuotesIn(repo, dir, extra = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [LEDGER, "check-quotes", "--dir", dir, ...extra], { cwd: repo });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("close", (status) => resolve({ status, result: JSON.parse(stdout) }));
  });
}

/** A git repository with a started research run, and a ledger at `depth` inside the run folder. */
function newRun(depth = "deep") {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "oresearch-ledger-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const { dir } = ok(STATE, repo, ["start", "--slug", "topic", "--metric", "research_depth", "--evaluator", "ledger.mjs score", "--policy", "pass_only", "--target", "1", "--cap", "6"]);
  ok(LEDGER, repo, ["init", "--dir", dir, "--depth", depth]);
  const led = (...args) => ok(LEDGER, repo, [args[0], "--dir", dir, ...args.slice(1)]);
  const fail = (...args) => {
    const out = exec(LEDGER, repo, [args[0], "--dir", dir, ...args.slice(1)]);
    assert.notEqual(out.status, 0, `expected ${args[0]} to be refused`);
    return JSON.parse(out.stderr).error;
  };
  const score = () => led("score");
  const gate = (name) => score().gates.find((g) => g.name === name);
  const open = (id) => score().open.find((question) => question.id === id)?.gaps ?? [];
  return { repo, dir, led, fail, score, gate, open, checkQuotes: (extra) => checkQuotesIn(repo, dir, extra) };
}

/** A page on the test server that carries QUOTE and OTHER, under an author of its own. */
const src = (run, name, kind, date = String(YEAR)) => run.led("source", "--url", `${base}/q/${name}`, "--kind", kind, "--title", name, "--date", date, "--origin", name).id;

/** The agent's report, written below the findings marker state.mjs keeps. */
function writeReport(run, body) {
  const file = path.join(run.dir, "research.md");
  const text = fs.readFileSync(file, "utf8");
  const head = text.slice(0, text.indexOf("## Findings\n") + "## Findings\n".length);
  fs.writeFileSync(file, `${head}\n${body}\n`);
}

const PROSE = "This section says enough for the reader to act on it and to know why.";
const problemsOf = (run) => JSON.parse(exec(LEDGER, run.repo, ["check-report", "--dir", run.dir]).stdout).problems;

describe("ledger sources", () => {
  it("takes the tier from the kind and keeps one source per page", () => {
    const run = newRun();
    const first = run.led("source", "--url", "https://docs.example.com/guide/", "--kind", "docs", "--title", "Guide");
    assert.deepEqual([first.tier, first.existing], ["A", false]);
    for (const variant of ["http://www.docs.example.com/guide?utm_source=x#part", "https://docs.example.com/guide"]) {
      assert.equal(run.led("source", "--url", variant, "--kind", "article", "--title", "Guide").id, first.id, variant);
    }
    const paper = run.led("source", "--url", "https://arxiv.org/abs/2101.00001v1", "--kind", "paper", "--title", "p").id;
    assert.equal(run.led("source", "--url", "https://arxiv.org/pdf/2101.00001v2.pdf", "--kind", "paper", "--title", "p").id, paper, "an arXiv paper's abstract, PDF and versions are one source");
    assert.equal(run.led("source", "--url", "https://blog.example.org/post", "--kind", "article", "--title", "Post").tier, "C");
    assert.match(run.fail("source", "--url", "https://x.example.com/e", "--kind", "experiment", "--title", "e"), /experiment --command/);
  });

  it("counts one voice per author, not per page", () => {
    const run = newRun();
    const origin = (url) => run.led("source", "--url", url, "--kind", "docs", "--title", url).origin;
    assert.equal(origin("https://developer.vendor.com/a"), origin("https://vendor.com/b"), "two pages of one vendor");
    assert.equal(origin("https://docs.fly.io/a"), origin("https://community.fly.io/b"), "a short name under a country-code TLD");
    assert.equal(origin("https://www.bbc.co.uk/a"), "bbc.co.uk");
    assert.notEqual(origin("https://github.com/alice/lib/blob/main/x.c"), origin("https://github.com/bob/lib/blob/main/y.c"), "two GitHub owners");
    assert.equal(origin("https://arxiv.org/abs/hep-th/9901001"), "arxiv:hep-th/9901001");
    assert.equal(origin("https://arxiv.org/pdf/hep-th/9901002"), "arxiv:hep-th/9901002");
    assert.notEqual(origin("https://doi.org/10.1000/one"), origin("https://doi.org/10.1000/two"), "each DOI is its own work");
    assert.equal(origin("https://web.archive.org/web/2020/https://vendor.com/old"), "vendor.com", "an archived page keeps its author");
  });

  it("refuses a local source that is not there, a run's own notes, and a misquote of a file that is there", () => {
    const run = newRun();
    assert.match(run.fail("source", "--path", "nope.md", "--kind", "docs", "--title", "n"), /not found/);
    fs.writeFileSync(path.join(run.dir, "notes.md"), `${QUOTE}\n`);
    assert.match(run.fail("source", "--path", path.join(run.dir, "notes.md"), "--kind", "docs", "--title", "n"), /inside \.o-skills/);
    fs.writeFileSync(path.join(run.repo, "notes.md"), `intro\n${QUOTE}\n`);
    assert.match(run.fail("source", "--path", "notes.md", "--kind", "docs", "--title", "n", "--origin", "Khronos"), /one voice/);
    const s = run.led("source", "--path", "notes.md", "--kind", "docs", "--title", "notes").id;
    const q = run.led("question", "--text", "what jumps", "--from", "user").id;
    assert.match(run.fail("claim", "--question", q, "--kind", "definition", "--text", "t", "--source", s, "--quote", "a slow red fox walks under a busy cat"), /not in notes.md/);
    assert.match(run.fail("claim", "--question", q, "--kind", "definition", "--text", "t", "--source", s, "--quote", "the fox"), /at least 5 words/);
    run.led("claim", "--question", q, "--kind", "definition", "--text", "t", "--source", s, "--quote", "Quick brown fox — jumps over the lazy");
  });

  it("refuses quotes stitched from single words, and one sentence behind two claims", () => {
    const run = newRun();
    const q = run.led("question", "--text", "q", "--from", "user").id;
    const s = src(run, "a", "docs");
    assert.match(run.fail("claim", "--question", q, "--kind", "mechanism", "--text", "x", "--source", s, "--quote", "the … of … and … to … a"), /at least 5 words in a row/);
    assert.match(run.fail("claim", "--question", q, "--kind", "mechanism", "--text", "x", "--source", s, "--quote", "the quick brown fox jumps … a"), /at least 3 words/);
    run.led("claim", "--question", q, "--kind", "mechanism", "--text", "how", "--source", s, "--quote", QUOTE);
    assert.match(run.fail("claim", "--question", q, "--kind", "limit", "--text", "where not", "--source", s, "--quote", QUOTE), /already rests on these words/);
    run.led("claim", "--question", q, "--kind", "limit", "--text", "where not", "--source", s, "--quote", OTHER);
  });

  it("demotes a misfiled source in place, and the question loses what it lent", () => {
    const run = newRun("quick");
    const q = run.led("question", "--text", "q", "--from", "user").id;
    const tutorial = run.led("source", "--url", "https://tutorials.example.com/x", "--kind", "docs", "--title", "x").id;
    run.led("claim", "--question", q, "--kind", "other", "--text", "x", "--source", tutorial, "--quote", QUOTE);
    assert.deepEqual(run.open(q), []);
    assert.equal(run.led("reclassify", "--source", tutorial, "--kind", "article", "--reason", "a third-party tutorial").tier, "C");
    assert.ok(run.open(q).some((gap) => /never answers a question alone/.test(gap)));
    assert.match(run.fail("reclassify", "--source", tutorial, "--kind", "experiment", "--reason", "r"), /experiment command/);
    run.led("render");
    assert.match(fs.readFileSync(path.join(run.dir, "ledger.md"), "utf8"), /reclassified: a third-party tutorial/);
  });
});

describe("the depth bar", () => {
  async function answeredDeep(run) {
    const q = run.led("question", "--text", "how does it work", "--from", "user").id;
    const spec = src(run, "spec-one", "spec");
    const paper = src(run, "paper-two", "paper");
    const book = src(run, "book-three", "textbook");
    const how = run.led("claim", "--question", q, "--kind", "mechanism", "--text", "how", "--source", spec, "--quote", QUOTE).id;
    run.led("cite", "--claim", how, "--source", paper, "--quote", QUOTE);
    run.led("claim", "--question", q, "--kind", "limit", "--text", "where not", "--source", book, "--quote", OTHER);
    await run.checkQuotes();
    return q;
  }

  it("answers a deep question only with three independent sources, a primary one, how it works and where it fails", () => {
    const run = newRun();
    const q = run.led("question", "--text", "how does it work", "--from", "user").id;
    run.led("claim", "--question", q, "--kind", "mechanism", "--text", "how", "--source", src(run, "one", "spec"), "--quote", QUOTE);
    const gaps = run.open(q);
    for (const expected of ["1 citations wait for check-quotes or confirm-quote before they count", "0/3 independent sources", "no limit claim"]) {
      assert.ok(gaps.includes(expected), `${expected} — got ${gaps.join("; ")}`);
    }
  });

  it("clears the bar when every part of it is there and every quote was found", async () => {
    const run = newRun();
    const q = await answeredDeep(run);
    assert.deepEqual(run.open(q), []);
    assert.equal(run.score().answered, 1);
  });

  it("counts a quote on a page nobody could read only once confirmed by hand, and never on that alone", async () => {
    const run = newRun();
    const q = await answeredDeep(run);
    const locked = run.led("source", "--url", `${base}/forbidden`, "--kind", "paper", "--title", "locked", "--date", String(YEAR), "--origin", "locked").id;
    const claim = run.led("claim", "--question", q, "--kind", "comparison", "--text", "c", "--source", locked, "--quote", "a sentence behind a paywall nobody can fetch").id;
    assert.match(run.fail("confirm-quote", "--claim", claim, "--source", locked, "--how", "trust me"), /run check-quotes first/);
    assert.equal((await run.checkQuotes()).result.unverifiable, 1);
    assert.ok(run.open(q).some((gap) => /wait for check-quotes or confirm-quote/.test(gap)));
    run.led("confirm-quote", "--claim", claim, "--source", locked, "--how", "read it through the library proxy");
    assert.deepEqual(run.open(q), []);
    const handOnly = run.led("question", "--text", "only by hand", "--from", "user").id;
    const second = run.led("claim", "--question", handOnly, "--kind", "other", "--text", "x", "--source", locked, "--quote", "another sentence behind that same paywall").id;
    await run.checkQuotes();
    run.led("confirm-quote", "--claim", second, "--source", locked, "--how", "proxy");
    assert.ok(run.open(handOnly).some((gap) => /a hand confirmation alone does not anchor it/.test(gap)));
  });

  it("counts the project's own files and the run's own experiments as one voice each, and wants a source from outside", () => {
    const run = newRun("standard");
    const q = run.led("question", "--text", "is it faster", "--from", "user").id;
    fs.writeFileSync(path.join(run.repo, "a.md"), `${QUOTE}\n`);
    fs.writeFileSync(path.join(run.repo, "b.md"), `${OTHER}\n`);
    const a = run.led("source", "--path", "a.md", "--kind", "spec", "--title", "a").id;
    const b = run.led("source", "--path", "b.md", "--kind", "docs", "--title", "b").id;
    run.led("claim", "--question", q, "--kind", "mechanism", "--text", "x", "--source", a, "--quote", QUOTE);
    run.led("claim", "--question", q, "--kind", "other", "--text", "y", "--source", b, "--quote", OTHER);
    for (const n of [1, 2]) {
      const e = run.led("experiment", "--command", `node -e "console.log('run ${n} took 12ms on the same pattern')"`, "--title", `bench ${n}`).id;
      run.led("claim", "--question", q, "--kind", "number", "--text", `${n}`, "--source", e, "--quote", `run ${n} took 12ms on the same pattern`);
    }
    const verdict = run.score();
    const gaps = run.open(q);
    assert.ok(!gaps.some((gap) => /independent/.test(gap)), "four local sources are two voices, which a standard question needs");
    assert.ok(gaps.some((gap) => /no source from outside the project/.test(gap)), gaps.join("; "));
    assert.equal(verdict.answered, 0);
  });

  it("runs an experiment itself, refuses a failed one, and stops counting an output edited afterwards", async () => {
    const run = newRun("quick");
    const q = run.led("question", "--text", "how much faster", "--from", "user", "--quantitative").id;
    run.led("claim", "--question", q, "--kind", "number", "--text", "2x", "--source", src(run, "talk", "talk"), "--quote", QUOTE);
    assert.ok(run.open(q).some((gap) => /no number backed by a tier A source/.test(gap)));
    assert.match(run.fail("experiment", "--command", 'node -e "process.exit(3)"', "--title", "broken"), /exited 3/);
    const bench = run.led("experiment", "--command", "node -e \"console.log('naive 120ms hashlife 9ms on the same pattern')\"", "--title", "bench");
    run.led("claim", "--question", q, "--kind", "number", "--text", "13x", "--source", bench.id, "--quote", "naive 120ms hashlife 9ms on");
    assert.deepEqual(run.open(q), []);
    fs.appendFileSync(bench.output, "edited by hand\n");
    assert.equal((await run.checkQuotes(["--all"])).status, 1);
    assert.ok(run.open(q).some((gap) => /no number backed by a tier A source/.test(gap)));
  });

  it("wants a recent tier A or B source in deep mode unless the question is about a settled result", async () => {
    const run = newRun();
    const q = run.led("question", "--text", "classic result", "--from", "user").id;
    const old = src(run, "old", "paper", "1984");
    run.led("claim", "--question", q, "--kind", "mechanism", "--text", "m", "--source", old, "--quote", QUOTE);
    run.led("claim", "--question", q, "--kind", "other", "--text", "b", "--source", src(run, "fresh-blog", "article"), "--quote", QUOTE);
    assert.match(run.fail("source", "--url", "https://future.example.com/x", "--kind", "article", "--title", "f", "--date", "2099"), /in the future/);
    await run.checkQuotes();
    assert.ok(run.open(q).some((gap) => /newest tier A or B source is from 1984/.test(gap)), "a recent blog does not make the answer recent");
    const timeless = run.led("question", "--text", "classic result again", "--from", "user", "--timeless").id;
    run.led("claim", "--question", timeless, "--kind", "mechanism", "--text", "m", "--source", old, "--quote", OTHER);
    await run.checkQuotes();
    assert.ok(!run.open(timeless).some((gap) => /newest/.test(gap)));
  });

  it("never lets an article or a forum post answer alone", () => {
    const run = newRun("quick");
    const q = run.led("question", "--text", "is it fast", "--from", "user").id;
    run.led("claim", "--question", q, "--kind", "other", "--text", "it is", "--source", src(run, "blog", "article"), "--quote", QUOTE);
    assert.ok(run.open(q).some((gap) => /never answers a question alone/.test(gap)));
  });

  it("answers a question with sub-questions through them", () => {
    const run = newRun("quick");
    const parent = run.led("question", "--text", "overview", "--from", "user").id;
    const child = run.led("question", "--text", "detail", "--from", "user", "--parent", parent).id;
    assert.deepEqual(run.open(parent), [`waits on ${child}`]);
    run.led("claim", "--question", child, "--kind", "other", "--text", "d", "--source", src(run, "docs", "docs"), "--quote", QUOTE);
    assert.deepEqual(run.open(parent), []);
  });
});

describe("disputes", () => {
  it("blocks the question until the dispute is settled with evidence or reported as a debate", () => {
    const run = newRun("quick");
    const q = run.led("question", "--text", "which is right", "--from", "user").id;
    const a = src(run, "a", "docs");
    const b = src(run, "b", "paper");
    const claim = run.led("claim", "--question", q, "--kind", "other", "--text", "x", "--source", a, "--quote", QUOTE).id;
    run.led("dispute", "--claim", claim, "--by", b, "--note", "b measures the opposite");
    assert.ok(run.open(q).includes(`open dispute on ${claim}`));
    assert.match(run.fail("resolve", "--claim", claim, "--outcome", "upheld", "--note", "a is right"), /needs --by/);
    run.led("resolve", "--claim", claim, "--outcome", "debate", "--note", "both hold on different hardware");
    assert.deepEqual(run.open(q), []);
  });

  it("drops a refuted claim from what the question rests on", () => {
    const run = newRun("quick");
    const q = run.led("question", "--text", "q", "--from", "user").id;
    const a = src(run, "a", "docs");
    const b = src(run, "b", "paper");
    const claim = run.led("claim", "--question", q, "--kind", "other", "--text", "x", "--source", a, "--quote", QUOTE).id;
    run.led("dispute", "--claim", claim, "--by", b, "--note", "no");
    run.led("resolve", "--claim", claim, "--outcome", "refuted", "--note", "b is the spec", "--by", b);
    assert.ok(run.open(q).some((gap) => /0\/1 independent/.test(gap)));
  });
});

describe("saturation", () => {
  it("counts the authors among the newest strong sources that only confirmed what the ledger held", () => {
    const run = newRun("standard");
    const q = run.led("question", "--text", "q", "--from", "user").id;
    const claim = run.led("claim", "--question", q, "--kind", "mechanism", "--text", "x", "--source", src(run, "first", "docs"), "--quote", QUOTE).id;
    assert.equal(run.gate("saturation").pass, false);
    for (const v of [1, 2, 3, 4, 5]) run.led("cite", "--claim", claim, "--source", run.led("source", "--url", `https://same.example.org/page?v=${v}`, "--kind", "paper", "--title", `v${v}`).id, "--quote", QUOTE);
    assert.equal(run.gate("saturation").pass, false, "five copies of one site are one author");
    for (const name of ["two", "three"]) run.led("cite", "--claim", claim, "--source", src(run, name, "paper"), "--quote", QUOTE);
    src(run, "unread", "paper");
    src(run, "some-blog", "article");
    assert.equal(run.gate("saturation").pass, true, run.gate("saturation").problems.join("; "));
    run.led("question", "--text", "a new angle", "--from", src(run, "fresh", "paper"));
    assert.equal(run.gate("saturation").pass, false, "a source that raised a question is new information");
  });
});

describe("the field map", () => {
  it("counts topics asked as questions, at most two per question, and not parked ones", () => {
    const run = newRun("standard");
    const survey = src(run, "survey", "survey");
    const topics = ["t1", "t2", "t3", "t4"].map((text) => run.led("topic", "--text", text, "--from", survey).id);
    assert.match(run.gate("map").problems.join("; "), /T1, T2, T3, T4 neither asked nor parked/);
    assert.match(run.fail("question", "--text", "everything", "--topic", topics.slice(0, 3).join(",")), /at most 2 topics/);
    run.led("question", "--text", "q1", "--topic", `${topics[0]},${topics[1]}`);
    run.led("park", "--topic", topics[2], "--reason", "not about our platform");
    run.led("park", "--topic", topics[3], "--reason", "the user ruled it out");
    assert.match(run.gate("map").problems.join("; "), /2\/3 topics of the field map asked/, "parked topics do not count");
    run.led("topic", "--text", "t5", "--from", survey);
    run.led("question", "--text", "q5", "--topic", "T5");
    assert.equal(run.gate("map").pass, true, run.gate("map").problems.join("; "));
  });

  it("does not take docs or a second page of the same survey as a second map source", () => {
    const run = newRun();
    const a = run.led("source", "--url", "https://surveys.example.org/a", "--kind", "survey", "--title", "a").id;
    const b = run.led("source", "--url", "https://surveys.example.org/b", "--kind", "survey", "--title", "b").id;
    const docs = run.led("source", "--url", "https://docs.vendor.com/toc", "--kind", "docs", "--title", "toc").id;
    for (const from of [a, b, docs]) run.led("topic", "--text", `from ${from}`, "--from", from);
    assert.match(run.gate("map").problems.join("; "), /map drawn from 1\/2 surveys/);
  });
});

describe("quote checks", () => {
  it("finds a quote across markup, flags one that is not there, a dead link and a page drawn by script", async () => {
    const run = newRun("standard");
    const q = run.led("question", "--text", "q", "--from", "user").id;
    const cite = (url, kind) => run.led("claim", "--question", q, "--kind", "mechanism", "--text", url, "--source", run.led("source", "--url", url, "--kind", kind, "--title", url).id, "--quote", QUOTE).id;
    const good = cite(`${base}/good`, "docs");
    const wrong = cite(`${base}/other`, "paper");
    cite(`${base}/gone`, "spec");
    cite(`${base}/script-only`, "survey");
    const { status, result } = await run.checkQuotes();
    assert.equal(status, 1, "a quote that is not on its page fails the check");
    assert.deepEqual([result.found, result.missing, result.dead, result.unverifiable], [1, 1, 1, 1]);
    const problems = run.gate("quotes").problems.join("; ");
    assert.match(problems, new RegExp(`${wrong}/S2`));
    assert.doesNotMatch(problems, new RegExp(`${good}/`));
    assert.match(run.fail("confirm-quote", "--claim", wrong, "--source", "S2", "--how", "trust me"), /recorded missing/);
    run.led("cite", "--claim", wrong, "--source", "S2", "--quote", QUOTE);
    assert.match(run.gate("quotes").problems.join("; "), new RegExp(`${wrong}/S2`), "citing the same words again keeps them missing");
  });

  it("re-checks a quote the agent corrected", async () => {
    const run = newRun("standard");
    const q = run.led("question", "--text", "q", "--from", "user").id;
    const s = run.led("source", "--url", `${base}/good`, "--kind", "docs", "--title", "g").id;
    const claim = run.led("claim", "--question", q, "--kind", "mechanism", "--text", "x", "--source", s, "--quote", "a sentence the page never says at all").id;
    assert.equal((await run.checkQuotes()).result.missing, 1);
    run.led("cite", "--claim", claim, "--source", s, "--quote", QUOTE);
    assert.equal((await run.checkQuotes()).result.found, 1);
    assert.equal(run.gate("quotes").pass, true);
  });

  it("does not take a page that echoes its own URL as proof, and reads accents and soft hyphens", async () => {
    const run = newRun("standard");
    const q = run.led("question", "--text", "q", "--from", "user").id;
    const echo = run.led("source", "--url", `${base}/search?q=a+completely+fabricated+claim+about+shaders`, "--kind", "docs", "--title", "s").id;
    run.led("claim", "--question", q, "--kind", "mechanism", "--text", "x", "--source", echo, "--quote", "a completely fabricated claim about shaders");
    const accents = run.led("source", "--url", `${base}/accents`, "--kind", "paper", "--title", "a").id;
    run.led("claim", "--question", q, "--kind", "history", "--text", "y", "--source", accents, "--quote", "Poincaré wrote about international recurrence");
    const { result } = await run.checkQuotes();
    assert.deepEqual([result.found, result.unverifiable], [1, 1]);
    assert.match(result.unverifiableDetail[0].reason, /in the URL itself/);
  });
});

describe("the report", () => {
  it("checks the sections, the claim references, the unread inputs and the ledger link", () => {
    const run = newRun("standard");
    run.led("input", "--ref", "https://named.example.com/paper.pdf");
    run.led("unreadable", "--ref", "https://named.example.com/paper.pdf", "--reason", "paywalled");
    const q = run.led("question", "--text", "q", "--from", "user").id;
    const claim = run.led("claim", "--question", q, "--kind", "mechanism", "--text", "x", "--source", src(run, "docs", "docs"), "--quote", QUOTE).id;
    writeReport(run, `## Answer\n\nIt works like this [C9], as C11 says [C11 §6.5]. ${PROSE}\n\n## Glossary\n\n<!-- [${claim}] -->\n`);
    const problems = problemsOf(run);
    for (const expected of ['the "Glossary" section is nearly empty', 'no "Decision guide" section', "cites C9, which is not in the ledger", `no claim of ${q} is cited in the report`, "the unread input https://named.example.com/paper.pdf is not named in the report", "the Evidence section does not link ledger.md"]) {
      assert.ok(problems.includes(expected), `${expected} — got ${problems.join("; ")}`);
    }
    assert.ok(!problems.some((p) => /C11/.test(p)), "a bracket with words in it is not a claim reference");
    const sections = ["Answer", "Glossary", "Map of the field", "Decision guide", "Open questions"].map((name) => `## ${name}\n\n${PROSE}`);
    writeReport(run, [...sections, `It works like this [${claim}].`, "## Evidence", `See [the ledger](ledger.md). Not read: https://named.example.com/paper.pdf (paywalled). ${PROSE}`].join("\n\n"));
    assert.deepEqual(run.led("check-report"), { ok: true, problems: [] });
    run.led("render");
    assert.match(fs.readFileSync(path.join(run.dir, "ledger.md"), "utf8"), new RegExp(`#### ${claim}`));
  });

  it("wants a debate under its own heading and a hand-confirmed quote named in the evidence", async () => {
    const run = newRun("standard");
    const q = run.led("question", "--text", "q", "--from", "user").id;
    const locked = run.led("source", "--url", `${base}/forbidden`, "--kind", "paper", "--title", "locked").id;
    const claim = run.led("claim", "--question", q, "--kind", "mechanism", "--text", "x", "--source", locked, "--quote", "a sentence behind a paywall nobody can fetch").id;
    run.led("dispute", "--claim", claim, "--by", src(run, "rival", "paper"), "--note", "the rival measures otherwise");
    run.led("resolve", "--claim", claim, "--outcome", "debate", "--note", "both hold");
    await run.checkQuotes();
    run.led("confirm-quote", "--claim", claim, "--source", locked, "--how", "library proxy");
    const sections = ["Answer", "Glossary", "Map of the field", "Decision guide", "Open questions"].map((name) => `## ${name}\n\n${PROSE} [${claim}]`);
    writeReport(run, [...sections, "## Evidence", `See [the ledger](ledger.md). ${PROSE}`].join("\n\n"));
    const problems = problemsOf(run);
    assert.ok(problems.includes('no "Where experts disagree" section'), problems.join("; "));
    assert.ok(problems.includes(`the Evidence section does not name ${claim}, whose quotes no script could check`), problems.join("; "));
  });
});

describe("named inputs", () => {
  it("counts an input as read only once a claim cites it, and matches a file cited at a line", () => {
    const run = newRun("quick");
    run.led("input", "--ref", "https://named.example.com/spec");
    fs.writeFileSync(path.join(run.repo, "spec.md"), `title\n${QUOTE}\n`);
    run.led("input", "--ref", "spec.md");
    run.led("source", "--url", "https://named.example.com/spec", "--kind", "spec", "--title", "spec");
    const q = run.led("question", "--text", "q", "--from", "user").id;
    assert.match(run.gate("inputs").problems.join("; "), /named but not read and cited: https:\/\/named.example.com\/spec, spec.md/);
    run.led("claim", "--question", q, "--kind", "other", "--text", "x", "--source", "S1", "--quote", QUOTE);
    const local = run.led("source", "--path", "spec.md", "--line", "2", "--kind", "spec", "--title", "spec").id;
    run.led("claim", "--question", q, "--kind", "definition", "--text", "y", "--source", local, "--quote", QUOTE);
    assert.equal(run.gate("inputs").pass, true, run.gate("inputs").problems.join("; "));
  });
});

describe("reviews", () => {
  it("counts a review only once most of the tree was answered", () => {
    const run = newRun("standard");
    const q = run.led("question", "--text", "q", "--from", "user").id;
    assert.equal(run.led("review", "--by", "fresh subagent", "--note", "too early").counts, false);
    const claim = run.led("claim", "--question", q, "--kind", "mechanism", "--text", "x", "--source", src(run, "a", "docs"), "--quote", QUOTE).id;
    run.led("cite", "--claim", claim, "--source", src(run, "b", "paper"), "--quote", QUOTE);
    assert.equal(run.led("review", "--by", "another model", "--note", "missing the mobile case").counts, true);
    assert.equal(run.gate("review").pass, true);
  });
});

describe("the log", () => {
  it("never loses or duplicates parallel researchers' writes", async () => {
    const run = newRun();
    const writers = Array.from({ length: 8 }, (_, i) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [LEDGER, "source", "--dir", run.dir, "--url", `https://site${i}.example.com/p`, "--kind", "paper", "--title", `p${i}`, "--agent", `branch-${i}`], { cwd: run.repo });
        child.on("close", resolve);
      }),
    );
    assert.deepEqual(await Promise.all(writers), Array(8).fill(0));
    const ids = fs.readFileSync(path.join(run.dir, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse).filter((e) => e.t === "source").map((e) => e.id);
    assert.equal(new Set(ids).size, 8);
  });

  it("reports a broken event as a failed pass instead of crashing", () => {
    const run = newRun();
    fs.appendFileSync(path.join(run.dir, "ledger.jsonl"), '{"t":"park"}\nnot json\n');
    const verdict = run.score();
    assert.equal(verdict.pass, false);
    assert.equal(verdict.errors.length, 2, verdict.errors.join("; "));
  });
});

describe("continuing an earlier run", () => {
  it("inherits the knowledge, including experiments that still check, but not the quote checks or the reviews", async () => {
    const first = newRun("quick");
    const q = first.led("question", "--text", "q", "--from", "user").id;
    fs.writeFileSync(path.join(first.repo, "notes.md"), `${QUOTE}\n`);
    const s = first.led("source", "--path", "notes.md", "--kind", "docs", "--title", "n").id;
    first.led("claim", "--question", q, "--kind", "other", "--text", "x", "--source", s, "--quote", QUOTE);
    const bench = first.led("experiment", "--command", "node -e \"console.log('the run printed this exact line')\"", "--title", "b").id;
    first.led("claim", "--question", q, "--kind", "number", "--text", "y", "--source", bench, "--quote", "the run printed this exact line");
    first.led("review", "--by", "r", "--note", "n");
    const { dir } = ok(STATE, first.repo, ["start", "--slug", "topic-2", "--metric", "research_depth", "--evaluator", "ledger.mjs score", "--policy", "pass_only", "--target", "1"]);
    assert.equal(ok(LEDGER, first.repo, ["init", "--dir", dir, "--depth", "quick", "--from", first.dir]).inherited, 5);
    const events = fs.readFileSync(path.join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(events.map((e) => e.t), ["init", "question", "source", "claim", "source", "claim"]);
    const { status, result } = await checkQuotesIn(first.repo, dir);
    assert.equal(status, 0, JSON.stringify(result));
    assert.equal(result.found, 2);
  });
});

describe("state.mjs records the ledger's score", () => {
  it("keeps a step that grew the tree and stops only when every question and gate holds", () => {
    const run = newRun("quick");
    const q = run.led("question", "--text", "q", "--from", "user").id;
    const docs = src(run, "docs", "docs");
    const claim = run.led("claim", "--question", q, "--kind", "other", "--text", "x", "--source", docs, "--quote", QUOTE).id;
    ok(STATE, run.repo, ["record", "--dir", run.dir, "--baseline", "-"], JSON.stringify(run.score()));
    run.led("question", "--text", "a sub-question the reading raised", "--from", docs);
    const grown = ok(STATE, run.repo, ["record", "--dir", run.dir, "--candidate", "-", "--change", "grew the tree"], JSON.stringify(run.score()));
    assert.equal(grown.next, "iterate");
    const history = JSON.parse(fs.readFileSync(path.join(run.dir, "state.json"), "utf8")).history;
    assert.equal(history.at(-1).decision, "keep", "a lower score from a bigger tree is still progress");
    run.led("claim", "--question", "Q2", "--kind", "other", "--text", "y", "--source", docs, "--quote", OTHER);
    writeReport(run, `## Answer\n\nYes [${claim}], and also [C2]. ${PROSE}\n\n## Evidence\n\nOne source, read in full and quoted. ${PROSE}\n`);
    const finalScore = run.score();
    assert.equal(finalScore.score, 1, JSON.stringify(finalScore.gates));
    assert.equal(ok(STATE, run.repo, ["record", "--dir", run.dir, "--candidate", "-", "--change", "report"], JSON.stringify(finalScore)).next, "done");
    assert.equal(exec(STATE, run.repo, ["verify", "--dir", run.dir]).status, 0);
    assert.equal(exec(LEDGER, run.repo, ["verify", "--dir", run.dir]).status, 0);
  });

  it("catches a forged score that state.mjs alone would accept", () => {
    const run = newRun("quick");
    ok(STATE, run.repo, ["record", "--dir", run.dir, "--baseline", "-"], JSON.stringify(run.score()));
    ok(STATE, run.repo, ["record", "--dir", run.dir, "--candidate", "-", "--change", "forged"], JSON.stringify({ pass: true, score: 1 }));
    assert.equal(exec(STATE, run.repo, ["verify", "--dir", run.dir]).status, 0, "state.mjs trusts what it was piped");
    const out = exec(LEDGER, run.repo, ["verify", "--dir", run.dir]);
    assert.equal(out.status, 1);
    assert.match(JSON.parse(out.stdout).problems.join("; "), /the ledger scores 0, not 1/);
  });
});
