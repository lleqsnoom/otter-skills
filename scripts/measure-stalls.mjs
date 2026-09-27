#!/usr/bin/env node
/**
 * measure-stalls — score the autoreflection scanner on the labelled stall corpus.
 *
 * The metric is session-level F1 over `test/fixtures/stall-ground-truth.json`: a session counts as
 * predicted when the scanner emits any stall signal, and a positive counts as found only when every
 * kind it expects is present. Prints `{ "pass": bool, "score": number }` beside the counts, so the
 * x-research loop can read it as a command evaluator.
 *
 * Usage:
 *   node tools/measure-stalls.mjs [--fixture <file>] [--target <f1>] [--json]
 *
 * Exit: 0 when the score reaches the target · 1 when it does not · 2 on a usage error.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const READ = path.join(REPO, "skills", "x-autoreflection", "scripts", "read-session.mjs");
const SCAN = path.join(REPO, "skills", "x-autoreflection", "scripts", "scan-session.mjs");
const DEFAULT_FIXTURE = path.join(REPO, "test", "fixtures", "stall-ground-truth.json");

/** The signals a stalled run leaves. A session carrying any of them is predicted positive. */
export const STALL_KINDS = ["user-stuck", "blocking-wait"];

function parseArgs(args) {
  const out = { fixture: DEFAULT_FIXTURE, target: 0.95, json: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--fixture") out.fixture = args[++i];
    else if (arg === "--target") out.target = Number(args[++i]);
    else if (arg === "--json") out.json = true;
    else if (arg === "--verbose") out.verbose = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument "${arg}"`);
  }
  return out;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

/** A crush session is only readable through its own project, so it is dumped first and read as a file. */
function sessionPath(entry, dir) {
  const name = entry.id.replace(/[^A-Za-z0-9._-]/g, "_");
  const out = path.join(dir, `${name}.json`);
  if (entry.host === "crush") {
    const raw = run("crush", ["session", "show", entry.id, "--json"], { cwd: entry.project });
    if (raw.status !== 0 || !raw.stdout.trim()) throw new Error(`crush session show failed for ${entry.id}: ${raw.stderr.trim()}`);
    const rawFile = path.join(dir, `${name}.raw.json`);
    fs.writeFileSync(rawFile, raw.stdout);
    const read = run("node", [READ, "--file", rawFile, "--out", out]);
    if (read.status !== 0) throw new Error(`read-session failed for ${entry.id}: ${read.stderr.trim()}`);
    return out;
  }
  const args = [READ, "--session", entry.id, "--out", out];
  if (entry.host) args.push("--host", entry.host);
  const read = run("node", args);
  if (read.status !== 0) throw new Error(`read-session failed for ${entry.id}: ${read.stderr.trim()}`);
  return out;
}

/** The kinds one session leaves, or a reason the session could not be read. */
export function kindsOf(entry, dir) {
  const file = sessionPath(entry, dir);
  const scan = run("node", [SCAN, "--input", file]);
  if (scan.status !== 0) throw new Error(`scan-session failed for ${entry.id}: ${scan.stderr.trim()}`);
  const signals = JSON.parse(scan.stdout).signals ?? [];
  return { kinds: signals.map((signal) => signal.kind), signals };
}

export function measure(fixture, { target = 0.95, dir = fs.mkdtempSync(path.join(os.tmpdir(), "measure-stalls-")) } = {}) {
  const rows = [];
  for (const entry of fixture.positives ?? []) {
    const { kinds } = kindsOf(entry, dir);
    const expected = entry.expect ?? ["user-stuck"];
    const missing = expected.filter((kind) => !kinds.includes(kind));
    rows.push({ id: entry.id, positive: true, expected, kinds, found: missing.length === 0, missing });
  }
  for (const entry of fixture.negatives ?? []) {
    const { kinds } = kindsOf(entry, dir);
    const fired = STALL_KINDS.filter((kind) => kinds.includes(kind));
    rows.push({ id: entry.id, positive: false, expected: [], kinds, found: fired.length === 0, missing: fired });
  }

  const tp = rows.filter((row) => row.positive && row.found).length;
  const fn = rows.filter((row) => row.positive && !row.found).length;
  const fp = rows.filter((row) => !row.positive && !row.found).length;
  const tn = rows.filter((row) => !row.positive && row.found).length;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    pass: score >= target,
    score: Number(score.toFixed(4)),
    target,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    tp,
    fp,
    fn,
    tn,
    rows,
  };
}

function usage() {
  return [
    "measure-stalls — score the scanner on the labelled stall corpus.",
    "",
    "Usage: node tools/measure-stalls.mjs [--fixture <file>] [--target <f1>] [--json] [--verbose]",
    "",
    "Exit: 0 the score reaches the target · 1 it does not · 2 a usage error",
    "",
  ].join("\n");
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n${usage()}`);
    process.exit(2);
    return;
  }
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  try {
    const fixture = JSON.parse(fs.readFileSync(args.fixture, "utf8"));
    const result = measure(fixture, { target: args.target });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      for (const row of result.rows) {
        const mark = row.found ? "ok  " : "MISS";
        process.stdout.write(`${mark} ${row.positive ? "want" : "skip"} ${row.id} expected [${row.expected}] fired [${row.kinds.join(", ")}]\n`);
      }
      process.stdout.write(
        `${JSON.stringify({
          pass: result.pass,
          score: result.score,
          target: result.target,
          precision: result.precision,
          recall: result.recall,
          tp: result.tp,
          fp: result.fp,
          fn: result.fn,
        })}\n`
      );
    }
    process.exit(result.pass ? 0 : 1);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
