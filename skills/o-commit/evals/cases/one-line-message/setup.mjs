// A repository with one staged change: a new function, so the commit has a clear type and nothing else to decide.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });

git("init", "-q");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
fs.writeFileSync("math.mjs", "export const add = (a, b) => a + b;\n");
git("add", ".");
git("commit", "-qm", "feat: add add");
fs.appendFileSync("math.mjs", "export const subtract = (a, b) => a - b;\n");
git("add", "math.mjs");
