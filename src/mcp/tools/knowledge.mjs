import * as z from 'zod';

import { embed } from '../../server/embed.mjs';
import { relatedProject, searchProject, syncProject } from '../../server/index.mjs';
import { asText, projectOrThrow, resolveProjects } from '../context.mjs';

/**
 * The fuzzy half, read from the project's own database.
 *
 * Both tools report the stamp they were served from, and both keep `isError` false when the index simply cannot be
 * built: an agent has not made a mistake, and retrying the same call will not help. What it needs is to be told to
 * use the exact tools instead, which is what the unavailable wording says.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const clampLimit = (limit) => Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));

const UNAVAILABLE = (reason) =>
  [
    'The index is unavailable, so this answer cannot come from it.',
    `Reason: ${reason}`,
    'Every exact tool still reads the files: search_code, read_code, find_symbols, list_tasks and read_doc.',
  ].join('\n');

export const KNOWLEDGE_TOOLS = [
  {
    name: 'search_knowledge',
    description: "Search a project's tasks, documents and code by meaning, from its own index",
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      query: z.string().describe('what to look for'),
      limit: z.number().int().positive().optional().describe('most rows to return, up to 50'),
    },
    handler: async ({ project, query, limit }) => {
      const found = projectOrThrow(resolveProjects(), project);
      const wanted = clampLimit(limit);

      const [vector] = await embed([query]);
      const answer = await searchProject({ project: found, vector, limit: wanted });
      if (!answer.ok) return { text: UNAVAILABLE(answer.reason) };

      return { text: asText({ project: found.id, query, limit: wanted, ...answer }) };
    },
  },
  {
    name: 'find_related',
    description: 'Find what is related to a path, from the project index — the file linking',
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      path: z.string().describe('the path to find neighbours for'),
      limit: z.number().int().positive().optional().describe('most rows to return, up to 50'),
    },
    handler: async ({ project, path: asked, limit }) => {
      const found = projectOrThrow(resolveProjects(), project);
      const wanted = clampLimit(limit);

      const answer = await relatedProject({ project: found, relPath: asked, limit: wanted });
      if (!answer.ok) {
        if (answer.reason.startsWith('not in the index')) throw new Error(answer.reason);
        return { text: UNAVAILABLE(answer.reason) };
      }

      return { text: asText({ project: found.id, limit: wanted, ...answer }) };
    },
  },
];

