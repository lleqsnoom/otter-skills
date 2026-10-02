"use strict";

/**
 * The artifacts a chain starts from — an analysis, a research report, a plan — open with a property block, so a run
 * reads analysis → plan → tasks in Obsidian. A plan names the input it came from; the others name their type and run.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILLS = path.join(__dirname, "..", "skills");

function cli(cwd, script, ...args) {
  const result = spawnSync(process.execPath, [path.join(SKILLS, script), ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const repo = () => fs.mkdtempSync(path.join(os.tmpdir(), "oskills-origin-"));
const runOf = (dir) => `runs/${path.basename(dir)}`;

describe("origin artifacts start with their property block", () => {
  it("a plan names its type, its run, and the analysis it came from", () => {
    const cwd = repo();
    const analysis = path.join(".o-skills", "runs", "2026-01-01-0800-R01-key", "E00-analysis.md");
    fs.mkdirSync(path.join(cwd, path.dirname(analysis)), { recursive: true });
    fs.writeFileSync(path.join(cwd, analysis), "# Analysis — key\n");
    const { dir, state } = cli(cwd, "o-plan/scripts/scenario.mjs", "start", "--slug", "kms", "--input", analysis);
    const plan = fs.readFileSync(path.join(cwd, dir, state.report), "utf8");
    assert.ok(
      plan.startsWith(`---\ntype: plan\ntitle: "Plan · kms"\nrun: "[[${runOf(dir)}/index]]"\ninput: "[[runs/2026-01-01-0800-R01-key/E00-analysis]]"\n---\n# Plan — kms\n`),
      plan.slice(0, 300),
    );
    cli(cwd, "o-plan/scripts/scenario.mjs", "record", "--dir", dir, "--event", "research", "--data", "a finding");
    assert.ok(fs.readFileSync(path.join(cwd, dir, state.report), "utf8").startsWith("---\ntype: plan\n"), "a later record keeps the block");
  });

  it("a plan started without an input has no input key", () => {
    const cwd = repo();
    const { dir, state } = cli(cwd, "o-plan/scripts/scenario.mjs", "start", "--slug", "kms");
    assert.ok(fs.readFileSync(path.join(cwd, dir, state.report), "utf8").startsWith(`---\ntype: plan\ntitle: "Plan · kms"\nrun: "[[${runOf(dir)}/index]]"\n---\n`));
  });

  it("an analysis names its type and run", () => {
    const cwd = repo();
    const { dir, state } = cli(cwd, "o-analyze/scripts/scenario.mjs", "start", "--slug", "key");
    assert.ok(fs.readFileSync(path.join(cwd, dir, state.report), "utf8").startsWith(`---\ntype: analysis\ntitle: "Analysis · key"\nrun: "[[${runOf(dir)}/index]]"\n---\n# Analysis — key\n`));
  });

  it("a research report names its type and the run it sits in, and keeps it on every rewrite", () => {
    const cwd = repo();
    const { dir } = cli(cwd, "o-research/scripts/state.mjs", "start", "--slug", "topic", "--metric", "criteria_coverage", "--evaluator", "agent", "--criteria", "2", "--no-evidence");
    const run = path.dirname(dir);
    const expected = `---\ntype: research\ntitle: "Research · topic"\nrun: "[[runs/${path.basename(run)}/index]]"\n---\n# Research — topic\n`;
    assert.ok(fs.readFileSync(path.join(dir, "research.md"), "utf8").startsWith(expected));
    cli(cwd, "o-research/scripts/state.mjs", "record", "--dir", dir, "--baseline", "--coverage", "1/2");
    assert.ok(fs.readFileSync(path.join(dir, "research.md"), "utf8").startsWith(expected), "research.md is rewritten whole, block included");
  });
});

const TAG_NOTE = (name, kind) => `---\ntype: tag\ntitle: "${name} (${kind})"\n---\n# ${name}\n\n![[tag.base]]\n`;
const raw = (cwd, script, ...args) => spawnSync(process.execPath, [path.join(SKILLS, script), ...args], { cwd, encoding: "utf8" });

describe("o-plan tags a run with --topics", () => {
  it("writes the topics into the plan and creates the tag notes and the shared base it lacks", () => {
    const cwd = repo();
    fs.mkdirSync(path.join(cwd, ".o-skills", "tags", "domain"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".o-skills", "tags", "domain", "payments.md"), "mine\n");
    const { dir, state } = cli(cwd, "o-plan/scripts/scenario.mjs", "start", "--slug", "kms", "--topics", "domain/payments,area/board");
    const plan = fs.readFileSync(path.join(cwd, dir, state.report), "utf8");
    assert.match(plan, /^topics:\n {2}- "\[\[tags\/domain\/payments\]\]"\n {2}- "\[\[tags\/area\/board\]\]"$/m);
    assert.equal(fs.readFileSync(path.join(cwd, ".o-skills", "tags", "area", "board.md"), "utf8"), TAG_NOTE("board", "area"));
    assert.equal(fs.readFileSync(path.join(cwd, ".o-skills", "tags", "domain", "payments.md"), "utf8"), "mine\n", "an existing tag note is never rewritten");
    assert.equal(
      fs.readFileSync(path.join(cwd, ".o-skills", "tag.base"), "utf8"),
      fs.readFileSync(path.join(__dirname, "..", "scripts", "vault", "tag.base"), "utf8"),
      "o-plan's copy of the shared base is the one the backfill writes",
    );
  });

  it("refuses a topic that is not domain/<name> or area/<name>, and a fourth domain topic", () => {
    const cwd = repo();
    const bad = raw(cwd, "o-plan/scripts/scenario.mjs", "start", "--slug", "kms", "--topics", "Payments");
    assert.equal(bad.status, 2);
    assert.match(bad.stderr + bad.stdout, /Payments/);
    const many = raw(cwd, "o-plan/scripts/scenario.mjs", "start", "--slug", "kms", "--topics", "domain/a,domain/b,domain/c,domain/d");
    assert.equal(many.status, 2);
    assert.match(many.stderr + many.stdout, /three/);
  });
});

describe("o-analyze tags its analysis with --topics", () => {
  it("writes the topics and creates the missing tag note, and writes none when none are given", () => {
    const cwd = repo();
    const { dir, state } = cli(cwd, "o-analyze/scripts/scenario.mjs", "start", "--slug", "key", "--topics", "domain/key-rotation");
    assert.match(fs.readFileSync(path.join(cwd, dir, state.report), "utf8"), /^topics:\n {2}- "\[\[tags\/domain\/key-rotation\]\]"$/m);
    assert.equal(fs.readFileSync(path.join(cwd, ".o-skills", "tags", "domain", "key-rotation.md"), "utf8"), TAG_NOTE("key-rotation", "domain"));
    assert.equal(
      fs.readFileSync(path.join(cwd, ".o-skills", "tag.base"), "utf8"),
      fs.readFileSync(path.join(__dirname, "..", "scripts", "vault", "tag.base"), "utf8"),
    );

    const plain = repo();
    const second = cli(plain, "o-analyze/scripts/scenario.mjs", "start", "--slug", "key");
    assert.doesNotMatch(fs.readFileSync(path.join(plain, second.dir, second.state.report), "utf8"), /^topics:/m);
  });
});
