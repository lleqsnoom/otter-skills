#!/usr/bin/env node
/**
 * `npm run demo` — write a sample `.x-skills` tree to look at the board with.
 *
 * The board has no data of its own: every screen is a reading of a repository's `.x-skills` tree, so the only way to
 * see a shape is to have one on disk. This writes the shapes the reader distinguishes and nothing else: a run whose
 * **plan** carries the layers with the tasks it was split into, a run that began with a triage, a run that ended at a
 * gate, a plan filed loose and paired with its tasks by slug, a task collection belonging to nothing at all, a plan
 * that names the analysis it read, and enough collections to walk the whole eight-colour palette.
 *
 * No run writes an epic. The epic document repeated the plan's layer roadmap in a second file — one plan, two pages —
 * so the sample writes the merged shape and only that. An epic in an old tree is still read; that case is covered by
 * `test/otter-pm.test.cjs`, which builds one on purpose.
 *
 * It is a generator rather than a checked-in tree because `.x-skills` is ignored globally: a tree committed here
 * would be a fixture no clone could see. Re-running overwrites, so a hand-edited sample comes back clean.
 *
 * Usage:
 *   npm run demo                 # writes ./demo
 *   npm run demo -- --root /tmp/board-demo
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const USAGE = [
  'otter-pm demo — write a sample .x-skills tree to look at the board with.',
  '',
  'Usage:',
  '  npm run demo [-- --root <dir>] [--clean]',
  '',
  'Flags:',
  '  --root <dir>  Where to write the tree (default ./demo)',
  '  --clean       Remove the tree first, instead of overwriting file by file',
  '  --help        Show this help',
  '',
].join('\n');

function parseArgs(argv) {
  const args = { root: 'demo', clean: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') args.help = true;
    else if (flag === '--clean') args.clean = true;
    else if (flag === '--root') args.root = argv[(index += 1)] ?? args.root;
    else if (flag.startsWith('--root=')) args.root = flag.slice('--root='.length);
    else {
      process.stderr.write(`Unknown argument: ${flag}\n`);
      process.exit(2);
    }
  }
  return args;
}

/** A run's `state.json`, in the shape `summariseState` reads: every screen defaults a missing field, so only the
 *  facts the sample is about are written. */
function stateFor({ skill, slug, goal, node, stops, report, guards, questions = [], options = [], events = 0 }) {
  return `${JSON.stringify(
    {
      skill,
      slug,
      goal,
      createdAt: '2026-09-18T09:30:00.000Z',
      updatedAt: '2026-09-18T11:05:00.000Z',
      node,
      stops,
      guards: Object.fromEntries(guards.map(([name, pass]) => [name, { pass, expected: true, actual: pass }])),
      openQuestions: questions.map((text, index) => ({ id: `Q${index + 1}`, text, status: 'answered', answer: 'yes' })),
      options: options.map((summary, index) => ({ id: `O${index + 1}`, summary })),
      events: Array.from({ length: events }, (_, index) => ({ kind: 'event', at: `2026-09-18T0${index % 9}:00:00.000Z` })),
      report,
    },
    null,
    2,
  )}\n`;
}

const memoryFor = (slug, lines) => `# Memory — ${slug}\n\n${lines.map((line) => `- [2026-09-18T09:30:00.000Z] ${line}`).join('\n')}\n`;

const taskDoc = ({ name, layer, effort, files, goal, dod, done = false }) => `# Task: ${name}

**Layer:** ${layer}
**Effort:** ${effort}
**Files:** ${files}

## Goal

${goal}

## Context

The reader is already written and tested; this task wires it to the screen. No configuration changes.

## Definition of Done

- [${done ? 'x' : ' '}] \`npm test\`: the suite passes
- [${done ? 'x' : ' '}] \`npm run typecheck\`: no errors

## Test Plan

### Happy Path

- Given one row in the store → expect it on screen

### Error Paths

- Given a missing field → expect the row's placeholder, not a crash

## Preconditions

The previous layer's checks pass and the route exists.
`;

/**
 * The `**Input:**` line, when the plan names what it read. It is the one edge a document writes down itself, and two
 * of the runs below are joined by it: the analysis one run wrote, and the plan the next run opened read it.
 */
const planInput = (input) => (input ? `\n**Input:** \`${input}\`\n` : '');

const planDoc = (topic, goal, input = null) => `# Plan — ${topic}
${planInput(input)}
goal:         ${goal}
contract:     the screen reads the store through the existing reader
invariant:    an empty store renders an empty state, never an error
test:         given one row, when the screen loads, then the row is shown
constraint:   no new dependency

## Layers

### L0 — Skeleton / Prototype
**Goal:** the route renders with stub rows
**What works:** the screen loads and lists two hard-coded rows
**What's mocked:** the store reader returns a fixed list
**Definition of Done:**
- [x] Screen renders without errors: \`npm test\`

### L1 — Real Implementation
**Goal:** the reader replaces the stub
**What changes:** the fixed list becomes the real reader
**Prerequisite:** Layer 0 complete and passing
**Definition of Done:**
- [x] All L0 tests still pass (regression)
- [ ] Rows come from the store
`;

/** The plans filed loose in `plans/`, paired with nothing or with a task collection by slug. */
const LOOSE_PLANS = [
  { stamp: '18-09-2026-11:23', slug: 'openapi-gaps', goal: 'Every published route answers a documented shape' },
  { stamp: '19-09-2026-09:05', slug: 'dark-mode', goal: 'Both themes are painted from the same tokens' },
  { stamp: '22-09-2026-07:15', slug: 'keyboard-nav', goal: 'The board is usable without a pointer' },
  { stamp: '23-09-2026-09:30', slug: 'weekly-digest', goal: 'A weekly digest arrives without being asked for' },
];

/** Runs, in the order they were worked on. Every shape the reader distinguishes is one of these. */
function runFiles() {
  return [
    {
      dir: '2026-09-18-0930-R01-checkout-redesign',
      files: {
        'E00-analysis.md': '# Analysis — checkout-redesign\n\n## Thesis\n\nThe form loses the buyer when it asks for a postcode twice.\n',
        'E01-plan.md': planDoc('checkout-redesign', 'Checkout keeps the buyer in one screen', 'runs/2026-09-18-0930-R01-checkout-redesign/E00-analysis.md'),
        'E02-tasks/L0-0.1-shell.md': taskDoc({ name: 'Checkout shell with stub rows', layer: '0 — Skeleton', effort: '2h', files: 'src/pages/checkout.tsx (new)', goal: 'The route renders with stub rows.', dod: 'Screen renders without errors', done: true }),
        'E02-tasks/L1-1.1-real-reader.md': taskDoc({ name: 'Wire the real cart reader', layer: '1 — Real data', effort: '3h', files: 'src/pages/checkout.tsx (mod), src/lib/cart.mjs (new)', goal: 'Rows come from the store instead of the stub.' }),
        'E02-tasks/L1-1.2-empty-state.md': taskDoc({ name: 'Empty cart shows an empty state', layer: '1 — Real data', effort: '1h', files: 'src/pages/checkout.tsx (mod)', goal: 'An empty cart says so rather than rendering nothing.' }),
        'state.json': stateFor({ skill: 'x-plan', slug: 'checkout-redesign', goal: 'Checkout keeps the buyer in one screen', node: 'handoff', stops: ['handoff', 'abandon'], report: 'E01-plan.md', guards: [['research_recorded', true], ['no_open_questions', true], ['three_options', true], ['decision_made', true], ['spec_complete', true], ['gate_approved', true]], options: ['one screen', 'two steps', 'server-rendered'], events: 14 }),
        'memory.md': memoryFor('checkout-redesign', ['confirm: one screen', 'research: the double postcode field', 'evidence: src/pages/checkout.tsx:44', 'approve: yes']),
      },
    },
    {
      dir: '2026-09-19-1415-R01-search-speed',
      files: {
        'E00-triage.md': '# Triage — search-speed\n\n**Platform:** node\n**Type:** performance\n',
        'E01-plan.md': planDoc('search-speed', 'Search answers while the query is typed', 'analysis/2026-09-17-slow-search.md'),
        'E02-tasks/L1-1.1-index-once.md': taskDoc({ name: 'Build the index once per request', layer: '1 — Real data', effort: '4h', files: 'src/server/search.mjs (mod)', goal: 'The index is built once and reused.' }),
        'E02-tasks/L2-2.1-debounce.md': taskDoc({ name: 'Debounce the query', layer: '2 — Resilience', effort: '1h', files: 'src/components/Search.tsx (mod)', goal: 'Typing does not fire a request per keystroke.' }),
        'state.json': stateFor({ skill: 'x-plan', slug: 'search-speed', goal: 'Search answers while the query is typed', node: 'handoff', stops: ['handoff', 'abandon'], report: 'E01-plan.md', guards: [['research_recorded', true], ['no_open_questions', true], ['three_options', true], ['decision_made', true], ['spec_complete', true], ['gate_approved', true]], options: ['index once', 'cache per query', 'move to a worker'], events: 17 }),
        'memory.md': memoryFor('search-speed', ['research: the index is rebuilt per query', 'question: one index or one per route?', 'answer: one', 'decide: index once']),
      },
    },
    {
      dir: '2026-09-23-0905-R01-csv-export',
      files: {
        'E00-plan.md': planDoc('csv-export', 'A board exports to a file another tool reads'),
        'E01-tasks/L0-0.1-writer.md': taskDoc({ name: 'A file appears with the right columns', layer: '0 — Skeleton', effort: '2h', files: 'src/server/export.mjs (new)', goal: 'Export writes a file with the columns in order.', done: true }),
        'E01-tasks/L1-1.1-real-rows.md': taskDoc({ name: 'Rows come from the store', layer: '1 — Real data', effort: '3h', files: 'src/server/export.mjs (mod)', goal: 'The stub rows are replaced by the board’s own.' }),
        'E01-tasks/L2-2.1-big-boards.md': taskDoc({ name: 'A big board streams instead of buffering', layer: '2 — Resilience', effort: '4h', files: 'src/server/export.mjs (mod)', goal: 'A board larger than memory still exports.' }),
        'state.json': stateFor({ skill: 'x-plan', slug: 'csv-export', goal: 'A board exports to a file another tool reads', node: 'handoff', stops: ['handoff', 'abandon'], report: 'E00-plan.md', guards: [['research_recorded', true], ['no_open_questions', true], ['three_options', true], ['decision_made', true], ['spec_complete', true], ['gate_approved', true]], options: ['write in the writer', 'stream the rows', 'a queue'], events: 15 }),
        'memory.md': memoryFor('csv-export', ['research: the board already knows its columns', 'decide: write in the writer', 'layer: L0 the route answers a file', 'layer: L1 the rows are real']),
      },
    },
    {
      dir: '2026-09-20-1645-R01-import-board',
      files: {
        'E00-triage.md': '# Triage — import-board\n\n**Platform:** node\n**Type:** migration\n',
        'E01-investigate.md': '# Investigate — import-board\n\n## Hypotheses\n\n1. The old board file is read twice — **refuted**\n2. The lanes map by name, not by id — **confirmed**\n\n## Root cause\n\nThe lane id is the position, so a drag renames the lane it left.\n',
        'state.json': stateFor({ skill: 'x-triage', slug: 'import-board', goal: 'Move a board filed before the store was per project', node: 'abandon', stops: ['fix', 'tasks', 'defer', 'abandon'], report: 'E01-investigate.md', guards: [['intent_confirmed', true], ['research_recorded', true], ['no_open_questions', false]], events: 6 }),
        'memory.md': memoryFor('import-board', ['confirm: move the old board', 'research: the lane id is the position', 'route: abandon']),
      },
    },
    {
      dir: '2026-09-22-0830-R01-notifications',
      files: {
        'E00-plan.md': planDoc('notifications', 'A notification exists when work finishes'),
        'E01-tasks/L0-0.1-toast.md': taskDoc({ name: 'A toast renders with fixed text', layer: '0 — Skeleton', effort: '2h', files: 'src/components/Toast.tsx (new)', goal: 'A toast mounts and unmounts.', done: true }),
        'E01-tasks/L1-1.1-finish-event.md': taskDoc({ name: 'A finished run raises the toast', layer: '1 — Real data', effort: '3h', files: 'src/server/events.mjs (new)', goal: 'The toast is raised by a run finishing.' }),
        'state.json': stateFor({ skill: 'x-plan', slug: 'notifications', goal: 'A notification exists when work finishes', node: 'spec', stops: ['handoff', 'abandon'], report: 'E00-plan.md', guards: [['research_recorded', true], ['no_open_questions', true], ['three_options', true], ['decision_made', true], ['spec_complete', false], ['gate_approved', false]], events: 11 }),
        'memory.md': memoryFor('notifications', ['research: the run already writes a stop', 'question: which runs notify?', 'answer: all of them']),
      },
    },
  ];
}

/** Every file the sample holds, as `[path, text]`, relative to the `.x-skills` directory. */
function tree() {
  const files = [
    ['project.md', '# Otter demo\n\n**About:** A sample tree for looking at the board without waiting on real work.\n**Icon:** OD\n**Color:** #0a61b8\n'],
    ['plans/2026-09-22-board-demo.md', planDoc('board-demo', 'A sample tree exists to look at the board with')],
  ];

  for (const run of runFiles()) {
    for (const [name, text] of Object.entries(run.files)) files.push([`runs/${run.dir}/${name}`, text]);
  }

  for (const plan of LOOSE_PLANS) {
    files.push([`plans/${plan.stamp}-${plan.slug}.md`, planDoc(plan.slug, plan.goal)]);
  }

  // The slug is what pairs these with their plan, and the stamp is minutes later than the plan's — the case the reader
  // exists for, since neither document names the other.
  files.push(['tasks/18-09-2026-11:30-openapi-gaps/L0-0.1-route-table.md', taskDoc({ name: 'Publish the route table', layer: '0 — Skeleton', effort: '2h', files: 'src/server/openapi.mjs (new)', goal: 'Every route appears in one table.' })]);
  files.push(['tasks/18-09-2026-11:30-openapi-gaps/L1-1.1-schemas.md', taskDoc({ name: 'Every route answers a schema', layer: '1 — Real data', effort: '3h', files: 'src/server/openapi.mjs (mod)', goal: 'A route without a schema fails the suite.' })]);
  files.push(['tasks/23-09-2026-09:40-weekly-digest/L0-0.1-scheduler.md', taskDoc({ name: 'The digest is scheduled', layer: '0 — Skeleton', effort: '2h', files: 'src/server/digest.mjs (new)', goal: 'A digest is built on a timer.' })]);
  // No plan carries this slug, so the collection is filed as work in its own right.
  files.push(['tasks/21-09-2026-09:20-orphan-tasks/L0-0.1-spike.md', taskDoc({ name: 'Spike: read a board from disk', layer: '0 — Skeleton', effort: '2h', files: 'tools/board-spike.mjs (new)', goal: 'Answer whether an old board can be read at all.' })]);

  files.push(['analysis/2026-09-17-slow-search.md', '# Analysis — slow-search\n\n## Thesis\n\nThe index is rebuilt for every keystroke, so typing is the cost.\n\n## Evidence\n\n- A 3-character query builds the index three times: `src/server/search.mjs:88`\n']);
  files.push(['anal/2026-09-16-flaky-auth.md', '# Analysis — flaky-auth\n\n## Thesis\n\nThe token is refreshed on a timer that fires mid-request.\n']);
  files.push(['critique/2026-09-19-dark-mode-critique.md', '# Roast — dark-mode\n\n**Profile:** epic\n**Total:** 61 / 100 — adequate\n']);
  files.push(['review/2026-09-19-review-plan.md', '# Review plan — checkout-redesign\n\n- [ ] `src/pages/checkout.tsx:44` extracts the postcode field\n- [x] `src/lib/cart.mjs:12` reads the store once\n']);
  files.push(['research/2026-09-18-quickjs-case.md', '# Research — quickjs-case\n\nOne atomic change per iteration, kept only when the measure moves.\n']);
  files.push(['docs/CONTRIBUTING.md', '# Contributing\n\nRun `npm test` before a commit.\n']);

  return files;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const root = resolve(args.root);
if (args.clean) rmSync(root, { recursive: true, force: true });

for (const [path, text] of tree()) {
  const target = resolve(root, '.x-skills', path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, 'utf8');
}

writeFileSync(resolve(root, 'README.md'), '# Otter demo\n\nA sample tree for the board. Written by `npm run demo`.\n', 'utf8');

const files = tree();
process.stdout.write(
  [
    `Wrote ${files.length} artifacts to ${root}/.x-skills`,
    '',
    'Open the board on it:',
    `  OTTER_PM_ROOTS=${root} npm run dev`,
    '',
  ].join('\n'),
);
