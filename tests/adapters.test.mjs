import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { tools, callTool } from '../core/tools.mjs';
import { DshSessions } from '../adapters/dsh-sessions.mjs';
import { registerBrowserTools } from '../adapters/dsh.mjs';
import { createBrowserServer } from '../adapters/mcp.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRfcAAAAASUVORK5CYII=';
const agent = id => ({ id, session: { id, requestHeader: () => ({ config: { provider: 'test', model: 'vision' } }) }, options: {} });

test('shared contract rejects cross-session input and ambiguous/stale references without replay', async () => {
  let calls = 0;
  const bridge = { call: async () => { calls++; const error = new Error('Snapshot expired'); error.code = 'STALE_REF'; throw error; } };
  for (const args of [{ tab: 'x:1', sessionId: 'victim', ref: 'r1' }, { tab: 'x:1', ref: 'r1', selector: 'button' }, { tab: 'x:1', x: 1 }]) {
    const result = await callTool(bridge, 'browser_click', args);
    assert.equal(result.isError, true);
  }
  assert.equal(calls, 0);
  const stale = await callTool(bridge, 'browser_click', { tab: 'x:1', ref: 'old' });
  assert.equal(JSON.parse(stale.content[0].text).code, 'STALE_REF');
  assert.equal(calls, 1, 'a failed mutation is never automatically replayed');
});

test('DSH callers have distinct opaque capabilities and disposal cancels/drains only the right agent', async () => {
  const clients = [];
  const sessions = new DshSessions(options => { const value = { ...options, closed: 0, close: async () => { value.closed++; } }; clients.push(value); return value; });
  const a = agent('a'), b = agent('b');
  const first = await sessions.run({ agent: a }, async client => client.sessionId);
  const again = await sessions.run({ agent: a }, async client => client.sessionId);
  const second = await sessions.run({ agent: b }, async client => client.sessionId);
  assert.equal(first, again); assert.notEqual(first, second); assert.notEqual(first, 'a');
  await assert.rejects(sessions.run({}, async () => {}), /real DSH/);
  await assert.rejects(sessions.run({ agent: agent('a') }, async () => {}), /another agent lifecycle/);
  let start;
  const started = new Promise(resolve => { start = resolve; });
  const running = sessions.run({ agent: a }, (_client, { signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve('cancelled'), { once: true }); start();
  }));
  await started;
  await sessions.releaseAgent(a);
  assert.equal(await running, 'cancelled');
  assert.equal(clients[0].closed, 1); assert.equal(clients[1].closed, 0);
  await sessions.close(); assert.equal(clients[1].closed, 1);
  await assert.rejects(sessions.run({ agent: b }, async () => {}), /disposed/);
});

test('DSH rc.3 adapter projects actual image attachments and retains the host model capability gate', async () => {
  const definitions = new Map();
  let supportsImages = true, saved = 0;
  const imageRef = { id: 'test-image', mediaType: 'image/png', size: Buffer.from(png, 'base64').length };
  const ctx = {
    tools: { register: definition => definitions.set(definition.name, definition) },
    get: key => key === 'attachments' ? { saveImages: async images => { assert.equal(images[0].data.toString('base64'), png); saved++; return [imageRef]; } }
      : key === 'llm' ? { resolveModelInfo: async () => ({ inputModalities: supportsImages ? ['text', 'image'] : ['text'] }) } : undefined,
  };
  const sessions = new DshSessions(() => ({ call: async () => ({ mimeType: 'image/png', data: png }), close: async () => {} }));
  registerBrowserTools(ctx, sessions);
  assert.equal(definitions.size, tools.length);
  const definition = definitions.get('browser_screenshot');
  const args = { tab: 'test:1' };
  const caller = agent('vision');
  const execution = { agent: caller, signal: new AbortController().signal };
  const value = await definition.execute(args, execution);
  const content = definition.output.render(args, value);
  const projected = definition.projectContent(execution, { value, content, isError: false });
  assert.equal(projected[1].type, 'image'); assert.deepEqual(projected[1].attachment, imageRef); assert.equal(saved, 1);
  assert.equal(definition.projectContent(execution, { value, content, isError: false }), undefined, 'prepared images project once');
  supportsImages = false;
  const refusedExecution = { agent: caller, signal: new AbortController().signal };
  const refusedValue = await definition.execute(args, refusedExecution);
  const refused = definition.projectContent(refusedExecution, { value: refusedValue, content: definition.output.render(args, refusedValue), isError: false });
  assert.ok(refused.every(item => item.type === 'text'));
  assert.match(refused.map(item => item.text).join(''), /does not declare image input/);
  assert.equal(saved, 1);
  await sessions.close();
});

test('Antigravity MCP negotiates, discovers the shared tools and transports screenshot images and errors', async () => {
  let closed = 0;
  const bridge = { call: async (action, _args, { signal }) => {
    assert.equal(signal.aborted, false);
    return action === 'screenshot' ? { mimeType: 'image/png', data: png } : [{ tab: 'test:9', owned: false }];
  }, close: async () => { closed++; } };
  const runtime = createBrowserServer(bridge);
  const client = new Client({ name: 'test-antigravity', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([runtime.server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, tools.length);
  assert.ok(listed.tools.every(item => !('action' in item) && !('sessionId' in item.inputSchema.properties)));
  const image = await client.callTool({ name: 'browser_screenshot', arguments: { tab: 'test:9' } });
  assert.deepEqual(image.content[1], { type: 'image', mimeType: 'image/png', data: png });
  const invalid = await client.callTool({ name: 'browser_click', arguments: { tab: 'test:9' } });
  assert.equal(invalid.isError, true);
  const unknown = await client.callTool({ name: 'browser_missing', arguments: {} });
  assert.equal(unknown.isError, true);
  await runtime.close(); await client.close(); assert.equal(closed, 1);
});
