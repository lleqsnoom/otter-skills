#!/usr/bin/env node
/**
 * o-rollback — revert commits with an impact preview and a confirmation nobody can skip by accident.
 *
 * Usage:
 *   node revert.mjs --last 1 --dry-run                          # preview the most recent commit
 *   node revert.mjs --commit <sha> [--commit <sha>] --dry-run   # preview named commits
 *   node revert.mjs --last 2                                    # in a terminal: asks for REVERT
 *   node revert.mjs --last 2 --yes --expect-sha <sha>,<sha>     # without a terminal (an agent's shell)
 *
 * `--last N` is the N most recent commits on the current branch, HEAD first. A shell an agent runs is never a
 * terminal, so there the prompt cannot be answered: the run refuses unless `--yes` comes with `--expect-sha`
 * naming exactly the commits the dry run listed — the approval is for those commits, not for whatever
 * `--last` resolves to by the time it runs.
 *
 * Exit: 0 reverted, or cancelled at the prompt · 1 refused or failed (nothing half-done is left behind) · 2 usage
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const USAGE = "Usage: node revert.mjs (--last N | --commit <sha> ...) [--dry-run] [--yes --expect-sha <sha,...>] [--mainline <n>]";

export function parseArgs(argv) {
  const args = { commits: [], last: null, dryRun: false, yes: false, expect: [], mainline: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--commit") args.commits.push(argv[++i]);
    else if (flag === "--last") args.last = Number(argv[++i]);
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--yes") args.yes = true;
    else if (flag === "--expect-sha") args.expect = String(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (flag === "--mainline") args.mainline = Number(argv[++i]);
    else if (!flag.startsWith("--")) args.commits.push(flag);
    else throw new Error(`unknown option ${flag}`);
  }
  if (args.last !== null && (!Number.isInteger(args.last) || args.last < 1)) throw new Error("--last takes a whole number of commits, 1 or more");
  if (args.last !== null && args.commits.length) throw new Error("pass --last or --commit, not both");
  if (args.last === null && !args.commits.length) throw new Error("--last N or --commit <sha> is required");
  return args;
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

/** Full SHAs, newest first: the order a stack of reverts has to be applied in. */
export function resolveTargets({ last, commits }) {
  if (last !== null) {
    const shas = git("rev-list", "--first-parent", `--max-count=${last}`, "HEAD").split("\n").filter(Boolean);
    if (shas.length < last) throw new Error(`the branch has only ${shas.length} commit(s); --last ${last} asks for more`);
    return shas;
  }
  const shas = commits.map((ref) => {
    const sha = tryGit("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
    if (!sha) throw new Error(`commit "${ref}" not found`);
    if (tryGit("merge-base", "--is-ancestor", sha, "HEAD") === null) throw new Error(`commit ${sha.slice(0, 12)} is not in the current branch's history`);
    return sha;
  });
  const order = new Map(git("rev-list", "HEAD").split("\n").map((sha, index) => [sha, index]));
  return [...new Set(shas)].sort((a, b) => order.get(a) - order.get(b));
}

export function impactOf(sha) {
  const parents = git("rev-list", "--parents", "-n", "1", sha).split(" ").slice(1);
  const files = git("diff-tree", "--no-commit-id", "--name-status", "-r", "-m", "--first-parent", sha)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status.trim(), path: rest.join("\t").trim() };
    });
  return { sha, message: git("log", "-1", "--format=%s", sha), merge: parents.length > 1, files };
}

/** Each expected value is a prefix of at least 7 characters, matched against the targets one for one. */
export function expectationMatches(targets, expect) {
  if (expect.length !== targets.length) return false;
  return targets.every((sha, index) => expect[index].length >= 7 && sha.startsWith(expect[index].toLowerCase()));
}

function confirmInTerminal(impacts) {
  process.stderr.write("\n=== ROLLBACK ===\n");
  for (const impact of impacts) {
    process.stderr.write(`\n${impact.sha.slice(0, 12)}  ${impact.message}\n`);
    for (const file of impact.files) process.stderr.write(`  [${file.status}] ${file.path}\n`);
  }
  process.stderr.write("\nType REVERT to confirm: ");
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    readline.question("", (answer) => {
      readline.close();
      resolve(answer.trim() === "REVERT");
    });
  });
}

/** o-commit's script when it sits beside this skill; plain git otherwise. No shell either way. */
function commitRevert(message) {
  const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
  const oCommit = path.resolve(here, "..", "..", "o-commit", "scripts", "commit.mjs");
  if (fs.existsSync(oCommit)) execFileSync(process.execPath, [oCommit, message], { stdio: ["ignore", "ignore", "inherit"] });
  else execFileSync("git", ["commit", "-m", message], { stdio: ["ignore", "ignore", "inherit"] });
}

function revertOne(impact, mainline) {
  const args = ["revert", "--no-edit", "--no-commit", ...(impact.merge ? ["-m", String(mainline)] : []), impact.sha];
  try {
    git(...args);
    commitRevert(`revert: ${impact.message.replace(/\.$/, "")}`);
  } catch (error) {
    tryGit("revert", "--abort");
    throw new Error(`revert of ${impact.sha.slice(0, 12)} failed and was aborted: ${String(error.stderr || error.message).trim()}`);
  }
  return { reverted: impact.sha, revertSha: git("rev-parse", "HEAD") };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}\n${USAGE}`);
    process.exit(2);
  }

  const fail = (message) => {
    console.error(`Error: ${message}`);
    process.exit(1);
  };

  // A preview changes nothing, so it runs on any tree and says what the real revert will need.
  const clean = !git("status", "--porcelain");
  if (!clean && !args.dryRun) fail("the working tree is not clean; commit or stash your changes first");

  let impacts;
  try {
    impacts = resolveTargets(args).map(impactOf);
  } catch (error) {
    fail(error.message);
  }
  const merges = impacts.filter((impact) => impact.merge);
  if (merges.length && !args.mainline) fail(`${merges.map((m) => m.sha.slice(0, 12)).join(", ")} is a merge commit; pass --mainline 1 to revert it against its first parent`);

  const targets = impacts.map((impact) => impact.sha);
  if (args.dryRun) {
    const preview = { dryRun: true, targets: impacts, confirmWith: `--yes --expect-sha ${targets.map((s) => s.slice(0, 12)).join(",")}` };
    if (!clean) preview.blocked = "the working tree is not clean; the revert refuses until it is committed or stashed";
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  if (process.stdin.isTTY && !args.yes) {
    if (!(await confirmInTerminal(impacts))) {
      console.error("Rollback cancelled.");
      return;
    }
  } else if (!args.yes || !expectationMatches(targets, args.expect)) {
    fail(
      "no terminal to confirm in: run --dry-run, show the user the targets, and on their approval rerun with " +
        `--yes --expect-sha ${targets.map((s) => s.slice(0, 12)).join(",")}`,
    );
  }

  const results = [];
  for (const impact of impacts) {
    try {
      results.push(revertOne(impact, args.mainline));
    } catch (error) {
      console.log(JSON.stringify({ success: false, reverted: results, error: error.message }, null, 2));
      process.exitCode = 1;
      return;
    }
  }
  console.log(JSON.stringify({ success: true, reverted: results }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
