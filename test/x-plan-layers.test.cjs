"use strict";

/**
 * x-plan hands off a plan whose layer roadmap is complete, or it does not hand off. The five fields a layer
 * carries are what x-decompose reads, so the gate that refuses an incomplete roadmap is the pipeline's promise
 * that a decomposition never starts from half a plan. These tests hold the graph's shape and the gate's reading
 * of real plan text: what passes, what refuses, and what the refusal says.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SCENARIO = path.join(ROOT, "skills", "x-plan", "scripts", "scenario.mjs");

const DECLARATIONS = `goal:         One thing, working.
contract:     The interface that must hold.
invariant:    Nothing regresses.
test:         given a run, when it ends, then it is green
`;

/** A plan whose two layers carry all five fields, with L0 the prototype. */
const COMPLETE = `# Plan — fixture

${DECLARATIONS}
## Layers

### L0 — the skeleton

**Objective:** something runs end to end.
**Scope in:**
- the flow, with mocks
**Scope out:**
- real logic
**Prerequisite:** clean project state
**Definition of Done:**
- [ ] the skeleton runs

### L1 — real logic

**Objective:** the real path works.
**Scope in:**
- the real function
**Scope out:**
- error handling
**Prerequisite:** Layer 0 complete and passing
**Definition of Done:**
- [ ] the real path works
`;

/** A state that satisfies every other gate, so a failure here is about the roadmap. */
function state() {
  return {
    skill: "x-plan",
    slug: "fixture",
    report: "E00-plan.md",
    events: [],
    openQuestions: [],
    options: [],
    decision: null,
    intent: null,
    evidence: [],
    confidence: "high",
    route: null,
  };
}

function guardOn(reportText) {
  return mod.computeGuards(state(), { reportText }).layers_complete;
}

let mod;

describe("x-plan's layer roadmap gate", async () => {
  mod = await import(SCENARIO);

  it("sits between the spec and the gate", () => {
    assert.ok(mod.GRAPH.nodes.includes("layers"), "the node exists");
    assert.deepEqual(
      mod.GRAPH.edges
        .filter((edge) => ["spec", "layers"].includes(edge.from) && edge.to !== "abandon")
        .map((edge) => [edge.from, edge.to, edge.guards]),
      [
        ["spec", "layers", ["spec_complete"]],
        ["layers", "gate", ["layers_complete"]],
      ],
      "a spec opens the roadmap check, and the roadmap check opens the gate",
    );
  });

  it("passes a roadmap whose layers carry all five fields", () => {
    const verdict = guardOn(COMPLETE);
    assert.equal(verdict.pass, true, verdict.actual);
    assert.match(verdict.actual, /2 layer/);
  });

  it("refuses a layer that is missing one field, and names it", () => {
    const missing = COMPLETE.replace("**Scope out:**\n- error handling\n", "");
    const verdict = guardOn(missing);
    assert.equal(verdict.pass, false);
    assert.match(verdict.actual, /L1/);
    assert.match(verdict.actual, /Scope out/);
  });

  it("refuses an empty roadmap rather than passing on nothing", () => {
    const verdict = guardOn(COMPLETE.split("## Layers")[0]);
    assert.equal(verdict.pass, false);
    assert.match(verdict.actual, /no layer/);
  });

  it("records a layer event in the run's memory trail", () => {
    const next = mod.applyEvent(state(), { kind: "layer", data: "L0: the skeleton" });
    assert.equal(next.events.at(-1).kind, "layer");
    assert.match(mod.renderMemoryLine(next.events.at(-1)), /layer: L0: the skeleton/);
  });

  it("answers the gate through the CLI", () => {
    const run = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xskills-layers-")), ".x-skills", "runs", "2026-01-01-0900-R01-fixture");
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, "E00-plan.md"), COMPLETE);
    fs.writeFileSync(path.join(run, "state.json"), JSON.stringify({ ...state(), created: true }, null, 2));

    const pass = spawnSync(process.execPath, [SCENARIO, "guard", "--dir", run, "--gate", "layers_complete"], { encoding: "utf8" });
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);

    fs.writeFileSync(path.join(run, "E00-plan.md"), COMPLETE.split("## Layers")[0]);
    const fail = spawnSync(process.execPath, [SCENARIO, "guard", "--dir", run, "--gate", "layers_complete"], { encoding: "utf8" });
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /no layer/);
  });
});

describe("the plan skeleton x-plan writes", () => {
  it("carries a layer block that already passes the gate", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "xskills-spec-"));
    const written = spawnSync(process.execPath, [path.join(ROOT, "skills", "x-plan", "scripts", "save-spec.mjs"), "--topic", "fixture"], {
      cwd,
      encoding: "utf8",
    });
    assert.equal(written.status, 0, written.stderr);

    const plan = written.stdout.trim();
    assert.ok(fs.existsSync(plan), `the skeleton was written at ${plan}`);
    const text = fs.readFileSync(plan, "utf8");
    const gaps = require(SCENARIO).layerReport(text);
    assert.equal(gaps.layers, 2, "the skeleton shows two layers to fill in");
    assert.deepEqual(gaps.gaps, [], "a fresh skeleton is a complete roadmap, so its author starts from passing");
  });
});
