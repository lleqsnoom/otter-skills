// Passes only when the XS task was built, tested, committed through o-commit, reviewed lightly, and marked done.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const RUN = ".o-skills/runs/2026-01-01-0000-R01-clamp";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const failures = [];
const expect = (ok, message) => ok || failures.push(message);

expect(fs.existsSync("src/clamp.mjs"), "src/clamp.mjs is missing");
if (fs.existsSync("src/clamp.mjs")) {
  const { clamp } = await import(`${process.cwd()}/src/clamp.mjs`);
  expect(clamp?.(15, 0, 10) === 10 && clamp(-3, 0, 10) === 0 && clamp(4, 0, 10) === 4, "clamp returns the wrong value");
  let threw = null;
  try { clamp(1, 5, 1); } catch (error) { threw = error; }
  expect(threw instanceof RangeError, "clamp(1, 5, 1) does not throw a RangeError");
}
const testFile = "test/clamp.test.mjs";
expect(fs.existsSync(testFile) && /throws|rejects/.test(fs.readFileSync(testFile, "utf8")), "the RangeError is not tested");
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
expect(spawnSync(process.execPath, ["--test"], { encoding: "utf8", env }).status === 0, "the suite is not green");

const base = fs.readFileSync(".git/otter-eval-base", "utf8").trim();
const subjects = git("log", "--format=%s", `${base}..HEAD`).split("\n").filter(Boolean);
expect(subjects.length >= 1, "nothing was committed");
for (const subject of subjects) {
  const ok = spawnSync(process.execPath, [".claude/skills/o-commit/scripts/validate-commit.mjs", subject], { encoding: "utf8" }).status === 0;
  expect(ok, `"${subject}" fails o-commit's validator`);
}
expect(!git("log", "--format=%b", `${base}..HEAD`).includes("Co-Authored-By"), "a commit carries a co-author line");

const task = fs.readFileSync(`${RUN}/E01-tasks/L0-T1-clamp.md`, "utf8");
expect(/- \[x\] `test\/clamp\.test\.mjs`/.test(task), "the task's own check is not ticked");
expect(/^done: true$/m.test(task), "status.mjs did not record the task done");
const plans = fs.readdirSync(RUN).filter((name) => /^E\d+-review-plan\.md$/.test(name));
expect(plans.length >= 1, "no review plan: the VERIFY step's o-review did not run");
if (plans.length) expect(/light review/i.test(fs.readFileSync(`${RUN}/${plans.at(-1)}`, "utf8")), "an XS task did not get the light review");

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
