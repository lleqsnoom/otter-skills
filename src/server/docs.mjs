import { basename } from 'node:path';

import { readRepoFile, repoFiles } from './repo.mjs';

/**
 * The documents a repository holds: its README and its other markdown.
 *
 * The scanner already reads the markdown inside `.x-skills`, so this only adds what it cannot see — the repository's
 * own files — and the two lists are joined into one, prefixed with `.x-skills/` for those the scanner found. One
 * document therefore appears once, at one path an agent can name.
 */

const MARKDOWN = new Set(['.md', '.markdown']);

/** Whether a path is a document. Exported so the index files a markdown file in `docs` and not also in `code`:
 * one file, one row, or a search answers the same document twice. */
export const isDocumentPath = (relPath) => MARKDOWN.has(relPath.slice(relPath.lastIndexOf('.')).toLowerCase());

/** The title a document leads with, or its file name. */
function titleOf(relPath, text) {
  const heading = /^#\s+(.+)$/m.exec(text ?? '');
  return heading ? heading[1].trim() : basename(relPath);
}

/**
 * Every document, repository-relative.
 *
 * `skillsDocuments` are the ones the scanner already lists inside `.x-skills` — passed in rather than re-walked, so
 * the two halves cannot disagree about what a project holds.
 */
export function listDocuments({ repoPath, skillsDocuments = [] } = {}) {
  const { mode, files } = repoFiles(repoPath);

  const repository = files.filter((relPath) => !relPath.startsWith('.x-skills/') && isDocumentPath(relPath));
  const documents = [
    ...repository.map((relPath) => ({ relPath, source: 'repository' })),
    ...skillsDocuments.map((relPath) => ({ relPath: `.x-skills/${relPath}`, source: 'skills' })),
  ];

  return { mode, documents: documents.sort((a, b) => a.relPath.localeCompare(b.relPath)) };
}

/** One document's text and its own facts. `null` when there is no such document. */
export function readDocument({ repoPath, relPath } = {}) {
  const read = readRepoFile(repoPath, relPath);
  if (read.status !== 200) return read;
  return { ...read, relPath, title: titleOf(relPath, read.text) };
}
