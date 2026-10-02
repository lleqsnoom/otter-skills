#!/usr/bin/env node
/**
 * validate-skills — the suite gate over skills/.
 *
 * Runs x-skill-lint's checks against a repo root — parseable frontmatter whose name matches the
 * folder, every referenced scripts/* and references/* existing, evals files that parse, the README
 * skills table listing every skill — and adds trail of bits' zero-items rule (a checker that
 * inspects zero items must fail, not pass) plus the version rules: every SKILL.md carries a
 * `version`, and a skill changed against git HEAD without a version increase is reported. Run by
 * `npm test`, so a broken skill cannot ship.
 *
 * Usage: node scripts/validate-skills.mjs [--root <dir>]
 * Exit:  0 clean · 1 violations or zero items · 2 usage error
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lintRepo, parseFrontmatter, readmeSkills } from "../skills/x-skill-lint/scripts/lint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");

/** git output at `root`, or null when git is missing, the tree is not a checkout, or the read fails. */
function git(root, args) {
  const run = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return run.status === 0 ? run.stdout : null;
}

/**
 * A higher version means a real bump: numeric segments compare numerically past their shared
 * length, so 1.1 > 1. Versions that differ but do not order numerically (prerelease tags) are
 * treated as a bump, since the equality case is the one the rule exists to catch.
 */
function versionBumped(work, head) {
  if (work === head) return false;
  const workParts = work.split(".").map(Number);
  const headParts = head.split(".").map(Number);
  if (!workParts.every(Number.isInteger) || !headParts.every(Number.isInteger)) return true;
  for (let i = 0; i < Math.max(workParts.length, headParts.length); i++) {
    const a = workParts[i] ?? 0;
    const b = headParts[i] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

/**
 * The version rules over `names`: every SKILL.md carries a version, and a skill whose files differ
 * from git HEAD kept its version. Outside a git checkout there is no HEAD to compare against, so
 * the change half degrades to the presence half alone.
 */
function versionViolations(root, names) {
  const changedFiles = git(root, ["diff", "--name-only", "HEAD", "--", "skills/"]);
  const changed = changedFiles === null ? new Set() : new Set(changedFiles.split("\n").flatMap((line) => line.match(/^skills\/([^/]+)\//) ?? []));
  const violations = [];
  for (const name of names) {
    const skillPath = path.join(root, "skills", name, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    const frontmatter = parseFrontmatter(fs.readFileSync(skillPath, "utf8"));
    if (!frontmatter) continue;
    if (!frontmatter.version) {
      violations.push({ skill: name, file: `${name}/SKILL.md`, rule: "version", detail: "SKILL.md has no version field" });
      continue;
    }
    if (!changed.has(name)) continue;
    const head = git(root, ["show", `HEAD:skills/${name}/SKILL.md`]);
    const headVersion = head === null ? null : (parseFrontmatter(head)?.version ?? null);
    if (headVersion === null || versionBumped(frontmatter.version, headVersion)) continue;
    violations.push({
      skill: name,
      file: `${name}/SKILL.md`,
      rule: "version-bump",
      detail: `changed since HEAD but version is ${frontmatter.version} (HEAD has ${headVersion}); bump it`,
    });
  }
  return violations;
}

export function validateSkills(root = REPO_ROOT) {
  const result = lintRepo(root);
  const readmePath = path.join(root, "README.md");
  const readmeRows = fs.existsSync(readmePath) ? readmeSkills(fs.readFileSync(readmePath, "utf8")).size : 0;
  const violations = result.violations.map((violation) => ({
    ...violation,
    file: violation.file ?? (violation.skill === "-" ? violation.skill : `${violation.skill}/SKILL.md`),
  }));
  if (result.skills === 0 && !violations.some((violation) => violation.rule === "no-skills-dir")) {
    violations.push({
      skill: "-",
      file: "skills/",
      rule: "zero-items",
      detail: "inspected 0 skills; a checker that scans nothing must fail, not pass",
    });
  }
  const names = fs.existsSync(path.join(root, "skills"))
    ? fs.readdirSync(path.join(root, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  violations.push(...versionViolations(root, names));
  return { root, counts: { skills: result.skills, readmeRows }, violations };
}

function usage() {
  return [
    "validate-skills — the suite gate over skills/.",
    "",
    "Usage:",
    "  node validate-skills.mjs              # validate this checkout's skills",
    "  node validate-skills.mjs --root <dir> # validate a different repo root",
    "  node validate-skills.mjs --help",
    "",
    "Exit: 0 clean · 1 violations or zero items · 2 usage error",
    "",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  let root = REPO_ROOT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      process.stdout.write(usage());
      return;
    }
    if (args[i] === "--root" && i + 1 < args.length) {
      root = path.resolve(args[++i]);
    } else {
      process.stderr.write(`${JSON.stringify({ error: `Unknown argument "${args[i]}"` })}\n`);
      process.exit(2);
    }
  }
  const result = validateSkills(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.violations.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}
