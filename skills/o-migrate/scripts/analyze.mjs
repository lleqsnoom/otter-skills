#!/usr/bin/env node
/**
 * o-migrate — dependency inventory and migration plan skeleton, for npm, Python, Cargo and Go projects.
 *
 * It answers what can be read off the project without guessing: which version each package is declared at and
 * installed at, and which major versions an upgrade crosses. It carries no table of breaking changes. A built-in
 * table is a second, unsourced copy of each project's release notes, and it goes stale the day it is written; the
 * breaking changes come from the official upgrade guide of each major crossed, read by the agent and cited by URL.
 *
 * Usage:
 *   node analyze.mjs --target express@5 [--source 4.21.2] [--output plan.md]
 *   node analyze.mjs --target requests@latest --online    # ask the registry for the latest version and links
 *   node analyze.mjs --all [--online]
 * Exit: 0 inventory written · 1 usage error or no manifest found
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = { target: null, source: null, outputFile: null, allDeps: false, online: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target" && i + 1 < argv.length) args.target = argv[++i];
    else if (argv[i] === "--source" && i + 1 < argv.length) args.source = argv[++i];
    else if (argv[i] === "--output" && i + 1 < argv.length) args.outputFile = argv[++i];
    else if (argv[i] === "--all") args.allDeps = true;
    else if (argv[i] === "--online") args.online = true;
    else if (!argv[i].startsWith("--")) args.target = argv[i];
  }
  return args;
}

/** `name@version`, where a scoped name keeps its leading `@`: `@types/node@20` is `@types/node` at `20`. */
function splitSpec(spec) {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { name: spec, version: null };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) || null };
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
const readJson = (file) => {
  try {
    return JSON.parse(read(file));
  } catch {
    return null;
  }
};

/** `name = "1.2"` and `name = { version = "1.2", … }` lines under one TOML table. */
function tomlTable(text, table) {
  const start = text.search(new RegExp(`^\\[${table.replace(/\./g, "\\.")}\\]\\s*$`, "m"));
  if (start === -1) return {};
  const body = text.slice(start).split("\n").slice(1);
  const out = {};
  for (const line of body) {
    if (/^\s*\[/.test(line)) break;
    const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/);
    if (m) out[m[1]] = m[2] ?? m[3];
  }
  return out;
}

/** Every table whose header matches `pattern` (`tool.poetry.group.dev.dependencies`, `project.optional-dependencies`). */
function tomlTablesMatching(text, pattern) {
  return [...text.matchAll(/^\[([^\]\n]+)\]\s*$/gm)].map((m) => m[1].trim()).filter((name) => pattern.test(name));
}

/** The quoted requirement strings of every array in a TOML table: `dev = ["pytest>=8", "ruff"]`. */
function tomlArrayStrings(text, table) {
  const start = text.search(new RegExp(`^\\[${table.replace(/\./g, "\\.")}\\]\\s*$`, "m"));
  if (start === -1) return [];
  const rest = text.slice(start).split("\n").slice(1);
  const stop = rest.findIndex((line) => /^\s*\[/.test(line));
  const body = (stop === -1 ? rest : rest.slice(0, stop)).join("\n");
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** `[[package]]` blocks in a lockfile (Cargo.lock, poetry.lock, uv.lock): name → version. */
function lockPackages(text) {
  const out = {};
  for (const block of (text ?? "").split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if (name && version) out[name.toLowerCase()] = version;
  }
  return out;
}

const pythonName = (spec) => spec.match(/^\s*([A-Za-z0-9_.-]+)/)?.[1]?.toLowerCase();

/**
 * Every declared dependency the project's manifests name, with its ecosystem, declared constraint and the version
 * the lockfile or install resolved — whatever can be read without running a package manager.
 */
export function readManifests(root) {
  const deps = new Map();
  const add = (ecosystem, name, declared, installed = null) => deps.set(`${ecosystem}:${name}`, { ecosystem, name, declared, installed });

  const pkg = readJson(path.join(root, "package.json"));
  if (pkg) {
    const lock = readJson(path.join(root, "package-lock.json"));
    for (const [name, declared] of Object.entries({ ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) })) {
      const installed = readJson(path.join(root, "node_modules", name, "package.json"))?.version ?? lock?.packages?.[`node_modules/${name}`]?.version ?? lock?.dependencies?.[name]?.version ?? null;
      add("npm", name, declared, installed);
    }
  }

  const pyLock = lockPackages(read(path.join(root, "poetry.lock")) ?? read(path.join(root, "uv.lock")));
  const requirements = read(path.join(root, "requirements.txt"));
  for (const line of (requirements ?? "").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter((l) => l && !l.startsWith("-"))) {
    const name = pythonName(line);
    const pinned = line.match(/==\s*([\w.]+)/)?.[1] ?? null;
    if (name) add("python", name, line.slice(name.length).trim() || "*", pyLock[name] ?? pinned);
  }
  const pyproject = read(path.join(root, "pyproject.toml"));
  if (pyproject) {
    const list = pyproject.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m)?.[1] ?? "";
    for (const [, spec] of list.matchAll(/"([^"]+)"/g)) {
      const name = pythonName(spec);
      if (name) add("python", name, spec.slice(name.length).trim() || "*", pyLock[name] ?? null);
    }
    // PEP 621 extras and dependency groups: requirement strings, like `dependencies`.
    for (const table of ["project.optional-dependencies", "dependency-groups"]) {
      for (const spec of tomlArrayStrings(pyproject, table)) {
        const name = pythonName(spec);
        if (name && !deps.has(`python:${name}`)) add("python", name, spec.slice(name.length).trim() || "*", pyLock[name] ?? null);
      }
    }
    // Poetry's main table and every group (`[tool.poetry.group.dev.dependencies]`).
    for (const table of ["tool.poetry.dependencies", ...tomlTablesMatching(pyproject, /^tool\.poetry\.group\.[^.]+\.dependencies$/)]) {
      for (const [name, declared] of Object.entries(tomlTable(pyproject, table))) {
        if (name.toLowerCase() !== "python" && !deps.has(`python:${name.toLowerCase()}`)) add("python", name.toLowerCase(), declared, pyLock[name.toLowerCase()] ?? null);
      }
    }
  }

  const cargo = read(path.join(root, "Cargo.toml"));
  if (cargo) {
    const cargoLock = lockPackages(read(path.join(root, "Cargo.lock")));
    // A workspace pins shared versions in [workspace.dependencies], and each member crate has its own manifest.
    const members = (cargo.match(/^members\s*=\s*\[([\s\S]*?)\]/m)?.[1] ?? "").match(/"([^"*]+)"/g)?.map((m) => m.slice(1, -1)) ?? [];
    const manifests = [cargo, ...members.map((member) => read(path.join(root, member, "Cargo.toml"))).filter(Boolean)];
    for (const manifest of manifests) {
      for (const table of ["workspace.dependencies", "dependencies", "dev-dependencies", "build-dependencies"]) {
        for (const [name, declared] of Object.entries(tomlTable(manifest, table))) {
          if (!deps.has(`cargo:${name}`)) add("cargo", name, declared, cargoLock[name.toLowerCase()] ?? null);
        }
      }
    }
  }

  const gomod = read(path.join(root, "go.mod"));
  if (gomod) {
    const block = gomod.match(/^require\s*\(([\s\S]*?)\)/m)?.[1] ?? "";
    const lines = [...block.split("\n"), ...[...gomod.matchAll(/^require\s+(\S+\s+\S+)/gm)].map((m) => m[1])];
    for (const line of lines) {
      const m = line.trim().match(/^(\S+)\s+(v[\w.+-]+)/);
      if (m) add("go", m[1], m[2], m[2]);
    }
  }
  return [...deps.values()];
}

/** The major of a version or range (`^4.18.0`, `~4.1`, `>=2.31`, `v1.9.0`, `5`), or null for `latest` or a tag. */
function majorOf(version) {
  const match = String(version ?? "").match(/^\s*[\^~>=<!v*\s]*?(\d+)/);
  return match && !/^\s*\*\s*$/.test(String(version)) ? Number(match[1]) : null;
}

/** Every major from the one after `from` to `to` inclusive — each one has its own upgrade guide to read. */
function majorsCrossed(from, to) {
  const start = majorOf(from);
  const end = majorOf(to);
  if (start === null || end === null || end <= start) return [];
  return Array.from({ length: end - start }, (_, i) => start + i + 1);
}

function inventoryRow(dep, target = null, source = null) {
  const from = source ?? dep.installed ?? dep.declared;
  return { ...dep, from, target, majorsCrossed: target ? majorsCrossed(from, target) : [] };
}

/** One step per major crossed. Nothing in it is known yet except what to read: the agent fills it from the guide. */
function planSteps(row) {
  return row.majorsCrossed.map((major) => ({
    package: row.name,
    ecosystem: row.ecosystem,
    fromVersion: `${row.name}@${major === row.majorsCrossed[0] ? row.from : `${major - 1}`}`,
    toVersion: `${row.name}@${major}`,
    source: null,
    changes: [],
    note: `Read the official upgrade guide or changelog for ${row.name} ${major} and list its breaking changes, each with the URL it came from.`,
  }));
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "user-agent": "o-migrate (otter-skills)" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/** A repository URL as a browser opens it: `git+ssh://git@github.com/a/b.git` is `https://github.com/a/b`. */
function browsable(url) {
  return url
    .replace(/^git\+/, "")
    .replace(/^(ssh:\/\/)?git@([^/:]+)[:/]/, "https://$2/")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git(#.*)?$/, "");
}

function npmView(name) {
  const out = execFileSync("npm", ["view", name, "version", "repository.url", "homepage", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 });
  const data = JSON.parse(out);
  const links = [data["repository.url"], data.homepage].filter(Boolean).map(browsable);
  return { latest: data.version ?? null, links: [...new Set(links)] };
}

/**
 * The registry's latest version and the links where its changelog lives. Every call can fail — offline, a private
 * package — and a failure is reported as a problem, never filled in.
 */
export async function lookupLatest(dep, { getJson = fetchJson, viewNpm = npmView } = {}) {
  if (dep.ecosystem === "npm") return viewNpm(dep.name);
  if (dep.ecosystem === "python") {
    const { info } = await getJson(`https://pypi.org/pypi/${encodeURIComponent(dep.name)}/json`);
    return { latest: info.version, links: Object.values(info.project_urls ?? {}) };
  }
  if (dep.ecosystem === "cargo") {
    const { crate } = await getJson(`https://crates.io/api/v1/crates/${encodeURIComponent(dep.name)}`);
    return { latest: crate.max_stable_version ?? crate.max_version, links: [crate.repository, crate.homepage].filter(Boolean) };
  }
  if (dep.ecosystem === "go") {
    const escaped = dep.name.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
    const data = await getJson(`https://proxy.golang.org/${escaped}/@latest`);
    return { latest: data.Version, links: [`https://pkg.go.dev/${dep.name}`] };
  }
  return { latest: null, links: [] };
}

function targetProblem(row) {
  if (majorOf(row.target) === null) return `target "${row.target}" is not a version: pass --online, or the number from the registry`;
  if (row.from === null) return `${row.name} is not declared or installed here: pass --source <version>`;
  if (row.majorsCrossed.length === 0) return `${row.name} ${row.from} → ${row.target} crosses no major version; read its changelog for deprecations`;
  return null;
}

function formatMarkdownPlan(rows, steps, problems) {
  const lines = ["# Migration Plan", "", `**Generated:** ${new Date().toISOString()}`, ""];
  for (const problem of problems) lines.push(`> ${problem}`, "");
  for (const row of rows) {
    lines.push(`## ${row.name} ${row.from ?? "?"} → ${row.target ?? "?"} (${row.ecosystem})`, "");
    lines.push(`- **Declared:** ${row.declared ?? "not declared"} · **Installed:** ${row.installed ?? "not installed"}`);
    lines.push(`- **Majors crossed:** ${row.majorsCrossed.length ? row.majorsCrossed.join(", ") : "none"}`);
    if (row.links?.length) lines.push(`- **Where its changelog lives:** ${row.links.join(" · ")}`);
    lines.push("");
    for (const step of steps.filter((s) => s.package === row.name)) {
      lines.push(`### ${step.fromVersion} → ${step.toVersion}`, "", "**Source:** _required — the official upgrade guide or changelog, by URL_", "");
      lines.push("| Breaking change | Used at (file:line) | Fix | Codemod |", "|---|---|---|---|", "", "");
    }
  }
  return lines.join("\n");
}

export async function analyze({ root = process.cwd(), target = null, source = null, allDeps = false, online = false, lookup = lookupLatest } = {}) {
  const deps = readManifests(root);
  if (!deps.length) throw Object.assign(new Error("No manifest found: package.json, requirements.txt, pyproject.toml, Cargo.toml or go.mod"), { exitCode: 1 });
  const problems = [];
  let rows;
  if (allDeps) {
    rows = deps.map((dep) => inventoryRow(dep));
  } else {
    const { name, version } = splitSpec(target);
    const dep = deps.find((d) => d.name === name || d.name === name.toLowerCase()) ?? { ecosystem: "npm", name, declared: null, installed: null };
    rows = [inventoryRow(dep, version ?? "latest", source)];
  }
  if (online) {
    for (const row of rows) {
      try {
        const { latest, links } = await lookup(row);
        row.latest = latest;
        row.links = links;
        if (!allDeps && (row.target === "latest" || majorOf(row.target) === null)) Object.assign(row, inventoryRow(row, latest, source), { latest, links });
      } catch (error) {
        problems.push(`${row.name}: the registry could not be read (${error.message})`);
      }
    }
  }
  const steps = rows.flatMap(planSteps);
  if (!allDeps) problems.push(...rows.map(targetProblem).filter(Boolean));
  return { packagesAnalyzed: rows.length, inventory: rows, plan: steps, problems };
}

const USAGE = `Usage:
  node analyze.mjs --target <package>@<version> [--source <version>] [--output <plan.md>] [--online]
  node analyze.mjs --all [--online]
Reads npm, Python, Cargo and Go manifests; --online asks the registry for the latest version and changelog links.`;

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const { target, source, outputFile, allDeps, online } = parseArgs(process.argv.slice(2));
  if (!target && !allDeps) {
    console.error("Error: --target <package@version> or --all required");
    process.exit(1);
  }
  try {
    const result = await analyze({ target, source, allDeps, online });
    console.log(JSON.stringify(result, null, 2));
    const report = formatMarkdownPlan(result.inventory, result.plan, result.problems);
    process.stderr.write(`${report}\n`);
    if (outputFile) {
      fs.writeFileSync(outputFile, report);
      console.error(`Migration plan written to: ${outputFile}`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(error.exitCode ?? 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main();
}

export { parseArgs, browsable, splitSpec, majorOf, majorsCrossed, inventoryRow, planSteps, formatMarkdownPlan };
