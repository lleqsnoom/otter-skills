// Passes only when exactly the last commit was reverted, through one conventional revert commit.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const failures = [];
const expect = (ok, message) => ok || failures.push(message);

const subjects = git("log", "--format=%s").split("\n");
expect(subjects.length === 4, `expected one new commit, found ${subjects.length - 3}`);
expect(/^revert: .*f3/.test(subjects[0]), `the newest commit is not the revert of f3: ${subjects[0]}`);
expect(!fs.existsSync("f3.txt"), "f3.txt is still there: the last commit was not reverted");
expect(fs.existsSync("f2.txt") && fs.existsSync("f1.txt"), "an earlier commit was reverted too");
expect(git("status", "--porcelain") === "", "the tree is not clean");

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
