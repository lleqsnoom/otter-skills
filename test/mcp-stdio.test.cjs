'use strict';

/**
 * The MCP server is a second way into the same repository the board reads, and its whole surface is a protocol:
 * an agent that cannot list the tools cannot call them. So what is asserted here is the wire, not the readers —
 * the bin starts, `initialize` and `tools/list` answer, exactly the twelve contracted tools are advertised, and
 * stdout carries nothing that is not a protocol message. A stray `console.log` anywhere in the server would break
 * the last one, which is why it is checked rather than assumed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'scripts', 'mcp.mjs');

const PROTOCOL_VERSION = '2025-06-18';

const TOOL_NAMES = [
  'find_related',
  'find_symbols',
  'get_project',
  'get_task',
  'list_docs',
  'list_epics',
  'list_projects',
  'list_tasks',
  'read_code',
  'read_doc',
  'search_code',
  'search_knowledge',
];

/**
 * The bin, spoken to the way an agent speaks to it: newline-delimited JSON-RPC in, one JSON-RPC message per line
 * out. `lines` keeps every raw line so a test can assert nothing else was written to stdout.
 *
 * Every request takes its id from `nextId`, so no two share one: a helper that matched on id alone would resolve a
 * later request with an earlier answer and hide the bug it was meant to catch.
 */
function start() {
  const child = spawn(process.execPath, [BIN], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  const waiters = [];
  let buffer = '';
  let stderr = '';
  let lastId = 0;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        lines.push(line);
        waiters.splice(0).forEach((waiter) => waiter(line));
      }
      index = buffer.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const nextId = () => (lastId += 1);
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const write = (raw) => child.stdin.write(raw);

  /** Whatever the server wrote that this predicate accepts, whether it arrived already or later. */
  const nextMatching = (predicate, describes) =>
    new Promise((resolvePromise, rejectPromise) => {
      const found = lines.map((line) => JSON.parse(line)).find(predicate);
      if (found) {
        resolvePromise(found);
        return;
      }
      const timer = setTimeout(() => rejectPromise(new Error(`no ${describes}; stderr: ${stderr}`)), 15000);
      waiters.push((line) => {
        const message = JSON.parse(line);
        if (!predicate(message)) return;
        clearTimeout(timer);
        resolvePromise(message);
      });
    });

  const request = async (method, params) => {
    const id = nextId();
    send({ jsonrpc: '2.0', id, method, params: params ?? {} });
    return nextMatching((message) => message.id === id, `answer to ${method}`);
  };

  const initialize = async () => {
    const answered = await request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'otter-skills-test', version: '1' },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return answered;
  };

  return {
    send,
    write,
    request,
    nextMatching,
    initialize,
    lines,
    stderr: () => stderr,
    stop: () => child.kill('SIGTERM'),
  };
}

test('the bin starts and answers initialize with its own name', async () => {
  const server = start();
  try {
    const initialized = await server.initialize();

    assert.equal(initialized.error, undefined, `initialize errored: ${JSON.stringify(initialized.error)}`);
    assert.equal(initialized.result.serverInfo.name, 'otter-skills');
    assert.equal(typeof initialized.result.protocolVersion, 'string');
  } finally {
    server.stop();
  }
});

test('tools/list advertises exactly the twelve contracted tools', async () => {
  const server = start();
  try {
    await server.initialize();
    const listed = await server.request('tools/list');

    assert.equal(listed.error, undefined, `tools/list errored: ${JSON.stringify(listed.error)}`);
    const names = listed.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, TOOL_NAMES);
    for (const tool of listed.result.tools) {
      assert.equal(typeof tool.description, 'string', `${tool.name} has a description`);
      assert.ok(tool.description.length > 0, `${tool.name}'s description says something`);
    }
  } finally {
    server.stop();
  }
});

test('stdout carries protocol messages and nothing else', async () => {
  const server = start();
  try {
    await server.initialize();
    await server.request('tools/list');

    for (const line of server.lines) {
      const message = JSON.parse(line);
      assert.equal(message.jsonrpc, '2.0', `not a JSON-RPC line: ${line}`);
    }
  } finally {
    server.stop();
  }
});

test('a line that is not JSON is discarded, and the server keeps serving', async () => {
  const server = start();
  try {
    await server.initialize();
    await server.request('tools/list');

    const before = server.lines.length;
    server.write('this is not json\n');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));

    assert.equal(server.lines.length, before, 'a malformed line produced no reply, so stdout stayed protocol-only');

    const listed = await server.request('tools/list');
    assert.equal(listed.result.tools.length, TOOL_NAMES.length, 'the server served the next request');
  } finally {
    server.stop();
  }
});

test('a request before initialize leaves the server serving', async () => {
  const server = start();
  try {
    await server.request('tools/list');

    const initialized = await server.initialize();
    assert.equal(initialized.result.serverInfo.name, 'otter-skills', 'the connection still initializes');
  } finally {
    server.stop();
  }
});
