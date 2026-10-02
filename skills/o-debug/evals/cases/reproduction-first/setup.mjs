// An off-by-one in a cart total, reported the way a user would: a wrong number, no stack trace.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });

git("init", "-q");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
fs.mkdirSync("src");
fs.writeFileSync("package.json", `${JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
fs.writeFileSync(
  "src/cart.mjs",
  [
    "export function total(items) {",
    "  let sum = 0;",
    "  for (let i = 1; i < items.length; i++) sum += items[i].price * items[i].qty;",
    "  return sum;",
    "}",
    "",
  ].join("\n"),
);
git("add", ".");
git("commit", "-qm", "feat: add cart total");
