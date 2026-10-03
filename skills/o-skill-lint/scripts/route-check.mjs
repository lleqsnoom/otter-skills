#!/usr/bin/env node
/**
 * route-check — ask a model which skill each trigger query should load, and score the answers like trigger-rate.
 *
 * trigger-rate measures word overlap, which is cheap enough for CI and blind to meaning: a description rewritten
 * to say what users mean can lose queries to a neighbour that happens to share a word. This puts the same queries
 * to a model that reads the descriptions the way a host's router does. It costs one model call per batch, so it
 * runs on demand, never in CI.
 *
 * The model command reads the prompt on stdin and prints the answer, as `claude -p`, `codex exec -` or `crush run`
 * do. It is the user's own command line and runs through the shell; nothing from the repository is put into it.
 *
 * Usage: node route-check.mjs --model-cmd "claude -p" [--root <dir>] [--batch 90] [--dry-run]
 * Exit:  0 measured · 2 usage error or a model call that failed
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseFrontmatter, REPO_ROOT } from "./lint.mjs";

const USAGE = `Usage: node route-check.mjs --model-cmd "<command>" [--root <dir>] [--batch <n>] [--dry-run]
Asks a model which skill each trigger query should load, and reports rank-1 and false triggers per skill.`;

const MODEL_TIMEOUT_MS = 10 * 60 * 1000;

/** The skills a router can pick — a skill the model may not invoke is never one — and every labelled query. */
export function routingSet(root) {
  const skillsDir = path.join(root, "skills");
  const skills = [];
  const queries = [];
  for (const name of fs.readdirSync(skillsDir).sort()) {
    const file = path.join(skillsDir, name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const frontmatter = parseFrontmatter(fs.readFileSync(file, "utf8")) ?? {};
    if (String(frontmatter["disable-model-invocation"]) === "true") continue;
    skills.push({ name, description: frontmatter.description ?? "" });
    const triggers = path.join(skillsDir, name, "evals", "triggers.json");
    if (!fs.existsSync(triggers)) continue;
    for (const entry of JSON.parse(fs.readFileSync(triggers, "utf8")).queries ?? []) {
      queries.push({ id: queries.length + 1, skill: name, query: entry.query, shouldTrigger: entry.should_trigger === true });
    }
  }
  return { skills, queries };
}

/** One batch as a prompt: the catalogue, the numbered requests, and the exact answer shape. */
export function buildPrompt(skills, batch) {
  return [
    "You route a coding agent's requests to skills. Each skill below has a name and the description the agent sees.",
    "For each numbered request, name the one skill the agent should load for it, or none when no skill fits.",
    "",
    "Skills:",
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
    "",
    "Requests:",
    ...batch.map((entry) => `${entry.id}. ${entry.query}`),
    "",
    'Answer with only a JSON array, one object per request, in order: [{"id": 1, "skill": "o-plan"}, {"id": 2, "skill": "none"}]',
  ].join("\n");
}

/** The id → skill map in a model's answer; the first JSON array in it, so prose around it does not matter. */
export function parseAnswer(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("the answer holds no JSON array");
  return new Map(JSON.parse(text.slice(start, end + 1)).map((row) => [Number(row.id), String(row.skill ?? "none")]));
}

/** Rank-1 over the should-trigger queries, false triggers over the rest, and every miss by name. */
export function score(queries, picks) {
  const rows = queries.map((entry) => ({ ...entry, pick: picks.get(entry.id) ?? "none" }));
  const positives = rows.filter((row) => row.shouldTrigger);
  const negatives = rows.filter((row) => !row.shouldTrigger);
  const hits = positives.filter((row) => row.pick === row.skill);
  const falses = negatives.filter((row) => row.pick === row.skill);
  return {
    rank1: positives.length ? Number(((hits.length / positives.length) * 100).toFixed(1)) : 100,
    positives: positives.length,
    falseTriggers: falses.length,
    negatives: negatives.length,
    misses: positives.filter((row) => row.pick !== row.skill).map(({ skill, query, pick }) => ({ skill, query, pick })),
    unexpected: falses.map(({ skill, query }) => ({ skill, query })),
  };
}

function askModel(command, prompt) {
  const result = spawnSync(command, { shell: true, input: prompt, encoding: "utf8", timeout: MODEL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`model command failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`model command exited ${result.status}: ${String(result.stderr).slice(0, 300)}`);
  return result.stdout;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const command = value("--model-cmd");
  const batchSize = Number(value("--batch") ?? 90);
  if ((!command && !args.includes("--dry-run")) || !(batchSize > 0)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const { skills, queries } = routingSet(path.resolve(value("--root") ?? REPO_ROOT));
  const batches = Array.from({ length: Math.ceil(queries.length / batchSize) }, (_, i) => queries.slice(i * batchSize, (i + 1) * batchSize));
  if (args.includes("--dry-run")) {
    console.log(JSON.stringify({ skills: skills.length, queries: queries.length, batches: batches.length, promptChars: batches.map((b) => buildPrompt(skills, b).length) }, null, 2));
    return;
  }
  try {
    const picks = new Map();
    for (const [index, batch] of batches.entries()) {
      process.stderr.write(`route-check: batch ${index + 1}/${batches.length}\n`);
      for (const [id, skill] of parseAnswer(askModel(command, buildPrompt(skills, batch)))) picks.set(id, skill);
    }
    console.log(JSON.stringify(score(queries, picks), null, 2));
  } catch (error) {
    console.error(`route-check: ${error.message}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
