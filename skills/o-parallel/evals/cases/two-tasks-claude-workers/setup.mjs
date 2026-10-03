// A node:test project and two independent XS tasks, committed, so the tree is clean when o-parallel starts.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
git("init", "-q", "-b", "main");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
fs.mkdirSync("src");
fs.mkdirSync("test");
fs.mkdirSync("tasks");
fs.writeFileSync("package.json", `${JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
fs.writeFileSync("src/sum.mjs", "export function sum(values) {\n  return values.reduce((total, value) => total + value, 0);\n}\n");
fs.writeFileSync("test/sum.test.mjs", 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { sum } from "../src/sum.mjs";\n\ntest("sum adds", () => assert.equal(sum([1, 2, 3]), 6));\n');
const task = (name, fn, factor) =>
  fs.writeFileSync(
    `tasks/${name}.md`,
    `# Task: ${fn}\n\n## Goal\nExport \`${fn}(n)\` from \`src/${fn}.mjs\`, returning \`n * ${factor}\`.\n\n## Context\nThe project uses node:test; tests live in \`test/\` as \`<name>.test.mjs\`. Touch no other file.\n\n## Definition of Done\n- [ ] \`test/${fn}.test.mjs\` covers ${fn}(0), ${fn}(4) and a negative number, and \`node --test\` is green\n`,
  );
task("L0-T1-double", "double", 2);
task("L0-T2-triple", "triple", 3);
git("add", ".");
git("commit", "-qm", "feat: add sum and two tasks");
fs.writeFileSync(".git/otter-eval-base", execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }));
