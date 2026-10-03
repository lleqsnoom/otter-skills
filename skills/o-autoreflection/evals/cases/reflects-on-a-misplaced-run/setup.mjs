// A synthetic, already-normalized session that repeats a real failure: an agent ran o-research from a scratch
// folder, the run landed in /tmp, and the user had to say where it belonged.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { stdio: "ignore" });
git("init", "-q", "-b", "main");
git("config", "user.email", "eval@example.com");
git("config", "user.name", "eval");
fs.writeFileSync("README.md", "# Terrain game\n");
git("add", ".");
git("commit", "-qm", "docs: add readme");

const at = (minute) => `2026-10-03T09:${String(minute).padStart(2, "0")}:00.000Z`;
const call = (id, name, input) => ({ type: "tool_call", id, name, input: JSON.stringify(input) });
const result = (id, name, content) => ({ type: "tool_result", id, name, content });
const SCRATCH = "/tmp/claude-1000/project/session/scratchpad";
const RUN = `${SCRATCH}/research/2026-10-03-0906-R01-infinite-terrain`;
const session = {
  source: { host: "claude", id: "eval-misplaced-run", uuid: "eval-misplaced-run", title: "Infinite terrain research", created: at(5), modified: at(30), headless: false, model: "claude-opus-5-5", models: { "claude-opus-5-5": 9 } },
  skills: [{ name: "o-research", loadedAt: at(6) }],
  messages: [
    { index: 0, role: "user", created: at(5), parts: [{ type: "text", text: "/o-research how to stream infinite procedural terrain in Godot, with sources" }] },
    { index: 1, role: "assistant", created: at(6), model: "claude-opus-5-5", parts: [call("t1", "Skill", { skill: "o-research" })] },
    { index: 2, role: "user", created: at(6), parts: [result("t1", "Skill", "Launching skill: o-research")] },
    { index: 3, role: "assistant", created: at(8), model: "claude-opus-5-5", parts: [call("t2", "Bash", { command: `cd ${SCRATCH}/research && printf 'C1 chunk streaming\\nC2 collision\\n' > criteria.md && node ~/.claude/skills/o-research/scripts/state.mjs start --root . --slug infinite-terrain --metric criteria_coverage --evaluator agent --criteria criteria.md` })] },
    { index: 4, role: "user", created: at(8), parts: [result("t2", "Bash", `{ "dir": "${RUN}/E00-research", "next": "baseline" }`)] },
    { index: 5, role: "assistant", created: at(24), model: "claude-opus-5-5", parts: [{ type: "text", text: `Both criteria are answered with sources I opened. The report is ${RUN}/E00-research/findings.md.` }] },
    { index: 6, role: "user", created: at(25), parts: [{ type: "text", text: "you should add it in .o-skills" }] },
    { index: 7, role: "assistant", created: at(26), model: "claude-opus-5-5", parts: [call("t3", "Bash", { command: `mkdir -p .o-skills/runs && cp -r ${RUN} .o-skills/runs/ && sed -i "s#${SCRATCH}/research/#.o-skills/runs/#g" .o-skills/runs/2026-10-03-0906-R01-infinite-terrain/E00-research/state.json` })] },
    { index: 8, role: "user", created: at(26), parts: [result("t3", "Bash", "")] },
    { index: 9, role: "assistant", created: at(27), model: "claude-opus-5-5", parts: [{ type: "text", text: "Copied the run into .o-skills/runs/ and rewrote the absolute paths in its state.json." }] },
  ],
};
fs.writeFileSync("session.json", `${JSON.stringify(session, null, 2)}\n`);
