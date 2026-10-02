// Passes only when a new commit exists whose whole message is one conventional line with no attribution.
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const failures = [];
const expect = (ok, message) => ok || failures.push(message);

const count = Number(git("rev-list", "--count", "HEAD").trim());
const message = git("log", "-1", "--format=%B").replace(/\s+$/, "");

expect(count === 2, `expected one new commit, found ${count - 1}`);
expect(!message.includes("\n"), `the message is more than one line:\n${message}`);
expect(/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w./-]+\))?!?: \S.*[^.]$/.test(message), `not a conventional subject: ${message}`);
expect(!/co-authored-by|claude|anthropic|generated with/i.test(message), `the message carries attribution: ${message}`);
expect(git("status", "--porcelain").trim() === "", "the staged change is not all committed");

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
