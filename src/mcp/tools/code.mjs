import * as z from 'zod';

import { findSymbols, readLines, searchRepo } from '../../server/repo.mjs';
import { asText, projectOrThrow, resolveProjects } from '../context.mjs';

/**
 * The code tools: the authoritative half of the server.
 *
 * They read the files, so their answer is what the repository says rather than a copy of it — no index, no cache,
 * no model. `search_code` and `read_code` are exact; `find_symbols` reads declaration shapes and says it is a
 * heuristic, because a miss must never be read as proof that a name is not declared anywhere.
 */
export const CODE_TOOLS = [
  {
    name: 'search_code',
    description: 'Search tracked source for a literal or regular expression, exactly as the files hold it',
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      query: z.string().describe('what to look for'),
      regex: z.boolean().optional().describe('treat the query as a regular expression'),
    },
    handler: async ({ project, query, regex }) => {
      const found = projectOrThrow(resolveProjects(), project);

      let result;
      try {
        result = searchRepo(found.repoPath, { query, regex });
      } catch (error) {
        throw new Error(`could not read ${JSON.stringify(query)} as a ${regex ? 'pattern' : 'literal'}: ${error.message}`);
      }

      return { text: asText({ project: found.id, query, ...result }) };
    },
  },
  {
    name: 'read_code',
    description: 'Read a tracked file, or a line range of it, with line numbers',
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      path: z.string().describe('the file path, relative to the repository'),
      start: z.number().int().positive().optional().describe('first line, 1-based'),
      end: z.number().int().positive().optional().describe('last line, inclusive'),
    },
    handler: async ({ project, path: asked, start, end }) => {
      const found = projectOrThrow(resolveProjects(), project);
      const read = readLines(found.repoPath, asked, { start, end });
      if (read.status !== 200) throw new Error(read.error);

      return { text: asText({ project: found.id, ...read, status: undefined }) };
    },
  },
  {
    name: 'find_symbols',
    description: 'Find where a name is declared, by declaration shape — a heuristic, and it says so',
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      name: z.string().describe('the name to look for'),
    },
    handler: async ({ project, name }) => {
      const found = projectOrThrow(resolveProjects(), project);
      return { text: asText({ project: found.id, name, ...findSymbols(found.repoPath, name) }) };
    },
  },
];
