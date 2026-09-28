#!/usr/bin/env node
/**
 * `otter-pm-mcp` — the MCP server, spoken to over stdio.
 *
 * stdout belongs to the protocol: the client parses it as newline-delimited JSON-RPC, so a single log line written
 * there would corrupt the stream. Every diagnostic therefore goes to stderr, where a client may forward it or
 * ignore it.
 */
import { serve } from '../src/mcp/server.mjs';

serve().catch((error) => {
  process.stderr.write(`otter-pm-mcp: ${error.message}\n`);
  process.exit(1);
});
