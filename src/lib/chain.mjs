/**
 * The chain an artifact is part of: everything a reader would want beside it.
 *
 * The skills leave two relations in the tree and neither is a list. A run numbers its artifacts `E00…E09`, so its
 * rungs are a chain by construction; and a skill that read the previous rung names its path in what it writes
 * (`**Input:** .x-skills/runs/<run>/E00-analysis.md`), which is how a plan points at the analysis it came from. Both
 * are edges of one graph, and the pipeline a reader thinks in — analysis, plan, epic, tasks — is the component those
 * edges connect: `x-analyze` writes the analysis into its own run and `x-plan` opens the next one, so the analysis
 * and the plan that read it are *two runs* joined by one written path.
 *
 * Following only the outbound direction leaves half of that invisible: an epic names the plan, the plan names the
 * analysis, and an analysis names nothing at all — so the analysis page looked like the end of the chain it began.
 * This walks the edges both ways (which is why `scan.mjs` publishes the paths read backwards, `references`) and
 * answers with one ordered list rather than three panels for a reader to join up themselves.
 *
 * The order is the order the pipeline was built in: the run you are in first, its rungs by `E<nn>`, then the runs it
 * reached. Each entry keeps how it was reached — the field's own label (`Input`, `Spec`) and the artifact that wrote
 * it — because that is what says which way the work flowed.
 */

/** A chain is a screen, not an export: past this many artifacts it says how much it is not showing. */
export const CHAIN_LIMIT = 60;

/** An empty set of lookups, so the builders below only have to say what they add. */
function emptyIndex() {
  return { groups: new Map(), owner: new Map(), files: new Map(), outbound: new Map(), inbound: new Map(), rungs: new Map() };
}

/**
 * One artifact, in the index and on both ends of its named paths: what it names (forward) and, read back, the
 * artifacts it will be found by (backward). The backward edge is the whole reason this file exists.
 */
function indexFile(maps, file, owner = null) {
  maps.files.set(file.relPath, file);
  if (file.links?.length) maps.outbound.set(file.relPath, file.links);
  for (const link of file.links ?? []) {
    maps.inbound.set(link.path, [...(maps.inbound.get(link.path) ?? []), { from: file.relPath, label: link.label }]);
  }
  if (!maps.owner.has(file.relPath)) maps.owner.set(file.relPath, owner);
}

/** One collection: itself, the run it numbers if it numbers any, and every file it holds. */
function indexCollection(maps, group) {
  maps.groups.set(group.relPath, group);
  for (const stage of group.stages) maps.rungs.set(stage.relPath, { run: group, stage });
  for (const file of group.files) indexFile(maps, file, group);
}

/**
 * One read of the project, as lookups: the collections, which collection holds each file, every file by path, and the
 * two directions of the named-path edges. Built once per chain so a walk of forty artifacts does not scan the tree
 * forty times.
 */
function indexProject(project) {
  const maps = emptyIndex();
  for (const category of project.categories) {
    for (const file of category.items) indexFile(maps, file);
    for (const group of category.groups) indexCollection(maps, group);
  }
  return maps;
}

/**
 * The collection a path is read in: a run when the path *is* one, or the run that holds the file.
 *
 * A run is the collection that numbered artifacts — not every collection: `E02-tasks/` is a collection too, and it
 * is a rung of the run that holds it, so a chain that treated both as runs would drop the tasks from the pipeline.
 */
function runOf(maps, path) {
  const group = maps.groups.get(path);
  if (group && group.stages.length) return group;
  return maps.rungs.get(path)?.run ?? maps.owner.get(path) ?? null;
}

/** Everything one node is joined to, with the reason: its run's rungs, its run, and the named paths both ways. */
function edgesOf(maps, path) {
  const edges = [];
  const run = runOf(maps, path);
  if (run) {
    for (const stage of run.stages) edges.push({ path: stage.relPath, relation: null, from: null });
    edges.push({ path: run.relPath, relation: null, from: null });
  }
  for (const link of maps.outbound.get(path) ?? []) {
    edges.push({ path: link.path, relation: link.label, from: path });
  }
  for (const link of maps.inbound.get(path) ?? []) {
    // Walking backwards, the artifact that holds the field is still the one that named this: it is the edge's other
    // end, not the node the walk is standing on.
    edges.push({ path: link.from, relation: link.label, from: link.from });
  }
  return edges;
}

/**
 * A node as one line of the chain: what it is, where it lives, and — for a folder rung — the files under it. A rung
 * takes its `E<nn>` and its kind from the run that numbered it, because `E02-tasks/` is a collection *and* the second
 * rung, and a line that read "collection" would hide the order the run was built in.
 */
function entryFor(maps, path, current) {
  const group = maps.groups.get(path);
  if (group) return collectionEntry(maps, group, current);
  const rung = maps.rungs.get(path);
  if (rung && !maps.files.has(path)) return orphanRungEntry(rung, path, current);
  const file = maps.files.get(path);
  return file ? fileEntry(maps, file, current) : null;
}

/** A collection's line: a run, or the `E02-tasks/` a run numbered, which is a collection as well as a rung. */
function collectionEntry(maps, group, current) {
  const rung = maps.rungs.get(group.relPath);
  const owned = group.files.filter((file) => maps.owner.get(file.relPath)?.relPath === group.relPath);
  return {
    path: group.relPath,
    open: group.relPath,
    name: group.name,
    kind: rung?.stage.kind ?? 'collection',
    title: group.title,
    step: rung?.stage.step ?? null,
    isDirectory: true,
    // A folder rung belongs to the run that numbered it, not to itself: reading its own path as its run put
    // `E02-tasks/` after every artifact of the run it came from.
    runPath: rung?.run.relPath ?? group.relPath,
    runTitle: rung?.run.title ?? group.title,
    children: group.stages.length ? owned : group.files,
    current,
  };
}

/**
 * A rung with no collection of its own: a run filed *inside* the category its stage belongs to is skipped where it
 * would be the same work listed twice, so `E02-tasks/` never became one. It is still a rung of the run, so it is
 * listed rather than dropped and it opens the run — a chain that quietly left a stage out would be lying about the
 * order the work was built in.
 */
function orphanRungEntry(rung, path, current) {
  return {
    path,
    open: rung.run.relPath,
    name: rung.stage.name,
    kind: rung.stage.kind,
    title: rung.stage.name,
    step: rung.stage.step,
    isDirectory: true,
    runPath: rung.run.relPath,
    runTitle: rung.run.title,
    children: [],
    current,
  };
}

/** An artifact's line, its `E<nn>` and kind taken from the run that numbered it when it has one. */
function fileEntry(maps, file, current) {
  const rung = maps.rungs.get(file.relPath);
  const owner = maps.owner.get(file.relPath) ?? null;
  return {
    path: file.relPath,
    open: file.relPath,
    name: file.name,
    kind: rung?.stage.kind ?? file.kind,
    title: file.title,
    step: rung?.stage.step ?? file.step ?? null,
    isDirectory: false,
    runPath: owner?.relPath ?? null,
    runTitle: owner?.title ?? null,
    children: [],
    current,
  };
}

/**
 * Everything connected to `relPath`, in the order the pipeline was built.
 *
 * @typedef {{ path: string, open: string, name: string, kind: string, title: string, step: number | null,
 *   isDirectory: boolean, runPath: string | null, runTitle: string | null,
 *   children: { relPath: string, name: string }[], current: boolean, relation: string | null,
 *   from: string | null }} ChainEntry
 * @param {object} project  A project from the snapshot.
 * @param {string} relPath  The artifact (or collection) the reader is looking at.
 * @param {{ limit?: number }} [options]
 * @returns {{ run: { relPath: string, title: string } | null, entries: ChainEntry[], hidden: number }}
 */
export function chainFor(project, relPath, { limit = CHAIN_LIMIT } = {}) {
  const maps = indexProject(project);
  const start = runOf(maps, relPath);
  const entries = orderChain(chainEntries(walk(maps, relPath)), start);

  return { run: start, entries: entries.slice(0, limit), hidden: Math.max(0, entries.length - limit) };
}

/**
 * Every node reachable from `relPath`, with the edge that reached it — breadth first, and once.
 *
 * A run is reached like any other node and dropped on the way out (`chainEntries`): it heads the panel rather than
 * sitting in the chain, while its rungs are edges of it, and keeping it here is what stops the walk from expanding
 * it again and again.
 *
 * @returns {Map<string, { path: string, entry: object | null, run: boolean, relation: string | null, from: string | null }>}
 */
function walk(maps, relPath) {
  const reached = new Map();
  const start = relPath.replace(/\/$/, '');
  const pending = [{ path: start, relation: null, from: null }];

  while (pending.length) {
    const node = pending.shift();
    const path = node.path.replace(/\/$/, '');
    if (reached.has(path)) continue;
    reached.set(path, { path, entry: entryFor(maps, path, path === start), run: runOf(maps, path)?.relPath === path, relation: node.relation, from: node.from });
    for (const edge of edgesOf(maps, path)) pending.push({ ...edge, path: edge.path.replace(/\/$/, '') });
  }
  return reached;
}

/** The chain itself: the nodes that are artifacts, with how each was reached, and no run among them. */
function chainEntries(reached) {
  return [...reached.values()]
    .filter((node) => node.entry && !node.run)
    .map((node) => ({ ...node.entry, relation: node.relation, from: node.from }));
}

/** The pipeline order: the run you are in, then its rungs by `E<nn>`, then the runs it reached, then loose work. */
function orderChain(entries, start) {
  const runRank = (entry) => (entry.runPath === start?.relPath ? 0 : entry.runPath ? 1 : 2);
  return entries.sort((a, b) => {
    return (
      runRank(a) - runRank(b) ||
      (a.step ?? 99) - (b.step ?? 99) ||
      String(a.runPath ?? '').localeCompare(String(b.runPath ?? '')) ||
      a.path.localeCompare(b.path)
    );
  });
}
