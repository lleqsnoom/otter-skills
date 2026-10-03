# Reproduction recipes

A reproduction is one command that runs the project's own code and exits non-zero while the bug is present.
Save it in the run folder as `E<nn>-verify.<ext>`, run it, and see it go red before testing any hypothesis.
Each recipe below is a starting shape: replace the module, input and assertion with the ones the bug report
names. A recipe still holding its placeholder values is not a reproduction.

## Backend or library (Node)

```js
// E03-verify.test.mjs — run with: node --test <run folder>/E03-verify.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { total } from "../../../src/cart.mjs"; // the real module, by its path from the run folder

test("cart total counts every item (bug: first item skipped)", () => {
  assert.equal(total([{ price: 5, qty: 1 }, { price: 7, qty: 1 }]), 12);
});
```

## Python

```python
# E03_verify_test.py — run with: python -m pytest <run folder>/E03_verify_test.py
from shop.cart import total

def test_total_counts_every_item():
    assert total([{"price": 5, "qty": 1}, {"price": 7, "qty": 1}]) == 12
```

## CLI

```js
// E03-verify.mjs — run with: node <run folder>/E03-verify.mjs
import { spawnSync } from "node:child_process";
const run = spawnSync("node", ["bin/tool.mjs", "export", "--format", "csv"], { encoding: "utf8" });
if (run.status !== 0 || !run.stdout.startsWith("id,name")) {
  console.error(`FAIL: exit ${run.status}\n${run.stderr}`);
  process.exit(1);
}
```

## Web (Playwright)

```js
// E03-verify.spec.mjs — run with: npx playwright test <run folder>/E03-verify.spec.mjs
import { test, expect } from "@playwright/test";
test("saving the form shows the saved state", async ({ page }) => {
  await page.goto("http://localhost:5173/settings");
  await page.getByLabel("Display name").fill("Ada");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
});
```

Without Playwright in the project, drive the page through the chrome-devtools MCP (`o-browser`) and record the
steps; the reproduction is then the recorded steps plus the console or network evidence.

## Mobile (Android)

```bash
# E03-verify.sh — run with: bash <run folder>/E03-verify.sh
adb logcat -c
adb shell am start -n com.example.app/.MainActivity
adb shell input tap 540 1600          # the step that triggers the crash
sleep 3
if adb logcat -d | grep -q "FATAL EXCEPTION"; then echo "FAIL: crash reproduced"; exit 1; fi
```

## Flaky bugs

Wrap the reproduction in a loop and gate on the failure rate, so a flaky bug becomes a number you can move:

```bash
fails=0; for i in $(seq 1 50); do node --test E03-verify.test.mjs >/dev/null 2>&1 || fails=$((fails+1)); done
echo "failed $fails/50"; [ "$fails" -eq 0 ]
```

Raise the rate first (smaller timeouts, more parallelism, a fixed seed) until the loop fails most runs; a
reproduction that fails 1 in 50 is too slow to debug with.
