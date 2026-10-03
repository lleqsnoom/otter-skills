# o-autoreflection — Gates

Every gate a run passes, what passing means, and what checks it.

| Gate | Passes when | Checked by |
|------|-------------|-----------|
| `session_loaded` | a transcript was read and has at least one user message and one tool call | `read-session.mjs` reports non-zero counts |
| `signals_recorded` | `scan-session.mjs` ran and its JSON is in the reflection | `check-reflection.mjs` (empty `Signals` section) |
| `signals_verified` | every high signal was checked against the real file and kept, re-graded, or dropped | *contract* — the checker sees a verdict, not the reading |
| `no_open_questions` | every question was asked as a panel and answered | *contract* — `check-questions.mjs` checks the questions, not the session |
| `proposals_shaped` | each proposal has a `Signal`, `Target`, `Change`, and `Check` line | `check-reflection.mjs` (`proposal-shape`) |
| `high_signals_answered` | every `high` signal has a keep / re-grade / drop verdict, and a kept one is cited by a proposal | `check-reflection.mjs` (`unanswered-high`, `kept-without-proposal`) |
| `scan_is_evidence` | the scan reports messages and tool calls, so it is a session and not a stub | `check-reflection.mjs` (`scan-not-evidence`) |
| `quality_anchored` | every kept quality anchor has a `## Quality` line whose quote is in the transcript and whose skill line exists, and its proposal names a `Watch:` rate | `check-reflection.mjs --transcript` (`quality-unanchored`, `quality-quote`, `quality-skill-line`, `quality-watch`) |
| `reflection_checked` | `check-reflection.mjs` exits 0 | the exit code |
| `route_chosen` | the user picked which proposals to pursue | *contract* — recorded in `Routes` |
| `report_shaped` | every finding cites a session and a message, and every portfolio item is shaped | `check-analysis.mjs` (`no-evidence`, `portfolio-action`) |
| `skill_delta` | every per-skill proposal quotes a line really in that skill's `SKILL.md` (or declares it new) and cites only sessions where the skill was in play | `hunt-issues.mjs --read --by-skill` (`the quoted line is not in`, `was not in play`) |
| `plan_shaped` | every item names its target, its issue and its rate; every `auto` item a find and a check; every quality item a `watch` and the `SKILL.md` line it changes | `check-heal.mjs` (`item-issue`, `item-improvement`, `item-find`, `item-check`, `item-skill-md`) |
| `measure_separated` | no detector, gate or taxonomy is edited in the same plan as a skill it measures | `check-heal.mjs` (`measure-and-measured`, `auto-measure`) |
| `heal_chosen` | the user picked the fixes, and only those were applied | `heal.mjs --apply` takes the ids, the ledger records them |
| `proof_or_revert` | every applied edit passed its check or was reverted | `heal.mjs` reverts on a failed check |

The rows marked *contract* are not commands: nothing can verify that you read a file or rendered a
panel. Keep them honest yourself, and do not let the machine-checked rows imply the others.
