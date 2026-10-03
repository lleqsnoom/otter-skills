"use strict";

/** o-domain's format rules, checked: every glossary entry says what it is not, every ADR has its sections and a status. */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "skills", "o-domain", "scripts", "check-domain.mjs");

function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "odomain-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

describe("o-domain check", () => {
  it("names the glossary entry with no not-line and the ADR missing a section or a status", async () => {
    const { checkDomain } = await import(pathToFileURL(SCRIPT).href);
    const root = repo({
      "GLOSSARY.md": "# Glossary\n\n## Shipment\n\nOne dispatch.\n\nNot to be confused with **Order**.\n\n## Order\n\nWhat a customer buys.\n",
      "docs/decisions/0001-outbox.md": "# 0001 — Outbox\n\n**Status:** accepted\n\n## Context\nx\n## Decision\ny\n## Consequences\nz\n",
      "docs/decisions/0002-cache.md": "# 0002 — Cache\n\n## Context\nx\n## Decision\ny\n",
    });
    const result = checkDomain(root);
    assert.equal(result.adrDir, "docs/decisions", "it finds the directory the repo already uses");
    assert.deepEqual(result.violations.map((v) => [v.rule, v.file]).sort(), [
      ["adr-no-status", "docs/decisions/0002-cache.md"],
      ["adr-section-missing", "docs/decisions/0002-cache.md"],
      ["glossary-no-not-line", "GLOSSARY.md"],
    ]);
  });
});
