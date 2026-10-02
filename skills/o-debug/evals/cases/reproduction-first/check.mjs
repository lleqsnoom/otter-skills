// Passes only when the bug is fixed and the run folder holds a reproduction that runs the project's own code:
// green against the fix, red against the original bug.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const failures = [];
const expect = (ok, message) => ok || failures.push(message);

const { total } = await import(path.resolve("src/cart.mjs") + `?t=${Date.now()}`);
expect(total([{ price: 5, qty: 1 }, { price: 7, qty: 1 }]) === 12, "the cart total is still wrong");
expect(total([]) === 0, "an empty cart no longer totals 0");

const runsDir = ".o-skills/runs";
const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).map((name) => path.join(runsDir, name)) : [];
const files = runs.flatMap((dir) => fs.readdirSync(dir).map((name) => path.join(dir, name)));
expect(files.some((file) => /E\d{2}-debug\.md$/.test(file)), "no E<nn>-debug.md session in the run folder");

const verify = files.find((file) => /E\d{2}-verify\.(m?js|cjs)$/.test(file));
expect(verify, "no E<nn>-verify script in the run folder");
if (verify) {
  const run = () => spawnSync(process.execPath, [verify], { encoding: "utf8" }).status;
  expect(run() === 0, "the reproduction does not pass against the fix");
  const fixed = fs.readFileSync("src/cart.mjs", "utf8");
  fs.writeFileSync("src/cart.mjs", execFileSync("git", ["show", "HEAD:src/cart.mjs"], { encoding: "utf8" }));
  const againstBug = run();
  fs.writeFileSync("src/cart.mjs", fixed);
  expect(againstBug !== 0, "the reproduction stays green with the original bug put back, so it does not reproduce it");
}

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
