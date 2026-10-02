#!/usr/bin/env node
/**
 * o-skill-lint — trigger-rate measurement.
 *
 * Answers the two questions a description's wording decides, deterministically and without spending tokens:
 * does each skill's description carry the vocabulary its own queries use (so it ranks first for them), and do
 * any two descriptions say so nearly the same thing that a query cannot tell them apart? It is a lexical
 * approximation of routing — it cannot judge meaning — but it catches the two failure modes that dominate real
 * trigger bugs: a description missing the words users say, and an over-broad description that outranks the
 * right skill.
 *
 * Usage: node trigger-rate.mjs [--root <dir>] [--min-rank1 <pct>] [--json] [--help]
 * Exit:  0 within the floor (or reporting only) · 1 below it · 2 usage error
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFrontmatter, REPO_ROOT } from "./lint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Words that appear in nearly every description and in nearly every query, so they separate nothing. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "for", "from", "in", "into", "is", "it", "its",
  "no", "not", "of", "on", "or", "that", "the", "this", "to", "use", "used", "using", "when", "with", "you",
  "your",
]);

/** A light stemmer, enough to make `tests` and `test` the same word. Never shortens below three characters. */
export function stem(token) {
  for (const suffix of ["ing", "es", "ed", "s"]) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) return token.slice(0, token.length - suffix.length);
  }
  return token;
}

export function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stem);
}

/** Cosine over tf-idf weights: a query is ranked against every description, not just its own. */
function vectorize(documents) {
  const df = new Map();
  for (const tokens of documents) for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  const total = documents.length || 1;
  const idf = (token) => Math.log(total / (df.get(token) ?? 0.5)) + 1;
  return documents.map((tokens) => {
    const weights = new Map();
    for (const token of tokens) weights.set(token, (weights.get(token) ?? 0) + 1);
    let norm = 0;
    for (const [token, count] of weights) {
      const weight = (1 + Math.log(count)) * idf(token);
      weights.set(token, weight);
      norm += weight * weight;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [token, weight] of weights) weights.set(token, weight / norm);
    return weights;
  });
}

const cosine = (a, b) => {
  let dot = 0;
  for (const [token, weight] of a) dot += weight * (b.get(token) ?? 0);
  return dot;
};

const COLLISION = 0.75;
const NEAR_COLLISION = 0.5;

/** Rank every skill for a query, most similar first. Ties break by name so a run is reproducible. */
export function rank(query, skills, vectors) {
  const queryVector = vectorize([tokenize(query), ...skills.map(() => [])])[0];
  return skills
    .map((skill, index) => ({ skill, score: cosine(queryVector, vectors[index]) }))
    .sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill));
}

export function measure(root = REPO_ROOT) {
  const skillsDir = path.join(root, "skills");
  const names = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const descriptions = new Map();
  for (const name of names) {
    const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    const frontmatter = parseFrontmatter(text) ?? {};
    // The name is part of the vocabulary a user reaches for ("plan", "review"), and descriptions do not
    // always repeat it.
    descriptions.set(name, `${name.replace(/^o-/, "").replace(/-/g, " ")} ${frontmatter.description ?? ""}`);
  }

  const vectors = vectorize(names.map((name) => tokenize(descriptions.get(name))));
  const rows = [];
  for (const name of names) {
    const file = path.join(skillsDir, name, "evals", "triggers.json");
    if (!fs.existsSync(file)) continue;
    const queries = JSON.parse(fs.readFileSync(file, "utf8")).queries ?? [];
    for (const entry of queries) {
      const ranked = rank(entry.query, names, vectors);
      const top = ranked[0];
      rows.push({
        skill: name,
        query: entry.query,
        shouldTrigger: entry.should_trigger === true,
        top: top.skill,
        topScore: Number(top.score.toFixed(3)),
        ok: entry.should_trigger === true ? top.skill === name : top.skill !== name,
        runnerUp: ranked[1]?.skill ?? null,
      });
    }
  }

  const positives = rows.filter((row) => row.shouldTrigger);
  const negatives = rows.filter((row) => !row.shouldTrigger);
  const ranking = positives.filter((row) => row.ok);
  const falsePositives = negatives.filter((row) => !row.ok);

  const collisions = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const score = cosine(vectors[i], vectors[j]);
      if (score >= NEAR_COLLISION) collisions.push({ a: names[i], b: names[j], score: Number(score.toFixed(3)) });
    }
  }

  const rank1 = positives.length ? (ranking.length / positives.length) * 100 : 100;
  return {
    root,
    skills: names.length,
    skillsWithTriggers: new Set(rows.map((row) => row.skill)).size,
    positives: positives.length,
    rank1: Number(rank1.toFixed(1)),
    negatives: negatives.length,
    falsePositives: falsePositives.length,
    collisions,
    misses: positives.filter((row) => !row.ok),
    unexpected: falsePositives,
  };
}

function usage() {
  return [
    "o-skill-lint — trigger-rate measurement.",
    "",
    "Usage:",
    "  node trigger-rate.mjs                    # report the rate; exits 0",
    "  node trigger-rate.mjs --min-rank1 95     # gate on it; exits 1 below the floor",
    "  node trigger-rate.mjs --json             # the raw measurement only",
    "  node trigger-rate.mjs --root <dir>",
    "",
    "Exit: 0 within the floor (or reporting only) · 1 below it · 2 usage error",
    "",
  ].join("\n");
}

function report(measurement) {
  const lines = [
    `trigger rank-1: ${measurement.rank1}% of ${measurement.positives} should-trigger queries over ${measurement.skillsWithTriggers} skill(s)`,
    `should-not-trigger that fired the wrong skill: ${measurement.falsePositives}/${measurement.negatives}`,
  ];
  for (const row of measurement.misses) lines.push(`  MISS  ${row.skill}: "${row.query}" ranked "${row.top}" first` + (row.runnerUp ? ` (runner-up "${row.runnerUp}")` : ""));
  for (const row of measurement.unexpected) lines.push(`  FALSE ${row.skill}: "${row.query}" ranked "${row.top}" first`);
  if (measurement.collisions.length) {
    lines.push("description collisions:");
    for (const pair of measurement.collisions) lines.push(`  ${pair.score >= COLLISION ? "ERROR" : "WARN "} ${pair.a} ~ ${pair.b} (${pair.score})`);
  }
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    if (index === -1) return fallback;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
    return value;
  };
  try {
    if (args.includes("--help") || args.includes("-h")) {
      process.stdout.write(usage());
      return;
    }
    const known = ["--root", "--min-rank1"];
    const unknown = args.filter((arg, index) => arg.startsWith("--") && !known.includes(arg) && !["--json", "--help", "-h"].includes(arg) && !known.includes(args[index - 1]));
    if (unknown.length) throw new Error(`unknown argument ${unknown[0]}`);

    const root = path.resolve(option("--root", REPO_ROOT));
    const measurement = measure(root);
    const min = option("--min-rank1", null);
    if (min !== null && !Number.isFinite(Number(min))) throw new Error("--min-rank1 needs a number");

    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`);
    } else {
      process.stdout.write(`${report(measurement)}\n`);
    }
    // Reporting only unless a floor is asked for: the number is the point, and a repo sets its own floor.
    if (min === null) process.exit(0);
    process.exit(measurement.rank1 >= Number(min) ? 0 : 1);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
