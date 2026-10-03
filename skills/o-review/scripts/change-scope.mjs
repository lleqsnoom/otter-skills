#!/usr/bin/env node
/**
 * The source files a review should measure: everything the branch changed since its merge-base with the default
 * branch, committed or not. o-implement reviews a task before committing it, so the index, the working tree and new
 * files are part of the change. Deleted files are left out: there is nothing left to measure.
 *
 * Usage: node change-scope.mjs [--base <ref>]   # prints the scope as JSON
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { SOURCE_EXTENSIONS } from "./file-discovery.mjs";

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

const tryGit = (cwd, args) => {
  try {
    return git(cwd, args).trim();
  } catch {
    return null;
  }
};

const sourcePaths = (output) => output.split("\n").filter((line) => line && SOURCE_EXTENSIONS.test(line)).sort();

const defaultRef = (cwd) => ["main", "master"].find((ref) => tryGit(cwd, ["rev-parse", "--verify", "--quiet", ref]) !== null);

export function changeScope({ base, cwd = process.cwd() } = {}) {
  const root = tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (root === null) return { kind: "tree", reason: "not a git repository" };

  const ref = base ?? defaultRef(root);
  if (!ref) return { kind: "tree", reason: "no main or master branch" };
  const mergeBase = tryGit(root, ["merge-base", "HEAD", ref]);
  if (mergeBase === null) return { kind: "tree", reason: `no merge-base with ${ref}` };

  const committed = sourcePaths(git(root, ["diff", "--name-only", "--diff-filter=d", mergeBase, "HEAD"]));
  const staged = sourcePaths(git(root, ["diff", "--name-only", "--cached", "--diff-filter=d"]));
  const unstaged = sourcePaths(git(root, ["diff", "--name-only", "--diff-filter=d"]));
  const untracked = sourcePaths(git(root, ["ls-files", "--others", "--exclude-standard"]));
  const files = [...new Set([...committed, ...staged, ...unstaged, ...untracked])]
    .sort()
    .map((rel) => path.join(root, rel))
    .filter((file) => fs.existsSync(file));

  return { kind: "change", ref, mergeBase, committed, staged, unstaged, untracked, files };
}

/**
 * The lines this change wrote, per absolute file path: every `+` range of the diff against the merge-base (working
 * tree included), and the whole file for an untracked one (`true`). A function is "touched" when one of its lines is
 * here — the line between findings this review introduces and findings it only walks past.
 */
export function changedRanges(scope, cwd = process.cwd()) {
  if (scope?.kind !== "change") return null;
  const root = tryGit(cwd, ["rev-parse", "--show-toplevel"]);
  const ranges = new Map();
  const diff = git(root, ["diff", "--no-prefix", "--no-color", "--unified=0", "--diff-filter=d", scope.mergeBase]);
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? null : path.join(root, line.slice(4));
      if (file && !ranges.has(file)) ranges.set(file, []);
      continue;
    }
    const hunk = file && line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (hunk && hunk[2] !== "0") ranges.get(file).push([Number(hunk[1]), Number(hunk[1]) + Number(hunk[2] ?? 1) - 1]);
  }
  for (const rel of scope.untracked) ranges.set(path.join(root, rel), true);
  return ranges;
}

/** Whether lines `start..end` of `file` overlap what the change wrote. */
export function touches(ranges, file, start, end) {
  const written = ranges.get(path.resolve(file));
  if (written === true) return true;
  return (written ?? []).some(([from, to]) => from <= end && to >= start);
}

const USAGE = `Usage: node change-scope.mjs [--base <ref>]
Prints the source files the branch changed since its merge-base, committed or not, as JSON.`;

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  const at = process.argv.indexOf("--base");
  console.log(JSON.stringify(changeScope({ base: at === -1 ? undefined : process.argv[at + 1] }), null, 2));
}
