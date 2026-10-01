#!/usr/bin/env node
/**
 * The source files a review should measure: everything the branch changed since its merge-base with the default
 * branch, committed or not. x-implement reviews a task before committing it, so the index, the working tree and new
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

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const at = process.argv.indexOf("--base");
  console.log(JSON.stringify(changeScope({ base: at === -1 ? undefined : process.argv[at + 1] }), null, 2));
}
