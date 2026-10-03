// main has a correct paginate(); the feature branch changes it in a few lines and drops the last item of every
// page — a bug the existing test, which only checks the page count, does not catch.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
git("init", "-q", "-b", "main");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
fs.mkdirSync("src");
fs.mkdirSync("test");
fs.writeFileSync("package.json", `${JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
fs.writeFileSync(
  "src/paginate.mjs",
  "export function paginate(items, page, size) {\n  const start = page * size;\n  return items.slice(start, start + size);\n}\n\nexport function pageCount(items, size) {\n  return Math.ceil(items.length / size);\n}\n",
);
fs.writeFileSync(
  "test/paginate.test.mjs",
  'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { pageCount } from "../src/paginate.mjs";\n\ntest("ten items in pages of three make four pages", () => assert.equal(pageCount([...Array(10).keys()], 3), 4));\n',
);
git("add", ".");
git("commit", "-qm", "feat: add pagination");
git("switch", "-qc", "feat/clamp-page");
fs.writeFileSync(
  "src/paginate.mjs",
  "export function paginate(items, page, size) {\n  const last = Math.max(0, pageCount(items, size) - 1);\n  const start = Math.min(page, last) * size;\n  return items.slice(start, start + size - 1);\n}\n\nexport function pageCount(items, size) {\n  return Math.ceil(items.length / size);\n}\n",
);
git("commit", "-qam", "feat: clamp the page to the last one");
