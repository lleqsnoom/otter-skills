// A small module with no tests, in a node:test project.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
git("init", "-q");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
fs.mkdirSync("src");
fs.mkdirSync("test");
fs.writeFileSync("package.json", `${JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
fs.writeFileSync(
  "src/price.mjs",
  [
    "function round(value) {",
    "  return Math.round(value * 100) / 100;",
    "}",
    "",
    "function withTax(net, rate) {",
    '  if (rate < 0) throw new RangeError("rate must not be negative");',
    "  return round(net * (1 + rate));",
    "}",
    "",
    "export { round, withTax };",
    "",
  ].join("\n"),
);
git("add", ".");
git("commit", "-qm", "feat: add price helpers");
