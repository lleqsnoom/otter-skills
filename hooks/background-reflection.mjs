#!/usr/bin/env node

/**
 * Background reflection — a Stop hook that counts work and, when a session has done enough of it,
 * runs o-autoreflection's analyze stage in the background, report-only.
 *
 * The trigger is deterministic, not judgemental: it counts tool calls and fires when the count
 * crosses AUTOHARNESS_REFLECT_EVERY_N. The fired pass runs `improve.mjs <period> --no-plan`, which
 * writes the report and stops before Propose — so the background never edits a skill, a detector,
 * or a gate; a human still runs the apply stage. Fail-open throughout: a hung or missing analyzer
 * can delay nothing, and a missed reflection never fails the turn.
 *
 * Usage: installed as a Stop hook. Reads the payload as a JSON stdin line, a positional file path,
 * or nothing (one turn's worth of one tool call). State lives in .o-skills/autoreflection/counter.json.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(__dirname, "..", "skills", "o-autoreflection");

export const DEFAULT_THRESHOLD = 50;
export const DEFAULT_PERIOD = "24h";

/** Pure: does this count cross the threshold, and what is the counter after a reflection? */
export function shouldReflect(count, threshold) {
  if (count >= threshold) return { reflect: true, next: 0 };
  return { reflect: false, next: count };
}

/** Pure: add this turn's calls to the state and decide. */
export function advance(state, calls, threshold) {
  const count = (state?.count ?? 0) + (Number.isFinite(calls) ? calls : 1);
  const decision = shouldReflect(count, threshold);
  return { count: decision.next, reflect: decision.reflect, previous: count };
}

export function statePath(cwd = process.cwd()) {
  return path.resolve(cwd, ".o-skills", "autoreflection", "counter.json");
}

export function readState(cwd = process.cwd()) {
  const file = statePath(cwd);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { count: 0 };
  }
}

export function writeState(state, cwd = process.cwd()) {
  const file = statePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state)}\n`);
}

/** Where the background run recorded its report, for the next session to read back. */
export function writeReportPointer(report, { cwd = process.cwd(), at = new Date() } = {}) {
  const file = path.resolve(cwd, ".o-skills", "runs", "last-background-report.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ at: at.toISOString(), report: report.report ?? report, analysis: report.analysis ?? null })}\n`);
  return file;
}

const readFileOrNull = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/** How many tool calls this Stop event represents. Unknown payloads still count one. */
export function callsFrom(payload) {
  const uses = payload?.tool_input?.tool_uses ?? payload?.tool_uses ?? payload?.tool_calls;
  if (Array.isArray(uses)) return uses.length;
  return 1;
}

function runBackgroundAnalyze(period, threshold) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SKILL, "scripts", "improve.mjs"), period, "--no-plan"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    const timeout = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 30_000);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("close", () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(stdout.trim().split("\n").pop() || "null"));
      } catch {
        resolve(null);
      }
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

async function main() {
  const threshold = Number(process.env.AUTOHARNESS_REFLECT_EVERY_N ?? DEFAULT_THRESHOLD) || DEFAULT_THRESHOLD;
  const period = process.env.AUTOHARNESS_REFLECT_PERIOD ?? DEFAULT_PERIOD;

  const arg = process.argv[2];
  const payload = (() => {
    if (arg && fs.existsSync(arg)) return JSON.parse(readFileOrNull(arg) ?? "null");
    if (process.stdin.isTTY === false) return JSON.parse(readFileSync(0, "utf8") ?? "null");
    return null;
  })();

  const state = readState();
  const next = advance(state, callsFrom(payload ?? {}), threshold);
  if (next.reflect) {
    const report = await runBackgroundAnalyze(period, threshold);
    if (report) writeReportPointer(report);
  }
  writeState({ count: next.count, lastReflectedAt: next.reflect ? new Date().toISOString() : state.lastReflectedAt ?? null });
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().catch(() => process.exit(0));
}
