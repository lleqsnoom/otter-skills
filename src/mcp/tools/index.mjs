import * as z from 'zod';

import { PROJECT_TOOLS } from './projects.mjs';
import { stub } from './stub.mjs';

/**
 * The tools the server advertises, in the order a reader meets them.
 *
 * A definition is `{ name, description, inputSchema, handler }`: `inputSchema` is a raw Zod shape and the handler
 * returns `{ text }`. Nothing here knows MCP's wire format — `server.mjs` owns that — so a handler stays a plain
 * function over the repository. `project` is a configured root's id, the same id the board uses.
 *
 * A tool whose reader has not landed yet is `stub(name)`, which echoes the call: the surface stays complete and
 * testable while the readers arrive one family at a time.
 */
export const TOOLS = [
  ...PROJECT_TOOLS,
  {
    name: 'list_epics',
    description: "List a project's plans and epics with the tasks under each",
    inputSchema: { project: z.string().optional().describe('the project id') },
    handler: stub('list_epics'),
  },
  {
    name: 'list_tasks',
    description: "List a project's tasks with their state, epic, lane and archived flag",
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      state: z.enum(['todo', 'active', 'done']).optional().describe('keep only tasks in this state'),
      epic: z.string().optional().describe('keep only tasks belonging to this epic'),
    },
    handler: stub('list_tasks'),
  },
  {
    name: 'get_task',
    description: 'Read one task in full, with its parsed fields, lane and archived flag',
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      path: z.string().describe('the task path, relative to the .x-skills root'),
    },
    handler: stub('get_task'),
  },
  {
    name: 'list_docs',
    description: "List a project's README and its other documents",
    inputSchema: { project: z.string().optional().describe('the project id') },
    handler: stub('list_docs'),
  },
  {
    name: 'read_doc',
    description: 'Read one document, always with its drift report against the code',
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      path: z.string().describe('the document path, relative to the repository'),
    },
    handler: stub('read_doc'),
  },
  {
    name: 'search_code',
    description: 'Search tracked source for a literal or regular expression, exactly as the files hold it',
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      query: z.string().describe('what to look for'),
      regex: z.boolean().optional().describe('treat the query as a regular expression'),
    },
    handler: stub('search_code'),
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
    handler: stub('read_code'),
  },
  {
    name: 'find_symbols',
    description: 'Find where a name is declared, by declaration shape — a heuristic, and it says so',
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      name: z.string().describe('the name to look for'),
    },
    handler: stub('find_symbols'),
  },
  {
    name: 'search_knowledge',
    description: "Search a project's tasks, documents and code by meaning, from its own index",
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      query: z.string().describe('what to look for'),
      limit: z.number().int().positive().optional().describe('most rows to return'),
    },
    handler: stub('search_knowledge'),
  },
  {
    name: 'find_related',
    description: 'Find what is related to a path, from the project index — the file linking',
    inputSchema: {
      project: z.string().optional().describe('the project id'),
      path: z.string().describe('the path to find neighbours for'),
      limit: z.number().int().positive().optional().describe('most rows to return'),
    },
    handler: stub('find_related'),
  },
];
