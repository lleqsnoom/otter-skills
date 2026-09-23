# Task Triage Rules Reference

Triage is the pass between the layer roadmap and the task files, and it answers one question per candidate: **is this
a task, or does it need a run of its own?**

It exists because the expensive mistake in decomposition is not the small task, it is the "task" that is
really a subsystem. Written as one file it hands the implementer an interface nobody agreed on, blows the
effort cap, and closes a layer with nothing runnable. The example that named this rule: "make a platform
game". Split by components it reads as `player`, `physics`, `levels`, `enemies`, `score` — five task files,
each hiding a contract. Split by layers it reads as a walking skeleton, then real physics, then enemies,
then polish — and only two of those steps are genuinely task-sized.

## The four verdicts

| Verdict | Means | Artifact |
|---------|-------|----------|
| `task` | One step, one verifiable change, inside this run's layer | `<run folder>/E<nn>-tasks/L<N>-T<M>-<slug>.md` |
| `plan` | It hides a contract or its own layers, so it needs its own spec | A child run started with `x-plan`, from the same project root |
| `analyze` | What to build, or why it fails, cannot be said yet | A child run started with `x-analyze`; its route decides fix / tasks / plan |
| `drop` | It duplicates another candidate, or the layer's scope-out already covers it | Nothing. The reason stays in the ledger. |

`plan` and `analyze` are the only verdicts that cost the user a new run, so they are the only ones that must
cite evidence: a `file:line` or a URL that shows the gap. A verdict you cannot cite is a preference.

## Signals

Read the signals in order and stop at the first that fires.

| Order | Signal | What you look for | Verdict |
|-------|--------|-------------------|---------|
| 1 | **Duplicate or out of scope** | Another candidate, a delivered layer, or the layer's *scope out* already covers it | `drop` |
| 2 | **Own contract** | The work fixes an interface, data shape, protocol, or file format that other work must obey | `plan` |
| 3 | **Own layers** | You can name its own L0..L3 (skeleton, real logic, resilience, polish) without inventing them | `plan` |
| 4 | **Effort far over the cap** | Rough size is 2x the cap or more, and no two-way cut of it exists | `plan` |
| 5 | **Unknown shape** | You cannot say what to build, or what causes the failure, without investigating first | `analyze` |
| 6 | **One change, one check** | One identifiable change, one automated check, inside the cap, ≤2 files touched, no new interface | `task` |

**The cap is 4 hours unless the plan says otherwise.** It is a working convention rather than a measurement: a
sitting is the largest change whose definition of done the person making it can still check, and past it the
unstated interface is usually what is hiding. A plan that carries its own `constraint: task size ≤ <n>` wins,
and the whole point of the pass is that this number is *something to argue with* at the gate, not a sacred line.

Two edges that catch most mistakes:

- **Over the cap, no contract** is not `plan`. It is two or three candidates: add the extra `L<N>-T<M+1>`
  entries and triage those. `plan` is for work whose *shape* is unsettled, not merely its size.
- **A `task` verdict is the default, and it must be earned too.** If you cannot name the change and the
  automated check that proves it in one sentence, the candidate is not a task yet - clarify it or send it
  to `analyze`.

## The analysis pass, per candidate

1. **Read the layer entry** - the layer's objective, scope in, scope out, and DOD.
2. **Search where the candidate lands** - grep the symbols, files, and modules it names. What exists, what
   is absent, what the neighbouring layers already promise. The absence of a collision system is evidence;
   a feeling that games are hard is not.
3. **Walk the signal table** and stop at the first verdict that fires.
4. **Write the reason** the way you would defend it later, in one line: `own contract: gravity, collision
   resolution, tilemap format`.
5. **Cite the evidence** for `plan` and `analyze`. Record what you read, in the ledger, as `file:line` or URL.

Triaging is reading and deciding. It never writes product code, and it never adds scope the layers do not
have - a candidate that turns out to be new scope goes back to the plan, not into the task list.

## Asking the user

- **Only the candidates whose proposal is not `task` need a panel.** A `single` panel per such candidate,
  with `plan`, `analyze`, `task`, `drop` as the options, plus the free-text answer the host adds. Ask at
  most three panels per round.
- **Never ask in prose** and never bury the question in a paragraph.
- A candidate that passes every signal as `task` is recorded without a panel. A twenty-panel interrogation
  is not a gate, it is how a run loses its user.

## Bounds

- **Depth is one level.** A `plan` verdict starts one child run. If a candidate inside that child demands
  its own plan as well, the top-level spec was too coarse: stop, say so at the gate, and take the parent
  back to `x-plan`. Do not spawn a grandchild.
- **Volume is a signal about the layers.** If more than half the candidates come back `plan`, the layers were
  written as a component list rather than as increments. Re-cut them in the plan, or say at the gate that you
  are not going to and why - what the pass may not do is hand out the fleet silently. The worked example below
  hits this bound and shows the re-cut.
- **The child owns its work.** The parent writes no task file for a `plan` or `analyze` candidate. The
  ledger records the slug and the reason; the child run writes its own `E00-plan.md`, its own layers, and its
  own tasks.
- **A parent task may consume what a child delivers.** The task file describes the state it needs, not the
  run it came from: *"the physics module is present and its tests pass"* is a precondition; *"see the
  platform-physics run"* is a cross-reference and does not belong in a task file.

## Worked example - "make a platform game"

Layers: L0 walking skeleton, L1 real movement and physics, L2 enemies and scoring, L3 polish.

| Candidate | Signal that fires | Verdict |
|-----------|-------------------|---------|
| L0-T1 one level, one sprite, arrow keys move it, test proves it renders and moves | 6 - one change, one check, 3h | `task` |
| L1-T1 gravity, collision resolution, tilemap format, sprite-vs-tile response | 2 - own contract: three interfaces nothing else in the repo defines | `plan` |
| L1-T2 pause menu on top of the skeleton | 6 - one component, one test, 2h | `task` |
| L2-T1 enemy behaviour, spawn rules, patrol/pursuit pathing, damage model | 3 - own layers: static enemies, then pathing, then damage | `plan` |
| L2-T2 leaderboard API and storage | 5 - shape unknown: local file, service, or hosted board is undecided | `analyze` |
| L3-T1 asset pipeline for sprites and sound | 2 - own contract: asset naming, packing, load order | `plan` |
| L2-T3 "make the game fun" | 5 - not a change, not checkable | `analyze` |
| L3-T2 duplicate of the L0 rendering test | 1 - already covered | `drop` |

Three task files, one dropped candidate, and five child runs: three `plan`, two `analyze`.

That last number is the volume bound firing. Five runs out of one set of layers means L1 and L2 were written as
component slices ("physics", "levels", "enemies", "asset pipeline") rather than as increments, and the pass is
not finished until the gate has been told so. The re-cut that follows hands out three runs instead of five,
because each layer now delivers one playable step:

| Re-cut layer | The step it delivers | Candidates |
|--------------|----------------------|------------|
| L1 one sprite falls and lands | jump, fall, stand on a flat tilemap | `L1-T1 task` gravity and landing, one test; `L1-T2 plan` tilemap format and collision resolution (child run `platform-physics`) |
| L2 one enemy walks a fixed route | avoid it, stomp it, score it | `L2-T1 task` that enemy with one route and one test; `L2-T2 analyze` leaderboard storage (child run `leaderboard-backend`) |
| L3 assets load through a pipeline | real sprites and sound replace inline data | `L3-T1 plan` asset naming, packing, load order (child run `asset-pipeline`) |
| L4 polish | a pause menu, a title screen | `L4-T1 task` the pause menu |

Six candidates in the re-cut: three task files and three child runs, with the two dropped candidates from the
first cut still dropped. Three of six sits exactly on the bound, so one more run and the layers need cutting
again. The ledger is what made the overweight first cut visible instead of hiding it inside a task file nobody
could finish.
