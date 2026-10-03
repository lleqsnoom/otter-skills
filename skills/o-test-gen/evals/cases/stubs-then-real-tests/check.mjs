// Passes only when the generated test file exists, every stub became a real assertion, and the suite is green.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const failures = [];
const expect = (ok, message) => ok || failures.push(message);
const file = "test/price.test.mjs";

expect(fs.existsSync(file), `${file} was not created where the project keeps its tests`);
if (fs.existsSync(file)) {
  const text = fs.readFileSync(file, "utf8");
  expect(!/TODO/.test(text), "a TODO stub is left in the test file");
  expect((text.match(/assert\.|expect\(/g) ?? []).length >= 3, "fewer than three assertions: the stubs were not written");
  expect(/throws|rejects/.test(text), "the negative-rate error path is not tested");
}
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
expect(spawnSync(process.execPath, ["--test"], { encoding: "utf8", env }).status === 0, "the suite is not green");
expect(fs.readFileSync("src/price.mjs", "utf8").includes("export { round, withTax };"), "the source was changed");

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
