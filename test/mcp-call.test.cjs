'use strict';

/**
 * `tools/list` proves the tools exist; this proves they are reachable. Two things are asserted, because they fail
 * for different reasons: the wire — a call reaches its handler, the answer carries the request's id, and an unknown
 * name does not end the process — and the wrapper — a handler that throws comes back as a readable error result
 * instead of a dropped connection the agent cannot see a reason in.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'scripts', 'mcp.mjs');

const serverModule = () => import(pathToFileURL(path.join(ROOT, 'src', 'mcp', 'server.mjs')).href);

/** The same stdio client the stdio suite uses: newline-delimited JSON-RPC with a fresh id per request. */
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
    const id = (lastId += 1);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`);
    return nextMatching((message) => message.id === id, `answer to ${method}`);
  };

  return {
    request,
    initialize: async () => {
      const answered = await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'otter-skills-test', version: '1' },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      return answered;
    },
    stop: () => child.kill('SIGTERM'),
  };
}

const textOf = (answered) => answered.result.content.map((block) => block.text).join('\n');

test('a tool call reaches its handler and comes back with the request id', async () => {
  const server = start();
  try {
    await server.initialize();
    const answered = await server.request('tools/call', {
      name: 'read_code',
      arguments: { project: 'demo', path: 'src/thing.mjs' },
    });

    assert.equal(answered.error, undefined, `errored: ${JSON.stringify(answered.error)}`);
    assert.equal(answered.result.content[0].type, 'text');
    assert.match(textOf(answered), /read_code/);
    assert.match(textOf(answered), /demo/);
  } finally {
    server.stop();
  }
});

test('a name that is not a tool is an error, and the server keeps serving', async () => {
  const server = start();
  try {
    await server.initialize();
    const refused = await server.request('tools/call', { name: 'not_a_tool', arguments: {} });

    assert.equal(refused.result.isError, true, 'an unknown tool is an error result');
    assert.match(textOf(refused), /not_a_tool/, 'and the message names it');

    const listed = await server.request('tools/list');
    assert.equal(listed.result.tools.length, 12, 'the connection still answers');
  } finally {
    server.stop();
  }
});

test('arguments that do not match the declared shape come back as an error result', async () => {
  const server = start();
  try {
    await server.initialize();
    const refused = await server.request('tools/call', {
      name: 'read_code',
      arguments: { project: 'demo', path: 42 },
    });

    assert.equal(refused.error, undefined, 'a schema violation is a tool result, not a protocol error');
    assert.equal(refused.result.isError, true);
    assert.match(textOf(refused), /path|string/i);
  } finally {
    server.stop();
  }
});

test('a handler that throws becomes an error result carrying its message', async () => {
  const { callTool } = await serverModule();
  const tool = {
    name: 'explode',
    handler: async () => {
      throw new Error('the repository is not a git checkout');
    },
  };

  const answered = await callTool(tool, {});

  assert.equal(answered.isError, true);
  assert.match(answered.content[0].text, /explode failed/);
  assert.match(answered.content[0].text, /not a git checkout/);
});

test('a handler that answers becomes text content and nothing else', async () => {
  const { callTool } = await serverModule();
  const tool = { name: 'answer', handler: async (args) => ({ text: `got ${args.what}` }) };

  const answered = await callTool(tool, { what: 'a question' });

  assert.equal(answered.isError, undefined);
  assert.deepEqual(answered.content, [{ type: 'text', text: 'got a question' }]);
});
