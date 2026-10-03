"use strict";

/**
 * route-check puts every trigger query to a model and scores its picks like trigger-rate. The model call is the
 * user's command; these pin what the script builds, reads and counts, with a stand-in model.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "skills", "o-skill-lint", "scripts", "route-check.mjs");
const load = () => import(pathToFileURL(SCRIPT).href);

describe("route-check", () => {
  it("reads the JSON array out of a chatty answer and scores rank-1 and false triggers", async () => {
    const { parseAnswer, score } = await load();
    const picks = parseAnswer('Sure.\n[{"id":1,"skill":"o-plan"},{"id":2,"skill":"o-fix"},{"id":3,"skill":"o-plan"}]\nDone.');
    const result = score(
      [
        { id: 1, skill: "o-plan", query: "plan it", shouldTrigger: true },
        { id: 2, skill: "o-plan", query: "spec it", shouldTrigger: true },
        { id: 3, skill: "o-plan", query: "fix the bug", shouldTrigger: false },
      ],
      picks,
    );
    assert.equal(result.rank1, 50);
    assert.equal(result.falseTriggers, 1);
    assert.deepEqual(result.misses, [{ skill: "o-plan", query: "spec it", pick: "o-fix" }]);
  });

  it("leaves out a skill the model may not invoke, and runs a whole repo through a stand-in model", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oroute-"));
    const skill = (name, extra, queries) => {
      fs.mkdirSync(path.join(root, "skills", name, "evals"), { recursive: true });
      fs.writeFileSync(path.join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} things\n${extra}---\n`);
      fs.writeFileSync(path.join(root, "skills", name, "evals", "triggers.json"), JSON.stringify({ skill: name, queries }));
    };
    skill("o-a", "", [{ query: "do a", should_trigger: true }]);
    skill("o-guide", "disable-model-invocation: true\n", [{ query: "guide me", should_trigger: true }]);
    const { routingSet } = await load();
    assert.deepEqual(routingSet(root).skills.map((s) => s.name), ["o-a"]);
    const model = path.join(root, "model.mjs");
    fs.writeFileSync(model, 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify([{id:1,skill:"o-a"}])));\n');
    const run = spawnSync(process.execPath, [SCRIPT, "--root", root, "--model-cmd", `node ${model}`], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).rank1, 100);
  });
});
