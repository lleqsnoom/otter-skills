// Passes only when both tasks landed on this branch as validated conventional commits, the suite is green, and
// nothing the run used — worktrees, TASK.md — is left behind.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const failures = [];
const expect = (ok, message) => ok || failures.push(message);

for (const [fn, factor] of [["double", 2], ["triple", 3]]) {
  expect(fs.existsSync(`src/${fn}.mjs`), `src/${fn}.mjs is missing`);
  expect(fs.existsSync(`test/${fn}.test.mjs`), `test/${fn}.test.mjs is missing`);
  if (fs.existsSync(`src/${fn}.mjs`)) {
    const mod = await import(`${process.cwd()}/src/${fn}.mjs`);
    expect(mod[fn]?.(5) === 5 * factor, `${fn}(5) is not ${5 * factor}`);
  }
}
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
expect(spawnSync(process.execPath, ["--test"], { encoding: "utf8", env }).status === 0, "the suite is not green");

const base = fs.readFileSync(".git/otter-eval-base", "utf8").trim();
const subjects = git("log", "--no-merges", "--format=%s", `${base}..HEAD`).split("\n").filter(Boolean);
expect(subjects.length >= 2, `expected a commit per task on this branch, found ${subjects.length}`);
const validate = ".claude/skills/o-commit/scripts/validate-commit.mjs";
for (const subject of subjects) {
  expect(spawnSync(process.execPath, [validate, subject], { encoding: "utf8" }).status === 0, `"${subject}" fails o-commit's validator`);
}
expect(git("worktree", "list").split("\n").length === 1, "a worktree was left behind");
expect(!git("ls-files").split("\n").some((file) => file.endsWith("TASK.md")), "a TASK.md was committed");

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
