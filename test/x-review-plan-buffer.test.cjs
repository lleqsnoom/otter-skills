'use strict';

/**
 * `save-plan.mjs` reads each analyzer by capturing its stdout, and a capture is capped: `execFileSync` holds
 * 1 MiB unless `maxBuffer` raises it. A whole-repo analyzer document is bigger than that — 2.6 MB of complexity
 * and 5.3 MB of duplication on a 4900-file repository — so the capture is cut and the plan reports the analysis
 * as failed, leaving a review with no complexity or duplication numbers on exactly the repositories that need
 * them most. The capture is also what turns "the numbers are unknown" into "the numbers are zero", so this is
 * measured through a stub analyzer rather than by trusting the real one to stay small.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SAVE_PLAN = path.join(__dirname, "..", "skills", "x-review", "scripts", "save-plan.mjs");

/** What a capture holds when `maxBuffer` is not given, in bytes. */
const CAPTURE_LIMIT = 1024 * 1024;

/** Enough functions to push the document well past the capture limit; the guardian test below keeps it honest. */
const FUNCTION_COUNT = 30_000;

const COMPLEXITY_STUB = `
const functions = Array.from({ length: ${FUNCTION_COUNT} }, (_, i) => ({
  name: "fn_" + i,
  line: i + 1,
  length: 3,
  complexity: 1,
  paramCount: 1,
  issues: [],
}));
functions[0].complexity = 9;
functions[1].length = 42;
process.stdout.write(JSON.stringify({
  files: [{ file: "src/a.js", functionCount: functions.length, functions }],
  summary: {
    totalFiles: 1,
    totalFunctions: functions.length,
    highComplexity: 1,
    longFunctions: 1,
    tooManyParams: 0,
    language: "stub",
    thresholds: { maxComplexity: 5, maxLength: 20, maxParams: 3 },
  },
}));
`;

const DUPLICATION_STUB = `
process.stdout.write(JSON.stringify({
  totalFiles: 1,
  duplicatedBlocks: 3,
  duplicates: [{ file: "src/a.js", lines: 6, occurrences: [], sample: "x".repeat(2 * 1024 * 1024) }],
}));
`;

const PATTERNS_STUB = `
process.stdout.write(JSON.stringify({ results: [], totalFiles: 0, message: "stub" }));
`;

let root;
let entry;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-review-plan-"));
  const scripts = path.join(root, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(SAVE_PLAN, path.join(scripts, "save-plan.mjs"));
  fs.writeFileSync(path.join(scripts, "analyze-complexity.mjs"), COMPLEXITY_STUB);
  fs.writeFileSync(path.join(scripts, "check-duplication.mjs"), DUPLICATION_STUB);
  fs.writeFileSync(path.join(scripts, "analyze-patterns.mjs"), PATTERNS_STUB);
  // `save-plan.mjs` resolves its sibling scripts from `import.meta.url`, so it runs the stubs beside this copy.
  entry = fs.realpathSync(path.join(scripts, "save-plan.mjs"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Read one stub's own document, with room for a document larger than a default capture. */
function stubDocument(script) {
  const run = spawnSync(process.execPath, [path.join(root, "scripts", script), "--all"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(run.status, 0, `the ${script} stub exited ${run.status}: ${run.stderr}`);
  return run.stdout;
}

describe("save-plan reads an analyzer document larger than a default capture", () => {
  it("reports the measurements instead of calling the analysis incomplete", () => {
    const out = path.join(root, "plan");
    const run = spawnSync(process.execPath, [entry, "--output", out], { cwd: root, encoding: "utf8" });

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), path.join(out, "E00-review-plan.md"), "it prints the plan path it wrote");

    const plan = fs.readFileSync(path.join(out, "E00-review-plan.md"), "utf8");
    assert.doesNotMatch(
      plan,
      /Analysis incomplete/,
      `a capture cut at its limit reads as a failed analyzer: ${run.stderr}`,
    );
    assert.match(plan, /\*\*Functions with complexity > 5:\*\* 1\b/, "the complexity count survives the capture");
    assert.match(plan, /\*\*Functions longer than 20 lines:\*\* 1\b/);
    assert.match(plan, /\*\*Duplicated blocks found:\*\* 3\b/, "so does the duplication count");
  });

  it("holds stub documents larger than a default capture, so the test above measures something", () => {
    for (const script of ["analyze-complexity.mjs", "check-duplication.mjs"]) {
      const document = stubDocument(script);
      assert.ok(
        document.length > CAPTURE_LIMIT,
        `the ${script} stub wrote ${document.length} bytes, which fits a default capture — this run proves nothing`,
      );
      assert.doesNotThrow(() => JSON.parse(document), `the ${script} stub writes one whole document`);
    }
  });
});
