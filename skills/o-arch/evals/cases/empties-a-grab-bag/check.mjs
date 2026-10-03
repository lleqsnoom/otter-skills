// Passes only when the utils bag is gone, each function lives with the one feature that uses it, nothing imports
// a utils path any more, and the tests pass unchanged.
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";

const failures = [];
const expect = (ok, message) => ok || failures.push(message);
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src"], { encoding: "utf8" }).split("\n").filter(Boolean).filter((f) => fs.existsSync(f));
expect(!files.some((f) => /(^|\/)utils(\/|\.)/.test(f)), "a utils file or folder is still there");
const owner = (name) => files.filter((f) => new RegExp(`export (?:function|const) ${name}\\b`).test(fs.readFileSync(f, "utf8")));
expect(owner("formatDate").every((f) => f.startsWith("src/report/")) && owner("formatDate").length === 1, `formatDate lives in ${owner("formatDate").join(", ") || "nowhere"}, not with report`);
expect(owner("orderTotal").every((f) => f.startsWith("src/orders/")) && owner("orderTotal").length === 1, `orderTotal lives in ${owner("orderTotal").join(", ") || "nowhere"}, not with orders`);
expect(!files.some((f) => /utils/.test(fs.readFileSync(f, "utf8"))), "something still imports from utils");
expect(execFileSync("git", ["diff", "--name-only", "--", "test"], { encoding: "utf8" }).trim() === "", "the tests were changed");
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
expect(spawnSync(process.execPath, ["--test"], { encoding: "utf8", env }).status === 0, "the tests no longer pass");

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
