#!/usr/bin/env node
/**
 * ledger — what a research run knows, and how well it knows it.
 *
 * A run's findings used to be prose under `## Findings` and its score a `k/n` the agent typed: one link per question
 * reached 1/1 and stopped the loop, and a second source on an answered question was recorded as a revert. The ledger
 * holds the question tree, every source opened, every claim with the verbatim quote that backs it, the disputes, the
 * field map, the reviews and the inputs the user named. Each write appends one event to ledger.jsonl under a lock, so
 * branch researchers working in parallel never lose each other's lines; every read replays the log.
 *
 * `score` prints the evaluator JSON state.mjs records (`--policy pass_only --target 1`): a question counts only when
 * it clears the depth bar, and the run reaches 1 only when every gate holds as well. `verify` re-scores the ledger
 * itself, since state.mjs records whatever JSON it is handed.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LEDGER_FILE = "ledger.jsonl";
export const REPORT_FILE = "research.md";
export const RENDER_FILE = "ledger.md";

/** What a source is decides its tier. The agent names the kind and never the tier, so a blog cannot promote itself. */
export const SOURCE_KINDS = {
  spec: "A",
  paper: "A",
  docs: "A",
  code: "A",
  data: "A",
  experiment: "A",
  survey: "B",
  textbook: "B",
  course: "B",
  talk: "B",
  article: "C",
  forum: "C",
  video: "C",
  other: "C",
};
export const CLAIM_KINDS = ["definition", "mechanism", "number", "limit", "comparison", "recommendation", "history", "other"];
export const OUTCOMES = ["upheld", "refuted", "debate"];
export const MIN_QUOTE_WORDS = 5;
/** Each part of a quote around an ellipsis: three words in a row is a phrase, one word is a word every page has. */
export const MIN_QUOTE_PART_WORDS = 3;
/** A question that claims to cover a whole map is a heading, not a question. */
export const MAX_TOPICS_PER_QUESTION = 2;
/** A report section with fewer words than this is a heading with nothing under it. */
export const MIN_SECTION_WORDS = 12;
/** A review read before most of the tree was answered critiques a plan, not the research. */
export const REVIEW_AFTER = 0.75;
const LINE_WINDOW = 15;
const STALE_LOCK_MS = 10000;
const LOCK_WAIT_MS = 30000;
const THIN_PAGE_WORDS = 150;
const DEFAULT_TIMEOUT_MS = 20000;
const EXPERIMENT_TIMEOUT_MS = 300000;
const FETCH_CONCURRENCY = 4;
const DISAGREE = "Where experts disagree";

const ALL_SECTIONS = ["Answer", "Glossary", "Map of the field", "Decision guide", DISAGREE, "Next steps", "Reading path", "Open questions", "Evidence"];

/**
 * `external`: a question needs a source from outside the project, since the agent's own files and runs are one
 * voice at most. `verifiedOnly`: a citation counts only once its quote was found on the page or confirmed by hand.
 */
export const DEPTHS = {
  quick: { sources: 1, primary: 0, external: 0, needs: [], recentYears: 0, verifiedOnly: false, anchored: false, quoteChecks: false, mapTopics: 0, mapSources: 0, saturation: 0, reviews: 0, report: ["Answer", "Evidence"] },
  standard: {
    sources: 2,
    primary: 1,
    external: 1,
    needs: ["mechanism"],
    recentYears: 0,
    verifiedOnly: false,
    anchored: false,
    quoteChecks: true,
    mapTopics: 3,
    mapSources: 1,
    saturation: 3,
    reviews: 1,
    report: ["Answer", "Glossary", "Map of the field", "Decision guide", "Open questions", "Evidence"],
  },
  deep: { sources: 3, primary: 1, external: 1, needs: ["mechanism", "limit"], recentYears: 5, verifiedOnly: true, anchored: true, quoteChecks: true, mapTopics: 6, mapSources: 2, saturation: 5, reviews: 1, report: ALL_SECTIONS },
};

/** The bar a depth sets, with the one setting a run may change: how recent its newest source must be. */
export function barFor(depth, recentYears) {
  const preset = DEPTHS[depth];
  if (!preset) throw new Error(`--depth must be one of ${Object.keys(DEPTHS).join(", ")}`);
  return { ...preset, ...(recentYears === undefined ? {} : { recentYears }) };
}

const currentYear = () => new Date().getUTCFullYear();

// ── matching a quote against the text it came from ─────────────────────────────────────────────────────────────

/** A text as its words: markup, punctuation, accents, quote styles and dashes differ between a page and a copy of it. */
export function words(text) {
  return (
    String(text ?? "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[­​-‍⁠﻿]/g, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** A quote as the runs of words it is made of: an ellipsis skips words between two runs. */
export const quoteParts = (quote) => String(quote).split(/\.{3}|…/).map(words).filter((part) => part.length);

/** Why a quote cannot back a claim, or null: too short to say anything, or single words stitched by ellipses. */
export function quoteProblem(quote) {
  const parts = quoteParts(quote);
  if (!parts.length || Math.max(...parts.map((part) => part.length)) < MIN_QUOTE_WORDS) {
    return `a quote needs at least ${MIN_QUOTE_WORDS} words in a row copied from the source, not a paraphrase`;
  }
  if (parts.some((part) => part.length < MIN_QUOTE_PART_WORDS)) return `every part of a quote around an ellipsis needs at least ${MIN_QUOTE_PART_WORDS} words in a row`;
  return null;
}

/** The quote's runs of words appear in the text, in order. */
export function quoteFound(quote, text) {
  const hay = ` ${words(text).join(" ")} `;
  const parts = quoteParts(quote);
  let from = 0;
  for (const part of parts) {
    const at = hay.indexOf(` ${part.join(" ")} `, from);
    if (at < 0) return false;
    from = at + 1;
  }
  return parts.length > 0;
}

const sameWords = (a, b) => words(a).join(" ") === words(b).join(" ");

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", shy: "", zwnj: "", zwj: "",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", minus: "−",
  times: "×", divide: "÷", middot: "·", bull: "•", deg: "°", micro: "µ", copy: "©", reg: "®", trade: "™", szlig: "ß",
  aelig: "æ", oelig: "œ", eth: "ð", thorn: "þ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ",
  lambda: "λ", mu: "μ", pi: "π", sigma: "σ", tau: "τ", phi: "φ", omega: "ω",
};

/** `&eacute;`, `&Ouml;` and the like: the letter is what matching keeps, since `words` drops accents. */
const ACCENTED = /^([a-z])(acute|grave|circ|uml|tilde|cedil|ring|caron)$/i;

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, code) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      try {
        return String.fromCodePoint(point);
      } catch {
        return " ";
      }
    }
    if (/^oslash$/i.test(code)) return "ø";
    return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? code.match(ACCENTED)?.[1] ?? match;
  });
}

/** The visible text of an HTML page; scripts and styles are code, not what the page says. */
export function htmlText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

/** PDF text breaks words across lines with a hyphen; the quote was copied without it. */
const dehyphenate = (text) => text.replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2");

// ── sources: identity and independence ─────────────────────────────────────────────────────────────────────────

const ARXIV_ID = /\/(?:abs|pdf|html)\/((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[a-z]{2})?\/\d{7}))(?:v\d+)?(?:\.pdf)?\/?$/i;

/**
 * The URL a source is deduplicated by. The URL the agent gave is the one fetched; this is only its identity, so
 * http and https, tracking parameters, a fragment, and an arXiv paper's abstract, PDF and versions are one page.
 */
export function normalizeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`not an http(s) URL: ${raw}`);
  url.protocol = "https:";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.hostname === "arxiv.org") {
    const id = url.pathname.match(ARXIV_ID)?.[1];
    if (id) return `https://arxiv.org/abs/${id}`;
  }
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  const text = url.toString();
  return url.pathname !== "/" && text.endsWith("/") ? text.slice(0, -1) : text;
}

/** Second-level registries: under these, the name a person registers is the third label. */
const TWO_LEVEL_SUFFIXES = new Set(
  [
    "co.uk org.uk ac.uk gov.uk me.uk ltd.uk com.au net.au org.au edu.au gov.au co.nz org.nz ac.nz co.jp ne.jp or.jp ac.jp go.jp",
    "com.br org.br gov.br com.cn net.cn org.cn edu.cn gov.cn co.in org.in ac.in gov.in co.kr or.kr ac.kr com.tw org.tw edu.tw",
    "com.sg edu.sg gov.sg co.za org.za ac.za com.mx org.mx com.ar com.tr edu.tr com.pl org.pl com.hk edu.hk co.il ac.il com.ua",
    "co.id ac.id com.my edu.my com.ph com.vn edu.vn co.th ac.th",
  ].join(" ").split(" "),
);

function registrable(host) {
  if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
  const labels = host.split(".");
  return labels.slice(labels.length > 2 && TWO_LEVEL_SUFFIXES.has(labels.slice(-2).join(".")) ? -3 : -2).join(".");
}

/** Sites where each account is its own author: two repositories on GitHub are not one source. */
const HOSTING = new Set(["github.com", "gitlab.com", "bitbucket.org", "github.io", "gitlab.io", "medium.com", "substack.com", "dev.to", "hashnode.dev", "blogspot.com", "wordpress.com", "youtube.com", "stackoverflow.com", "stackexchange.com", "reddit.com", "netlify.app", "vercel.app", "pages.dev"]);

function urlOrigin(raw) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (host === "arxiv.org") return `arxiv:${url.pathname.match(ARXIV_ID)?.[1] ?? first}`;
  if (host === "doi.org" || host === "dx.doi.org") return `doi:${decodeURIComponent(url.pathname.slice(1)).toLowerCase()}`;
  if (host === "web.archive.org") {
    const inner = url.pathname.match(/^\/web\/[^/]+\/(.+)$/)?.[1];
    if (inner) {
      try {
        return urlOrigin(/^https?:/i.test(inner) ? inner : `https://${inner}`);
      } catch {
        // Not a URL inside after all; the archive itself is the origin.
      }
    }
  }
  if (host === "raw.githubusercontent.com" || host === "gist.github.com") return `github.com/${first}`;
  const site = registrable(host);
  if (!HOSTING.has(site)) return site;
  return host !== site ? host : `${site}/${first}`;
}

/**
 * Who stands behind a source, for counting independent ones: two pages of one vendor's docs are one voice, and so
 * are all of the project's own files and all of the run's own experiments. Only a URL source may name its origin
 * (`--origin "Khronos"`), for two domains with one author.
 */
export function originOf(source) {
  if (source.kind === "experiment") return "experiment";
  if (!source.url) return "local";
  return source.origin ?? urlOrigin(source.url);
}

export function yearOf(source) {
  const match = String(source?.date ?? "").match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

/** The project a run folder belongs to: the folder holding its `.o-skills/`. */
function projectRoot(dir) {
  let current = path.resolve(dir);
  while (current !== path.dirname(current)) {
    if (path.basename(current) === ".o-skills") return path.dirname(current);
    current = path.dirname(current);
  }
  return null;
}

const projectBase = (dir) => projectRoot(dir) ?? process.cwd();

/** A local path as the agent wrote it, found from the project root, the working directory or the run folder. */
function resolveLocal(file, dir) {
  if (!file) return null;
  const roots = path.isAbsolute(file) ? [""] : [projectBase(dir), process.cwd(), dir];
  for (const root of roots) {
    const candidate = path.resolve(root, file);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** A path as the project sees it, so a later run started with `init --from` finds the same file. */
const projectPath = (absolute, dir) => {
  const relative = path.relative(projectBase(dir), absolute);
  return relative.startsWith("..") ? absolute : relative;
};

const insideRuns = (absolute) => absolute.split(path.sep).includes(".o-skills");
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

// ── the log ────────────────────────────────────────────────────────────────────────────────────────────────────

export function readEvents(dir) {
  const file = path.join(dir, LEDGER_FILE);
  if (!fs.existsSync(file)) throw new Error(`no ${LEDGER_FILE} in ${dir}: run \`ledger.mjs init --dir ${dir}\` first`);
  const events = [];
  const bad = [];
  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return;
      try {
        events.push(JSON.parse(line));
      } catch {
        bad.push(`${LEDGER_FILE} line ${i + 1} is not JSON`);
      }
    });
  return { events, bad };
}

function applyEvent(led, event) {
  const need = (map, id, what) => {
    const item = map.get(id);
    if (!item) throw new Error(`names unknown ${what} ${id}`);
    return item;
  };
  switch (event.t) {
    case "init":
      led.depth = event.depth;
      led.bar = barFor(event.depth, event.recentYears);
      led.from = event.from ?? null;
      break;
    case "source":
      led.sources.set(event.id, { ...event, tier: SOURCE_KINDS[event.kind] ?? "C" });
      break;
    case "reclassify":
      Object.assign(need(led.sources, event.source, "source"), { kind: event.kind, tier: SOURCE_KINDS[event.kind] ?? "C", reclassified: event.reason, ...(event.origin ? { origin: event.origin } : {}) });
      break;
    case "topic":
      need(led.sources, event.from, "source");
      led.topics.set(event.id, { ...event, parked: null });
      break;
    case "question":
      if (event.parent) need(led.questions, event.parent, "question");
      led.questions.set(event.id, { ...event, topics: event.topics ?? [], needs: event.needs ?? [], parked: null });
      break;
    case "park":
      need(String(event.target).startsWith("T") ? led.topics : led.questions, event.target, "question or topic").parked = event.reason;
      break;
    case "claim":
      need(led.questions, event.question, "question");
      need(led.sources, event.source, "source");
      led.claims.set(event.id, {
        id: event.id,
        question: event.question,
        kind: event.kind,
        text: event.text,
        first: event.source,
        citations: new Map([[event.source, { quote: event.quote, check: null }]]),
        status: "live",
        disputes: [],
        resolution: null,
        inherited: event.inherited === true,
      });
      break;
    case "cite": {
      const claim = need(led.claims, event.claim, "claim");
      need(led.sources, event.source, "source");
      // Citing the same words again keeps their check: a quote shown missing stays missing until it changes.
      const before = claim.citations.get(event.source);
      claim.citations.set(event.source, { quote: event.quote, check: before && before.quote === event.quote ? before.check : null });
      break;
    }
    case "check": {
      // A check of a quote the agent has since replaced says nothing about the new one.
      const citation = led.claims.get(event.claim)?.citations.get(event.source);
      if (citation && citation.quote === event.quote) citation.check = { result: event.result, reason: event.reason ?? null, how: event.how ?? null, at: event.at };
      break;
    }
    case "dispute":
      need(led.claims, event.claim, "claim").disputes.push({ by: event.by, note: event.note, open: true });
      break;
    case "resolve": {
      const claim = need(led.claims, event.claim, "claim");
      for (const dispute of claim.disputes) dispute.open = false;
      claim.resolution = { outcome: event.outcome, note: event.note, by: event.by ?? null };
      if (event.outcome === "refuted") claim.status = "refuted";
      break;
    }
    case "retract": {
      const claim = need(led.claims, event.claim, "claim");
      claim.status = "retracted";
      claim.retracted = event.reason;
      break;
    }
    case "review":
      led.reviews.push(event);
      break;
    case "input":
      led.inputs.set(event.key, { ref: event.ref, key: event.key, unreadable: null });
      break;
    case "unreadable":
      need(led.inputs, event.key, "input").unreadable = event.reason;
      break;
    default:
      throw new Error(`has unknown type ${event.t}`);
  }
}

/** The ledger as of its last event. A hand edit that broke an event lands in `errors`, failing the evaluator's pass. */
export function replay(events) {
  const led = { depth: null, bar: null, sources: new Map(), topics: new Map(), questions: new Map(), claims: new Map(), inputs: new Map(), reviews: [], errors: [] };
  events.forEach((event, i) => {
    try {
      applyEvent(led, event ?? {});
    } catch (err) {
      led.errors.push(`event ${i + 1} (${event?.t ?? "?"}) ${err.message}`);
    }
  });
  if (!led.bar) led.errors.push("no init event: run `ledger.mjs init` first");
  return led;
}

export function load(dir) {
  const { events, bad } = readEvents(dir);
  const led = replay(events);
  led.errors.unshift(...bad);
  return led;
}

function append(dir, events) {
  const at = new Date().toISOString();
  fs.appendFileSync(path.join(dir, LEDGER_FILE), events.map((event) => `${JSON.stringify({ ...event, at })}\n`).join(""));
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * A lock a crashed writer left behind is broken by renaming it aside. Two waiters may both see it stale; the inode
 * says whether the one renamed is still that stale lock or a fresh one another waiter just took, which goes back.
 */
function breakStaleLock(lock) {
  try {
    const stale = fs.statSync(lock);
    if (Date.now() - stale.mtimeMs <= STALE_LOCK_MS) return;
    const aside = `${lock}.stale-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    fs.renameSync(lock, aside);
    if (fs.statSync(aside).ino === stale.ino) fs.rmSync(aside, { recursive: true, force: true });
    else fs.renameSync(aside, lock);
  } catch {
    // Another waiter broke it first, or its writer released it.
  }
}

/** One writer at a time: a branch researcher reads the ledger, picks the next id and appends inside the lock. */
function withLock(dir, fn) {
  const lock = path.join(dir, "ledger.lock");
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      breakStaleLock(lock);
      if (Date.now() > deadline) throw new Error("the ledger is locked by another writer; retry");
      sleep(20);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** Read, validate and append under the lock; `build` returns the events to write and what to print. */
function write(dir, build) {
  return withLock(dir, () => {
    const led = load(dir);
    const { events = [], output } = build(led);
    if (events.length) append(dir, events);
    return output;
  });
}

function nextId(led, prefix) {
  const map = { S: led.sources, T: led.topics, Q: led.questions, C: led.claims }[prefix];
  return `${prefix}${Math.max(0, ...[...map.keys()].map((id) => Number(String(id).slice(1)) || 0)) + 1}`;
}

// ── judging: the depth bar, the gates, the score ───────────────────────────────────────────────────────────────

const broken = (citation) => ["missing", "dead"].includes(citation.check?.result);
const verified = (citation) => ["found", "manual"].includes(citation.check?.result);
const unique = (items) => [...new Set(items)];
const liveClaims = (led) => [...led.claims.values()].filter((claim) => claim.status === "live");

function parkedReason(led, question) {
  for (let q = question; q; q = q.parent ? led.questions.get(q.parent) : null) if (q.parked) return q.parked;
  return null;
}

/**
 * The citations that still count: on a live claim, with a quote not shown missing from its source. At a depth that
 * counts only verified quotes, an unchecked or unreadable one waits for `check-quotes` or `confirm-quote`.
 */
function countedCitations(led, claims) {
  return claims
    .flatMap((claim) => [...claim.citations].map(([id, citation]) => ({ claim, source: led.sources.get(id), citation })))
    .filter((entry) => entry.source && !broken(entry.citation) && (!led.bar.verifiedOnly || verified(entry.citation)));
}

function leafVerdict(led, question, now) {
  const bar = led.bar;
  const gaps = [];
  const claims = liveClaims(led).filter((claim) => claim.question === question.id);
  const cited = countedCitations(led, claims);
  const sources = unique(cited.map((entry) => entry.source));
  const strong = sources.filter((source) => source.tier !== "C");
  const origins = new Set(strong.map(originOf));
  const weak = new Set(sources.filter((source) => source.tier === "C").map(originOf).filter((origin) => !origins.has(origin)));
  // An article or a forum thread may add one voice; it never makes up the count on its own.
  const independent = origins.size + Math.min(1, weak.size);
  const primary = sources.filter((source) => source.tier === "A").length;
  const external = sources.filter((source) => source.url).length;
  const waiting = bar.verifiedOnly ? claims.flatMap((claim) => [...claim.citations.values()]).filter((citation) => !citation.check || citation.check.result === "unverifiable").length : 0;
  if (waiting) gaps.push(`${waiting} citations wait for check-quotes or confirm-quote before they count`);
  if (!strong.length) gaps.push("no tier A or B source (an article or forum post never answers a question alone)");
  if (independent < bar.sources) gaps.push(`${independent}/${bar.sources} independent sources`);
  if (primary < bar.primary) gaps.push(`${primary}/${bar.primary} primary (tier A) sources`);
  if (external < bar.external) gaps.push("no source from outside the project (the project's own files and experiments are one voice)");
  const kinds = new Set(cited.map((entry) => entry.claim.kind));
  for (const kind of unique([...bar.needs, ...question.needs, ...(question.quantitative ? ["number"] : [])])) {
    if (!kinds.has(kind)) gaps.push(`no ${kind} claim`);
  }
  if (question.quantitative && kinds.has("number") && !cited.some((entry) => entry.claim.kind === "number" && entry.source.tier === "A")) {
    gaps.push("no number backed by a tier A source (a measurement, paper, spec or our own experiment)");
  }
  const disputed = claims.filter((claim) => claim.disputes.some((dispute) => dispute.open)).map((claim) => claim.id);
  if (disputed.length) gaps.push(`open dispute on ${disputed.join(", ")}`);
  if (bar.recentYears > 0 && !question.timeless) {
    // A blog post is easy to find for any year; recency must come from a source that carries weight.
    const floor = now.getUTCFullYear() - bar.recentYears + 1;
    const newest = Math.max(-Infinity, ...strong.map(yearOf).filter(Number.isFinite));
    if (newest < floor) gaps.push(`${newest === -Infinity ? "no dated tier A or B source" : `newest tier A or B source is from ${newest}`}; needs one from ${floor} or later, or --timeless`);
  }
  if (bar.anchored && !cited.some((entry) => entry.citation.check?.result === "found")) gaps.push("no quote found on its page by check-quotes (a hand confirmation alone does not anchor it)");
  return { id: question.id, answered: gaps.length === 0, gaps, claims: claims.length, sources: sources.length, independent, primary };
}

function questionVerdicts(led, now) {
  const verdicts = new Map();
  const inScope = [...led.questions.values()].filter((question) => !parkedReason(led, question));
  const verdictOf = (question) => {
    if (verdicts.has(question.id)) return verdicts.get(question.id);
    const children = inScope.filter((child) => child.parent === question.id);
    let verdict;
    if (children.length) {
      // A question with sub-questions is answered by them.
      const waiting = children.filter((child) => !verdictOf(child).answered).map((child) => child.id);
      verdict = { id: question.id, answered: waiting.length === 0, gaps: waiting.length ? [`waits on ${waiting.join(", ")}`] : [], group: true };
    } else {
      verdict = leafVerdict(led, question, now);
    }
    verdicts.set(question.id, verdict);
    return verdict;
  };
  return { inScope, verdicts: inScope.map(verdictOf) };
}

/** Sources that weigh in the field: from outside the project, tier A or B, not carried over from an earlier run. */
const weighty = (source) => source.url && source.tier !== "C" && !source.inherited;

/**
 * How many authors, among the newest tier A and B sources from outside the project, only confirmed what the ledger
 * already held. A source is new information when it started a claim, raised a question or topic, or disputed a
 * claim; one cited by nothing was not shown to be read and counts neither way. Five pages of one site are one author.
 */
export function saturationStreak(led) {
  const novel = new Set([
    ...[...led.claims.values()].map((claim) => claim.first),
    ...[...led.questions.values()].map((question) => question.from),
    ...[...led.topics.values()].map((topic) => topic.from),
    ...[...led.claims.values()].flatMap((claim) => claim.disputes.map((dispute) => dispute.by)),
  ]);
  const citedBy = new Set(liveClaims(led).flatMap((claim) => [...claim.citations].filter(([, citation]) => !broken(citation)).map(([id]) => id)));
  const authors = new Set();
  for (const source of [...led.sources.values()].reverse()) {
    if (!weighty(source)) continue;
    if (novel.has(source.id)) break;
    if (citedBy.has(source.id)) authors.add(originOf(source));
  }
  return authors.size;
}

/** An input is read when a source is it and a live claim cites that source; registering a URL is not reading it. */
function inputRead(led, input) {
  const matches = [...led.sources.values()].filter((source) => (source.url ? source.key === input.key : (source.resolved ?? source.path) === input.key));
  return matches.some((source) => liveClaims(led).some((claim) => claim.citations.has(source.id) && !broken(claim.citations.get(source.id))));
}

function gateList(led, report) {
  const bar = led.bar;
  const gates = [];
  const gate = (name, problems) => gates.push({ name, pass: problems.length === 0, problems });
  if (bar.mapTopics > 0) {
    const topics = [...led.topics.values()];
    const questions = [...led.questions.values()];
    const askedInScope = new Set(questions.filter((question) => !parkedReason(led, question)).flatMap((question) => question.topics));
    const askedAtAll = new Set(questions.flatMap((question) => question.topics));
    const asked = topics.filter((topic) => !topic.parked && askedInScope.has(topic.id)).length;
    // The map must come from experts laying out the field: surveys, textbooks, courses, talks, by different authors.
    const mapAuthors = new Set(topics.map((topic) => led.sources.get(topic.from)).filter((source) => source?.url && source.tier === "B").map(originOf));
    const loose = topics.filter((topic) => !topic.parked && !askedAtAll.has(topic.id)).map((topic) => topic.id);
    gate("map", [
      ...(asked < bar.mapTopics ? [`${asked}/${bar.mapTopics} topics of the field map asked as questions (parked ones do not count)`] : []),
      ...(mapAuthors.size < bar.mapSources ? [`map drawn from ${mapAuthors.size}/${bar.mapSources} surveys, textbooks, courses or talks by different authors`] : []),
      ...(loose.length ? [`${loose.join(", ")} neither asked nor parked`] : []),
    ]);
  }
  if (bar.saturation > 0) {
    const streak = saturationStreak(led);
    gate("saturation", streak < bar.saturation ? [`${streak}/${bar.saturation} authors among the newest tier A/B sources added nothing new`] : []);
  }
  const citations = liveClaims(led).flatMap((claim) => [...claim.citations].map(([source, citation]) => ({ claim: claim.id, source, citation })));
  const brokenOnes = citations.filter((entry) => broken(entry.citation)).map((entry) => `${entry.claim}/${entry.source}`);
  const unchecked = bar.quoteChecks ? citations.filter((entry) => !entry.citation.check).length : 0;
  gate("quotes", [
    ...(brokenOnes.length ? [`quote not found at its source: ${brokenOnes.join(", ")} (re-cite with the real words or retract)`] : []),
    ...(unchecked ? [`${unchecked} citations not checked yet (check-quotes)`] : []),
  ]);
  if (led.inputs.size) {
    const pending = [...led.inputs.values()].filter((input) => !input.unreadable && !inputRead(led, input)).map((input) => input.ref);
    gate("inputs", pending.length ? [`named but not read and cited: ${pending.join(", ")}`] : []);
  }
  if (bar.reviews > 0) {
    const counted = led.reviews.filter((review) => review.answered >= REVIEW_AFTER).length;
    gate("review", counted < bar.reviews ? [`${counted}/${bar.reviews} reviews by a reader who did not write it, taken once ${Math.round(REVIEW_AFTER * 100)}% of the tree was answered`] : []);
  }
  gate("report", reportProblems(led, report));
  return gates;
}

const round = (value) => Math.round(value * 1000) / 1000;

/**
 * The evaluator JSON. `pass` is the ledger's integrity — a hand edit that broke it fails the step. `score` counts
 * answered questions and passed gates together, and reaches 1 only when every one holds.
 */
export function evaluate(led, { report = "", now = new Date() } = {}) {
  if (!led.bar) return { pass: false, score: 0, errors: led.errors };
  const { inScope, verdicts } = questionVerdicts(led, now);
  const gates = gateList(led, report);
  const answered = verdicts.filter((verdict) => verdict.answered).length;
  const passed = gates.filter((gate) => gate.pass).length;
  const complete = led.errors.length === 0 && inScope.length > 0 && answered === inScope.length && passed === gates.length;
  const raw = inScope.length ? (answered + passed) / (inScope.length + gates.length) : 0;
  return {
    pass: led.errors.length === 0,
    score: complete ? 1 : Math.min(round(raw), 0.999),
    depth: led.depth,
    answered,
    questions: inScope.length,
    parked: led.questions.size - inScope.length,
    gates: gates.map(({ name, pass, problems }) => ({ name, pass, problems })),
    open: verdicts.filter((verdict) => !verdict.answered).map(({ id, gaps }) => ({ id, gaps })),
    ...(led.errors.length ? { errors: led.errors } : {}),
  };
}

// ── the report ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The agent's report: what research.md holds below the findings marker state.mjs keeps. */
export function reportBody(dir) {
  const file = path.join(dir, REPORT_FILE);
  if (!fs.existsSync(file)) return "";
  const text = fs.readFileSync(file, "utf8");
  const marker = text.search(/<!-- findings[^\n]*-->/);
  if (marker < 0) return text;
  return text.slice(text.indexOf("\n", marker) + 1).replace(/^\s*## Findings\s*\n/, "");
}

/** What a reader sees: a comment or a code block is not where a report says anything. */
const visible = (text) =>
  String(text)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, " ");

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Each heading's body, up to the next heading of the same or a higher level. */
function sections(text) {
  const lines = text.split("\n");
  const found = [];
  lines.forEach((line, i) => {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) found.push({ level: match[1].length, title: match[2].trim(), start: i });
  });
  return found.map((heading, k) => {
    const end = found.slice(k + 1).find((next) => next.level <= heading.level)?.start ?? lines.length;
    return { ...heading, body: lines.slice(heading.start + 1, end).join("\n") };
  });
}

function sectionNamed(all, name) {
  const re = new RegExp(`^(?:\\d+[.)]\\s*)?${escapeRe(name)}\\b`, "i");
  return all.find((section) => re.test(section.title)) ?? null;
}

/**
 * Claim ids the report cites: a bracket holding only claim ids, as `[C3]`, `[C3, C7]` or the link `[C3](ledger.md#c3)`.
 * A bracket with other words in it, such as a C language standard, is not a citation.
 */
export function claimRefs(text) {
  return unique([...String(text).matchAll(/\[\s*(C\d+(?:\s*[,;]\s*C\d+)*)\s*\]/g)].flatMap((match) => match[1].split(/[,;]/).map((id) => id.trim())));
}

/** What keeps the report from teaching the field: a section missing or empty, a dead reference, a question left out. */
export function reportProblems(led, raw) {
  if (!led.bar) return led.errors;
  const text = visible(raw);
  if (!text.trim()) return [`${REPORT_FILE} has no report below the findings marker yet (references/report.md)`];
  const problems = [];
  const all = sections(text);
  const debates = liveClaims(led).filter((claim) => claim.resolution?.outcome === "debate");
  const required = unique([...led.bar.report, ...(debates.length ? [DISAGREE] : [])]);
  for (const name of required) {
    const section = sectionNamed(all, name);
    if (!section) problems.push(`no "${name}" section`);
    else if (words(section.body).length < MIN_SECTION_WORDS) problems.push(`the "${name}" section is nearly empty`);
  }
  const refs = claimRefs(text);
  for (const id of refs) {
    const claim = led.claims.get(id);
    if (!claim) problems.push(`cites ${id}, which is not in the ledger`);
    else if (claim.status !== "live") problems.push(`cites ${id}, which was ${claim.status}`);
  }
  const cited = new Set(refs);
  const inScope = [...led.questions.values()].filter((question) => !parkedReason(led, question));
  const parents = new Set(inScope.map((question) => question.parent).filter(Boolean));
  for (const question of inScope.filter((q) => !parents.has(q.id))) {
    const claims = liveClaims(led).filter((claim) => claim.question === question.id);
    if (claims.length && !claims.some((claim) => cited.has(claim.id))) problems.push(`no claim of ${question.id} is cited in the report`);
  }
  const disagree = sectionNamed(all, DISAGREE);
  for (const claim of debates) {
    if (!disagree || !claimRefs(disagree.body).includes(claim.id)) problems.push(`the open debate on ${claim.id} is not cited under "${DISAGREE}"`);
  }
  for (const input of led.inputs.values()) {
    if (input.unreadable && !text.includes(input.ref)) problems.push(`the unread input ${input.ref} is not named in the report`);
  }
  const evidence = sectionNamed(all, "Evidence")?.body ?? "";
  if (led.depth !== "quick" && !evidence.includes(RENDER_FILE)) problems.push(`the Evidence section does not link ${RENDER_FILE}`);
  // A quote no script could read rests on the agent's word, so the reader is told which.
  const unchecked = liveClaims(led).filter((claim) => [...claim.citations.values()].some((citation) => ["manual", "unverifiable"].includes(citation.check?.result)));
  const unnamed = unchecked.filter((claim) => !new RegExp(`\\b${claim.id}\\b`).test(evidence)).map((claim) => claim.id);
  if (unnamed.length) problems.push(`the Evidence section does not name ${unnamed.join(", ")}, whose quotes no script could check`);
  return problems;
}

// ── checking quotes against their sources ──────────────────────────────────────────────────────────────────────

/** A GitHub file page is mostly script; its raw twin is the file itself. */
function fetchable(url) {
  const match = String(url).match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+?)(?:#.*)?$/);
  return match ? `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}` : url;
}

function pdfText(buffer) {
  const run = spawnSync("pdftotext", ["-q", "-", "-"], { input: buffer, maxBuffer: 256 * 1024 * 1024 });
  return run.status === 0 ? run.stdout.toString("utf8") : null;
}

function decodeBody(buffer, type) {
  const declared = type.match(/charset=["']?([\w-]+)/i)?.[1] ?? buffer.subarray(0, 4096).toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(declared).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

async function remoteText(url, timeoutMs) {
  let response;
  try {
    response = await fetch(fetchable(url), {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "Mozilla/5.0 (compatible; o-research quote check)", accept: "text/html,text/plain,application/pdf,*/*" },
    });
  } catch (err) {
    return { result: "unverifiable", reason: `fetch failed (${err.cause?.code ?? err.name})` };
  }
  if (response.status === 404 || response.status === 410) return { result: "dead", reason: `HTTP ${response.status}` };
  if (!response.ok) return { result: "unverifiable", reason: `HTTP ${response.status}` };
  const buffer = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") ?? "";
  if (/pdf/i.test(type) || buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    const text = pdfText(buffer);
    return text === null ? { result: "unverifiable", reason: "PDF (install pdftotext to check it)" } : { text, pdf: true };
  }
  const body = decodeBody(buffer, type);
  return { text: /html|xml/i.test(type) || /^\s*</.test(body) ? htmlText(body) : body, url };
}

function localText(source, dir) {
  if (source.kind === "experiment") {
    if (source.path && !resolveLocal(source.resolved ?? source.path, dir)) return { result: "dead", reason: `the experiment's script ${source.path} is gone` };
    const output = resolveLocal(source.output, dir);
    if (!output) return { result: "dead", reason: `the experiment's output ${source.output} is gone` };
    const text = fs.readFileSync(output, "utf8");
    // The ledger wrote this file from the run; a different file is not what the run printed.
    if (source.hash && sha256(text) !== source.hash) return { result: "dead", reason: "the experiment's output was edited after the run; run it again" };
    return { text };
  }
  const file = resolveLocal(source.resolved ?? source.path, dir);
  if (!file) return { result: "dead", reason: `${source.path} not found` };
  const text = fs.readFileSync(file, "utf8");
  if (!source.line) return { text };
  const lines = text.split(/\r?\n/);
  return { text: lines.slice(Math.max(0, source.line - 1 - LINE_WINDOW), source.line + LINE_WINDOW).join("\n") };
}

function judgeQuote(quote, page) {
  if (page.text === undefined) return { result: page.result, reason: page.reason };
  if (!quoteFound(quote, page.text) && !(page.pdf && quoteFound(quote, dehyphenate(page.text)))) {
    if (words(page.text).length < THIN_PAGE_WORDS) return { result: "unverifiable", reason: "the source has almost no text (likely drawn by JavaScript); confirm it by hand" };
    return { result: "missing", reason: "the quote is not in the source" };
  }
  // A search page, or a "not found" page that repeats its address, says back whatever the URL asked it.
  if (page.url && quoteFound(quote, safeDecode(page.url))) return { result: "unverifiable", reason: "the quote is in the URL itself, so the page may only be echoing it" };
  return { result: "found" };
}

function safeDecode(url) {
  try {
    return decodeURIComponent(String(url).replace(/\+/g, " "));
  } catch {
    return String(url);
  }
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    }),
  );
}

// ── rendering ──────────────────────────────────────────────────────────────────────────────────────────────────

const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function where(source) {
  if (source.url) return `[${cell(source.title)}](${source.url})`;
  if (source.kind === "experiment") return `${cell(source.title)} — \`${cell(source.command)}\` → \`${source.output}\``;
  return `${cell(source.title)} — \`${source.path}${source.line ? `:${source.line}` : ""}\``;
}

export function render(led, { report = "", now = new Date() } = {}) {
  const verdict = evaluate(led, { report, now });
  const byId = new Map(questionVerdicts(led, now).verdicts.map((v) => [v.id, v]));
  const lines = [`# Research ledger`, "", `Rendered from \`${LEDGER_FILE}\` by ledger.mjs — depth **${led.depth}**, score ${verdict.score}, ${verdict.answered}/${verdict.questions} questions answered. Do not edit by hand.`, ""];
  lines.push("## Gates", "", "| Gate | Holds | What is missing |", "|---|---|---|");
  for (const gate of verdict.gates) lines.push(`| ${gate.name} | ${gate.pass ? "yes" : "no"} | ${cell(gate.problems.join("; "))} |`);
  lines.push("", "## Questions", "", "| Question | Answered | What is missing |", "|---|---|---|");
  for (const question of led.questions.values()) {
    const parked = parkedReason(led, question);
    const v = byId.get(question.id);
    lines.push(`| **${question.id}** ${cell(question.text)}${question.parent ? ` (under ${question.parent})` : ""} | ${parked ? "parked" : v.answered ? "yes" : "no"} | ${cell(parked ?? v.gaps.join("; "))} |`);
  }
  lines.push("", "## Claims");
  for (const question of led.questions.values()) {
    const claims = [...led.claims.values()].filter((claim) => claim.question === question.id);
    if (!claims.length) continue;
    lines.push("", `### ${question.id} — ${question.text}`);
    for (const claim of claims) {
      lines.push("", `#### ${claim.id}`, "", `*${claim.kind}${claim.status === "live" ? "" : `, ${claim.status}`}* — ${claim.text}`, "");
      for (const [id, citation] of claim.citations) {
        const source = led.sources.get(id);
        if (!source) continue;
        const check = citation.check ? `${citation.check.result}${citation.check.reason ? ` (${citation.check.reason})` : ""}${citation.check.how ? ` — ${citation.check.how}` : ""}` : "not checked";
        lines.push(`- **${id}** tier ${source.tier}, ${source.date ?? "undated"} — ${where(source)}`, `  > ${citation.quote.replace(/\n/g, " ")}`, `  quote check: ${check}`);
      }
      for (const dispute of claim.disputes) lines.push(`- disputed by ${dispute.by}: ${dispute.note}${dispute.open ? " — **open**" : ""}`);
      if (claim.resolution) lines.push(`- resolved: **${claim.resolution.outcome}**${claim.resolution.by ? ` by ${claim.resolution.by}` : ""} — ${claim.resolution.note}`);
      if (claim.retracted) lines.push(`- retracted: ${claim.retracted}`);
    }
  }
  if (led.topics.size) {
    lines.push("", "## Field map", "", "| Topic | From | Asked as |", "|---|---|---|");
    for (const topic of led.topics.values()) {
      const asked = [...led.questions.values()].filter((question) => question.topics.includes(topic.id)).map((question) => question.id);
      lines.push(`| **${topic.id}** ${cell(topic.text)} | ${topic.from} | ${cell(topic.parked ? `parked: ${topic.parked}` : asked.join(", ") || "—")} |`);
    }
  }
  lines.push("", "## Sources", "", "| ID | Tier | Kind | Date | Origin | Source |", "|---|---|---|---|---|---|");
  for (const source of led.sources.values()) {
    const notes = [source.inherited ? "from an earlier run" : "", source.reclassified ? `reclassified: ${source.reclassified}` : "", source.origin && source.url ? "origin named by the agent" : ""].filter(Boolean).join("; ");
    lines.push(`| ${source.id} | ${source.tier} | ${source.kind} | ${source.date ?? "—"} | ${cell(originOf(source))} | ${where(source)}${notes ? ` (${cell(notes)})` : ""} |`);
  }
  if (led.inputs.size) {
    lines.push("", "## Inputs the user named", "");
    for (const input of led.inputs.values()) lines.push(`- ${input.ref} — ${input.unreadable ? `**not read**: ${input.unreadable}` : inputRead(led, input) ? "read and cited" : "**not read yet**"}`);
  }
  const parked = [...led.questions.values(), ...led.topics.values()].filter((item) => item.parked);
  if (parked.length) {
    lines.push("", "## Parked", "");
    for (const item of parked) lines.push(`- **${item.id}** ${item.text} — ${item.parked}`);
  }
  if (led.reviews.length) {
    lines.push("", "## Reviews", "");
    for (const review of led.reviews) lines.push(`- ${review.by} (at ${Math.round(review.answered * 100)}% answered): ${review.note}`);
  }
  return `${lines.join("\n")}\n`;
}

function statusText(verdict) {
  const lines = [`depth ${verdict.depth} · score ${verdict.score} · ${verdict.answered}/${verdict.questions} questions answered${verdict.parked ? ` · ${verdict.parked} parked` : ""}`];
  lines.push(`gates: ${verdict.gates.map((gate) => `${gate.name} ${gate.pass ? "ok" : "open"}`).join(" · ")}`);
  for (const gate of verdict.gates.filter((g) => !g.pass)) lines.push(`  ${gate.name}: ${gate.problems.join("; ")}`);
  if (verdict.open.length) lines.push("open questions:");
  for (const question of verdict.open) lines.push(`  ${question.id}: ${question.gaps.join("; ")}`);
  for (const error of verdict.errors ?? []) lines.push(`error: ${error}`);
  return `${lines.join("\n")}\n`;
}

// ── commands ───────────────────────────────────────────────────────────────────────────────────────────────────

const given = (value) => (value === undefined || value === true ? undefined : value);

function required(args, flag) {
  const value = given(args[flag]);
  if (value === undefined || !String(value).trim()) throw new Error(`--${flag} is required`);
  return String(value);
}

function int(value, flag) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} must be a whole number`);
  return n;
}

function requireDir(args) {
  const dir = required(args, "dir");
  if (!fs.existsSync(dir)) throw new Error(`--dir ${dir} does not exist (state.mjs start makes the run folder)`);
  return dir;
}

function kindArg(args) {
  const kind = required(args, "kind");
  if (!(kind in SOURCE_KINDS)) throw new Error(`--kind must be one of ${Object.keys(SOURCE_KINDS).join(", ")}`);
  return kind;
}

/** A quote from `--quote "<words>"`, or `--quote -` to read it from stdin when the words hold shell quotes. */
function quoteArg(args) {
  const quote = args.quote === "-" ? fs.readFileSync(0, "utf8").trim() : required(args, "quote");
  const problem = quoteProblem(quote);
  if (problem) throw new Error(problem);
  return quote;
}

const agentOf = (args) => (given(args.agent) ? { agent: String(args.agent) } : {});

function liveClaim(led, id) {
  const claim = led.claims.get(id);
  if (!claim) throw new Error(`no claim ${id}`);
  if (claim.status !== "live") throw new Error(`${id} was ${claim.status}`);
  return claim;
}

function knownSource(led, id) {
  const source = led.sources.get(id);
  if (!source) throw new Error(`no source ${id}: add it with \`source\` first`);
  return source;
}

/** One sentence backs one claim: the same words at the same source cannot stand behind two different claims. */
function refuseReusedQuote(led, claimId, sourceId, quote) {
  const other = liveClaims(led).find((claim) => claim.id !== claimId && claim.citations.has(sourceId) && sameWords(claim.citations.get(sourceId).quote, quote));
  if (other) throw new Error(`${other.id} already rests on these words from ${sourceId}; quote the sentence that says this claim`);
}

/** A local quote is checked as it is written: the file is here, so a misquote is refused instead of recorded. */
function citationEvents(led, dir, source, claim, quote, base) {
  if (source.url) return [base];
  const verdict = judgeQuote(quote, localText(source, dir));
  if (verdict.result !== "found") throw new Error(`the quote is not in ${source.kind === "experiment" ? source.output : source.path}${source.line ? ` near line ${source.line}` : ""}: ${verdict.reason}`);
  return [base, { t: "check", claim, source: source.id, quote, result: "found" }];
}

function validDate(date) {
  if (date === null) return null;
  if (!/^(\d{4}(-\d{2}(-\d{2})?)?|n\.d\.)$/.test(date)) throw new Error("--date must be YYYY, YYYY-MM, YYYY-MM-DD or n.d.");
  if (yearOf({ date }) > currentYear()) throw new Error(`--date ${date} is in the future`);
  return date;
}

function commandInit(args) {
  const dir = requireDir(args);
  const file = path.join(dir, LEDGER_FILE);
  if (fs.existsSync(file)) throw new Error(`${file} already exists; a run keeps one ledger`);
  const depth = given(args.depth) ?? "deep";
  const recentYears = given(args["recent-years"]) === undefined ? undefined : int(args["recent-years"], "--recent-years");
  const bar = barFor(depth, recentYears);
  const from = given(args.from);
  // An earlier run's knowledge carries over; its quote checks and reviews do not, since pages and judgments age.
  const KEEP = new Set(["source", "reclassify", "topic", "question", "park", "claim", "cite", "dispute", "resolve", "retract"]);
  const inherited = from ? readEvents(from).events.filter((event) => KEEP.has(event.t)).map((event) => ({ ...event, inherited: true })) : [];
  const at = new Date().toISOString();
  const init = { t: "init", depth, ...(recentYears === undefined ? {} : { recentYears }), ...(from ? { from } : {}), at };
  fs.writeFileSync(file, [init, ...inherited].map((event) => `${JSON.stringify(event)}\n`).join(""));
  return { output: { ledger: file, depth, bar, inherited: inherited.length } };
}

function commandSource(args) {
  const dir = requireDir(args);
  const kind = kindArg(args);
  if (kind === "experiment") throw new Error("an experiment is recorded by `experiment --command`, which runs it and saves what it printed");
  const title = required(args, "title");
  const url = given(args.url);
  const file = given(args.path);
  if (Boolean(url) === Boolean(file)) throw new Error("a source needs exactly one of --url or --path");
  if (file && given(args.origin)) throw new Error("--origin names who stands behind a URL; the project's own files are one voice");
  const line = given(args.line) === undefined ? null : int(args.line, "--line");
  const date = validDate(given(args.date) ?? null);
  return {
    output: write(dir, (led) => {
      let resolved = null;
      if (file) {
        const absolute = resolveLocal(file, dir);
        if (!absolute) throw new Error(`${file} not found: a source is something opened`);
        if (insideRuns(absolute)) throw new Error(`${file} is inside .o-skills/: the run's own notes are not a source`);
        resolved = projectPath(absolute, dir);
      }
      const key = url ? normalizeUrl(url) : `${resolved}${line ? `:${line}` : ""}`;
      const existing = [...led.sources.values()].find((source) => source.key === key);
      if (existing) return { output: { id: existing.id, tier: existing.tier, origin: originOf(existing), existing: true } };
      const id = nextId(led, "S");
      const event = {
        t: "source",
        id,
        kind,
        title,
        key,
        ...(url ? { url } : { path: file, resolved }),
        ...(line ? { line } : {}),
        date,
        ...(given(args.origin) ? { origin: String(args.origin) } : {}),
        ...agentOf(args),
      };
      return { events: [event], output: { id, tier: SOURCE_KINDS[kind], origin: originOf(event), existing: false } };
    }),
  };
}

/**
 * An experiment the ledger ran itself: the command, its exit code and a hash of what it printed are recorded, so an
 * output the agent typed or edited afterwards does not count.
 */
function commandExperiment(args) {
  const dir = requireDir(args);
  const title = required(args, "title");
  const command = required(args, "command");
  const script = given(args.path);
  const timeout = given(args.timeout) === undefined ? EXPERIMENT_TIMEOUT_MS : int(args.timeout, "--timeout");
  const scriptPath = script ? resolveLocal(script, dir) : null;
  if (script && !scriptPath) throw new Error(`${script} not found`);
  const run = spawnSync(command, { shell: true, cwd: projectBase(dir), encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  if (run.error) throw new Error(`the experiment did not run: ${run.error.message}`);
  const printed = `$ ${command}\n${run.stdout ?? ""}${run.stderr ? `\n[stderr]\n${run.stderr}` : ""}`;
  if (run.status !== 0) throw new Error(`the experiment exited ${run.status}; a failed run is not evidence. Its output ends:\n${printed.slice(-800)}`);
  return {
    output: write(dir, (led) => {
      const id = nextId(led, "S");
      const folder = path.join(dir, "experiments");
      fs.mkdirSync(folder, { recursive: true });
      const outFile = path.join(folder, `${id}.out`);
      fs.writeFileSync(outFile, printed);
      const event = {
        t: "source",
        id,
        kind: "experiment",
        title,
        key: `experiment:${id}`,
        command,
        ...(scriptPath ? { path: script, resolved: projectPath(scriptPath, dir) } : {}),
        output: projectPath(path.resolve(outFile), dir),
        hash: sha256(printed),
        date: new Date().toISOString().slice(0, 10),
        ...agentOf(args),
      };
      return { events: [event], output: { id, tier: "A", output: outFile, printed: printed.slice(0, 4000) } };
    }),
  };
}

/** A source filed under the wrong kind or origin is corrected in place; re-adding its URL only finds it again. */
function commandReclassify(args) {
  const dir = requireDir(args);
  const id = required(args, "source");
  const kind = kindArg(args);
  const reason = required(args, "reason");
  const origin = given(args.origin);
  return {
    output: write(dir, (led) => {
      const source = knownSource(led, id);
      if ((source.kind === "experiment") !== (kind === "experiment")) throw new Error("only the experiment command makes an experiment, and an experiment stays one");
      if (origin && !source.url) throw new Error("--origin names who stands behind a URL; the project's own files are one voice");
      const event = { t: "reclassify", source: id, kind, reason, ...(origin ? { origin: String(origin) } : {}), ...agentOf(args) };
      return { events: [event], output: { id, tier: SOURCE_KINDS[kind] } };
    }),
  };
}

function commandTopic(args) {
  const dir = requireDir(args);
  const text = required(args, "text");
  const from = required(args, "from");
  return {
    output: write(dir, (led) => {
      const source = knownSource(led, from);
      const id = nextId(led, "T");
      return { events: [{ t: "topic", id, text, from, ...agentOf(args) }], output: { id, mapSource: Boolean(source.url) && source.tier === "B" } };
    }),
  };
}

function commandQuestion(args) {
  const dir = requireDir(args);
  const text = required(args, "text");
  const topics = given(args.topic) ? String(args.topic).split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (topics.length > MAX_TOPICS_PER_QUESTION) throw new Error(`a question covers at most ${MAX_TOPICS_PER_QUESTION} topics of the map; ask one per topic`);
  const from = given(args.from) ?? (topics.length ? "map" : undefined);
  if (!from) throw new Error("--from is required: the source that raised the question (S<n>), user, or review");
  const needs = given(args.needs) ? String(args.needs).split(",").map((s) => s.trim()).filter(Boolean) : [];
  for (const kind of needs) if (!CLAIM_KINDS.includes(kind)) throw new Error(`--needs takes claim kinds: ${CLAIM_KINDS.join(", ")}`);
  return {
    output: write(dir, (led) => {
      if (/^S\d+$/.test(from)) knownSource(led, from);
      else if (!["user", "review", "map"].includes(from)) throw new Error("--from must be a source id, user, review or map");
      const parent = given(args.parent);
      if (parent && !led.questions.has(parent)) throw new Error(`no question ${parent}`);
      for (const topic of topics) if (!led.topics.has(topic)) throw new Error(`no topic ${topic}`);
      const id = nextId(led, "Q");
      const event = {
        t: "question",
        id,
        text,
        from,
        ...(parent ? { parent } : {}),
        ...(topics.length ? { topics } : {}),
        ...(needs.length ? { needs } : {}),
        ...(args.quantitative === true ? { quantitative: true } : {}),
        ...(args.timeless === true ? { timeless: true } : {}),
        ...agentOf(args),
      };
      return { events: [event], output: { id } };
    }),
  };
}

function commandPark(args) {
  const dir = requireDir(args);
  const target = given(args.question) ?? given(args.topic);
  if (!target) throw new Error("park needs --question <Q> or --topic <T>");
  const reason = required(args, "reason");
  return {
    output: write(dir, (led) => {
      if (!(target.startsWith("T") ? led.topics : led.questions).has(target)) throw new Error(`no ${target}`);
      return { events: [{ t: "park", target, reason, ...agentOf(args) }], output: { parked: target } };
    }),
  };
}

function commandClaim(args) {
  const dir = requireDir(args);
  const question = required(args, "question");
  const kind = required(args, "kind");
  if (!CLAIM_KINDS.includes(kind)) throw new Error(`--kind must be one of ${CLAIM_KINDS.join(", ")}`);
  const text = required(args, "text");
  const sourceId = required(args, "source");
  const quote = quoteArg(args);
  return {
    output: write(dir, (led) => {
      const q = led.questions.get(question);
      if (!q) throw new Error(`no question ${question}`);
      if (parkedReason(led, q)) throw new Error(`${question} is parked`);
      const source = knownSource(led, sourceId);
      const id = nextId(led, "C");
      refuseReusedQuote(led, id, sourceId, quote);
      const base = { t: "claim", id, question, kind, text, source: sourceId, quote, ...agentOf(args) };
      return { events: citationEvents(led, dir, source, id, quote, base), output: { id } };
    }),
  };
}

function commandCite(args) {
  const dir = requireDir(args);
  const claimId = required(args, "claim");
  const sourceId = required(args, "source");
  const quote = quoteArg(args);
  return {
    output: write(dir, (led) => {
      liveClaim(led, claimId);
      const source = knownSource(led, sourceId);
      refuseReusedQuote(led, claimId, sourceId, quote);
      const base = { t: "cite", claim: claimId, source: sourceId, quote, ...agentOf(args) };
      return { events: citationEvents(led, dir, source, claimId, quote, base), output: { claim: claimId, source: sourceId } };
    }),
  };
}

function commandDispute(args) {
  const dir = requireDir(args);
  const claimId = required(args, "claim");
  const by = required(args, "by");
  const note = required(args, "note");
  return {
    output: write(dir, (led) => {
      liveClaim(led, claimId);
      if (!led.sources.has(by) && !led.claims.has(by)) throw new Error(`--by must be the source or claim that disagrees (no ${by})`);
      return { events: [{ t: "dispute", claim: claimId, by, note, ...agentOf(args) }], output: { disputed: claimId } };
    }),
  };
}

function commandResolve(args) {
  const dir = requireDir(args);
  const claimId = required(args, "claim");
  const outcome = required(args, "outcome");
  if (!OUTCOMES.includes(outcome)) throw new Error(`--outcome must be one of ${OUTCOMES.join(", ")}`);
  const note = required(args, "note");
  const by = given(args.by);
  // Siding with one source over another needs the evidence that settled it; experts still disagreeing needs only saying so.
  if (outcome !== "debate" && !by) throw new Error(`--outcome ${outcome} needs --by: the source, claim or experiment that settled it`);
  return {
    output: write(dir, (led) => {
      const claim = liveClaim(led, claimId);
      if (!claim.disputes.some((dispute) => dispute.open)) throw new Error(`${claimId} has no open dispute`);
      if (by && !led.sources.has(by) && !led.claims.has(by)) throw new Error(`no source or claim ${by}`);
      return { events: [{ t: "resolve", claim: claimId, outcome, note, ...(by ? { by } : {}), ...agentOf(args) }], output: { resolved: claimId, outcome } };
    }),
  };
}

function commandRetract(args) {
  const dir = requireDir(args);
  const claimId = required(args, "claim");
  const reason = required(args, "reason");
  return {
    output: write(dir, (led) => {
      liveClaim(led, claimId);
      return { events: [{ t: "retract", claim: claimId, reason, ...agentOf(args) }], output: { retracted: claimId } };
    }),
  };
}

function commandReview(args) {
  const dir = requireDir(args);
  const by = required(args, "by");
  const note = required(args, "note");
  return {
    output: write(dir, (led) => {
      const { answered, questions } = evaluate(led, { report: reportBody(dir) });
      const ratio = questions ? round(answered / questions) : 0;
      return { events: [{ t: "review", by, note, answered: ratio }], output: { review: by, answered: ratio, counts: ratio >= REVIEW_AFTER } };
    }),
  };
}

/** A named input's identity: its URL as sources are keyed, or a file as the project sees it, without a line. */
function inputKey(ref, dir) {
  if (/^https?:\/\//i.test(ref)) return normalizeUrl(ref);
  const absolute = resolveLocal(ref, dir);
  return absolute ? projectPath(absolute, dir) : path.normalize(ref);
}

function commandInput(args) {
  const dir = requireDir(args);
  const ref = required(args, "ref");
  return { output: write(dir, () => ({ events: [{ t: "input", ref, key: inputKey(ref, dir) }], output: { input: ref } })) };
}

function commandUnreadable(args) {
  const dir = requireDir(args);
  const ref = required(args, "ref");
  const reason = required(args, "reason");
  return {
    output: write(dir, (led) => {
      const key = inputKey(ref, dir);
      if (!led.inputs.has(key)) throw new Error(`${ref} is not a named input (add it with \`input\` first)`);
      return { events: [{ t: "unreadable", key, reason }], output: { unreadable: ref } };
    }),
  };
}

function commandConfirmQuote(args) {
  const dir = requireDir(args);
  const claimId = required(args, "claim");
  const sourceId = required(args, "source");
  const how = required(args, "how");
  return {
    output: write(dir, (led) => {
      const citation = liveClaim(led, claimId).citations.get(sourceId);
      if (!citation) throw new Error(`${claimId} does not cite ${sourceId}`);
      // A hand check is for a page the script could not read, never a way around one it read.
      if (citation.check?.result !== "unverifiable") {
        throw new Error(citation.check ? `check-quotes read ${sourceId} and recorded ${citation.check.result}; a hand check is only for a source it could not read` : `run check-quotes first; a hand check is only for a source it could not read`);
      }
      return { events: [{ t: "check", claim: claimId, source: sourceId, quote: citation.quote, result: "manual", how }], output: { confirmed: `${claimId}/${sourceId}` } };
    }),
  };
}

async function commandCheckQuotes(args) {
  const dir = requireDir(args);
  const timeoutMs = given(args.timeout) === undefined ? DEFAULT_TIMEOUT_MS : int(args.timeout, "--timeout");
  const led = load(dir);
  const bySource = new Map();
  for (const claim of liveClaims(led)) {
    for (const [source, citation] of claim.citations) {
      if (citation.check && args.all !== true) continue;
      if (citation.check?.result === "manual") continue;
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source).push({ claim: claim.id, quote: citation.quote });
    }
  }
  const events = [];
  await pool([...bySource], FETCH_CONCURRENCY, async ([id, citations]) => {
    const source = led.sources.get(id);
    if (!source) return;
    const page = source.url ? await remoteText(source.url, timeoutMs) : localText(source, dir);
    for (const citation of citations) events.push({ t: "check", claim: citation.claim, source: id, quote: citation.quote, ...judgeQuote(citation.quote, page) });
  });
  if (events.length) withLock(dir, () => append(dir, events));
  const count = (result) => events.filter((event) => event.result === result).length;
  const failed = events.filter((event) => ["missing", "dead"].includes(event.result)).map(({ claim, source, result, reason }) => ({ claim, source, result, reason }));
  const unverifiable = events.filter((event) => event.result === "unverifiable").map(({ claim, source, reason }) => ({ claim, source, reason }));
  return {
    output: { checked: events.length, found: count("found"), missing: count("missing"), dead: count("dead"), unverifiable: unverifiable.length, failed, unverifiableDetail: unverifiable },
    exitCode: failed.length ? 1 : 0,
  };
}

function commandScore(args) {
  const dir = requireDir(args);
  return { output: evaluate(load(dir), { report: reportBody(dir) }) };
}

function commandStatus(args) {
  const dir = requireDir(args);
  const verdict = evaluate(load(dir), { report: reportBody(dir) });
  return args.json === true ? { output: verdict } : { text: statusText(verdict) };
}

function commandRender(args) {
  const dir = requireDir(args);
  const file = path.join(dir, RENDER_FILE);
  fs.writeFileSync(file, render(load(dir), { report: reportBody(dir) }));
  return { output: { rendered: file } };
}

function commandCheckReport(args) {
  const dir = requireDir(args);
  const problems = reportProblems(load(dir), reportBody(dir));
  return { output: { ok: problems.length === 0, problems }, exitCode: problems.length ? 1 : 0 };
}

/** state.mjs records whatever JSON it is piped, so a finished run is re-scored here from the ledger itself. */
function commandVerify(args) {
  const dir = requireDir(args);
  const verdict = evaluate(load(dir), { report: reportBody(dir) });
  const problems = [];
  if (!verdict.pass) problems.push(`the ledger is broken: ${verdict.errors.join("; ")}`);
  if (verdict.score !== 1) problems.push(`the ledger scores ${verdict.score}, not 1`);
  const stateFile = path.join(dir, "state.json");
  if (!fs.existsSync(stateFile)) problems.push("no state.json beside the ledger");
  else {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (state.phase !== "done") problems.push(`the loop stopped in "${state.phase}", not "done"`);
  }
  return { output: { ok: problems.length === 0, score: verdict.score, problems }, exitCode: problems.length ? 1 : 0 };
}

const COMMANDS = {
  init: commandInit,
  source: commandSource,
  experiment: commandExperiment,
  reclassify: commandReclassify,
  topic: commandTopic,
  question: commandQuestion,
  park: commandPark,
  claim: commandClaim,
  cite: commandCite,
  dispute: commandDispute,
  resolve: commandResolve,
  retract: commandRetract,
  review: commandReview,
  input: commandInput,
  unreadable: commandUnreadable,
  "confirm-quote": commandConfirmQuote,
  "check-quotes": commandCheckQuotes,
  score: commandScore,
  status: commandStatus,
  render: commandRender,
  "check-report": commandCheckReport,
  verify: commandVerify,
};

function usage() {
  return `ledger — the evidence a research run is scored by (o-research).

Usage: node ledger.mjs <command> --dir <run dir> [flags]
Every command takes --dir, the folder state.mjs start printed. Writes are safe from parallel agents.

Setup
  init          [--depth quick|standard|deep] [--recent-years <n>] [--from <earlier run dir>]
  input         --ref <url|path>                       a source the user named
  unreadable    --ref <url|path> --reason <why>        a named input that could not be opened

What was read
  source        (--url <u> [--origin <who>] | --path <file> [--line <n>]) --kind <kind> --title <t>
                [--date YYYY[-MM[-DD]]|n.d.]            kinds: ${Object.entries(SOURCE_KINDS).filter(([k]) => k !== "experiment").map(([k, t]) => `${k}=${t}`).join(" ")}
  experiment    --command "<shell command>" --title <t> [--path <script>] [--timeout <ms>]
                                                        runs it from the project root and saves what it printed
  reclassify    --source <S> --kind <kind> --reason <why> [--origin <who>]   correct a misfiled source
  topic         --text <t> --from <S>                  a topic of the field's own map (survey, textbook, course, talk)
  question      --text <t> (--from <S>|user|review | --topic <T>[,<T>]) [--parent <Q>] [--quantitative] [--timeless]
                [--needs <claim kinds>]
  park          (--question <Q> | --topic <T>) --reason <why it is out of scope>
  claim         --question <Q> --kind <kind> --text <t> --source <S> --quote <verbatim words | ->
                                                        kinds: ${CLAIM_KINDS.join(", ")}
  cite          --claim <C> --source <S> --quote <verbatim words | ->   another source backing a claim
  dispute       --claim <C> --by <S|C> --note <what disagrees>
  resolve       --claim <C> --outcome upheld|refuted|debate --note <why> [--by <S|C>]   (--by unless debate)
  retract       --claim <C> --reason <why>
  review        --by <reviewer> --note <what they found>

Checking and scoring
  check-quotes  [--all] [--timeout <ms>]               fetch each cited source and look for its quote; exit 1 on a miss
  confirm-quote --claim <C> --source <S> --how <how you checked it>   only for a source check-quotes could not read
  score                                                evaluator JSON {pass, score, ...} for state.mjs record
  status        [--json]                               what each question and gate still needs
  render                                               write ledger.md, the evidence appendix the report links
  check-report                                         is the report below the findings marker complete; exit 1 if not
  verify                                               re-score the ledger; exit 0 only when it is 1 and the loop is done

Any write takes --agent <label> to record which researcher made it.
`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || (next.startsWith("--") && next.length > 2)) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  try {
    const run = COMMANDS[command];
    if (!run) throw new Error(`unknown command "${command}"`);
    const args = parseArgs(rest);
    if (args.help === true) {
      process.stdout.write(usage());
      return;
    }
    const { output, text, exitCode = 0 } = await run(args);
    process.stdout.write(text ?? `${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = exitCode;
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
