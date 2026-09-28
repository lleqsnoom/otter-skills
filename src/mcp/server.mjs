import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { TOOLS } from './tools/index.mjs';

/**
 * The MCP server, assembled from the tool registry.
 *
 * Only this module knows the protocol's shapes: a handler returns `{ text }` and this turns it into a tool result, and
 * a handler that throws becomes an error result carrying the message. A tool that refuses — an unknown project, a path
 * outside the repository — is therefore readable to the agent rather than a connection error it cannot see.
 */
export const SERVER_NAME = 'otter-pm';
export const SERVER_VERSION = '0.1.0';

export function createServer() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of TOOLS) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args) => {
      try {
        const { text } = await tool.handler(args ?? {});
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `${tool.name} failed: ${error.message}` }] };
      }
    });
  }

  return server;
}

/** Connect over stdio, which is the transport a client starts this process for. */
export async function serve() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  return server;
}
