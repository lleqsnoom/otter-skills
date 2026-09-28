import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import * as lancedb from '@lancedb/lancedb';

import { isDocumentPath, listDocuments } from './docs.mjs';
import { EMBEDDING_DIMENSIONS, embed } from './embed.mjs';
import { isTextPath, readRepoFile, repoFiles } from './repo.mjs';
import { tasksOf } from './work.mjs';

/**
 * One project's own database: `<repo>/.x-skills/knowledge.lance/`.
 *
 * It lives inside the project, beside `board.json`, so it travels with the checkout and a second machine rebuilds
 * only its own copy. It is *derived* — every row is a reading of a file — which is what makes it safe to delete and
 * what makes the freshness stamp the important part: an answer served from a stale copy without saying so would be
 * the one thing this server exists to prevent.
 *
 * The stamp is a digest of the file list with each file's size and mtime. It is cheap, it is exact enough that an
 * edit is noticed on the next call, and it means a rebuild touches only what changed rather than re-embedding a
 * repository to answer one question.
 */

const DATABASE_DIRECTORY = 'knowledge.lance';
const TABLES = ['tasks', 'docs', 'code', 'drift', 'board'];

/** What a row's text is truncated to before embedding: a long file is represented by its start, not in full. */
const TEXT_FOR_EMBEDDING = 4000;

export const databasePath = (root) => join(root, DATABASE_DIRECTORY);

const digested = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** The digest of every file the project holds, as the repository itself lists them. */
export function stampOf(repoPath) {
  const { mode, files } = repoFiles(repoPath);
  const parts = files.map((relPath) => {
    const stat = statSync(join(repoPath, relPath), { throwIfNoEntry: false });
    return `${relPath}:${stat?.size ?? 0}:${stat?.mtimeMs ?? 0}`;
  });
  return digested(`${mode}\n${parts.join('\n')}`);
}

function rowOf(table, relPath, text, stat, own = {}) {
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

/** Every row the project's files imply, before any vector is attached. */
export function desiredRows(project) {
  const { repoPath, root } = project;
  const rows = { tasks: [], docs: [], code: [], drift: [], board: [] };

  const { files } = repoFiles(repoPath);
  for (const relPath of files) {
    if (!isTextPath(relPath) || isDocumentPath(relPath)) continue;
    const read = readRepoFile(repoPath, relPath);
    if (read.status !== 200) continue;
    rows.code.push(rowOf('code', relPath, read.text, statSync(join(repoPath, relPath), { throwIfNoEntry: false }), {
      language: relPath.slice(relPath.lastIndexOf('.') + 1),
    }));
  }

  const skillsDocuments = (project.categories.find((category) => category.id === 'docs')?.items ?? []).map(
    (item) => item.relPath,
  );
  for (const document of listDocuments({ repoPath, skillsDocuments }).documents) {
    const read = readRepoFile(repoPath, document.relPath);
    if (read.status !== 200) continue;
    rows.docs.push(
      rowOf('docs', document.relPath, read.text, statSync(join(repoPath, document.relPath), { throwIfNoEntry: false }), {
        title: document.relPath,
        mode: document.source,
      }),
    );
  }

  for (const task of tasksOf(project)) {
    const relPath = `.x-skills/${task.item.relPath}`;
    const read = readRepoFile(repoPath, relPath);
    if (read.status !== 200) continue;
    rows.tasks.push(
      rowOf('tasks', relPath, read.text, statSync(join(repoPath, relPath), { throwIfNoEntry: false }), {
        title: task.item.title,
        status: task.item.status ?? 'unknown',
        // An empty string rather than null: LanceDB infers a column's type from the first row, and a null has none.
        epic: task.epic?.title ?? '',
      }),
    );
  }

  // The board table is never searched, so its vector only has to be the right shape for the column to exist.
  rows.board.push({
    id: 'board:stamp',
    table: 'board',
    relPath: '.',
    text: '',
    vector: Array(EMBEDDING_DIMENSIONS).fill(0),
    mtime: 0,
    size: 0,
  });
  return rows;
}

/**
 * A table exists once something is in it. LanceDB refuses an empty table without an explicit schema, and a schema
 * hand-written here would drift from the rows the readers produce — so a table is created by its first write, and a
 * project with no documents simply has no `docs` table.
 */
async function tableOf(db, name) {
  const names = await db.tableNames();
  return names.includes(name) ? db.openTable(name) : null;
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

async function writeRows(db, name, rows) {
  if (!rows.length) return;
  const table = await tableOf(db, name);
  if (table) await table.add(rows);
  else await db.createTable(name, rows);
}

const quoted = (ids) => ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');

/**
 * Bring the project's database up to date, or say why it could not be.
 *
 * Nothing here reads the filesystem outside the project, and nothing writes to it: the only path this touches is
 * the database directory itself.
 */
export async function syncProject(project) {
  try {
    const stamp = stampOf(project.repoPath);
    const db = await lancedb.connect(databasePath(project.root));

    const stored = (await rowsOf(db, 'board')).find((row) => row.id === 'board:stamp');
    if (stored?.stamp === stamp) return { ok: true, rebuilt: false, stamp };

    const desired = desiredRows(project);
    const counts = { tasks: 0, docs: 0, code: 0 };
    let removed = 0;

    for (const name of ['tasks', 'docs', 'code']) {
      const existing = await rowsOf(db, name);
      const byId = new Map(existing.map((row) => [row.id, row]));
      const wanted = new Map(desired[name].map((row) => [row.id, row]));

      const changed = desired[name].filter((row) => {
        const previous = byId.get(row.id);
        return !previous || previous.mtime !== row.mtime || previous.size !== row.size;
      });
      const gone = existing.filter((row) => !wanted.has(row.id));
      if (!changed.length && !gone.length) continue;

      const table = await tableOf(db, name);
      if (table && gone.length) {
        await table.delete(`id IN (${quoted(gone.map((row) => row.id))})`);
      }
      if (changed.length) {
        const vectors = await embed(changed.map((row) => row.text));
        const rows = changed.map((row, index) => ({ ...row, vector: vectors[index] }));
        if (table) {
          // A changed row is deleted before its replacement is added, because the id is what identifies it and two
          // rows with one id would both be search results.
          await table.delete(`id IN (${quoted(changed.map((row) => row.id))})`);
          await table.add(rows);
        } else {
          await db.createTable(name, rows);
        }
        counts[name] = changed.length;
      }
      removed += gone.length;
    }

    const board = await tableOf(db, 'board');
    if (board) await board.delete("id = 'board:stamp'");
    await writeRows(db, 'board', [{ ...desired.board[0], stamp, rows: counts, text: stamp }]);

    return { ok: true, rebuilt: true, stamp, embedded: counts, removed };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/** What the database holds, without building or changing it. */
export async function indexState(project) {
  if (!existsSync(databasePath(project.root))) return { present: false };

  try {
    const db = await lancedb.connect(databasePath(project.root));
    const counts = {};
    for (const name of TABLES) {
      const table = await tableOf(db, name);
      if (table) counts[name] = await table.countRows();
    }
    const stored = (await rowsOf(db, 'board')).find((row) => row.id === 'board:stamp');

    return {
      present: true,
      path: databasePath(project.root),
      stamp: stored?.stamp ?? null,
      rows: counts,
      current: stored?.stamp === stampOf(project.repoPath),
    };
  } catch (error) {
    return { present: true, ok: false, reason: error.message };
  }
}

/** Ranked rows for a query vector, or a refusal saying why the index could not be read. */
export async function searchProject({ project, vector, tables = ['tasks', 'docs', 'code'], limit = 10 }) {
  try {
    const synced = await syncProject(project);
    if (!synced.ok) return synced;

    const db = await lancedb.connect(databasePath(project.root));
    const results = [];

    for (const name of tables) {
      const table = await tableOf(db, name);
      if (!table) continue;
      const rows = await table.search(vector).limit(limit).toArray();
      for (const row of rows) {
        results.push({
          table: name,
          relPath: row.relPath,
          text: row.text,
          title: row.title ?? null,
          distance: row._distance,
        });
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return { ok: true, index: { rebuilt: synced.rebuilt, stamp: synced.stamp }, results: results.slice(0, limit) };
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
export async function relatedProject({ project, relPath, tables = ['tasks', 'docs', 'code'], limit = 10 }) {
  try {
    const synced = await syncProject(project);
    if (!synced.ok) return synced;

    const db = await lancedb.connect(databasePath(project.root));
    let found = null;

    for (const name of tables) {
      const table = await tableOf(db, name);
      if (!table) continue;
      const rows = (await table.query().toArray()).filter((row) => row.relPath === relPath);
      if (rows.length) {
        found = { ...rows[0], table: name };
        break;
      }
    }

    if (!found) return { ok: false, reason: `not in the index: ${relPath}` };

    const results = [];
    for (const name of tables) {
      const table = await tableOf(db, name);
      if (!table) continue;
      const rows = await table.search(found.vector).limit(limit + 1).toArray();
      for (const row of rows) {
        if (row.relPath === relPath && name === found.table) continue;
        results.push({
          table: name,
          relPath: row.relPath,
          text: row.text,
          title: row.title ?? null,
          distance: row._distance,
        });
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return {
      ok: true,
      index: { rebuilt: synced.rebuilt, stamp: synced.stamp },
      related: { path: relPath, table: found.table },
      results: results.slice(0, limit),
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
    const db = await lancedb.connect(databasePath(project.root));
    const table = await tableOf(db, 'drift');

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

    if (table) await table.delete(`docPath = '${docPath.replace(/'/g, "''")}'`);
    if (rows.length) {
      const vectors = await embed(rows.map((row) => row.text));
      await writeRows(db, 'drift', rows.map((row, index) => ({ ...row, vector: vectors[index] })));
    }

    return { ok: true, rows: rows.length };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}
