// A utils bag holding two unrelated functions, each used by exactly one feature module.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
git("init", "-q", "-b", "main");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
for (const dir of ["src/utils", "src/report", "src/orders", "test"]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync("package.json", `${JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
fs.writeFileSync("src/utils/index.mjs", 'export function formatDate(d) {\n  return d.toISOString().slice(0, 10);\n}\n\nexport function orderTotal(lines) {\n  return lines.reduce((t, l) => t + l.price * l.qty, 0);\n}\n');
fs.writeFileSync("src/report/header.mjs", 'import { formatDate } from "../utils/index.mjs";\n\nexport const header = (d) => `Report ${formatDate(d)}`;\n');
fs.writeFileSync("src/orders/summary.mjs", 'import { orderTotal } from "../utils/index.mjs";\n\nexport const summary = (lines) => `Total ${orderTotal(lines)}`;\n');
fs.writeFileSync(
  "test/features.test.mjs",
  'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { header } from "../src/report/header.mjs";\nimport { summary } from "../src/orders/summary.mjs";\n\ntest("header", () => assert.equal(header(new Date("2026-01-02T00:00:00Z")), "Report 2026-01-02"));\ntest("summary", () => assert.equal(summary([{ price: 2, qty: 3 }]), "Total 6"));\n',
);
git("add", ".");
git("commit", "-qm", "feat: add report and orders");
