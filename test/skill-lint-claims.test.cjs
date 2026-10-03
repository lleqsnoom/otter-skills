"use strict";

/**
 * Two drifts that came back in every review round: a count stated in words after the fact changed ("propose three
 * solutions" once the rule became two or more), and a script that treats --help as input. The lint reports both.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const LINT = path.join(__dirname, "..", "skills", "o-skill-lint", "scripts", "lint.mjs");
const load = () => import(pathToFileURL(LINT).href);

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oskill-lint-claims-"));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof text === "string" ? text : JSON.stringify(text));
  }
  return root;
}

describe("counted-claim", () => {
  const claims = [{ pattern: "\\b(two|three|four) solutions\\b", allowed: ["two"], why: "the rule is two" }];

  it("reports a stale count where it stands, and passes the allowed one", async () => {
    const { countedClaimProblems } = await load();
    const root = tree({
      ".o-skills/config/claims.json": claims,
      "skills/o-x/SKILL.md": "Weigh two solutions.\nPropose three solutions.\n",
    });
    assert.deepEqual(countedClaimProblems(root).map((p) => [p.file, p.detail.slice(0, 18)]), [["skills/o-x/SKILL.md:2", '"three solutions" ']]);
  });

  it("never reads evals, where a trigger query quotes a user, and does nothing without a table", async () => {
    const { countedClaimProblems } = await load();
    assert.deepEqual(countedClaimProblems(tree({ ".o-skills/config/claims.json": claims, "skills/o-x/evals/notes.md": "propose three solutions\n" })), []);
    assert.deepEqual(countedClaimProblems(tree({ "skills/o-x/SKILL.md": "Propose three solutions.\n" })), []);
  });
});

describe("no-help", () => {
  it("flags a runnable script that never looks at --help, and passes one that does or is a library", async () => {
    const { scriptsWithoutHelp } = await load();
    const guard = "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();\n";
    const dir = tree({
      "scripts/bare.mjs": `function main() {}\n${guard}`,
      "scripts/helps.mjs": `function main() { if (process.argv.includes("--help")) return; }\n${guard}`,
      "scripts/parsed.mjs": `function main() { const args = parse(); if (args.help) return; }\n${guard}`,
      "scripts/library.mjs": "export const x = 1;\n",
    });
    assert.deepEqual(scriptsWithoutHelp(dir), ["scripts/bare.mjs"]);
  });
});
