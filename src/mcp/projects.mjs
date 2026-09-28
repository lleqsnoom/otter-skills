import * as z from 'zod';

import { indexState } from '../server/index.mjs';
import { asText, boardOf, projectOrThrow, resolveProjects } from './context.mjs';

/**
 * The two tools that answer what this machine reads: every project, and one project.
 *
 * Both carry the resolver's own account of itself — what it rejected, what it skipped, whether the IDE list was
 * on — because "the repository I expected is missing" is the question an agent cannot answer from a bare list.
 */
const summarise = (project) => ({
  id: project.id,
  name: project.name,
  repoPath: project.repoPath,
  root: project.root,
  about: project.about ?? null,
  totals: project.totals,
});

export const PROJECT_TOOLS = [
  {
    name: 'list_projects',
    description: "List every repository this machine reads, with each project's id and paths",
    inputSchema: {},
    handler: async () => {
      const context = resolveProjects();
      return {
        text: asText({
          projects: context.projects.map(summarise),
          rejected: context.rejected,
          skipped: context.skipped,
          failures: context.failures,
          orca: context.orca,
        }),
      };
    },
  },
  {
    name: 'get_project',
    description: "Get one project's identity, paths and board file",
    inputSchema: { project: z.string().describe('the project id') },
    handler: async ({ project }) => {
      const context = resolveProjects();
      const found = projectOrThrow(context, project);
      const board = boardOf(found);

      // Read, never built: asking about a project must not start an index build the caller did not ask for.
      const index = await indexState(found);
      return { text: asText({ ...summarise(found), boardFile: board.file, index }) };
    },
  },
];
