// Three commits; the user wants the last one rolled back and has approved it up front.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
git("init", "-q");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
for (const n of [1, 2, 3]) {
  fs.writeFileSync(`f${n}.txt`, `${n}\n`);
  git("add", ".");
  git("commit", "-qm", `feat: add f${n}`);
}
