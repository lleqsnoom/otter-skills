import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Analyze staged git diff and suggest a conventional commit type + scope.
 * Usage: node scripts/suggest-type.mjs [--staged | --unstaged]
 */

/**
 * Thresholds for commit type classification.
 */
const THRESHOLDS = {
  configNetChange: 50,
  docAdded: 30,
  docRemoved: 10,
  refactorRatio: 2,
  refactorNetChange: -50,
  featLargeAdded: 100,
  featLargeNetChange: 50,
  featSmallAdded: 20,
  featSmallNetChange: 10,
};

function getDiff(mode) {
  const cmd = mode === "unstaged" ? "git diff" : "git diff --cached";
  try {
    return execSync(cmd, { maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch {
    return "";
  }
}

/** Git's own list of changed paths: no diff prefix, no quoting, nothing to parse. */
export function getChangedFiles(mode = "staged") {
  const cmd = mode === "unstaged" ? "git diff --name-only" : "git diff --cached --name-only";
  try {
    return execSync(cmd, { maxBuffer: 10 * 1024 * 1024 })
      .toString()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The new-side path of every file in a diff, read from the `diff --git` header.
 * Only used when the caller has no file list. The header is `diff --git <src>/<path> <dst>/<path>`,
 * where the prefixes are configurable (`a/`/`b/` by default, but `i/`/`w/` or none at all are valid),
 * and git quotes either path when it holds a space or a special character.
 */
export function parseDiffPaths(diff) {
  const paths = [];
  for (const line of String(diff ?? "").split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    const rest = line.slice("diff --git ".length).trim();
    const quoted = rest.match(/^"(.*?)"\s+"(.*?)"\s*$/);
    const [from, to] = quoted ? [quoted[1], quoted[2]] : rest.split(/\s+/).slice(0, 2);
    if (!to) continue;
    const path = from === to ? to : to.slice(to.indexOf("/") + 1) || to;
    if (path) paths.push(path);
  }
  return paths;
}

/** Folders whose children are the real areas: `skills/o-review/…` is the o-review area, not "skills". */
const CONTAINERS = new Set(["skills", "packages", "apps", "libs", "services", "modules"]);

/** A share of the changed files one area must hold to name the scope. */
const DOMINANT_SHARE = 0.6;

const areaOf = (file) => {
  const parts = file.split("/");
  if (parts.length < 2) return null;
  return CONTAINERS.has(parts[0]) && parts.length >= 3 ? parts[1] : parts[0];
};

/**
 * The area most changed files sit in, or null when no area dominates. A change spread over many areas has no
 * honest scope, and a scope naming one of them misdescribes the rest.
 */
export function suggestScope(diff, changedFiles = null) {
  const files = changedFiles && changedFiles.length ? changedFiles : parseDiffPaths(diff);
  if (files.length === 0) return null;

  const counts = new Map();
  for (const area of files.map(areaOf).filter(Boolean)) counts.set(area, (counts.get(area) ?? 0) + 1);
  const [top] = [...counts].sort((a, b) => b[1] - a[1]);
  if (!top) return null;
  return top[1] / files.length >= DOMINANT_SHARE ? top[0] : null;
}

/**
 * Count added and removed lines in a git diff.
 */
function countChanges(diff) {
  let added = 0;
  let removed = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++") && !line.startsWith("+++ ")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---") && !line.startsWith("--- ")) {
      removed++;
    }
  }

  return { added, removed };
}

/**
 * Classify which file categories appear in the diff (test, config, docs).
 */
function classifyFiles(diff) {
  let hasTestFile = false;
  let hasConfigFile = false;
  let hasDocFile = false;

  for (const line of diff.split("\n")) {
    const filePathMatch = line.match(/diff --git a\/(.+?) b\//);
    if (!filePathMatch) continue;
    const path = filePathMatch[1];
    if (/\/test\//.test(path) || /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(path)) {
      hasTestFile = true;
    }
    if (/^config\//.test(path) || /\.(config\.(ts|js|mjs))$/.test(path)) {
      hasConfigFile = true;
    }
    if (/\.(md|txt|rst)$/i.test(path) || /^docs\//.test(path)) {
      hasDocFile = true;
    }
  }

  return { hasTestFile, hasConfigFile, hasDocFile };
}

/**
 * Check if the diff text matches any known fix-related patterns.
 */
/**
 * Patterns that indicate bugfix-related changes.
 * - Generic fix/bug keywords
 * - Null/undefined safety checks
 * - Stack trace indicators (! at ...)
 */
const FIX_PATTERNS = [
  /\b(fix|bug|issue|crash|error handling)\b/i,
  /\b(null|undefined)\s*(check|guard|safe)/i,
  /!\s*at\s+/i,
];

function matchPatterns(diff) {
  for (const pattern of FIX_PATTERNS) {
    if (pattern.test(diff)) return true;
  }
  return false;
}

/**
 * Check if changes are primarily test-related (test files with net removal).
 */
function isTestChange(added, removed, hasTestFile) {
  return hasTestFile && added - removed < 0;
}

/**
 * Check if changes are primarily build/config-related (config files with net removal).
 */
function isConfigChange(added, removed, hasConfigFile) {
  return hasConfigFile && added - removed < THRESHOLDS.configNetChange;
}

/**
 * Check if changes are documentation-only (small additions and removals in doc files).
 */
function isDocChange(added, removed, hasDocFile) {
  return hasDocFile && added < THRESHOLDS.docAdded && removed < THRESHOLDS.docRemoved;
}

/**
 * Check if changes are primarily refactoring (removals far exceed additions).
 */
function isRefactorChange(added, removed) {
  const netChange = added - removed;
  return removed > added * THRESHOLDS.refactorRatio && netChange < THRESHOLDS.refactorNetChange;
}

/**
 * Check if changes represent a feature (net additions above thresholds).
 */
function isFeatureChange(added, netChange) {
  return (
    (added > THRESHOLDS.featLargeAdded && netChange > THRESHOLDS.featLargeNetChange) ||
    (added > THRESHOLDS.featSmallAdded && netChange > THRESHOLDS.featSmallNetChange)
  );
}

export function suggestType(diff) {
  const { added, removed } = countChanges(diff);
  const { hasTestFile, hasConfigFile, hasDocFile } = classifyFiles(diff);
  const netChange = added - removed;

  if (isTestChange(added, removed, hasTestFile)) return "test";
  if (isConfigChange(added, removed, hasConfigFile)) return "build";
  if (isDocChange(added, removed, hasDocFile)) return "docs";
  if (isRefactorChange(added, removed)) return "refactor";
  if (matchPatterns(diff)) return "fix";
  if (isFeatureChange(added, netChange)) return "feat";
  return "chore";
}

const USAGE = `Usage: node suggest-type.mjs [--staged | --unstaged]
Prints a suggested conventional type and scope for the change as JSON.`;

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const mode = process.argv.includes("--unstaged") ? "unstaged" : "staged";
  const diff = getDiff(mode);

  if (!diff.trim()) {
    console.error("No changes detected. Stage some files first.");
    process.exit(1);
  }

  const type = suggestType(diff);
  const scope = suggestScope(diff, getChangedFiles(mode));

  console.log(JSON.stringify({ type, scope }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main();
}
