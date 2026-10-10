#!/usr/bin/env node
"use strict";

/**
 * Refactor pattern analyzer — detects code smell opportunities in source files.
 * Merged from o-refactor to unify with o-review analysis pipeline.
 *
 * Patterns detected:
 *   1. Extract Method: compound verb names (`loadAndValidate`) — a function's length is analyze-complexity.mjs's
 *      measurement, read from the syntax tree; a brace count here cannot find where a function ends
 *   2. Rename Variable: single-letter or Hungarian-notation variables
 *   3. Replace Conditional: if/else chains with 4+ branches on same variable
 *   4. Inline Method: trivial methods called from exactly one location
 *
 * Usage:
 *   node analyze-patterns.mjs <file-or-dir> [--thresholds branches]
 *   node analyze-patterns.mjs --all
 *
 * Output: JSON to stdout with suggestions grouped by file.
 */

import fs from "node:fs";
import path from "node:path";
import { findSourceFiles } from "./file-discovery.mjs";

// ── Thresholds ────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS = {
  replaceConditionalBranches: 4,
};

/** `--thresholds <branches>`; the older `<lines>,<branches>` form still parses, and its line count is ignored. */
function parseArgs(argv) {
  const args = argv.slice(2);
  const fileArgs = [];
  const thresholds = { ...DEFAULT_THRESHOLDS };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--thresholds" && i + 1 < args.length) {
      const parts = args[++i].split(",").map(Number).filter(Number.isFinite);
      if (parts.length) thresholds.replaceConditionalBranches = parts[parts.length - 1];
    } else if (!args[i].startsWith("--")) {
      fileArgs.push(args[i]);
    }
  }

  return { fileArgs, thresholds };
}

// ── Pattern Detection Regexes ────────────────────────────────────────

const COMPOUND_VERB_RE = /\b(?:function\s+|async\s+function\s+|export\s+(?:default\s+)?(?:async\s+)?)(\w+)/g;

const SINGLE_LETTER_RE = /\b(?:let|const|var)\s+([a-zA-Z])\s*=/g;

const HUNGARIAN_RE = /\b(?:let|const|var)\s+(str[A-Z]\w*|n[A-Z]\d*\w*|b[A-Z]\w*|arr[A-Z]\w*|obj[A-Z]\w*)\s*=/g;

// ── Compound Verb Names ───────────────────────────────────────────────

const COMMON_NAMES = new Set([
  "parse", "format", "resolve", "detect", "extract", "find", "get", "set",
  "init", "validate", "sanitize", "collect", "compute", "analyze", "build",
  "setup", "ensure", "process", "convert", "transform", "map", "filter",
  "sort", "reduce", "count", "check", "verify", "create", "write", "read",
  "load", "save", "install", "list", "scan", "walk", "handle", "dispatch",
]);

function detectCompoundVerbs(source) {
  const suggestions = [];
  COMPOUND_VERB_RE.lastIndex = 0;

  let match;
  while ((match = COMPOUND_VERB_RE.exec(source)) !== null) {
    const name = match[1];
    if (name.length <= 3 || COMMON_NAMES.has(name.toLowerCase())) continue;

    const andMatch = name.match(/([a-z]+)(?:and|And|AND)([A-Z][a-z])/);
    if (!andMatch) continue;

    suggestions.push({
      type: "extract-method",
      pattern: "compound-verb-name",
      symbol: name,
      description: `Function "${name}" has a compound verb name suggesting multiple responsibilities.`,
    });
  }

  return suggestions;
}

// ── Single-Letter Variables ───────────────────────────────────────────

function detectSingleLetterVars(source) {
  const suggestions = [];
  SINGLE_LETTER_RE.lastIndex = 0;

  let match;
  while ((match = SINGLE_LETTER_RE.exec(source)) !== null) {
    const varName = match[1];
    if (["i", "j", "k"].includes(varName.toLowerCase())) continue;
    suggestions.push({
      type: "rename-variable",
      pattern: "single-letter",
      variable: varName,
      description: `Variable "${varName}" is a single letter. Use a descriptive name that conveys purpose.`,
    });
  }

  return suggestions;
}

// ── Hungarian Notation ────────────────────────────────────────────────

function detectHungarianNotation(source) {
  const suggestions = [];
  HUNGARIAN_RE.lastIndex = 0;

  let match;
  while ((match = HUNGARIAN_RE.exec(source)) !== null) {
    const varName = match[1];
    suggestions.push({
      type: "rename-variable",
      pattern: "hungarian-notation",
      variable: varName,
      description: `Variable "${varName}" uses Hungarian notation. Rely on TypeScript/IDE types instead.`,
    });
  }

  return suggestions;
}

// ── Conditional Chains (if/else if with N+ branches) ──────────────────

function detectConditionalChains(source, branchThreshold) {
  const suggestions = [];
  const lines = source.split("\n");
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const chainMatch = trimmed.match(/\b(if|else\s+if)\s*\(\s*(\w+)\s*[!=<>]=?/);

    if (chainMatch) {
      const varName = chainMatch[2];
      let branches = 1;
      let j = i + 1;

      while (j < lines.length) {
        const nextTrimmed = lines[j].trim();
        const nextChainMatch = nextTrimmed.match(/\belse\s+if\s*\(\s*(\w+)\s*[!=<>]=?/);

        if (nextChainMatch && nextChainMatch[1] === varName) {
          branches++;
          j++;
        } else {
          break;
        }
      }

      if (branches >= branchThreshold) {
        suggestions.push({
          type: "replace-conditional",
          pattern: "if-else-chain",
          variable: varName,
          branches,
          line: i + 1,
          description: `${branches}-branch if/else chain on "${varName}". Consider a strategy pattern or lookup table.`,
        });
      }

      i = j;
    } else {
      i++;
    }
  }

  return suggestions;
}

// ── Trivial Single-Call Methods ───────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** An exported function has callers this file cannot see, so its call count here says nothing about inlining it. */
function isExported(source, name) {
  const word = escapeRegex(name);
  return (
    new RegExp(`export\\s+(?:default\\s+)?(?:async\\s+)?(?:function\\s*\\*?\\s*|const\\s+|let\\s+|class\\s+)${word}\\b`).test(source) ||
    new RegExp(`export\\s*\\{[^}]*\\b${word}\\b[^}]*\\}`).test(source) ||
    new RegExp(`(?:module\\.)?exports(?:\\.${word}\\b|\\s*=\\s*\\{[^}]*\\b${word}\\b)`).test(source)
  );
}

function detectTrivialMethods(source) {
  const suggestions = [];
  const trivialPattern = /\b(?:async\s+)?(?:function\s+(\w+)\s*\([^)]*\)\s*\{[^{}]*\}|(\w+)\s*\([^)]*\)\s*[:=]\s*\{[^{}]*\})/g;

  let match;
  while ((match = trivialPattern.exec(source)) !== null) {
    const name = match[1] || match[2];
    if (!name || name.length <= 3) continue;

    const callPattern = new RegExp(`\\b${escapeRegex(name)}\\s*\\(`, "g");
    let callCount = 0;
    let callMatch;
    while ((callMatch = callPattern.exec(source)) !== null) {
      if (callMatch.index !== match.index) callCount++;
    }

    if (callCount <= 1 && !isExported(source, name)) {
      suggestions.push({
        type: "inline-method",
        pattern: "trivial-single-call",
        symbol: name,
        description: `Trivial method "${name}" is called from at most one location. Consider inlining its logic directly.`,
      });
    }
  }

  return suggestions;
}

// ── GDScript ──────────────────────────────────────────────────────────
// GDScript names in snake_case, declares with `func` and `var`, chains with `elif`, and has no export: a function
// without a leading underscore is public to every other script, and an underscored one may be an engine callback
// or a handler a signal is connected to by name.

const GD_FUNC_RE = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:static\s+)?func\s+([A-Za-z_]\w*)\s*\(/gm;
const GD_SINGLE_LETTER_RE = /^\s*var\s+([a-zA-Z])\s*(?::=|=|:)/gm;
/** Virtual methods the engine calls itself: their call count in a file says nothing. */
const GD_CALLBACKS = new Set([
  "_init", "_ready", "_process", "_physics_process", "_input", "_unhandled_input", "_unhandled_key_input",
  "_shortcut_input", "_gui_input", "_enter_tree", "_exit_tree", "_notification", "_draw", "_to_string",
  "_get_configuration_warnings", "_get", "_set", "_get_property_list", "_validate_property", "_integrate_forces",
  "_can_drop_data", "_drop_data", "_get_drag_data", "_has_point", "_make_custom_tooltip", "_run",
]);

function detectCompoundVerbsGD(source) {
  return [...source.matchAll(GD_FUNC_RE)]
    .map((match) => match[1])
    // A test's name describes a scenario (`test_walk_and_wade_do_not_move`), not a function doing two jobs.
    .filter((name) => /[a-z0-9]_and_[a-z]/.test(name) && !name.startsWith("test_"))
    .map((name) => ({
      type: "extract-method",
      pattern: "compound-verb-name",
      symbol: name,
      description: `Function "${name}" has a compound verb name suggesting multiple responsibilities.`,
    }));
}

function detectSingleLetterVarsGD(source) {
  return [...source.matchAll(GD_SINGLE_LETTER_RE)]
    .map((match) => match[1])
    .filter((name) => !["i", "j", "k"].includes(name.toLowerCase()))
    .map((name) => ({
      type: "rename-variable",
      pattern: "single-letter",
      variable: name,
      description: `Variable "${name}" is a single letter. Use a descriptive name that conveys purpose.`,
    }));
}

function detectConditionalChainsGD(source, branchThreshold) {
  const suggestions = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].match(/^(\s*)if\s+(\w+)\s*(?:==|!=|<=|>=|<|>)/);
    if (!start) continue;
    let branches = 1;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const next = lines[j].match(/^(\s*)elif\s+(\w+)\s*(?:==|!=|<=|>=|<|>)/);
      if (next && next[1] === start[1] && next[2] === start[2]) branches++;
      else if (lines[j].trim() && !lines[j].startsWith(start[1] + "\t") && !lines[j].startsWith(start[1] + " ")) break;
    }
    if (branches >= branchThreshold) {
      suggestions.push({
        type: "replace-conditional",
        pattern: "if-else-chain",
        variable: start[2],
        branches,
        line: i + 1,
        description: `${branches}-branch if/elif chain on "${start[2]}". Consider a match, a lookup table or a strategy.`,
      });
    }
    i = j - 1;
  }
  return suggestions;
}

/** A private one-statement function the file names at most once more -- by a call or by a reference such as connect(). */
function detectTrivialMethodsGD(source) {
  const suggestions = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^(\s*)(?:static\s+)?func\s+(_\w+)\s*\([^)]*\)[^:]*:\s*$/);
    if (!header || GD_CALLBACKS.has(header[2])) continue;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (!lines[j].startsWith(header[1] + "\t") && !lines[j].startsWith(header[1] + " ")) break;
      if (!/^\s*#/.test(lines[j])) body.push(lines[j]);
    }
    if (body.length !== 1) continue;
    const name = header[2];
    // A function passed by name -- to connect(), bind(), or as a string to call_deferred() -- is used as a value
    // and cannot be inlined, however few the uses.
    const definedAt = lines.slice(0, i).reduce((offset, line) => offset + line.length + 1, 0);
    const uses = [...source.matchAll(new RegExp(`\\b${escapeRegex(name)}\\b(\\s*\\()?`, "g"))]
      .filter((use) => use.index < definedAt || use.index > definedAt + lines[i].length);
    if (uses.length <= 1 && uses.every((use) => use[1])) {
      suggestions.push({
        type: "inline-method",
        pattern: "trivial-single-call",
        symbol: name,
        description: `Trivial method "${name}" is used from at most one place. Consider inlining its logic directly.`,
      });
    }
  }
  return suggestions;
}

// ── Analysis Engine ───────────────────────────────────────────────────

function analyzeFile(filePath, thresholds) {
  let source;
  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return { path: filePath, errors: [`Failed to read file: ${err.message}`] };
  }

  const relativePath = path.relative(process.cwd(), filePath);

  const suggestions = [];
  if (path.extname(filePath).toLowerCase() === ".gd") {
    suggestions.push(...detectCompoundVerbsGD(source));
    suggestions.push(...detectSingleLetterVarsGD(source));
    suggestions.push(...detectConditionalChainsGD(source, thresholds.replaceConditionalBranches));
    suggestions.push(...detectTrivialMethodsGD(source));
    return { path: relativePath, suggestions };
  }
  suggestions.push(...detectCompoundVerbs(source));
  suggestions.push(...detectSingleLetterVars(source));
  suggestions.push(...detectHungarianNotation(source));
  suggestions.push(...detectConditionalChains(source, thresholds.replaceConditionalBranches));
  suggestions.push(...detectTrivialMethods(source));

  return { path: relativePath, suggestions };
}

// ── Main ──────────────────────────────────────────────────────────────

/**
 * No `process.exit` here, deliberately: `console.log` to a pipe is asynchronous, so exiting on the next line
 * discards whatever had not drained and the consumer parses a document cut mid-string. Returning lets Node flush
 * first. `test/o-review-patterns-json.test.cjs` is the check that this stays true.
 */
function main() {
  const { thresholds } = parseArgs(process.argv);
  const files = findSourceFiles(process.argv.slice(2));

  if (files.length === 0) {
    console.log(JSON.stringify({ results: [], totalFiles: 0, message: "No source files found." }, null, 2));
    return;
  }

  const results = [];
  for (const file of files) {
    const result = analyzeFile(file, thresholds);
    if (result.suggestions.length > 0 || result.errors) {
      results.push(result);
    }
  }

  const output = { results, totalFiles: files.length };
  console.log(JSON.stringify(output, null, 2));
}

main();
