// A module with a dead function, a pass-through wrapper and an option nobody passes — and one input check at the
// trust boundary that must survive the cut. Committed, so the unbloat record has a base to measure against.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
git("init", "-q", "-b", "main");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
fs.mkdirSync("src");
fs.mkdirSync("test");
fs.writeFileSync("package.json", `${JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
fs.writeFileSync(
  "src/orders.mjs",
  `function sumLines(lines) {
  return lines.reduce((total, line) => total + line.price * line.qty, 0);
}

// A pass-through: it only forwards to sumLines.
function computeTotal(lines) {
  return sumLines(lines);
}

// Nobody calls this.
export function legacyTotal(order) {
  return order.items.map((item) => item.price).reduce((a, b) => a + b, 0);
}

/** The order total. Input arrives from the HTTP layer, so it is checked here. */
export function orderTotal(order, options = { currency: "EUR", rounding: "none" }) {
  if (!order || !Array.isArray(order.lines)) throw new TypeError("order.lines must be an array");
  return computeTotal(order.lines);
}
`,
);
fs.writeFileSync(
  "test/orders.test.mjs",
  `import { test } from "node:test";
import assert from "node:assert/strict";
import { orderTotal } from "../src/orders.mjs";

test("adds price times quantity", () => assert.equal(orderTotal({ lines: [{ price: 2, qty: 3 }, { price: 1, qty: 1 }] }), 7));
test("rejects an order without lines", () => assert.throws(() => orderTotal({}), TypeError));
`,
);
git("add", ".");
git("commit", "-qm", "feat: add order totals");
