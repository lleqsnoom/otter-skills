#!/usr/bin/env node
/**
 * validate-skills — the suite gate over skills/.
 *
 * Runs x-skill-lint's checks against a repo root — parseable frontmatter whose name matches the
 * folder, every referenced scripts/* and references/* existing, evals files that parse, the README
 * skills table listing every skill — and adds trail of bits' zero-items rule: a checker that
 * inspects zero items must fail, not pass. Run by `npm test`, so a broken skill cannot ship.
 *
 * Usage: node scripts/validate-skills.mjs [--root <dir>]
 * Exit:  0 clean · 1 violations or zero items · 2 usage error
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lintRepo, readmeSkills } from "../skills/x-skill-lint/scripts/lint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");

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
