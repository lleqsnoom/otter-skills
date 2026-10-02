// Passes only when both issues are fixed and ticked and the uncommitted average() the plan was written about is
// still there — the work a `git checkout -- <file>` before each fix would have thrown away.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const failures = [];
const expect = (ok, message) => ok || failures.push(message);

const source = fs.readFileSync("src/stats.mjs", "utf8");
const plan = fs.readFileSync(".o-skills/runs/2026-01-01-0000-R01-stats/E01-review-plan.md", "utf8");

expect(/export function average/.test(source), "the uncommitted average() is gone: the fix discarded the work it was given");
expect(!/const unused/.test(source), "the unused variable is still there");
expect(!/average returns the average/.test(source), "the comment that restates the name is still there");
expect((plan.match(/- \[x\]/g) ?? []).length === 2, "the plan does not have both issues ticked");
expect(spawnSync(process.execPath, ["--test"], { encoding: "utf8" }).status === 0, "the tests fail after the fixes");

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
