// Passes only when the dead function, the wrapper and the unused option are gone, the trust-boundary check stays,
// the tests still pass, and the unbloat record passes its own check.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const failures = [];
const expect = (ok, message) => ok || failures.push(message);
const src = fs.readFileSync("src/orders.mjs", "utf8");
expect(!/legacyTotal/.test(src), "the dead legacyTotal is still there");
expect(!/function computeTotal/.test(src), "the pass-through computeTotal is still there");
expect(!/currency|rounding/.test(src), "the unused options are still there");
expect(/throw new TypeError/.test(src), "the input check at the trust boundary was cut");
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
expect(spawnSync(process.execPath, ["--test"], { encoding: "utf8", env }).status === 0, "the tests no longer pass");
expect(fs.readFileSync("test/orders.test.mjs", "utf8").includes("rejects an order without lines"), "a test was removed");

const runs = ".o-skills/runs";
const records = fs.existsSync(runs) ? fs.readdirSync(runs).flatMap((d) => (fs.statSync(path.join(runs, d)).isDirectory() ? fs.readdirSync(path.join(runs, d)).filter((f) => /^E\d+-unbloat\.md$/.test(f)).map((f) => path.join(runs, d, f)) : [])) : [];
expect(records.length === 1, `expected one unbloat record, found ${records.length}`);
if (records.length) {
  const check = spawnSync(process.execPath, [".claude/skills/o-unbloat/scripts/verdicts.mjs", "check", "--file", records[0]], { encoding: "utf8" });
  expect(check.status === 0, `the record fails its own check: ${check.stdout.slice(0, 300)}`);
}

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
