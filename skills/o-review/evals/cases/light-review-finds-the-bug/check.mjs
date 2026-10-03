// Passes only when the review plan exists, is a light review with every pass heading, and its correctness pass
// names the dropped last item in src/paginate.mjs — without the reviewer touching the code.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const failures = [];
const expect = (ok, message) => ok || failures.push(message);

const runs = ".o-skills/runs";
const plans = fs.existsSync(runs)
  ? fs.readdirSync(runs).flatMap((dir) => (fs.statSync(path.join(runs, dir)).isDirectory() ? fs.readdirSync(path.join(runs, dir)).filter((f) => /^E\d+-review-plan\.md$/.test(f)).map((f) => path.join(runs, dir, f)) : []))
  : [];
expect(plans.length === 1, `expected one review plan, found ${plans.length}`);
if (plans.length) {
  const plan = fs.readFileSync(plans[0], "utf8");
  for (const heading of ["[Correctness]", "[PRINCIPLE]", "[Comments]", "[Bloat]", "[Architecture]", "[Floor]", "[Spec]"]) {
    expect(plan.includes(`## ${heading}`), `the plan has no ${heading} heading`);
  }
  expect(!/_pending/.test(plan), "a pass was left pending");
  expect(/light review/i.test(plan), "a five-line change did not get the light review");
  const correctness = plan.split("## [Correctness]")[1]?.split("\n## ")[0] ?? "";
  expect(/- \[ \]/.test(correctness), "the correctness pass reported no finding");
  expect(/paginate\.mjs/.test(correctness), "the finding does not name src/paginate.mjs");
  expect(/size - 1|last item|one item|off[- ]by[- ]one|drops?|missing|fewer/i.test(correctness), "the finding does not describe the dropped item");
}
expect(execFileSync("git", ["status", "--porcelain", "--", "src", "test"], { encoding: "utf8" }).trim() === "", "the review changed the code");

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
