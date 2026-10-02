#!/usr/bin/env node
/**
 * o-migrate — dependency inventory and migration plan skeleton.
 *
 * It answers what can be read off the project without guessing: which version each package is declared at and
 * installed at, and which major versions an upgrade crosses. It carries no table of breaking changes. A built-in
 * table is a second, unsourced copy of each project's release notes, and it goes stale the day it is written; the
 * breaking changes come from the official upgrade guide of each major crossed, read by the agent and cited by URL.
 *
 * Usage:
 *   node analyze.mjs --target express@5 [--source 4.21.2] [--output plan.md]
 *   node analyze.mjs --all
 * Exit: 0 inventory written · 1 usage error or no readable package.json
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = argv.slice(2);
  let target = null;
  let source = null;
  let outputFile = null;
  let allDeps = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target" && i + 1 < args.length) target = args[++i];
    else if (args[i] === "--source" && i + 1 < args.length) source = args[++i];
    else if (args[i] === "--output" && i + 1 < args.length) outputFile = args[++i];
    else if (args[i] === "--all") allDeps = true;
    else if (!args[i].startsWith("--")) target = args[i];
  }

  return { target, source, outputFile, allDeps };
}

/** `name@version`, where a scoped name keeps its leading `@`: `@types/node@20` is `@types/node` at `20`. */
function splitSpec(spec) {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { name: spec, version: null };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) || null };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

const declaredDeps = (pkg) => ({ ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) });

/** The version actually installed: node_modules first, then the lockfile, or null when neither says. */
function installedVersion(cwd, name, lock) {
  const installed = readJson(path.join(cwd, "node_modules", name, "package.json"))?.version;
  if (installed) return installed;
  return lock?.packages?.[`node_modules/${name}`]?.version ?? lock?.dependencies?.[name]?.version ?? null;
}

/** The major of a version or range (`^4.18.0`, `~4.1`, `4.x`, `5`), or null for `latest`, a tag, or a URL. */
function majorOf(version) {
  const match = String(version ?? "").match(/^\s*[\^~>=v]*\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

/** Every major from the one after `from` to `to` inclusive — each one has its own upgrade guide to read. */
function majorsCrossed(from, to) {
  const start = majorOf(from);
  const end = majorOf(to);
  if (start === null || end === null || end <= start) return [];
  return Array.from({ length: end - start }, (_, i) => start + i + 1);
}

function inventoryRow(cwd, pkg, lock, name, target = null, source = null) {
  const declared = declaredDeps(pkg)[name] ?? null;
  const installed = installedVersion(cwd, name, lock);
  const from = source ?? installed ?? declared;
  return { package: name, declared, installed, from, target, majorsCrossed: target ? majorsCrossed(from, target) : [] };
}

/** One step per major crossed. Nothing in it is known yet except what to read: the agent fills it from the guide. */
function planSteps(row) {
  return row.majorsCrossed.map((major) => ({
    package: row.package,
    fromVersion: `${row.package}@${major === row.majorsCrossed[0] ? row.from : `${major - 1}`}`,
    toVersion: `${row.package}@${major}`,
    source: null,
    changes: [],
    note: `Read the official upgrade guide or changelog for ${row.package} ${major} and list its breaking changes, each with the URL it came from.`,
  }));
}

function targetProblem(row) {
  if (majorOf(row.target) === null) {
    return `target "${row.target}" is not a version: run \`npm view ${row.package} version\` and pass the number`;
  }
  if (row.from === null) return `${row.package} is not declared or installed here: pass --source <version>`;
  if (row.majorsCrossed.length === 0) return `${row.package} ${row.from} → ${row.target} crosses no major version; read its changelog for deprecations`;
  return null;
}

function formatMarkdownPlan(rows, steps, problems) {
  const lines = ["# Migration Plan", "", `**Generated:** ${new Date().toISOString()}`, ""];
  for (const problem of problems) lines.push(`> ${problem}`, "");

  for (const row of rows) {
    lines.push(`## ${row.package} ${row.from ?? "?"} → ${row.target ?? "?"}`, "");
    lines.push(`- **Declared:** ${row.declared ?? "not declared"} · **Installed:** ${row.installed ?? "not installed"}`);
    lines.push(`- **Majors crossed:** ${row.majorsCrossed.length ? row.majorsCrossed.join(", ") : "none"}`, "");
    for (const step of steps.filter((s) => s.package === row.package)) {
      lines.push(`### ${step.fromVersion} → ${step.toVersion}`, "");
      lines.push("**Source:** _required — the official upgrade guide or changelog, by URL_", "");
      lines.push("| Breaking change | Used at (file:line) | Fix | Codemod |", "|---|---|---|---|", "", "");
    }
  }
  return lines.join("\n");
}

function main() {
  const { target, source, outputFile, allDeps } = parseArgs(process.argv);
  if (!target && !allDeps) {
    console.error("Error: --target <package@version> or --all required");
    process.exit(1);
  }

  const cwd = process.cwd();
  const pkg = readJson(path.join(cwd, "package.json"));
  if (!pkg) {
    console.error("Error: No package.json found in current directory");
    process.exit(1);
  }
  const lock = readJson(path.join(cwd, "package-lock.json"));

  let rows;
  if (allDeps) {
    rows = Object.keys(declaredDeps(pkg)).sort().map((name) => inventoryRow(cwd, pkg, lock, name));
  } else {
    const { name, version } = splitSpec(target);
    rows = [inventoryRow(cwd, pkg, lock, name, version ?? "latest", source)];
  }

  const steps = rows.flatMap(planSteps);
  const problems = allDeps ? [] : rows.map(targetProblem).filter(Boolean);
  console.log(JSON.stringify({ packagesAnalyzed: rows.length, inventory: rows, plan: steps, problems }, null, 2));

  const report = formatMarkdownPlan(rows, steps, problems);
  process.stderr.write(report + "\n");
  if (outputFile) {
    fs.writeFileSync(outputFile, report);
    console.error(`Migration plan written to: ${outputFile}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}

export { parseArgs, splitSpec, majorOf, majorsCrossed, inventoryRow, planSteps, formatMarkdownPlan };
