// Passes only when a reflection was written for this session, passes the skill's own checker, names o-research and
// where its run belonged — and no skill file was edited, since a reflection only reports.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const failures = [];
const expect = (ok, message) => ok || failures.push(message);
const runs = ".o-skills/runs";
const reflections = fs.existsSync(runs) ? fs.readdirSync(runs).flatMap((d) => (fs.statSync(path.join(runs, d)).isDirectory() ? fs.readdirSync(path.join(runs, d)).filter((f) => /^E\d+-reflection\.md$/.test(f)).map((f) => path.join(runs, d, f)) : [])) : [];
expect(reflections.length === 1, `expected one reflection, found ${reflections.length}`);
if (reflections.length) {
  const text = fs.readFileSync(reflections[0], "utf8");
  expect(/o-research/.test(text), "the reflection does not name o-research");
  expect(/\.o-skills|scratch|\/tmp/i.test(text), "the reflection does not say where the run landed or belonged");
  const check = spawnSync(process.execPath, [".claude/skills/o-autoreflection/scripts/check-reflection.mjs", "--file", reflections[0], "--transcript", "session.json"], { encoding: "utf8" });
  expect(check.status === 0, `check-reflection refuses it: ${(check.stdout + check.stderr).slice(0, 400)}`);
}

const repoSkills = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
for (const skill of fs.readdirSync(".claude/skills")) {
  const installed = path.join(".claude/skills", skill, "SKILL.md");
  const source = path.join(repoSkills, skill, "SKILL.md");
  if (fs.existsSync(installed) && fs.existsSync(source)) expect(fs.readFileSync(installed, "utf8") === fs.readFileSync(source, "utf8"), `${skill}/SKILL.md was edited by a report-only reflection`);
}

for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
