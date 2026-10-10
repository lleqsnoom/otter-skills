#!/usr/bin/env node

/**
 * Detect duplicated code blocks in source files.
 * Uses a simple line-hashing approach to find repeated sequences.
 *
 * Comments are stripped by a scan that skips strings, by the file's language (text-normalization.mjs); heredocs
 * and raw strings are not recognised. Each occurrence is reported at its line in the file.
 *
 * Usage: node scripts/check-duplication.mjs <file1> [file2] ...
 *        node scripts/check-duplication.mjs --all [--root ./src]
 *
 * Outputs duplicated blocks as JSON.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSourceFiles } from "./file-discovery.mjs";
import { normalizeLines } from "./text-normalization.mjs";

/** The directory this script sits in: ESM has no __dirname, and the config resolves from here. */
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── Config ─────────────────────────────────────────────────────────

function loadConfig() {
  try {
    const configPath = path.join(HERE, "..", "assets", "config.json");
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

const CONFIG = { minDupLines: 5, ...loadConfig() };

// ── Deduplication checker ──────────────────────────────────────────

function findDuplicates(source, filePath) {
  const lines = normalizeLines(source, path.extname(filePath));
  const duplicates = [];

  if (lines.length < CONFIG.minDupLines) return duplicates;

  // Sliding window: hash every N-line block
  const windowSize = CONFIG.minDupLines;
  const hashes = new Map();

  for (let i = 0; i <= lines.length - windowSize; i++) {
    const block = lines.slice(i, i + windowSize).map((line) => line.text).join("\n");
    if (!hashes.has(block)) {
      hashes.set(block, []);
    }
    hashes.get(block).push({ startLine: lines[i].line, block });
  }

  // Collect blocks that appear more than once
  for (const [, occurrences] of hashes) {
    if (occurrences.length > 1) {
      duplicates.push({
        file: filePath,
        lines: windowSize,
        occurrences: occurrences.map((o) => o.startLine),
        sample: occurrences[0].block.split("\n").slice(0, 3).join("\n"),
      });
    }
  }

  return duplicates;
}

// ── Main ───────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const rootDir = args.includes("--root") ? args[args.indexOf("--root") + 1] : undefined;

  const files = findSourceFiles(args, rootDir);

  if (files.length === 0) {
    console.error("No source files found.");
    process.exit(1);
  }

  const allDuplicates = [];

  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const relPath = path.relative(process.cwd(), file);
    const dups = findDuplicates(source, relPath);
    if (dups.length > 0) allDuplicates.push(...dups);
  }

  const report = {
    totalFiles: files.length,
    duplicatedBlocks: allDuplicates.length,
    duplicates: allDuplicates,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
