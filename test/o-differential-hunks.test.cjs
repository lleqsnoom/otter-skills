"use strict";

/**
 * hunks.mjs does the mechanical half of a differential review: every hunk, the symbol it sits in, and that
 * symbol's callers — in its own file, and in the files that import it when it is exported.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "skills", "o-differential", "scripts", "hunks.mjs");

describe("o-differential hunks", () => {
  it("pairs each hunk with its symbol and only the callers that can reach it", async () => {
    const { differential } = await import(pathToFileURL(SCRIPT).href);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "odiff-"));
    const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    fs.writeFileSync(path.join(root, "price.mjs"), "export function total(items) {\n  return items.length;\n}\nfunction main() {\n  return 1;\n}\n");
    fs.writeFileSync(path.join(root, "cart.mjs"), 'import { total } from "./price.mjs";\nexport const sum = (x) => total(x);\n');
    fs.writeFileSync(path.join(root, "other.mjs"), "function main() { return total; }\n");
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
    fs.writeFileSync(path.join(root, "price.mjs"), "export function total(items) {\n  return items.reduce((n, i) => n + i.qty, 0);\n}\nfunction main() {\n  return 2;\n}\n");

    const result = differential(root, "HEAD");
    const byHunk = Object.fromEntries(result.hunks.map((h) => [h.symbol, h]));
    assert.equal(byHunk.total.exported, true);
    assert.deepEqual(byHunk.total.callers, ["cart.mjs:1", "cart.mjs:2"]);
    assert.deepEqual(byHunk.main.callers, [], "a private main has no callers, and other files' main is not one");
  });

  it("counts a file as a caller only when it imports the module, not when it names it", async () => {
    const { differential } = await import(pathToFileURL(SCRIPT).href);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "odiff-imports-"));
    const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    fs.writeFileSync(path.join(root, "analyze.mjs"), "export function score(x) {\n  return x;\n}\n");
    fs.writeFileSync(path.join(root, "notes.mjs"), "// analyze computes the score; see there\nexport const score = 1;\n");
    fs.writeFileSync(path.join(root, "report.mjs"), 'import { score } from "./lib/analyze.mjs";\nexport const r = score(2);\n');
    fs.writeFileSync(path.join(root, "rank.py"), "def score(x):\n    return x\n");
    fs.writeFileSync(path.join(root, "app.py"), "from pkg.rank import score\nprint(score(1))\n");
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
    fs.writeFileSync(path.join(root, "analyze.mjs"), "export function score(x) {\n  return x * 2;\n}\n");
    fs.writeFileSync(path.join(root, "rank.py"), "def score(x):\n    return x * 2\n");

    const result = differential(root, "HEAD");
    const js = result.hunks.find((h) => h.hunk.startsWith("analyze.mjs"));
    assert.deepEqual(js.callers, ["report.mjs:1", "report.mjs:2"], "notes.mjs names analyze and score but imports neither");
    const py = result.hunks.find((h) => h.hunk.startsWith("rank.py"));
    assert.equal(py.exported, true, "a top-level Python def is public");
    assert.deepEqual(py.callers, ["app.py:1", "app.py:2"]);
  });

  it("gives each added function its own row with its doc comment, and reviews an untracked file as new code", async () => {
    const { differential } = await import(pathToFileURL(SCRIPT).href);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "odiff-split-"));
    const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    fs.writeFileSync(path.join(root, "a.mjs"), "export function one() {\n  return 1;\n}\n");
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
    fs.writeFileSync(path.join(root, "a.mjs"), "export function one() {\n  return 1;\n}\n\n/** Two. */\nexport function two() {\n  return 2;\n}\n\n/** Three. */\nfunction three() {\n  return 3;\n}\n");
    fs.writeFileSync(path.join(root, "fresh.mjs"), "export function made() {\n  return 0;\n}\n");

    const rows = differential(root, "HEAD").hunks.map((h) => [h.hunk, h.symbol, h.replaced]);
    assert.deepEqual(rows, [
      ["a.mjs:4-9", "two", "nothing (pure addition)"],
      ["a.mjs:10-13", "three", "nothing (pure addition)"],
      ["fresh.mjs:1-4", "made", "nothing (new file)"],
    ]);
  });
});
