import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { importOptional } from './optional.mjs';

import { isDocumentPath, listDocuments } from './docs.mjs';
import { EMBEDDING_DIMENSIONS, embed } from './embed.mjs';
import { isTextPath, readRepoFile, repoFiles } from './repo.mjs';
import { tasksOf } from './work.mjs';

/**
 * One project's own database: `<repo>/.o-skills/knowledge.lance/`.
 *
 * It lives inside the project, beside `board.json`, so it travels with the checkout and a second machine rebuilds
 * only its own copy. It is *derived* — every row is a reading of a file — which is what makes it safe to delete and
 * what makes the freshness stamp the important part: an answer served from a stale copy without saying so would be
 * the one thing this server exists to prevent.
 *
 * The stamp is a digest of the file list with each file's size and mtime. It is cheap, it is exact enough that an
 * edit is noticed on the next call, and it means a rebuild touches only what changed rather than re-embedding a
 * repository to answer one question.
 *
 * Two clients that share a checkout run a server each and both write this directory, so every write is one commit
 * that replaces a row rather than a delete followed by an add, and one the engine refuses is retried — see
 * `replaceRows` and `retryWrite`.
 */

const DATABASE_DIRECTORY = 'knowledge.lance';
const CONTENT_TABLES = ['tasks', 'docs', 'code'];
const TABLES = [...CONTENT_TABLES, 'drift', 'board'];

/**
 * How a refused write is retried: enough attempts, spaced, for the writers of one checkout to settle. The pause
 * matters as much as the count — a table being created is briefly listed before its dataset can be read, and that
 * window is not bounded by anything this side of the process, so a tight loop retries back into it. Measured worst
 * case for the four writers one checkout can hold is well under this budget; a permanent failure pays it once.
 */
const WRITE_ATTEMPTS = 8;
const WRITE_PAUSE_MS = 80;

/** What a row's text is truncated to before embedding: a long file is represented by its start, not in full. */
const TEXT_FOR_EMBEDDING = 4000;
const STAMP_ROW = 'board:stamp';

export const databasePath = (root) => join(root, DATABASE_DIRECTORY);

const digested = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const quoted = (ids) => ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
const inList = (ids) => `id IN (${quoted(ids)})`;

const statOf = (repoPath, relPath) => statSync(join(repoPath, relPath), { throwIfNoEntry: false });

/** The digest of every file the project holds, as the repository itself lists them. */
function stampOf(repoPath) {
  const { mode, files } = repoFiles(repoPath);
  const parts = files.map((relPath) => {
    const stat = statOf(repoPath, relPath);
    return `${relPath}:${stat?.size ?? 0}:${stat?.mtimeMs ?? 0}`;
  });
  return digested(`${mode}\n${parts.join('\n')}`);
}

/** A row built from one file's text, carrying the file's own facts so a change to them is visible in the digest. */
function fileRow(table, repoPath, relPath, text, own = {}) {
  const stat = statOf(repoPath, relPath);
  return {
    id: `${table}:${relPath}`,
    table,
    relPath,
    text: text.slice(0, TEXT_FOR_EMBEDDING),
    vector: [],
    mtime: Math.round(stat?.mtimeMs ?? 0),
    size: stat?.size ?? 0,
    ...own,
  };
}

function codeRows(repoPath) {
  const rows = [];
  for (const relPath of repoFiles(repoPath).files) {
    // A document is the `docs` table's row: indexing it here too would answer one file twice.
    if (!isTextPath(relPath) || isDocumentPath(relPath)) continue;
    const read = readRepoFile(repoPath, relPath);
    if (read.status !== 200) continue;
    rows.push(fileRow('code', repoPath, relPath, read.text, { language: relPath.slice(relPath.lastIndexOf('.') + 1) }));
  }
  return rows;
}

function docRows(project) {
  const { repoPath } = project;
  const skillsDocuments = (project.categories.find((category) => category.id === 'docs')?.items ?? []).map(
    (item) => item.relPath,
  );

  const rows = [];
  for (const document of listDocuments({ repoPath, skillsDocuments }).documents) {
    const read = readRepoFile(repoPath, document.relPath);
    if (read.status !== 200) continue;
    rows.push(
      fileRow('docs', repoPath, document.relPath, read.text, { title: document.relPath, source: document.source }),
    );
  }
  return rows;
}

function taskRows(project) {
  const rows = [];
  for (const task of tasksOf(project)) {
    const relPath = `.o-skills/${task.item.relPath}`;
    const read = readRepoFile(project.repoPath, relPath);
    if (read.status !== 200) continue;
    rows.push(
      fileRow('tasks', project.repoPath, relPath, read.text, {
        title: task.item.title,
        status: task.item.status ?? 'unknown',
        // An empty string rather than null: LanceDB infers a column's type from the first row, and a null has none.
        epic: task.epic?.title ?? '',
      }),
    );
  }
  return rows;
}

/** The board table is never searched, so its vector only has to be the right shape for the column to exist. */
const stampRow = (counts, stamp) => ({
  id: STAMP_ROW,
  table: 'board',
  relPath: '.',
  text: stamp,
  vector: Array(EMBEDDING_DIMENSIONS).fill(0),
  mtime: 0,
  size: 0,
  stamp,
  rows: counts,
});

/** Every row the project's files imply, before any vector is attached. */
function desiredRows(project) {
  return {
    tasks: taskRows(project),
    docs: docRows(project),
    code: codeRows(project.repoPath),
    drift: [],
    board: [stampRow({}, '')],
  };
}

/**
 * A table exists once something is in it. LanceDB refuses an empty table without an explicit schema, and a schema
 * hand-written here would drift from the rows the readers produce — so a table is created by its first write, and a
 * project with no documents simply has no `docs` table.
 *
 * A table another process is still creating is listed before its dataset is committed, and opening it then fails
 * with "not found". That table does not exist yet either: a reader sees no rows, and a writer creates it or, on a
 * retry after losing the race, merges into it.
 */
async function tableOf(db, name) {
  if (!(await db.tableNames()).includes(name)) return null;
  try {
    return await db.openTable(name);
  } catch (error) {
    if (/was not found/.test(error.message)) return null;
    throw error;
  }
}

async function rowsOf(db, name) {
  const table = await tableOf(db, name);
  if (!table) return [];
  try {
    return await table.query().toArray();
  } catch {
    return [];
  }
}

/** One commit per row-set: a matched row is replaced in place, a row that is new is appended. */
const mergeInto = ({ table, rows, prune }) => {
  const merge = table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll();
  return (prune ? merge.whenNotMatchedBySourceDelete({ where: prune }) : merge).execute(rows);
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a write, retrying it whole when another process made it unresolvable.
 *
 * LanceDB retries a conflicting commit from within its own budget, but it *refuses* one class outright: an update
 * that lands on a concurrent overwrite, which is what a merge into a table another process is creating looks like.
 * The retry re-resolves the table rather than repeating the call, so a creation this process lost becomes a merge.
 * Every write here is keyed by row id and so is idempotent, which is what makes retrying on any failure safe.
 */
async function retryWrite(write) {
  let refused;
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      refused = error;
      if (attempt < WRITE_ATTEMPTS) await pause(WRITE_PAUSE_MS);
    }
  }
  throw refused;
}

/**
 * Put `rows` into their table as one atomic upsert on `id`, creating the table on its first write.
 *
 * A changed row has to be *replaced*: deleting it and re-adding its successor are two commits, and the second client
 * that shares a checkout reads between them, finds the id missing, and inserts a copy of its own.
 *
 * `prune` is for the caller writing a whole table, where a row absent from `rows` is gone; a caller writing only what
 * changed must leave it out, because its unchanged rows are absent from `rows` too.
 */
async function replaceRows({ db, name, rows, prune }) {
  await retryWrite(async () => {
    const table = await tableOf(db, name);
    if (table) return mergeInto({ table, rows, prune });
    if (!rows.length) return;
    return db.createTable(name, rows);
  });
}

/** Drop rows by id, re-resolving the table so an attempt after a lost race still finds the one that stands. */
async function deleteRows(db, name, ids) {
  if (!ids.length) return;
  await retryWrite(async () => {
    const table = await tableOf(db, name);
    if (table) await table.delete(inList(ids));
  });
}

const changedIn = (desired, existing) => {
  const byId = new Map(existing.map((row) => [row.id, row]));
  return desired.filter((row) => {
    const previous = byId.get(row.id);
    return !previous || previous.mtime !== row.mtime || previous.size !== row.size;
  });
};

const goneFrom = (desired, existing) => {
  const wanted = new Set(desired.map((row) => row.id));
  return existing.filter((row) => !wanted.has(row.id));
};

/**
 * One table brought up to date. The rows whose file is gone are deleted here rather than left to `replaceRows`:
 * they are absent from `rows`, and only a caller writing a whole table may ask absence to mean a deletion.
 */
async function syncTable(db, name, desired) {
  const existing = await rowsOf(db, name);
  const changed = changedIn(desired, existing);
  const gone = goneFrom(desired, existing);
  if (!changed.length && !gone.length) return { embedded: 0, removed: 0 };

  await deleteRows(db, name, gone.map((row) => row.id));
  if (changed.length) {
    const vectors = await embed(changed.map((row) => row.text));
    await replaceRows({ db, name, rows: changed.map((row, index) => ({ ...row, vector: vectors[index] })) });
  }

  return { embedded: changed.length, removed: gone.length };
}

/** The stamp lands as one upsert, so it is never momentarily absent for a process reading the board. */
const writeStamp = (db, counts, stamp) => replaceRows({ db, name: 'board', rows: [stampRow(counts, stamp)] });

/**
 * Bring the project's database up to date, or say why it could not be.
 *
 * Nothing here reads the filesystem outside the project, and nothing writes to it: the only path this touches is
 * the database directory itself.
 */
export async function syncProject(project) {
  try {
    const stamp = stampOf(project.repoPath);
    const db = await (await importOptional('@lancedb/lancedb')).connect(databasePath(project.root));
    const stored = (await rowsOf(db, 'board')).find((row) => row.id === STAMP_ROW);
    if (stored?.stamp === stamp) return { ok: true, rebuilt: false, stamp };

    const desired = desiredRows(project);
    const embedded = {};
    let removed = 0;

    for (const name of CONTENT_TABLES) {
      const done = await syncTable(db, name, desired[name]);
      embedded[name] = done.embedded;
      removed += done.removed;
    }

    await writeStamp(db, embedded, stamp);
    return { ok: true, rebuilt: true, stamp, embedded, removed };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/** What the database holds, without building or changing it. */
export async function indexState(project) {
  if (!existsSync(databasePath(project.root))) return { present: false };

  try {
    const db = await (await importOptional('@lancedb/lancedb')).connect(databasePath(project.root));
    const rows = {};
    for (const name of TABLES) {
      const table = await tableOf(db, name);
      if (table) rows[name] = await table.countRows();
    }
    const stored = (await rowsOf(db, 'board')).find((row) => row.id === STAMP_ROW);

    return {
      present: true,
      path: databasePath(project.root),
      stamp: stored?.stamp ?? null,
      rows,
      current: stored?.stamp === stampOf(project.repoPath),
    };
  } catch (error) {
    return { present: true, ok: false, reason: error.message };
  }
}

const present = (name, row) => ({
  table: name,
  relPath: row.relPath,
  text: row.text,
  title: row.title ?? null,
  distance: row._distance,
});

/** The nearest rows to a vector, across the tables named, skipping the row the query came from. */
async function rankedNear(db, vector, { tables, limit, skip }) {
  const results = [];

  for (const name of tables) {
    const table = await tableOf(db, name);
    if (!table) continue;
    const rows = await table.search(vector).limit(limit + 1).toArray();
    for (const row of rows) {
      if (skip && row.relPath === skip.relPath && name === skip.table) continue;
      results.push(present(name, row));
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, limit);
}

/** The indexed row for a path, or `null` when the index does not hold it. */
async function rowFor(db, relPath, tables) {
  for (const name of tables) {
    const table = await tableOf(db, name);
    if (!table) continue;
    const rows = (await table.query().toArray()).filter((row) => row.relPath === relPath);
    if (rows.length) return { row: rows[0], table: name };
  }
  return null;
}

/** Ranked rows for a query vector, or a refusal saying why the index could not be read. */
export async function searchProject({ project, vector, tables = CONTENT_TABLES, limit = 10 }) {
  try {
    const synced = await syncProject(project);
    if (!synced.ok) return synced;

    const db = await (await importOptional('@lancedb/lancedb')).connect(databasePath(project.root));
    const results = await rankedNear(db, vector, { tables, limit });

    return { ok: true, index: { rebuilt: synced.rebuilt, stamp: synced.stamp }, results };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/**
 * What is nearest a path, according to the index: the file linking.
 *
 * The query vector is the row's own stored vector rather than a fresh embedding of its text, so a document is
 * related to what it *was* when it was indexed, and the answer says which stamp it came from. A path the index does
 * not hold is a refusal naming the path — the alternative, an empty list, reads as "nothing is related to this",
 * which is a different and much stronger claim.
 */
export async function relatedProject({ project, relPath, tables = CONTENT_TABLES, limit = 10 }) {
  try {
    const synced = await syncProject(project);
    if (!synced.ok) return synced;

    const db = await (await importOptional('@lancedb/lancedb')).connect(databasePath(project.root));
    const found = await rowFor(db, relPath, tables);
    if (!found) return { ok: false, reason: `not in the index: ${relPath}` };

    const results = await rankedNear(db, found.row.vector, {
      tables,
      limit,
      skip: { relPath, table: found.table },
    });

    return {
      ok: true,
      index: { rebuilt: synced.rebuilt, stamp: synced.stamp },
      related: { path: relPath, table: found.table },
      results,
    };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/**
 * Replace one document's drift rows.
 *
 * Replacing rather than appending is what makes reading a document twice idempotent: the rows describe the
 * document's claims as they stand now, so a claim it dropped must not survive in the index. The report itself was
 * computed from the files and never depended on the index, so a database that cannot be written costs the
 * persistence and not the answer.
 */
export async function writeDrift({ project, docPath, report }) {
  try {
    const db = await (await importOptional('@lancedb/lancedb')).connect(databasePath(project.root));

    const rows = report.claims.map((claim, index) => ({
      id: `drift:${docPath}:${index}`,
      table: 'drift',
      relPath: docPath,
      docPath,
      claim: claim.claim,
      kind: claim.kind,
      verdict: claim.verdict,
      reason: claim.reason ?? '',
      text: `${claim.kind} ${claim.claim}`,
      vector: [],
      mtime: 0,
      size: 0,
    }));

    const docPredicate = `docPath = '${docPath.replace(/'/g, "''")}'`;
    const vectors = rows.length ? await embed(rows.map((row) => row.text)) : [];
    await replaceRows({
      db,
      name: 'drift',
      rows: rows.map((row, index) => ({ ...row, vector: vectors[index] })),
      prune: docPredicate,
    });

    return { ok: true, rows: rows.length };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}
