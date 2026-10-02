#!/usr/bin/env node
/**
 * o-arch verdicts — is the architecture pass's record finished?
 *
 * A record is a markdown file with a `**Scope:**` line, a `**Declaration:**` line, and one table row per unit
 * judged: unit, group, verdict, reason, evidence. The shape is in `o-arch`'s `SKILL.md`, and the point of
 * checking it is that "every group was rated and every verdict rests on a real line" becomes an exit code
 * rather than a reading of the reviewer's own prose.
 *
 * Detection only: it reads the record and the files its evidence names, opens no network connection, and runs
 * no git command.
 *
 * Usage: node verdicts.mjs --file <record> [--root <dir>] [--self-test]
 * Exit:  0 the record is finished · 1 the record is not · 2 usage or read error
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GROUPS = ["naming", "boundaries", "responsibilities", "dependencies", "composition"];
export const VERDICTS = ["ok", "violated", "unrated"];

// The two groups a declaration is what makes checkable, so a run with none cannot call them ok.
const DECLARED_GROUPS = ["dependencies", "boundaries"];

const COLUMNS = ["unit", "group", "verdict", "reason", "evidence"];
const UNDECLARED = "none";
const EVIDENCE = /^(.+?):(\d+)$/;

const strip = (cell) => String(cell ?? "").replace(/`/g, "").trim();

/** The value of a `**Label:** value` line, or null when the record does not carry it. */
export function headerValue(text, label) {
  return String(text).match(new RegExp(`^\\*\\*${label}:\\*\\*\\s*(\\S.*)$`, "m"))?.[1]?.trim() ?? null;
}

/**
 * The table's rows, read by the header's own column names so the columns may sit in any order. Returns null
 * when the record carries no table that names a unit and a verdict, which is the one shape nothing else fits.
 */
export function recordRows(text) {
  const table = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !/^\|[\s:|-]+\|$/.test(line))
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
  const head = table.find((cells) => COLUMNS.every((name) => cells.map((cell) => cell.toLowerCase()).includes(name)));
  if (!head) return null;
  const names = head.map((cell) => cell.toLowerCase());
  return table.filter((cells) => cells !== head).map((cells) => ({ cells, by: (name) => cells[names.indexOf(name)] ?? "" }));
}

const lineCount = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).length;

/** The file an evidence cell names, looked for from the record's own directory upward, or null. */
export function resolveEvidence(recordPath, rel) {
  for (let dir = path.dirname(path.resolve(recordPath));; dir = path.dirname(dir)) {
    const candidate = path.resolve(dir, rel);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    if (dir === path.dirname(dir)) return null;
  }
}

const violation = ({ rule, unit = null, at = null, detail }) => ({ rule, unit, at, detail });

/** A violation when the condition holds, so each rule reads as one line rather than as a branch. */
const one = (condition, finding) => (condition ? [violation(finding)] : []);

/** The five cells of a row, trimmed and with the two compared against a fixed list folded to lower case. */
function rowFields(row) {
  return {
    unit: strip(row.by("unit")),
    group: strip(row.by("group")).toLowerCase(),
    verdict: strip(row.by("verdict")).toLowerCase(),
    reason: strip(row.by("reason")),
    evidence: strip(row.by("evidence")),
  };
}

function shapeViolations(fields, at, cells) {
  const { unit, group, verdict, reason } = fields;
  return [
    ...one(cells.length !== COLUMNS.length || !unit, { rule: "row-shape", unit, at, detail: `a row is ${COLUMNS.length} cells: ${COLUMNS.join(", ")}` }),
    ...one(!GROUPS.includes(group), { rule: "group-unknown", unit, at, detail: `group is one of ${GROUPS.join(", ")}, not "${group}"` }),
    ...one(!VERDICTS.includes(verdict), { rule: "verdict-unknown", unit, at, detail: `verdict is one of ${VERDICTS.join(", ")}, not "${verdict}"` }),
    ...one(!reason || reason === "-", { rule: "reason-empty", unit, at, detail: "every row says why in one sentence" }),
  ];
}

function evidenceViolations({ unit, verdict, evidence }, at, recordPath) {
  if (evidence === "-") {
    return one(verdict !== "unrated", { rule: "evidence-missing", unit, at, detail: `a ${verdict} row names the file:line it rests on; only an unrated row may write -` });
  }
  const match = evidence.match(EVIDENCE);
  const file = match ? resolveEvidence(recordPath, match[1]) : null;
  return one(!file || lineCount(file) < Number(match[2]), { rule: "evidence-unresolved", unit, at, detail: `${evidence} is not a file and line this tree has` });
}

/** A declaration is what makes two groups checkable, so a run without one may not call them ok. */
function coverageViolations({ unit, group, verdict }, at, declaration) {
  const claimed = verdict === "ok" && declaration === UNDECLARED && DECLARED_GROUPS.includes(group);
  return one(claimed, { rule: "unrated-without-declaration", unit, at, detail: `a run with no declaration cannot rate ${group}: record the row as unrated` });
}

function rowViolations(row, at, { recordPath, declaration }) {
  const fields = rowFields(row);
  return [
    ...shapeViolations(fields, at, row.cells),
    ...evidenceViolations(fields, at, recordPath),
    ...coverageViolations(fields, at, declaration),
  ];
}

function checkHeader(text, recordPath) {
  const scope = headerValue(text, "Scope");
  const declaration = headerValue(text, "Declaration");
  const unresolved = Boolean(declaration) && declaration !== UNDECLARED && !resolveEvidence(recordPath, declaration);
  return {
    scope,
    declaration,
    violations: [
      ...one(!scope, { rule: "header-missing-scope", detail: "a record opens with **Scope:** the files judged" }),
      ...one(!declaration, { rule: "header-missing-declaration", detail: "a record carries **Declaration:** the path it read, or none" }),
      ...one(unresolved, { rule: "declaration-unresolved", detail: `${declaration} is not a file this tree has: a declaration a clone does not receive checks nothing` }),
    ],
  };
}

/**
 * A record against the shape: the two header lines, the table, then one row each. `recordPath` is where the
 * record sits, which is what resolves its evidence against the tree it describes.
 */
export function checkRecord({ recordPath, text }) {
  const header = checkHeader(text, recordPath);
  const rows = recordRows(text);
  if (!rows) {
    const missing = one(true, { rule: "table-missing", detail: `no table with the columns ${COLUMNS.join(", ")}` });
    return { scope: header.scope, declaration: header.declaration, rows: 0, violations: [...header.violations, ...missing] };
  }
  const declaration = (header.declaration ?? "").toLowerCase();
  const rowsFound = rows.flatMap((row, at) => rowViolations(row, at + 1, { recordPath, declaration }));
  return { scope: header.scope, declaration: header.declaration, rows: rows.length, violations: [...header.violations, ...rowsFound] };
}

// #region self-test

const FIXTURE_FILE = new URL("../evals/fixtures/verdict-cases.json", import.meta.url);

export function fixtureCases() {
  try {
    return JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8")).cases;
  } catch (error) {
    throw new Error(`the cases are read from ${fileURLToPath(FIXTURE_FILE)}, which ships beside this skill: ${error.message}`);
  }
}

function writeTree(dir, tree) {
  for (const [rel, text] of Object.entries(tree)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

const caseShape = ({ violations }) => ({ ok: violations.length === 0, rules: [...new Set(violations.map((entry) => entry.rule))].sort() });

/** Every shipped case, written to a temporary tree and checked in-process, so `--self-test` is hermetic. */
export function selfTest() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "verdicts-selftest-"));
  let cases = [];
  try {
    cases = fixtureCases().map(({ name, tree, record, expect }) => {
      const dir = path.join(scratch, name.replace(/[^\w.-]+/g, "-"));
      writeTree(dir, tree);
      const recordPath = path.join(dir, "runs", "R01", "E01-arch.md");
      fs.mkdirSync(path.dirname(recordPath), { recursive: true });
      fs.writeFileSync(recordPath, record);
      const got = caseShape(checkRecord({ recordPath, text: record }));
      return { name, pass: JSON.stringify(got) === JSON.stringify(expect), expected: expect, got };
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return { pass: cases.every((entry) => entry.pass), cases };
}

// #endregion self-test

const USAGE = "usage: verdicts.mjs --file <record> [--root <dir>] [--self-test]";
const KNOWN_FLAGS = ["--file", "--root", "--self-test", "--help", "-h"];
const VALUED_FLAGS = ["--file", "--root"];

/** An unrecognised option is a usage error rather than a word to ignore, so a typo cannot pass for a check. */
function unknownFlag(argv) {
  return argv.find((arg, at) => arg.startsWith("-") && !KNOWN_FLAGS.includes(arg) && !VALUED_FLAGS.includes(argv[at - 1]));
}

function readFlag(argv, flag) {
  const at = argv.indexOf(flag);
  if (at === -1) return { given: false, value: null };
  const value = argv[at + 1];
  return { given: true, value: value && !value.startsWith("--") ? value : null };
}

function printSelfTest() {
  try {
    const { pass, cases } = selfTest();
    console.log(JSON.stringify({ selfTest: pass, cases }, null, 2));
    // `process.exit` would discard whatever of that write had not drained, and the caller parses this document.
    // Setting the code keeps the exit status identical and lets Node flush stdout first.
    process.exitCode = pass ? 0 : 1;
    return;
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(2);
  }
}

function check(argv) {
  const file = readFlag(argv, "--file");
  if (!file.given || !file.value) {
    console.error(USAGE);
    return 2;
  }
  if (!fs.existsSync(file.value) || !fs.statSync(file.value).isFile()) {
    console.error(JSON.stringify({ error: `--file is not a file: ${file.value}` }, null, 2));
    return 2;
  }
  const result = checkRecord({ recordPath: file.value, text: fs.readFileSync(file.value, "utf8") });
  const ok = result.violations.length === 0;
  console.log(JSON.stringify({ file: path.resolve(file.value), scope: result.scope, declaration: result.declaration, rows: result.rows, ok, violations: result.violations }, null, 2));
  return ok ? 0 : 1;
}

function main(argv) {
  const unknown = unknownFlag(argv);
  if (unknown) {
    console.error(`${USAGE}\nunknown option: ${unknown}`);
    process.exit(2);
  }
  if (argv.includes("--self-test")) {
    printSelfTest();
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  process.exit(check(argv));
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2));
}
