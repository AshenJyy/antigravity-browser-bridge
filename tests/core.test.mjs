import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startBridge } from '../core/service.mjs';
import { BridgeClient, readToken, getSettings } from '../core/client.mjs';

const workRoot = resolve('work');
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

async function fixture(t, options = {}) {
  await mkdir(workRoot, { recursive: true });
  const dataDir = await mkdtemp(join(workRoot, 'core-test-'));
  const bridge = await startBridge({ dataDir, port: 0, commandTimeoutMs: 2000, ...options });
  const token = await readToken(bridge.settings);
  const clients = new Set();
  t.after(async () => {
    for (const socket of clients) socket.terminate();
    await bridge.close();
    assert.ok(dataDir.startsWith(workRoot + sep));
    await rm(dataDir, { recursive: true, force: true });
  });
  async function peer({ instanceId = randomUUID(), handler, origin, credential = token, autoCancel = true } = {}) {
    const socket = new WebSocket(`ws://127.0.0.1:${bridge.settings.port}/extension`, origin ? { origin } : {});
    clients.add(socket);
    await once(socket, 'open');
    const messages = [];
    let nextTab = 10;
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      messages.push(message);
      if (message.type === 'cancel' && autoCancel) socket.send(JSON.stringify({ type: 'result', id: message.id, ok: false, error: { code: 'CANCELLED', message: 'Cancelled by test extension' } }));
      if (message.type !== 'command') return;
      const sendResult = result => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result }));
      if (handler?.(message, sendResult, socket) === true) return;
      if (message.action === 'tabs') sendResult([{ id: 7, title: 'Fixture tab', url: 'https://example.com/', active: true, windowId: 1, groupId: -1 }]);
      else if (message.action === 'open') sendResult({ id: nextTab++, title: 'Created', url: message.args.url });
      else if (message.action === 'claim') sendResult({ id: message.tabId, title: 'Claimed', url: 'https://example.com/' });
      else sendResult({ action: message.action, tabId: message.tabId, text: 'Fixture result' });
    });
    const first = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'hello', protocol: 2, token: credential, instanceId, browser: 'Microsoft Edge', version: '2.0.0' }));
    if (credential !== token) { await once(socket, 'close'); return { socket, instanceId, messages }; }
    const [welcome] = await first;
    assert.equal(JSON.parse(welcome.toString()).type, 'welcome');
    assert.equal(JSON.parse(welcome.toString()).daemonId, bridge.daemonId);
    return { socket, instanceId, messages, tab: `${instanceId}:7` };
  }
  return { bridge, token, peer, client: (client = 'cli', sessionId = randomUUID()) => new BridgeClient({ client, sessionId, settings: bridge.settings, autoStart: false }) };
}

test('HTTP boundary authenticates control, rejects browser origins and hostile Host, keeps health minimal', async t => {
  const { bridge, token } = await fixture(t);
  const health = await fetch(`${bridge.settings.baseUrl}/health`);
  assert.deepEqual(Object.keys(await health.json()).sort(), ['ok', 'protocol', 'version']);
  assert.equal((await fetch(`${bridge.settings.baseUrl}/v1/status`)).status, 401);
  assert.equal((await fetch(`${bridge.settings.baseUrl}/v1/status`, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(`${bridge.settings.baseUrl}/health`, { headers: { Host: 'evil.example' } })).status, 403);
  const authenticated = await fetch(`${bridge.settings.baseUrl}/v1/status`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await authenticated.text();
  assert.equal(authenticated.status, 200);
  assert.equal(body.includes(token), false);
});

test('WS rejects a wrong credential and browser-page origin', async t => {
  const { bridge } = await fixture(t);
  const wrong = new WebSocket(`ws://127.0.0.1:${bridge.settings.port}/extension`);
  await once(wrong, 'open');
  const closed = once(wrong, 'close');
  wrong.send(JSON.stringify({ type: 'hello', protocol: 2, token: '0'.repeat(64), instanceId: randomUUID(), browser: 'Microsoft Edge', version: '2.0.0' }));
  assert.equal((await closed)[0], 1008);
  const forbidden = new WebSocket(`ws://127.0.0.1:${bridge.settings.port}/extension`, { origin: 'https://example.com' });
  await assert.rejects(once(forbidden, 'open'), /403/);
  assert.equal(bridge.status().browsers.length, 0);
});

test('two Edge profiles retain distinct handles even when numeric tab IDs coincide', async t => {
  const { peer, client } = await fixture(t);
  const first = await peer(), second = await peer();
  const agent = client('dsh');
  const tabs = await agent.call('tabs');
  assert.equal(tabs.length, 2);
  assert.notEqual(tabs[0].tab, tabs[1].tab);
  assert.equal(tabs[0].id, tabs[1].id);
  await assert.rejects(agent.call('open', { url: 'https://example.com' }), error => error.code === 'BROWSER_AMBIGUOUS');
  const opened = await agent.call('open', { instanceId: second.instanceId, url: 'https://example.com' });
  assert.equal(opened.instanceId, second.instanceId);
  assert.equal(opened.owned, true);
  assert.equal(first.messages.some(message => message.action === 'open'), false);
});

test('claim and ownership are enforced across concurrent sessions; missing tab never selects active tab', async t => {
  const { peer, client } = await fixture(t);
  const browser = await peer();
  const one = client('dsh'), two = client('antigravity');
  await assert.rejects(one.call('click', {}), error => error.code === 'TAB_REQUIRED');
  await assert.rejects(one.call('content', { tab: browser.tab }), error => error.code === 'TAB_NOT_OWNED');
  const claims = await Promise.allSettled([one.call('claim', { tab: browser.tab }), two.call('claim', { tab: browser.tab })]);
  assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(claims.find(result => result.status === 'rejected').reason.code, 'TAB_OWNED');
  const winner = claims[0].status === 'fulfilled' ? one : two;
  const loser = winner === one ? two : one;
  await assert.rejects(loser.call('content', { tab: browser.tab }), error => error.code === 'TAB_NOT_OWNED');
  await winner.call('release', { tab: browser.tab });
  assert.equal((await loser.call('claim', { tab: browser.tab })).owned, true);
});

test('tab close and user detach revoke ownership; release/session close never close pages', async t => {
  const { peer, client } = await fixture(t);
  const browser = await peer();
  const agent = client('dsh');
  await agent.call('claim', { tab: browser.tab });
  browser.socket.send(JSON.stringify({ type: 'event', event: 'detached', tabId: 7, reason: 'canceled_by_user' }));
  await delay(15);
  await assert.rejects(agent.call('content', { tab: browser.tab }), error => error.code === 'TAB_NOT_OWNED');
  await agent.call('claim', { tab: browser.tab });
  const result = await agent.close();
  assert.deepEqual(result.released, [browser.tab]);
  assert.equal(browser.messages.some(message => message.action === 'close'), false);
  assert.equal(browser.messages.filter(message => message.action === 'release').length, 1);
});

test('a reply from another browser cannot resolve an in-flight command', async t => {
  const { peer, client } = await fixture(t);
  let held;
  const first = await peer({ handler(message, send) { if (message.action === 'content') { held = { message, send }; return true; } } });
  const second = await peer();
  const agent = client('dsh');
  await agent.call('claim', { tab: first.tab });
  let settled = false;
  const request = agent.call('content', { tab: first.tab }).finally(() => { settled = true; });
  while (!held) await delay(5);
  second.socket.send(JSON.stringify({ type: 'result', id: held.message.id, ok: true, result: { spoofed: true } }));
  await delay(20);
  assert.equal(settled, false);
  held.send({ text: 'Correct tab' });
  assert.deepEqual(await request, { text: 'Correct tab' });
});

test('replacing one instance fails its old commands and preserves other instances', async t => {
  const { bridge, peer, client } = await fixture(t);
  let commandSeen = false;
  const first = await peer({ handler(message) { if (message.action === 'content') { commandSeen = true; return true; } } });
  const other = await peer();
  const agent = client('dsh');
  await agent.call('claim', { tab: first.tab });
  const rejected = assert.rejects(agent.call('content', { tab: first.tab }), error => error.code === 'BROWSER_DISCONNECTED');
  while (!commandSeen) await delay(5);
  await peer({ instanceId: first.instanceId });
  await rejected;
  assert.equal(bridge.status().browsers.length, 2);
  assert.equal(bridge.status().browsers.some(browser => browser.instanceId === other.instanceId), true);
  assert.equal((await agent.call('content', { tab: first.tab })).action, 'content');
});

test('timeout cancels without replay and holds the tab queue until cancellation is acknowledged', async t => {
  const { peer, client } = await fixture(t, { commandTimeoutMs: 80, cancelGraceMs: 1000 });
  let blockedId;
  const browser = await peer({ autoCancel: false, handler(message) { if (message.action === 'click') { blockedId = message.id; return true; } } });
  const agent = client('dsh');
  await agent.call('claim', { tab: browser.tab });
  const click = assert.rejects(agent.call('click', { tab: browser.tab, x: 5, y: 5 }), error => error.code === 'COMMAND_TIMEOUT' && error.details.outcomeUnknown);
  while (!blockedId) await delay(5);
  const next = agent.call('content', { tab: browser.tab });
  await delay(110);
  assert.equal(browser.messages.some(message => message.action === 'content'), false);
  assert.equal(browser.messages.filter(message => message.action === 'click').length, 1);
  assert.equal(browser.messages.some(message => message.type === 'cancel' && message.id === blockedId), true);
  browser.socket.send(JSON.stringify({ type: 'result', id: blockedId, ok: false, error: { code: 'CANCELLED', message: 'Cancelled' } }));
  await click;
  assert.equal((await next).action, 'content');
});

test('HTTP cancellation cancels the extension command and prevents queued action interleaving', async t => {
  const { peer, client } = await fixture(t);
  const browser = await peer({ handler(message) { if (message.action === 'wait') return true; } });
  const agent = client('antigravity');
  await agent.call('claim', { tab: browser.tab });
  const controller = new AbortController();
  const rejected = assert.rejects(agent.call('wait', { tab: browser.tab, selector: '#future' }, { signal: controller.signal }), error => error.code === 'CANCELLED');
  while (!browser.messages.some(message => message.action === 'wait')) await delay(5);
  controller.abort();
  await rejected;
  const result = await agent.call('content', { tab: browser.tab });
  assert.equal(result.action, 'content');
  assert.equal(browser.messages.some(message => message.type === 'cancel'), true);
});

test('upload requires actual absolute files; downloads reject traversal and dangerous URL schemes', async t => {
  const { bridge, peer, client } = await fixture(t);
  const browser = await peer();
  const agent = client('dsh');
  await agent.call('claim', { tab: browser.tab });
  await assert.rejects(agent.call('upload', { tab: browser.tab, selector: 'input', files: ['relative.txt'] }), error => error.code === 'INVALID_FILES');
  await assert.rejects(agent.call('upload', { tab: browser.tab, selector: 'input', files: [join(bridge.settings.dataDir, 'missing.txt')] }), error => error.code === 'FILE_NOT_FOUND');
  const path = join(bridge.settings.dataDir, 'sample.txt');
  await writeFile(path, 'hello');
  assert.equal((await agent.call('upload', { tab: browser.tab, selector: 'input', files: [path] })).action, 'upload');
  await assert.rejects(agent.call('download', { tab: browser.tab, url: 'https://example.com/a', filename: '../escape.txt' }), error => error.code === 'INVALID_FILENAME');
  await assert.rejects(agent.call('open', { url: 'javascript:alert(1)' }), error => error.code === 'URL_SCHEME_NOT_ALLOWED');
});

test('token initialization is race-safe and stable across readers', async t => {
  await mkdir(workRoot, { recursive: true });
  const dataDir = await mkdtemp(join(workRoot, 'core-token-'));
  t.after(async () => { assert.ok(dataDir.startsWith(workRoot + sep)); await rm(dataDir, { recursive: true, force: true }); });
  const settings = getSettings({ dataDir, port: 9999 });
  const tokens = await Promise.all(Array.from({ length: 25 }, () => readToken(settings)));
  assert.equal(new Set(tokens).size, 1);
  assert.match(tokens[0], /^[a-f0-9]{64}$/);
  assert.equal((await readFile(settings.tokenPath, 'utf8')).trim(), tokens[0]);
});
