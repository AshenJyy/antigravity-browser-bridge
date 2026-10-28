import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { getSettings, readToken, BridgeError, VERSION, PROTOCOL } from './settings.mjs';

const ACTIONS = new Set(['status', 'tabs', 'open', 'claim', 'release', 'session_close', 'navigate', 'back', 'forward', 'reload', 'close', 'snapshot', 'content', 'screenshot', 'click', 'hover', 'type', 'press', 'scroll', 'select', 'wait', 'upload', 'download', 'downloads', 'dialog', 'evaluate']);
const CLIENTS = new Set(['dsh', 'antigravity', 'cli']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const errorObject = error => error instanceof BridgeError ? error.toJSON() : { code: 'INTERNAL_ERROR', message: error?.message || 'Unexpected bridge error.' };
const fail = (code, message, details) => { throw new BridgeError(code, message, details); };

function equalToken(actual, expected) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
function checkAbort(signal) { if (signal?.aborted) fail('CANCELLED', 'Browser operation was cancelled.'); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function checkUrl(value, download = false) {
  let url;
  try { url = new URL(value); } catch { fail('INVALID_URL', 'Provide an absolute URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) && !(value === 'about:blank' && !download)) fail('URL_SCHEME_NOT_ALLOWED', 'Only http(s) URLs and about:blank are supported.');
  if (url.username || url.password) fail('INVALID_URL', 'URLs containing credentials are not supported.');
}

/** Start a standalone bridge. Explicit overrides permit isolated integration tests. */
export async function startBridge(options = {}) {
  const settings = getSettings(options.settings || options);
  const token = await readToken(settings);
  const daemonId = randomUUID();
  const browsers = new Map();
  const sessions = new Map();
  const owners = new Map();
  const revocations = new Map();
  const pending = new Map();
  const queues = new Map();
  const commandTimeoutMs = options.commandTimeoutMs ?? 45000;
  const cancelGraceMs = options.cancelGraceMs ?? 5000;
  let closing = false;

  function enqueue(key, task) {
    const previous = queues.get(key) || Promise.resolve();
    const result = previous.catch(() => {}).then(task);
    queues.set(key, result);
    result.finally(() => { if (queues.get(key) === result) queues.delete(key); }).catch(() => {});
    return result;
  }
  function status() {
    return {
      protocol: PROTOCOL, version: VERSION, daemonId, port: settings.port, connected: browsers.size > 0,
      browsers: [...browsers.values()].map(browser => ({ instanceId: browser.instanceId, browser: browser.browser, version: browser.version, connectedAt: browser.connectedAt })),
      sessions: [...sessions.values()].map(session => ({ sessionId: session.id, client: session.client, label: session.label, tabs: [...owners].filter(([, owner]) => owner === session.id).map(([tab]) => tab) })),
    };
  }
  function sessionFor(body) {
    if (typeof body.sessionId !== 'string' || !/^[A-Za-z0-9_.:-]{3,160}$/.test(body.sessionId)) fail('INVALID_SESSION', 'Provide an opaque sessionId of 3 to 160 letters, digits, or . _ : - characters.');
    if (!CLIENTS.has(body.client)) fail('INVALID_CLIENT', 'client must be dsh, antigravity, or cli.');
    let session = sessions.get(body.sessionId);
    if (session && session.client !== body.client) fail('SESSION_CONFLICT', 'This sessionId is already associated with another client.');
    if (!session) {
      if (sessions.size >= 2048) fail('SESSION_LIMIT', 'Close an unused bridge session before creating another one.');
      session = { id: body.sessionId, client: body.client, label: body.sessionId.slice(0, 12) };
      sessions.set(session.id, session);
    }
    return session;
  }
  function parseTab(value) {
    if (typeof value !== 'string') fail('TAB_REQUIRED', 'Use an explicit tab handle returned by tabs or open.');
    const match = /^(.*):(\d+)$/.exec(value);
    if (!match || !UUID.test(match[1]) || !Number.isSafeInteger(Number(match[2]))) fail('INVALID_TAB', 'Use an unmodified tab handle returned by tabs or open.');
    return { instanceId: match[1], tabId: Number(match[2]), handle: value };
  }
  function browserFor(instanceId) {
    if (instanceId) {
      const browser = browsers.get(instanceId);
      if (!browser) fail('BROWSER_OFFLINE', 'The selected browser instance is offline.');
      return browser;
    }
    if (browsers.size === 0) fail('BROWSER_OFFLINE', 'No browser extension is connected. Pair Browser Bridge in Edge first.');
    if (browsers.size > 1) fail('BROWSER_AMBIGUOUS', 'Several browser instances are connected. Specify instanceId from browser_status or browser_tabs.');
    return browsers.values().next().value;
  }
  function decorate(tab, browser, session) {
    if (!isRecord(tab) || !Number.isSafeInteger(tab.id) || tab.id < 0) fail('INVALID_EXTENSION_RESULT', 'Extension returned an invalid tab.');
    const handle = `${browser.instanceId}:${tab.id}`;
    const ownerId = owners.get(handle);
    const owner = sessions.get(ownerId);
    return { ...tab, tab: handle, instanceId: browser.instanceId, owner: owner ? { sessionId: owner.id, client: owner.client, label: owner.label } : null, owned: ownerId === session?.id };
  }
  function send(socket, value) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
  function finishPending(request, error, result) {
    if (!pending.delete(request.id)) return;
    clearTimeout(request.timer);
    clearTimeout(request.graceTimer);
    request.signal?.removeEventListener('abort', request.cancel);
    if (request.cancelError) request.reject(request.cancelError);
    else if (error) request.reject(error);
    else request.resolve(result);
  }
  function disconnectPending(socket) {
    for (const request of pending.values()) if (request.socket === socket) finishPending(request, new BridgeError('BROWSER_DISCONNECTED', 'Browser disconnected before confirming the action. Inspect state before retrying.', { outcomeUnknown: true }));
  }
  function rpc(browser, action, tabId, args, session, signal) {
    checkAbort(signal);
    if (browser.socket.readyState !== WebSocket.OPEN || browsers.get(browser.instanceId) !== browser) fail('BROWSER_OFFLINE', 'Browser connection changed. Refresh browser_status.');
    const id = randomUUID();
    return new Promise((resolveResult, reject) => {
      const request = { id, socket: browser.socket, resolve: resolveResult, reject, signal, timer: null, graceTimer: null, cancelError: null };
      request.cancel = () => {
        if (!pending.has(id) || request.cancelError) return;
        request.cancelError = new BridgeError('CANCELLED', 'The operation was cancelled. Inspect the tab before retrying a mutation.', { outcomeUnknown: true });
        send(browser.socket, { type: 'cancel', id });
        // Keep the tab queue locked until the extension acknowledges completion.
        request.graceTimer = setTimeout(() => browser.socket.terminate(), cancelGraceMs);
      };
      pending.set(id, request);
      signal?.addEventListener('abort', request.cancel, { once: true });
      request.timer = setTimeout(() => {
        request.cancel();
        request.cancelError = new BridgeError('COMMAND_TIMEOUT', `Browser did not confirm ${action} in time. The command was not replayed; inspect the tab before retrying.`, { outcomeUnknown: true });
      }, commandTimeoutMs);
      try { send(browser.socket, { type: 'command', id, action, ...(tabId === undefined ? {} : { tabId }), args, session: { id: session.id, client: session.client, label: session.label } }); }
      catch (error) { finishPending(request, new BridgeError('BROWSER_DISCONNECTED', error.message, { outcomeUnknown: true })); }
    });
  }

  async function validateArguments(action, args) {
    if (['open', 'navigate', 'download'].includes(action)) checkUrl(args.url, action === 'download');
    if (args.timeoutMs !== undefined && (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 0 || args.timeoutMs > 30000)) fail('INVALID_TIMEOUT', 'timeoutMs must be an integer from 0 to 30000.');
    if (action === 'upload') {
      if (!Array.isArray(args.files) || args.files.length === 0 || args.files.length > 32) fail('INVALID_FILES', 'Upload requires between 1 and 32 absolute file paths.');
      for (const path of args.files) {
        if (typeof path !== 'string' || !isAbsolute(path)) fail('INVALID_FILES', 'Upload paths must be absolute.');
        try { if (!(await stat(path)).isFile()) fail('INVALID_FILES', 'Every upload path must refer to a file.'); }
        catch (error) { if (error instanceof BridgeError) throw error; fail('FILE_NOT_FOUND', 'An upload file does not exist or cannot be read.', { path }); }
      }
    }
    if (action === 'download' && args.filename !== undefined) {
      if (typeof args.filename !== 'string' || !args.filename || args.filename.length > 240 || /^[\\/]/.test(args.filename) || /[<>:"|?*\x00-\x1f]/.test(args.filename) || args.filename.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) fail('INVALID_FILENAME', 'Use a relative download filename without traversal or reserved characters.');
    }
  }

  async function tabAction(session, action, args, signal) {
    const target = parseTab(args.tab);
    return enqueue(`tab:${target.handle}`, async () => {
      checkAbort(signal);
      const owner = owners.get(target.handle);
      if (action === 'claim') {
        if (owner && owner !== session.id) fail('TAB_OWNED', 'This tab belongs to another session. Release it there first.');
      } else if (owner !== session.id) fail('TAB_NOT_OWNED', 'Claim this tab explicitly before operating it.');
      const browser = browserFor(target.instanceId);
      const generation = revocations.get(target.handle) || 0;
      const { tab, ...extensionArgs } = args;
      const result = await rpc(browser, action, target.tabId, extensionArgs, session, signal);
      if (action === 'claim') {
        if ((revocations.get(target.handle) || 0) !== generation) fail('TAB_REVOKED', 'The tab was detached or closed during claim.');
        owners.set(target.handle, session.id);
        return isRecord(result) && Number.isSafeInteger(result.id) ? decorate(result, browser, session) : { ...result, tab: target.handle, owned: true };
      }
      if (action === 'release' || action === 'close') owners.delete(target.handle);
      return result;
    });
  }

  async function execute(body, signal) {
    if (!isRecord(body) || !ACTIONS.has(body.action)) fail('UNKNOWN_ACTION', 'Unknown Browser Bridge action.');
    const args = body.args === undefined ? {} : body.args;
    if (!isRecord(args)) fail('INVALID_ARGUMENTS', 'args must be a JSON object.');
    const session = sessionFor(body);
    return enqueue(`session:${session.id}`, async () => {
      checkAbort(signal);
      if (!sessions.has(session.id)) sessions.set(session.id, session);
      await validateArguments(body.action, args);
      if (body.action === 'status') return status();
      if (body.action === 'tabs') {
        const selected = args.instanceId ? [browserFor(args.instanceId)] : [...browsers.values()];
        const results = [];
        for (const browser of selected) {
          const tabs = await rpc(browser, 'tabs', undefined, {}, session, signal);
          if (!Array.isArray(tabs)) fail('INVALID_EXTENSION_RESULT', 'Extension returned an invalid tab list.');
          for (const tab of tabs) results.push(decorate(tab, browser, session));
        }
        return results;
      }
      if (body.action === 'open') {
        const browser = browserFor(args.instanceId);
        if (typeof args.label === 'string' && args.label.trim()) session.label = args.label.trim().slice(0, 64);
        const { instanceId, ...extensionArgs } = args;
        const result = await rpc(browser, 'open', undefined, extensionArgs, session, signal);
        const tab = decorate(result, browser, session);
        if (owners.has(tab.tab)) fail('TAB_OWNED', 'Extension returned a tab already owned by a session.');
        owners.set(tab.tab, session.id);
        return decorate(result, browser, session);
      }
      if (body.action === 'session_close') {
        const released = [], errors = [];
        for (const [tab, owner] of [...owners]) if (owner === session.id) {
          try { await tabAction(session, 'release', { tab }, signal); released.push(tab); }
          catch (error) { errors.push({ tab, ...errorObject(error) }); }
        }
        // Preserve failed offline ownership, so a reconnect can still be released.
        if (!errors.length) sessions.delete(session.id);
        return { released, errors };
      }
      return tabAction(session, body.action, args, signal);
    });
  }

  function respond(response, code, body) {
    if (response.destroyed || response.writableEnded) return;
    const data = JSON.stringify(body);
    response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(data);
  }
  function validHost(request) { return request.headers.host === `127.0.0.1:${settings.port}`; }
  const server = createServer(async (request, response) => {
    const controller = new AbortController();
    request.on('aborted', () => controller.abort());
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      if (!validHost(request)) { respond(response, 403, { ok: false, error: { code: 'INVALID_HOST', message: 'Use the loopback IP address.' } }); return; }
      if (request.headers.origin !== undefined) { respond(response, 403, { ok: false, error: { code: 'ORIGIN_FORBIDDEN', message: 'Browser-origin HTTP requests are not accepted.' } }); return; }
      if (request.method === 'GET' && request.url === '/health') { respond(response, 200, { ok: true, protocol: PROTOCOL, version: VERSION }); return; }
      if (!equalToken(request.headers.authorization, `Bearer ${token}`)) { respond(response, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Valid local bridge credentials are required.' } }); return; }
      if (request.method === 'GET' && request.url === '/v1/status') { respond(response, 200, { ok: true, result: status() }); return; }
      if (request.method !== 'POST' || request.url !== '/v1/call') { respond(response, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown bridge endpoint.' } }); return; }
      if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) { respond(response, 415, { ok: false, error: { code: 'CONTENT_TYPE_REQUIRED', message: 'Use application/json.' } }); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) { respond(response, 413, { ok: false, error: { code: 'REQUEST_TOO_LARGE', message: 'Request exceeds 1 MiB.' } }); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('INVALID_JSON', 'Request body is not valid JSON.'); }
      respond(response, 200, { ok: true, result: await execute(body, controller.signal) });
    } catch (error) { respond(response, error instanceof BridgeError ? 400 : 500, { ok: false, error: errorObject(error) }); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    if (closing || !validHost(request) || request.url !== '/extension' || (origin !== undefined && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });
  wss.on('connection', socket => {
    let browser;
    const helloTimer = setTimeout(() => socket.close(1008, 'Authentication required'), options.helloTimeoutMs ?? 5000);
    socket.on('error', () => {});
    socket.on('message', bytes => {
      let message;
      try { message = JSON.parse(bytes.toString()); } catch { socket.close(1008, 'Invalid JSON'); return; }
      if (!isRecord(message)) { socket.close(1008, 'Invalid message'); return; }
      if (!browser) {
        if (message.type !== 'hello' || message.protocol !== PROTOCOL || !equalToken(message.token, token) || !UUID.test(message.instanceId || '') || typeof message.browser !== 'string' || message.browser.length > 100 || typeof message.version !== 'string' || message.version.length > 40) { socket.close(1008, 'Authentication failed'); return; }
        clearTimeout(helloTimer);
        const prior = browsers.get(message.instanceId);
        if (prior) { disconnectPending(prior.socket); prior.socket.close(1012, 'Connection replaced'); }
        browser = { instanceId: message.instanceId, browser: message.browser, version: message.version, connectedAt: new Date().toISOString(), socket };
        browsers.set(browser.instanceId, browser);
        send(socket, { type: 'welcome', protocol: PROTOCOL, daemonId });
        return;
      }
      if (browsers.get(browser.instanceId)?.socket !== socket) return;
      if (message.type === 'ping') { send(socket, { type: 'pong' }); return; }
      if (message.type === 'pong') return;
      if (message.type === 'result') {
        const request = pending.get(message.id);
        if (!request || request.socket !== socket) return;
        if (message.ok === true) finishPending(request, null, message.result);
        else finishPending(request, new BridgeError(typeof message.error?.code === 'string' ? message.error.code : 'EXTENSION_ERROR', typeof message.error?.message === 'string' ? message.error.message : 'Browser extension command failed.'));
        return;
      }
      if (message.type === 'event' && ['tab_closed', 'detached'].includes(message.event) && Number.isSafeInteger(message.tabId)) {
        const tab = `${browser.instanceId}:${message.tabId}`;
        owners.delete(tab);
        revocations.set(tab, (revocations.get(tab) || 0) + 1);
      }
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      disconnectPending(socket);
      if (browser && browsers.get(browser.instanceId)?.socket === socket) browsers.delete(browser.instanceId);
    });
  });
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(settings.port, '127.0.0.1', () => { server.off('error', reject); resolveReady(); });
  });
  settings.port = server.address().port;
  settings.baseUrl = `http://127.0.0.1:${settings.port}`;
  return {
    settings, daemonId, status,
    async close() {
      closing = true;
      for (const socket of wss.clients) { disconnectPending(socket); socket.terminate(); }
      await new Promise(resolveClose => wss.close(resolveClose));
      server.closeIdleConnections();
      await new Promise(resolveClose => server.close(resolveClose));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startBridge().then(bridge => {
    console.error(`Browser Bridge ${VERSION} listening on ${bridge.settings.baseUrl}`);
    const shutdown = () => bridge.close().then(() => process.exit(0));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }).catch(error => {
    console.error(`Browser Bridge: ${error.code || 'START_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  });
}
