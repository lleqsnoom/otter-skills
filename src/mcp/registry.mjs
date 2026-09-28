import * as z from 'zod';

import { CODE_TOOLS } from './code.mjs';
import { KNOWLEDGE_TOOLS } from './knowledge.mjs';
import { PROJECT_TOOLS } from './projects.mjs';
import { WORK_TOOLS } from './work.mjs';

/**
 * The tools the server advertises, in the order a reader meets them.
 *
 * A definition is `{ name, description, inputSchema, handler }`: `inputSchema` is a raw Zod shape and the handler
 * returns `{ text }`. Nothing here knows MCP's wire format — `server.mjs` owns that — so a handler stays a plain
 * function over the repository. `project` is a configured root's id, the same id the board uses.
 */
export const TOOLS = [
  ...PROJECT_TOOLS,
  ...WORK_TOOLS,
  ...CODE_TOOLS,
  ...KNOWLEDGE_TOOLS,
];
