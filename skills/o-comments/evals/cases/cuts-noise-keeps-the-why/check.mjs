// Passes only when every comment that restates the code is gone, the licence header, the linter directive and the
// comment that says why are all still there, and behaviour is unchanged.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const failures = [];
const expect = (ok, message) => ok || failures.push(message);
const src = fs.readFileSync("src/price.mjs", "utf8");
for (const noise of ["This function rounds a price", "get the floor", "compute the difference", "return the result"]) {
  expect(!src.includes(noise), `the noise comment "${noise}" is still there`);
}
expect(src.includes("SPDX-License-Identifier: MIT") && src.includes("Copyright (c) 2026 Example Ltd."), "the licence header was touched");
expect(src.includes("eslint-disable-next-line no-nested-ternary"), "the linter directive was removed");
expect(/payment provider/.test(src), "the comment that says why was removed");
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
expect(spawnSync(process.execPath, ["--test"], { encoding: "utf8", env }).status === 0, "behaviour changed: the tests fail");

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
