#!/usr/bin/env node
"use strict";

/**
 * o-debug analyzer — opens a debug session and the fix plan o-fix reads, with first hypotheses ranked from the
 * error text. It never runs anything: the error text often comes from a bug report, which is untrusted input, and
 * a reproduction only counts when it runs the project's own code, which the agent builds next.
 *
 * Usage: node analyze.mjs --error "msg" [--file src.js] [--slug topic] [--fixes <brief or review>]
 * Writes every artifact into .o-skills/runs/<stamp>-R<nn>-<slug>/.
 */

import fs from "node:fs";
import path from "node:path";

// ── Run folders ──────────────────────────────────────────────────────
// #region run-folder
// Two digits, not more: a wider counter would sort E100 before E99.
const RUNS_ROOT = ".o-skills/runs";
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

// Each runtime words the same fault its own way, and V8 changed its wording in Node 16.9 ("Cannot read properties
// of undefined (reading 'x')"), so every reading a current runtime prints is listed.
const PATTERNS = [
  [/Cannot (read|set) propert(ies|y) .*\bundefined\b/, "undefined-reference", "A property is read or set on a value that is undefined"],
  [/Cannot (read|set) propert(ies|y) .*\bnull\b|'NoneType' object has no attribute|nil pointer dereference|called `Option::unwrap\(\)` on a `None` value|NullPointerException/, "null-reference", "A value that can be null or empty is used as if it were present"],
  [/is not a function|object is not callable/, "not-a-function", "A value that is not callable is called"],
  [/Maximum call stack size exceeded|RecursionError|stack overflow/, "infinite-recursion", "A recursion has no reachable base case"],
  [/Unexpected token|SyntaxError/, "syntax-error", "Malformed source, or input parsed as JSON that is not JSON"],
  [/Module not found|Cannot find module|ModuleNotFoundError|ERR_MODULE_NOT_FOUND/, "missing-module", "A module is missing, misnamed, or resolved from the wrong place"],
  [/ECONNREFUSED|Connection refused/, "connection-error", "The target service is not listening where the code expects it"],
];

function parseArgs(argv) {
  const args = argv.slice(2);
  let errorText = null, targetFile = null, sessionId = null, slug = null;
  let newRun = false, run = null, fixes = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--error" && i + 1 < args.length) errorText = args[++i];
    else if (args[i] === "--file" && i + 1 < args.length) targetFile = args[++i];
    else if (args[i] === "--session-id" && i + 1 < args.length) sessionId = args[++i];
    else if (args[i] === "--slug" && i + 1 < args.length) slug = args[++i];
    else if (args[i] === "--new-run") newRun = true;
    else if (args[i] === "--run" && i + 1 < args.length) run = Number(args[++i]);
    else if (args[i] === "--fixes" && i + 1 < args.length) fixes = args[++i];
    // --context and --no-reproduce belonged to the removed auto-reproduction; older callers still pass them.
    else if (args[i] === "--context" && i + 1 < args.length) i++;
    else if (args[i] === "--no-reproduce") continue;
    else if (!args[i].startsWith("--")) targetFile = args[i];
  }
  return { errorText, targetFile, sessionId, slug, fresh: newRun, run, fixes };
}

function matchPatterns(errorText) {
  const matches = [];
  for (const [regex, category, desc] of PATTERNS) {
    if (regex.test(errorText)) matches.push({ category, description: desc });
  }
  return matches;
}

/** The error text as a fenced block whose fence is longer than any backtick run inside it, so no input can close it. */
function fenced(text) {
  const longest = Math.max(0, ...(String(text).match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}\n`;
}

/** A path inside a `.o-skills` tree, from its root and without `.md` — the form Obsidian links by — or `null` outside one. */
function vaultNote(target) {
  const parts = path.resolve(target).split(path.sep);
  const at = parts.lastIndexOf(".o-skills");
  return at === -1 ? null : parts.slice(at + 1).join("/").replace(/\.md$/, "");
}

/** A run folder's topic: its name without the `YYYY-MM-DD-hhmm-R<nn>-` stamp. */
function runSlug(runDir) {
  return path.basename(path.resolve(runDir)).replace(/^\d{4}-\d{2}-\d{2}-\d{4}-R\d+-/, "");
}

/** An artifact's property block: its type, its title, the run hub it belongs to, and what it answers when that is in the vault. */
function propertyBlock(type, title, runDir, fixes) {
  const run = vaultNote(path.join(runDir, "index"));
  const target = fixes ? vaultNote(fixes) : null;
  return [
    "---",
    `type: ${type}`,
    `title: ${JSON.stringify(title)}`,
    ...(run ? [`run: "[[${run}]]"`] : []),
    ...(target ? [`fixes: "[[${target}]]"`] : []),
    "---",
    "",
  ].join("\n");
}

function generateSession(errorText, matches, targetFile, sessionId, runDir, fixes = null) {
  fs.mkdirSync(runDir, { recursive: true });
  const prefix = nextE(runDir);
  const fileName = `${prefix}-debug`;
  const filePath = path.join(runDir, fileName + ".md");

  let md = propertyBlock("debug", `Debug · ${runSlug(runDir)}`, runDir, fixes) + "# Debug Session\n\n**Error:**\n\n" + fenced(errorText);
  if (targetFile) md += "\n**File:** " + path.relative(process.cwd(), targetFile) + "\n";
  md += "\n## Reproduction\n_Not built yet. One command that runs the project's own code and goes red on this bug; save it in this run folder as `E<nn>-verify.<ext>` so o-fix can run it._\n";
  md += "\n## Hypotheses\n";
  for (const m of matches) md += "- **" + m.category + "**: " + m.description + "\n";
  if (!matches.length) md += "_No known error pattern matched. Write your own, ranked by likelihood._\n";
  md += "\n## Tests\n_Run each test and mark [ ] -> [x] Confirmed or [ ] Rejected_\n";
  md += "\n## Root Cause\n_Fill after testing:_\n";
  fs.writeFileSync(filePath, md);
  return { sessionId: fileName, reportPath: filePath, errorText, matches };
}

function exportFixPlan(errorText, matches, targetFile, sessionId, confirmed, runDir, sessionPath = null) {
  if (confirmed === undefined) confirmed = false;
  fs.mkdirSync(runDir, { recursive: true });
  const filePath = path.join(runDir, nextE(runDir) + "-fix-plan.md");

  let plan = propertyBlock("fix", `Fix plan · ${runSlug(runDir)}`, runDir, sessionPath) + "# Fix Plan\n\n**Error:**\n\n" + fenced(errorText) + "\n";
  if (!confirmed) {
    plan += "## Test Hypotheses First\n";
    for (const m of matches) {
      plan += "- [ ] **" + m.category + "**: " + m.description + "\n";
    }
    plan += "\nRun tests above, then re-run with confirmed root cause.\n";
  } else {
    plan += "## Confirmed Root Cause\n\n";
    plan += "- [ ] **Severity:** CRITICAL (fix root cause, do NOT silence)\n";
    if (targetFile) plan += "  - **Location:** " + path.relative(process.cwd(), targetFile) + "\n";
    plan += "\n**CRITICAL RULES:**\n";
    plan += "- Do NOT add try/catch wrappers that silently swallow errors\n";
    plan += "- Do NOT disable error reporting or set process.exit(0) on failure\n";
    plan += "- DO fix the root cause so the error cannot occur\n";
    plan += "- ALWAYS run the reproduction after applying the fix\n";
  }
  fs.writeFileSync(filePath, plan);
  return { filePath };
}

async function main() {
  const args = parseArgs(process.argv);
  const { errorText, targetFile, sessionId } = args;
  if (!errorText) { console.error("Error: --error required"); process.exit(1); }

  const matches = matchPatterns(errorText);
  const runDir = resolveRunDir(args.slug || "debug", { fresh: args.fresh === true, run: args.run });
  const targetResolved = targetFile ? path.resolve(targetFile) : null;

  const session = generateSession(errorText, matches, targetResolved, sessionId, runDir, args.fixes);
  const fixPlan = exportFixPlan(errorText, matches, targetResolved, sessionId, false, runDir, session.reportPath);

  console.log(JSON.stringify(Object.assign({}, session, { fixPlanPath: fixPlan.filePath, rootCauseConfirmed: false, reproduced: false }), null, 2));
  process.stderr.write("\nDebug session: " + session.reportPath + "\nFix plan: " + fixPlan.filePath + "\n");
  process.stderr.write("Hypotheses from the error text: " + matches.length + "\n");
  process.stderr.write("\nNothing has been reproduced yet. Next:\n");
  process.stderr.write("1. Build a reproduction: one command that runs the project's code and goes red on this bug\n");
  process.stderr.write("2. Confirm the root cause by testing the hypotheses\n3. Fix the root cause - NEVER silence errors\n");
  process.stderr.write("4. Verify: the reproduction now exits 0\n");
  process.exit(0);
}

main().catch(function(err) { console.error("Fatal:", err.message || err); process.exit(1); });
