// Passes only when the target is met by changing build.mjs alone, the guard still passes, and the run's own
// record proves the stop: a baseline, a kept candidate, and state.mjs verify exiting 0.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const failures = [];
const expect = (ok, message) => ok || failures.push(message);

const size = JSON.parse(execFileSync(process.execPath, ["measure.mjs"], { encoding: "utf8" })).score;
expect(size <= 900, `dist/out.js is ${size} bytes, above the 900 target`);
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
expect(spawnSync(process.execPath, ["--test"], { encoding: "utf8", env }).status === 0, "the guard (node --test) fails");
expect(execFileSync("git", ["status", "--porcelain", "--", "src", "test", "measure.mjs"], { encoding: "utf8" }).trim() === "", "src/, test/ or the evaluator was changed");

const runs = ".o-skills/runs";
const dirs = fs.existsSync(runs)
  ? fs.readdirSync(runs).flatMap((run) => (fs.statSync(path.join(runs, run)).isDirectory() ? fs.readdirSync(path.join(runs, run)).filter((d) => /^E\d+-research$/.test(d)).map((d) => path.join(runs, run, d)) : []))
  : [];
expect(dirs.length === 1, `expected one tuning run, found ${dirs.length}`);
if (dirs.length) {
  const verify = spawnSync(process.execPath, [".claude/skills/o-tune/scripts/state.mjs", "verify", "--dir", dirs[0]], { encoding: "utf8" });
  expect(verify.status === 0, `state.mjs verify refuses the stop: ${verify.stdout.slice(0, 300)}`);
  const state = JSON.parse(fs.readFileSync(path.join(dirs[0], "state.json"), "utf8"));
  expect(state.history.some((entry) => entry.kind === "baseline" || entry.decision === "baseline"), "no baseline was recorded");
  expect(state.history.some((entry) => entry.decision === "keep"), "no candidate was kept");
}

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
