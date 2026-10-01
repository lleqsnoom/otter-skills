#!/usr/bin/env node

/**
 * Write E<nn>-review-plan.md into the run folder, or into --output when given.
 * Runs all analysis scripts (complexity, duplication, refactor patterns)
 * and pre-fills the plan with aggregated statistics.
 *
 * Usage:
 *   node save-plan.mjs --output <dir> [--branch <name>]
 *
 * Output (stdout): absolute path to the plan file, ready to write into with `write`.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { changeScope } from "./change-scope.mjs";

/** The directory this script sits in: ESM has no __dirname, and the siblings are spawned from here. */
const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--output" || argv[i] === "-o") && i + 1 < argv.length) args.output = argv[++i];
    else if (argv[i] === "--slug" && i + 1 < argv.length) args.slug = argv[++i];
    else if (argv[i] === "--branch" && i + 1 < argv.length) args.branch = argv[++i];
    else if (argv[i] === "--new-run") args.newRun = true;
    else if (argv[i] === "--run" && i + 1 < argv.length) args.run = argv[++i];
    else if (argv[i] === "--reviews" && i + 1 < argv.length) args.reviews = argv[++i];
    else if (argv[i] === "--base" && i + 1 < argv.length) args.base = argv[++i];
    else if (argv[i] === "--files" && i + 1 < argv.length) args.files = argv[++i];
    else if (argv[i] === "--all") args.all = true;
  }
  return args;
}

function getBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.GIT_BRANCH || "unknown";
  }
}

// ── Timestamp (JS-generated only — never LLM-determined) ─────────────

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

// ── Run folders ──────────────────────────────────────────────────────
// #region run-folder
// Two digits, not more: a wider counter would sort E100 before E99.
const RUNS_ROOT = ".x-skills/runs";
const MAX_COUNTER = 99;

function padRunCounter(value) {
  return String(value).padStart(2, "0");
}

function runFolders(rootAbs, slug) {
  if (!fs.existsSync(rootAbs)) return [];
  return fs
    .readdirSync(rootAbs)
    .filter((name) => name.endsWith(`-${slug}`))
    .sort();
}

// Counts runs of this slug only, so R<nn> reads as "the nth run of this topic".
// Works together with `fresh`: a global counter would make the number depend on
// unrelated topics, and per-slug numbering alone could never reach 02 because
// resolveRunDir joins an existing run for the slug.
function highestRun(rootAbs, slug) {
  return runFolders(rootAbs, slug).reduce((max, name) => {
    const match = name.match(/-R(\d+)-/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function mintRunDir(rootAbs, slug, now) {
  const run = highestRun(rootAbs, slug) + 1;
  if (run > MAX_COUNTER) throw new Error(`run counter would exceed R${MAX_COUNTER}`);
  const stamp = `${now.getFullYear()}-${padRunCounter(now.getMonth() + 1)}-${padRunCounter(now.getDate())}-${padRunCounter(now.getHours())}${padRunCounter(now.getMinutes())}`;
  const dir = path.join(rootAbs, `${stamp}-R${padRunCounter(run)}-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Return the run folder for a slug, choosing in this order:
 * `fresh` mints a new R<nn>, `run` selects that R number, `marker` selects the
 * folder holding that artifact, one match is returned, none mints, and more
 * than one without a selector throws rather than guessing.
 */
function resolveRunDir(slug, { root = RUNS_ROOT, now = new Date(), marker = null, fresh = false, run = null } = {}) {
  if (!slug || typeof slug !== "string") throw new Error("slug is required");
  const rootAbs = path.resolve(root);
  fs.mkdirSync(rootAbs, { recursive: true });

  if (fresh) return mintRunDir(rootAbs, slug, now);

  const folders = runFolders(rootAbs, slug);
  if (run !== null) {
    const wanted = `-R${padRunCounter(run)}-`;
    const picked = folders.find((name) => name.includes(wanted));
    if (!picked) throw new Error(`no run R${padRunCounter(run)} for "${slug}"`);
    return path.join(rootAbs, picked);
  }
  if (marker) {
    const holding = folders.filter((name) => fs.existsSync(path.join(rootAbs, name, marker)));
    if (holding.length) return path.join(rootAbs, holding[holding.length - 1]);
  }
  if (folders.length > 1) {
    throw new Error(`${folders.length} runs match "${slug}"; pass --run <nn> to pick one, or --new-run to start another`);
  }
  if (folders.length) return path.join(rootAbs, folders[0]);
  return mintRunDir(rootAbs, slug, now);
}

function nextE(runDir) {
  const used = fs.existsSync(runDir)
    ? fs
        .readdirSync(runDir)
        .map((name) => {
          const match = name.match(/^E(\d{2})-/);
          return match ? Number(match[1]) : null;
        })
        .filter((value) => value !== null)
    : [];
  const next = used.length ? Math.max(...used) + 1 : 0;
  if (next > MAX_COUNTER) throw new Error(`artifact counter would exceed E${MAX_COUNTER}`);
  return `E${String(next).padStart(2, "0")}`;
}
// #endregion run-folder

// ── Self-discovery ────────────────────────────────────────────────────

const SKILL_DIR = path.resolve(HERE, ".."); // parent of scripts/

function scriptPath(rel) {
  return path.join(SKILL_DIR, "scripts", rel);
}

/** A whole-repo analyzer document runs to megabytes, and the 1 MiB default would cut it into `ENOBUFS`. */
const ANALYSIS_OUTPUT_LIMIT = 512 * 1024 * 1024;

/**
 * Run one analysis script. The result carries `ok` so the caller can tell "found nothing" from
 * "never ran": a crashed analyzer that reports zero issues is a false all-clear, and the plan must
 * say so rather than print a clean bill of health.
 */
function runAnalysis(scriptName, args = []) {
  try {
    const output = execFileSync("node", [scriptPath(scriptName), ...args], {
      cwd: process.cwd(),
      timeout: 120_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: ANALYSIS_OUTPUT_LIMIT,
    });
    return { ok: true, data: JSON.parse(output) };
  } catch (err) {
    console.error(`[x-review] Warning: ${scriptName} failed:`, err.message);
    return { ok: false, script: scriptName, error: firstLine(err.message) };
  }
}

/** execSync packs the command and its stderr into one message; the plan needs only the gist. */
function firstLine(message) {
  return String(message ?? "").split("\n").filter((line) => line.trim())[0].slice(0, 200) || "unknown error";
}

// ── Stats aggregation ────────────────────────────────────────────────

function aggregateStats(complexity, duplication, patterns) {
  const stats = {
    totalFilesAnalyzed: new Set(),
    functionsHighComplexity: 0,
    functionsLong: 0,
    functionsTooManyParams: 0,
    duplicatedBlocks: 0,
    refactorSuggestions: 0,
    byType: {},
  };

  // Count with the thresholds the analyzer actually applied, falling back to the defaults only when
  // an older analyzer did not report them.
  const C = { maxComplexity: 5, maxLength: 20, maxParams: 3, ...(complexity?.summary?.thresholds || {}) };
  if (complexity) {
    for (const f of complexity.files || []) {
      stats.totalFilesAnalyzed.add(f.file);
      for (const fn of f.functions || []) {
        if (fn.complexity > C.maxComplexity) stats.functionsHighComplexity++;
        if (fn.length > C.maxLength) stats.functionsLong++;
        if (fn.paramCount > C.maxParams) stats.functionsTooManyParams++;
      }
    }
  }

  // Duplication stats
  if (duplication) {
    stats.duplicatedBlocks = duplication.duplicatedBlocks || 0;
    for (const d of duplication.duplicates || []) {
      stats.totalFilesAnalyzed.add(d.file);
    }
  }

  // Refactor pattern stats
  if (patterns) {
    for (const r of patterns.results || []) {
      stats.totalFilesAnalyzed.add(r.path);
      for (const s of r.suggestions || []) {
        stats.refactorSuggestions++;
        const type = s.type.replace(/-/g, " ");
        if (!stats.byType[type]) stats.byType[type] = 0;
        stats.byType[type]++;
      }
    }
  }

  return stats;
}

// ── Scope ────────────────────────────────────────────────────────────

/**
 * What the review measures, decided once: the analyzers and the header both read this value, so the Scope line can
 * never name one set of files while the counts describe another.
 */
function resolveScope(args) {
  if (args.all) return { kind: "all" };
  if (args.files) {
    const files = args.files.split(",").map((file) => path.resolve(file.trim())).filter((file) => fs.existsSync(file));
    return { kind: "files", files };
  }
  return changeScope({ base: args.base });
}

const isWholeTree = (scope) => scope.kind === "all" || scope.kind === "tree";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function scopeLine(scope) {
  if (scope.kind === "all") return "**Scope:** whole repository (--all)";
  if (scope.kind === "tree") return `**Scope:** whole tree (${scope.reason})`;
  if (scope.kind === "files") return `**Scope:** ${plural(scope.files.length, "file")} named with --files`;
  const parts = [`${scope.committed.length} committed`, `${scope.staged.length} staged`, `${scope.unstaged.length} unstaged`, `${scope.untracked.length} untracked`];
  return `**Scope:** ${plural(scope.files.length, "file")} changed vs ${scope.ref}@${scope.mergeBase.slice(0, 7)} (${parts.join(", ")})`;
}

/** Why a scope with no files measured nothing, or null when it has something to measure. */
function emptyReason(scope) {
  if (isWholeTree(scope) || scope.files.length) return null;
  return scope.kind === "files" ? "no source files named with --files" : `no changed source files vs ${scope.ref}`;
}

// ── Plan header generation ───────────────────────────────────────────

/** One count line: the value, or why it was not measured — an unmeasured count is never a zero. */
function countLine(scope, failed) {
  const empty = emptyReason(scope);
  const failedNames = new Set(failed.map((run) => run.script));
  return (label, value, script) => {
    if (empty) return `**${label}:** not measured — ${empty}`;
    if (failedNames.has(script)) return `**${label}:** unknown — ${script} failed, so this was not measured`;
    return `**${label}:** ${value}`;
  };
}

function generatePlanHeader(stats, branch, failed = [], scope = { kind: "all" }) {
  const totalFiles = isWholeTree(scope) ? stats.totalFilesAnalyzed.size : scope.files.length;
  const metric = countLine(scope, failed);
  const lines = [];
  lines.push("# Code Review — Fix Plan");
  lines.push("");
  lines.push(`**Date:** ${getTimestamp()}`);
  lines.push(`**Branch:** ${branch}`);
  lines.push(scopeLine(scope) + (isWholeTree(scope) ? "" : " · duplication: whole repository"));
  lines.push(`**Total files analyzed:** ${totalFiles}`);
  lines.push(metric("Functions with complexity > 5", stats.functionsHighComplexity, "analyze-complexity.mjs"));
  lines.push(metric("Functions longer than 20 lines", stats.functionsLong, "analyze-complexity.mjs"));
  lines.push(metric("Duplicated blocks found", stats.duplicatedBlocks, "check-duplication.mjs"));
  lines.push("");

  if (failed.length) {
    lines.push("> ⚠️ **Analysis incomplete.** A count above is unknown, not zero:");
    for (const run of failed) lines.push(`> - \`${run.script}\` failed: ${run.error}`);
    lines.push("");
  }

  if (stats.refactorSuggestions > 0) {
    lines.push("## Refactoring Suggestions Summary");
    lines.push("");
    for (const [type, count] of Object.entries(stats.byType)) {
      lines.push(`- **${type}:** ${count}`);
    }
    lines.push("");
  }

  if (stats.functionsTooManyParams > 0) {
    lines.push(`> ⚠️ ${stats.functionsTooManyParams} function(s) have more than 3 parameters.`);
    lines.push("");
  }

  return lines.join("\n");
}

/** The `topics` items of a file's leading property block, as written; none when it has no block or no topics. */
function topicsOf(file) {
  if (!file || !fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const end = lines[0]?.trim() === "---" ? lines.findIndex((line, index) => index > 0 && line.trim() === "---") : -1;
  const start = lines.findIndex((line, index) => index > 0 && index < end && line === "topics:");
  if (start === -1) return [];
  const rest = lines.slice(start + 1, end);
  const stop = rest.findIndex((line) => !/^\s+-\s/.test(line));
  return stop === -1 ? rest : rest.slice(0, stop);
}

/** A path inside a `.x-skills` tree, from its root and without `.md` — the form Obsidian links by — or `null` outside one. */
function vaultNote(target) {
  const parts = path.resolve(target).split(path.sep);
  const at = parts.lastIndexOf(".x-skills");
  return at === -1 ? null : parts.slice(at + 1).join("/").replace(/\.md$/, "");
}

/** A run folder's topic: its name without the `YYYY-MM-DD-hhmm-R<nn>-` stamp. */
function runSlug(runDir) {
  return path.basename(path.resolve(runDir)).replace(/^\d{4}-\d{2}-\d{2}-\d{4}-R\d+-/, "");
}

/** A note's file name as words: `L0-T2-some-task` reads `L0-T2 · some task`, `E00-plan` reads `plan`. */
function noteLabel(note) {
  const name = path.basename(note).replace(/\.md$/, "");
  const task = name.match(/^(L\d+-T\d+)-(.+)$/);
  if (task) return `${task[1]} · ${task[2].replace(/-/g, " ")}`;
  return name.replace(/^E\d+-/, "").replace(/[-_]/g, " ");
}

/** The plan's property block: a review, its title, the run hub it belongs to, and what it reviewed when that is in the vault. */
function propertyBlock(runDir, reviewed) {
  const run = vaultNote(path.join(runDir, "index"));
  const target = reviewed ? vaultNote(reviewed) : null;
  const topics = target ? topicsOf(reviewed) : [];
  const title = target ? `Review of ${noteLabel(target)}` : `Review · ${runSlug(runDir)}`;
  return [
    "---",
    "type: review",
    `title: ${JSON.stringify(title)}`,
    ...(run ? [`run: "[[${run}]]"`] : []),
    ...(target ? [`reviews: "[[${target}]]"`] : []),
    ...(topics.length ? ["topics:", ...topics] : []),
    "---",
    "",
  ].join("\n");
}

/** Complexity and patterns measure the scope; duplication scans the whole repository. */
function analyze(files) {
  console.error("[x-review] Running complexity analysis...");
  const complexity = runAnalysis("analyze-complexity.mjs", files);
  console.error("[x-review] Running duplication check...");
  const duplication = runAnalysis("check-duplication.mjs", ["--all"]);
  console.error("[x-review] Running refactor pattern detection...");
  const patterns = runAnalysis("analyze-patterns.mjs", files);
  return [complexity, duplication, patterns];
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.output && !args.slug) {
    console.error("Usage: node save-plan.mjs [--output <dir> | --slug <topic>] [--branch <name>] [--reviews <task or plan file>]");
    process.exit(1);
  }

  const branch = args.branch || getBranch();
  const dir = args.output
    ? path.resolve(args.output)
    : resolveRunDir(args.slug || "review", {
        fresh: args.newRun === true,
        run: args.run === undefined ? null : Number(args.run),
      });
  const fullPath = path.join(dir, `${nextE(dir)}-review-plan.md`);

  fs.mkdirSync(dir, { recursive: true });

  const scope = resolveScope(args);
  const runs = emptyReason(scope) ? [] : analyze(isWholeTree(scope) ? ["--all"] : scope.files);
  const [complexity, duplication, patterns] = runs.map((run) => run.data);
  const stats = aggregateStats(complexity, duplication, patterns);
  const failed = runs.filter((run) => !run.ok);
  const header = generatePlanHeader(stats, branch, failed, scope);

  fs.writeFileSync(fullPath, propertyBlock(dir, args.reviews) + header + "\n\n---\n\n## Issues (fill in during review)\n");
  console.log(fullPath);
}

export { generatePlanHeader };

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
