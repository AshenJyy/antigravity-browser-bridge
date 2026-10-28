import { BridgeError, fail, validateConfig, allowedURL, downloadFilename, keyDefinition, tabMetadata, groupLabel, boundedNumber, commandError, SerialQueue } from './bridge-utils.mjs';
import { domOperation } from './dom.js';

const VERSION = '2.0.0', WORLD = 'BrowserBridge-v2';
let config = { port: 9224, token: '', enabled: true }, instanceId, daemonId, socket;
let connected = false, initialized = false, statusMessage = 'Paste a pairing token to connect.';
let reconnectTimer, heartbeatTimer, reconnectAttempt = 0;
const attached = new Set(), intentionalDetach = new Set();
const owners = new Map(), downloads = new Map(), childSessions = new Map(), refs = new Map(), dialogs = new Map(), contexts = new Map(), controllers = new Map();
const eventOutbox = new Map();
const queue = new SerialQueue(), initQueue = new SerialQueue();
const cdp = (tabId, method, params = {}, sessionId) => chrome.debugger.sendCommand({ tabId, ...(sessionId ? { sessionId } : {}) }, method, params);
const send = message => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
const badge = () => {
  chrome.action.setBadgeText({ text: connected ? 'ON' : config.enabled && config.token ? '…' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#15803d' : '#64748b' });
};
const saveSession = () => chrome.storage.session.set({ owners: [...owners], downloads: [...downloads], daemonId: daemonId || null, eventOutbox: [...eventOutbox] });
function publishEvent(event) {
  if (connected && socket?.readyState === WebSocket.OPEN) send(event);
  else { eventOutbox.set(event.tabId, event); void saveSession(); }
}
const assertActive = signal => { if (signal?.aborted) fail('CANCELLED', 'The operation was cancelled.'); };
const delay = (ms, signal) => new Promise((resolve, reject) => {
  assertActive(signal);
  const onAbort = () => { clearTimeout(timer); reject(new BridgeError('CANCELLED', 'The operation was cancelled.')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});

async function initialize() {
  if (initialized) return;
  return initQueue.run('initialize', async () => {
    if (initialized) return;
    const stored = await chrome.storage.local.get(['config', 'instanceId']);
    config = validateConfig(stored.config);
    instanceId = stored.instanceId || crypto.randomUUID();
    await chrome.storage.local.set({ instanceId });
    const state = await chrome.storage.session.get(['owners', 'downloads', 'daemonId', 'eventOutbox']);
    daemonId = state.daemonId;
    for (const [id, owner] of state.owners || []) owners.set(Number(id), owner);
    for (const [id, item] of state.downloads || []) downloads.set(Number(id), item);
    for (const [id, item] of state.eventOutbox || []) eventOutbox.set(Number(id), item);
    const tabs = new Set((await chrome.tabs.query({})).map(tab => tab.id));
    for (const id of owners.keys()) if (!tabs.has(id)) {
      owners.delete(id); eventOutbox.set(id, { type: 'event', event: 'tab_closed', tabId: id });
    }
    for (const target of await chrome.debugger.getTargets()) if (target.attached && owners.has(target.tabId)) {
      // sendCommand succeeds only for our debugger, not another extension's.
      try { await cdp(target.tabId, 'Runtime.enable'); await cdp(target.tabId, 'Page.enable'); attached.add(target.tabId); await enableChildren(target.tabId); } catch { /* Explicit claim reports attachment errors. */ }
    }
    for (const id of owners.keys()) if (!attached.has(id)) {
      owners.delete(id);
      await chrome.tabs.ungroup(id).catch(() => {});
      eventOutbox.set(id, { type: 'event', event: 'detached', tabId: id, reason: 'debugger_not_attached_after_worker_restart' });
    }
    await saveSession();
    initialized = true;
    badge();
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (!config.enabled || !config.token) return;
  reconnectTimer = setTimeout(() => connect().catch(connectionError), Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt++, 5)));
}
function connectionError(error) { statusMessage = error?.message || 'Connection failed.'; connected = false; badge(); scheduleReconnect(); }
async function connect() {
  await initialize();
  if (!config.enabled || !config.token || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  const current = new WebSocket(`ws://127.0.0.1:${config.port}/extension`);
  socket = current;
  statusMessage = 'Connecting to the local bridge…';
  badge();
  const handshakeTimer = setTimeout(() => { if (!connected && socket === current) current.close(1000, 'Handshake timeout'); }, 6000);
  current.onopen = () => current.send(JSON.stringify({ type: 'hello', protocol: 2, token: config.token, instanceId, browser: navigator.userAgent.includes('Edg/') ? 'Microsoft Edge' : 'Google Chrome', version: VERSION }));
  current.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { current.close(1002, 'Invalid JSON'); return; }
    if (socket !== current) return;
    if (message.type === 'welcome') {
      void initQueue.run('welcome', async () => {
        if (message.protocol !== 2 || !message.daemonId) { statusMessage = 'Incompatible bridge protocol. Update both plugin and extension.'; current.close(); return; }
        if (daemonId !== message.daemonId) {
          for (const id of [...owners.keys()]) await releaseTab(id).catch(() => {});
          downloads.clear(); daemonId = message.daemonId; await saveSession();
        }
        if (socket !== current || current.readyState !== WebSocket.OPEN) return;
        connected = true; reconnectAttempt = 0;
        for (const event of eventOutbox.values()) send(event);
        eventOutbox.clear(); await saveSession();
        statusMessage = 'Connected. Only explicitly claimed tabs can be controlled.';
        clearTimeout(handshakeTimer); clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => send({ type: 'ping' }), 20000);
        badge();
      }).catch(connectionError);
    } else if (message.type === 'ping') current.send(JSON.stringify({ type: 'pong' }));
    else if (message.type === 'cancel') controllers.get(message.id)?.abort();
    else if (message.type === 'command') void executeMessage(current, message);
  };
  current.onclose = event => {
    clearTimeout(handshakeTimer);
    if (socket !== current) return;
    connected = false; clearInterval(heartbeatTimer);
    for (const controller of controllers.values()) controller.abort();
    statusMessage = event.code === 1008 ? 'Pairing rejected. Check the token and port.' : 'Bridge disconnected. Reconnecting automatically…';
    badge(); scheduleReconnect();
  };
  current.onerror = () => { statusMessage = 'Local bridge unavailable. Start Browser Bridge or check its port.'; };
}

async function executeMessage(current, message) {
  const controller = new AbortController();
  controllers.set(message.id, controller);
  try {
    await initQueue.run('welcome', async () => {});
    const result = await queue.run(message.tabId ?? 'global', async () => {
      assertActive(controller.signal);
      if (socket !== current || !connected) fail('DISCONNECTED', 'Connection changed before the operation started.');
      return dispatch(message, controller.signal);
    });
    if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result }));
  } catch (error) {
    if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'result', id: message.id, ok: false, error: commandError(error) }));
  } finally { controllers.delete(message.id); }
}

async function ensureAttached(tabId) {
  if (attached.has(tabId)) return;
  try { await chrome.debugger.attach({ tabId }, '1.3'); }
  catch (error) { fail('ATTACH_FAILED', `Cannot attach: ${error.message}. Close this tab's DevTools or check browser policy.`); }
  attached.add(tabId);
  await cdp(tabId, 'Page.enable'); await cdp(tabId, 'Runtime.enable'); await enableChildren(tabId);
}
async function enableChildren(tabId, sessionId) {
  try { await cdp(tabId, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'iframe', exclude: false }] }, sessionId); }
  catch { /* Unsupported child targets report FRAME_UNAVAILABLE; never silently switch frames. */ }
}
async function groupTab(tabId, session) {
  const tab = await chrome.tabs.get(tabId);
  const peer = [...owners].find(([id, owner]) => id !== tabId && owner.sessionId === session.id && owner.windowId === tab.windowId && owner.groupId >= 0);
  let groupId;
  if (peer) { try { groupId = await chrome.tabs.group({ tabIds: [tabId], groupId: peer[1].groupId }); } catch { /* User changed the group. */ } }
  if (groupId === undefined) {
    groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title: groupLabel(session), color: session.client === 'dsh' ? 'blue' : session.client === 'antigravity' ? 'purple' : 'cyan', collapsed: false });
  }
  owners.set(tabId, { sessionId: session.id, client: session.client, windowId: tab.windowId, groupId });
  await saveSession();
}
async function releaseTab(tabId) {
  owners.delete(tabId); refs.delete(tabId); childSessions.delete(tabId); contexts.delete(tabId); dialogs.delete(tabId);
  if (attached.has(tabId)) {
    intentionalDetach.add(tabId);
    try { await chrome.debugger.detach({ tabId }); } catch { intentionalDetach.delete(tabId); }
    attached.delete(tabId);
  }
  try { await chrome.tabs.ungroup(tabId); } catch { /* Already closed or ungrouped. */ }
  await saveSession();
  return { released: true };
}
function owned(tabId, session) {
  if (!Number.isInteger(tabId)) fail('INVALID_ARGUMENT', 'An explicit tab is required.');
  if (owners.get(tabId)?.sessionId !== session?.id) fail('TAB_NOT_OWNED', 'Explicitly claim this tab before controlling it.');
}

async function frames(tabId) {
  await ensureAttached(tabId);
  const list = [];
  const add = (tree, sessionId) => {
    const found = list.find(frame => frame.id === tree.frame.id);
    if (!found) list.push({ id: tree.frame.id, parentId: tree.frame.parentId, url: tree.frame.url, name: tree.frame.name || '', sessionId });
    else if (sessionId) Object.assign(found, { sessionId });
    for (const child of tree.childFrames || []) add(child, sessionId);
  };
  add((await cdp(tabId, 'Page.getFrameTree')).frameTree);
  for (const sessionId of childSessions.get(tabId)?.keys() || []) {
    try { add((await cdp(tabId, 'Page.getFrameTree', {}, sessionId)).frameTree, sessionId); } catch { /* Detached child. */ }
  }
  return list;
}
async function frameContext(tabId, args) {
  const list = await frames(tabId);
  let frameId = args.frameId;
  if (args.ref) {
    const reference = refs.get(tabId)?.get(args.ref);
    if (!reference) fail('STALE_REFERENCE', 'The reference expired. Take a new snapshot of this tab.');
    if (frameId && frameId !== reference.frameId) fail('INVALID_ARGUMENT', 'ref and frameId identify different frames.');
    frameId = reference.frameId;
  }
  const frame = frameId ? list.find(item => item.id === frameId) : list[0];
  if (!frame) fail('FRAME_NOT_FOUND', 'The frame no longer exists. Take a new snapshot.');
  let executionContextId;
  try { ({ executionContextId } = await cdp(tabId, 'Page.createIsolatedWorld', { frameId: frame.id, worldName: WORLD, grantUniveralAccess: false }, frame.sessionId)); }
  catch (error) { fail('FRAME_UNAVAILABLE', `Cannot access frame ${frame.id}: ${error.message}. Cross-process frames require Edge 125+.`); }
  return { ...frame, executionContextId };
}
function unwrapEvaluation(response) {
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description || response.exceptionDetails.text;
    const match = description.match(/BB:([A-Z_]+):([^\n]*)/);
    if (match) fail(match[1], match[2]);
    fail('EVALUATION_FAILED', description);
  }
  return response.result;
}
async function dom(tabId, operation, args, returnByValue = true, context) {
  context ||= await frameContext(tabId, args);
  const result = unwrapEvaluation(await cdp(tabId, 'Runtime.callFunctionOn', { functionDeclaration: domOperation.toString(), executionContextId: context.executionContextId, arguments: [{ value: operation }, { value: args }], returnByValue, awaitPromise: true, objectGroup: 'browser-bridge' }, context.sessionId));
  return { value: returnByValue ? result.value : result.objectId, context };
}

async function frameOffset(tabId, frameId) {
  const list = await frames(tabId), frame = list.find(item => item.id === frameId);
  if (!frame?.parentId) return { x: 0, y: 0 };
  const parent = list.find(item => item.id === frame.parentId);
  if (!parent) fail('FRAME_UNAVAILABLE', 'Cannot resolve the parent frame for coordinate input.');
  let owner;
  try { owner = await cdp(tabId, 'DOM.getFrameOwner', { frameId }, parent.sessionId); }
  catch { fail('FRAME_UNAVAILABLE', 'Cannot determine frame geometry. Use top-level screenshot coordinates.'); }
  const { model } = await cdp(tabId, 'DOM.getBoxModel', { backendNodeId: owner.backendNodeId }, parent.sessionId), quad = model.content;
  if (Math.abs(quad[1] - quad[3]) > 1 || Math.abs(quad[0] - quad[6]) > 1 || Math.abs(quad[2] - quad[0] - model.width) > 4) fail('UNSUPPORTED_FRAME_TRANSFORM', 'Transformed cross-process frames require screenshot coordinates.');
  const outer = parent.sessionId ? await frameOffset(tabId, parent.id) : { x: 0, y: 0 };
  return { x: quad[0] + outer.x, y: quad[1] + outer.y };
}
async function elementPoint(tabId, args) {
  if (args.x !== undefined || args.y !== undefined) {
    const x = boundedNumber(args.x, undefined, 0, 100000, 'x'), y = boundedNumber(args.y, undefined, 0, 100000, 'y');
    if (x === undefined || y === undefined) fail('INVALID_ARGUMENT', 'Both x and y are required.');
    return { x, y };
  }
  const context = await frameContext(tabId, args);
  await dom(tabId, 'prepare', { ...args, hitTest: true }, true, context);
  const { value: objectId } = await dom(tabId, 'resolve', args, false, context);
  try {
    const result = await cdp(tabId, 'DOM.getContentQuads', { objectId }, context.sessionId);
    const quad = result.quads?.find(q => Math.abs((q[2] - q[0]) * (q[7] - q[1]) - (q[3] - q[1]) * (q[6] - q[0])) > 1);
    if (!quad) fail('ELEMENT_HIDDEN', 'The element has no clickable area.');
    let x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
    if (context.sessionId) { const offset = await frameOffset(tabId, context.id); x += offset.x; y += offset.y; }
    return { x, y };
  } finally { await cdp(tabId, 'Runtime.releaseObject', { objectId }, context.sessionId).catch(() => {}); }
}
async function keyPress(tabId, key, modifiers = []) {
  const event = keyDefinition(key, modifiers);
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: event.text ? 'keyDown' : 'rawKeyDown', ...event });
  const { text, ...up } = event;
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...up });
}
async function waitForPage(tabId, signal) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    assertActive(signal);
    if (dialogs.has(tabId)) return { waitingForDialog: true };
    if ((await chrome.tabs.get(tabId)).status === 'complete') return { loaded: true };
    await delay(100, signal);
  }
  return { loaded: false, warning: 'The action completed, but loading did not settle within 15 seconds.' };
}

async function dispatch(message, signal) {
  const { action, tabId, session } = message, args = message.args || {};
  assertActive(signal);
  if (!session?.id || !['dsh', 'antigravity', 'cli'].includes(session.client)) fail('INVALID_SESSION', 'A host session is required.');
  if (action === 'tabs') return (await chrome.tabs.query({})).map(tabMetadata);
  if (action === 'open') {
    const tab = await chrome.tabs.create({ url: allowedURL(args.url || 'about:blank'), active: args.active !== false });
    try {
      await groupTab(tab.id, { ...session, label: args.label || session.label }); await ensureAttached(tab.id); await waitForPage(tab.id, signal);
      return tabMetadata(await chrome.tabs.get(tab.id));
    } catch (error) { await releaseTab(tab.id); throw error; }
  }
  if (action === 'claim') {
    if (!Number.isInteger(tabId)) fail('INVALID_ARGUMENT', 'An explicit tab is required.');
    if (owners.has(tabId) && owners.get(tabId).sessionId !== session.id) fail('TAB_BUSY', 'Another session owns this tab.');
    await chrome.tabs.get(tabId); await ensureAttached(tabId);
    try { await groupTab(tabId, session); } catch (error) { await releaseTab(tabId); throw error; }
    return tabMetadata(await chrome.tabs.get(tabId));
  }
  owned(tabId, session);
  if (action === 'release') return releaseTab(tabId);
  if (action === 'close') { await chrome.tabs.remove(tabId); return { closed: true }; }
  if (dialogs.has(tabId) && action !== 'dialog') {
    const dialog = dialogs.get(tabId);
    fail('DIALOG_OPEN', `A ${dialog.type} dialog is open: ${dialog.message}. Handle it with the dialog tool before continuing.`);
  }
  if (['navigate', 'back', 'forward', 'reload'].includes(action)) {
    refs.delete(tabId);
    if (action === 'navigate') await chrome.tabs.update(tabId, { url: allowedURL(args.url) });
    else if (action === 'back') await chrome.tabs.goBack(tabId);
    else if (action === 'forward') await chrome.tabs.goForward(tabId);
    else await chrome.tabs.reload(tabId);
    return { ...tabMetadata(await chrome.tabs.get(tabId)), ...await waitForPage(tabId, signal) };
  }
  await ensureAttached(tabId);
  if (action === 'snapshot') {
    const context = await frameContext(tabId, args), snapshotId = crypto.randomUUID();
    const { value } = await dom(tabId, 'snapshot', { ...args, snapshotId, limit: Math.floor(boundedNumber(args.limit, 200, 1, 1000, 'limit')) }, true, context);
    const tabRefs = refs.get(tabId) || new Map();
    for (const [key, ref] of tabRefs) if (ref.frameId === context.id) tabRefs.delete(key);
    for (const element of value.elements) tabRefs.set(element.ref, { frameId: context.id });
    refs.set(tabId, tabRefs);
    return { ...value, frameId: context.id, frames: (await frames(tabId)).map(({ sessionId, ...frame }) => frame), note: 'One frame per snapshot. Pass frameId for iframe content; refs select their own frame. Bounds are relative to that frame.' };
  }
  if (action === 'content') return (await dom(tabId, 'content', { ...args, maxChars: Math.floor(boundedNumber(args.maxChars, 30000, 1, 200000, 'maxChars')) })).value;
  if (action === 'screenshot') {
    const parameters = { format: 'png', fromSurface: true, captureBeyondViewport: !!args.fullPage };
    if (args.fullPage) {
      const metrics = await cdp(tabId, 'Page.getLayoutMetrics'), content = metrics.cssContentSize || metrics.contentSize;
      if (content.width * content.height > 64000000 || content.width > 20000 || content.height > 50000) fail('SCREENSHOT_TOO_LARGE', 'Use viewport screenshots and scroll for a page this large.');
      parameters.clip = { x: 0, y: 0, width: content.width, height: content.height, scale: 1 };
    }
    return { mimeType: 'image/png', data: (await cdp(tabId, 'Page.captureScreenshot', parameters)).data };
  }
  if (action === 'click' || action === 'hover') {
    const point = await elementPoint(tabId, args); assertActive(signal);
    const metrics = await cdp(tabId, 'Page.getLayoutMetrics'), viewport = metrics.cssVisualViewport || metrics.visualViewport;
    if (point.x < 0 || point.y < 0 || point.x >= viewport.clientWidth || point.y >= viewport.clientHeight) fail('OUTSIDE_VIEWPORT', 'The target is outside the viewport. Scroll and take a new screenshot.');
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    if (action === 'click') {
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    }
    return { performed: action, ...point };
  }
  if (action === 'type') {
    if (typeof args.text !== 'string') fail('INVALID_ARGUMENT', 'text must be a string.');
    await dom(tabId, 'prepare', { ...args, focus: true, editable: true }); assertActive(signal);
    if (args.clear !== false) { await keyPress(tabId, 'a', ['Control']); await keyPress(tabId, 'Backspace'); }
    await cdp(tabId, 'Input.insertText', { text: args.text });
    return { typed: true, characters: args.text.length };
  }
  if (action === 'press') { await keyPress(tabId, args.key, args.modifiers); return { pressed: args.key }; }
  if (action === 'scroll') {
    await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: boundedNumber(args.x, 1, 0, 100000, 'x'), y: boundedNumber(args.y, 1, 0, 100000, 'y'), deltaX: boundedNumber(args.deltaX, 0, -100000, 100000, 'deltaX'), deltaY: boundedNumber(args.deltaY, 600, -100000, 100000, 'deltaY') });
    return { scrolled: true };
  }
  if (action === 'select') {
    if (!Array.isArray(args.values) || !args.values.every(value => typeof value === 'string')) fail('INVALID_ARGUMENT', 'values must be an array of strings.');
    return (await dom(tabId, 'select', args)).value;
  }
  if (action === 'wait') {
    const timeoutMs = boundedNumber(args.timeoutMs, 10000, 0, 60000, 'timeoutMs'), state = args.state || 'visible', started = Date.now();
    if (!['visible', 'hidden', 'attached'].includes(state)) fail('INVALID_ARGUMENT', 'Unknown wait state.');
    if (!args.ref && !args.selector && typeof args.text !== 'string') fail('INVALID_ARGUMENT', 'Provide a ref, selector, or text.');
    do {
      assertActive(signal);
      try { if ((await dom(tabId, 'wait', { ...args, state })).value.matched) return { matched: true, elapsedMs: Date.now() - started }; }
      catch (error) { if (error.code || !/context|navigat/i.test(error.message)) throw error; }
      if (Date.now() - started >= timeoutMs) break;
      await delay(Math.min(100, timeoutMs - (Date.now() - started)), signal);
    } while (true);
    fail('WAIT_TIMEOUT', `Condition was not met within ${timeoutMs} ms.`);
  }
  if (action === 'upload') {
    if (!Array.isArray(args.files) || !args.files.length || !args.files.every(file => typeof file === 'string' && /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(file))) fail('INVALID_ARGUMENT', 'files must contain absolute local paths.');
    const { value: objectId, context } = await dom(tabId, 'file', { ...args, fileCount: args.files.length }, false);
    try { await cdp(tabId, 'DOM.setFileInputFiles', { objectId, files: args.files }, context.sessionId); }
    finally { await cdp(tabId, 'Runtime.releaseObject', { objectId }, context.sessionId).catch(() => {}); }
    return { selected: args.files.length };
  }
  if (action === 'download') {
    const url = allowedURL(args.url), filename = downloadFilename(args.filename);
    if (url === 'about:blank') fail('INVALID_ARGUMENT', 'A download requires an http(s) URL.');
    const id = await chrome.downloads.download({ url, ...(filename ? { filename } : {}), conflictAction: 'uniquify', saveAs: false });
    downloads.set(id, { sessionId: session.id, tabId, createdAt: Date.now() }); await saveSession();
    return { id, started: true };
  }
  if (action === 'downloads') {
    const items = [];
    for (const [id, owner] of downloads) if (owner.tabId === tabId && owner.sessionId === session.id) {
      const [item] = await chrome.downloads.search({ id });
      if (item) items.push({ id: item.id, url: item.url, filename: item.filename, state: item.state, error: item.error, bytesReceived: item.bytesReceived, totalBytes: item.totalBytes, exists: item.exists });
    }
    return { downloads: items, scope: 'Only downloads started by this session’s download tool.' };
  }
  if (action === 'dialog') {
    if (typeof args.accept !== 'boolean') fail('INVALID_ARGUMENT', 'accept must be a boolean.');
    await cdp(tabId, 'Page.handleJavaScriptDialog', { accept: args.accept, ...(args.promptText !== undefined ? { promptText: String(args.promptText) } : {}) });
    dialogs.delete(tabId); return { handled: true };
  }
  if (action === 'evaluate') {
    if (typeof args.expression !== 'string' || !args.expression.trim()) fail('INVALID_ARGUMENT', 'expression must be a JavaScript expression.');
    const context = await frameContext(tabId, args), main = contexts.get(tabId)?.get(`${context.sessionId || ''}:${context.id}`);
    if (!main) fail('FRAME_UNAVAILABLE', 'The frame main-world context is unavailable. Retry after navigation settles.');
    const result = unwrapEvaluation(await cdp(tabId, 'Runtime.evaluate', { expression: args.expression, contextId: main, returnByValue: true, awaitPromise: true, timeout: 10000 }, context.sessionId));
    return { value: result.value ?? result.unserializableValue ?? null, type: result.type };
  }
  fail('UNKNOWN_ACTION', `Unsupported browser action: ${action}`);
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
    const children = childSessions.get(source.tabId) || new Map(); children.set(params.sessionId, params.targetInfo.targetId); childSessions.set(source.tabId, children);
    void cdp(source.tabId, 'Page.enable', {}, params.sessionId).catch(() => {});
    void cdp(source.tabId, 'Runtime.enable', {}, params.sessionId).catch(() => {});
    void enableChildren(source.tabId, params.sessionId);
  } else if (method === 'Target.detachedFromTarget') childSessions.get(source.tabId)?.delete(params.sessionId);
  else if (method === 'Runtime.executionContextCreated' && params.context.auxData?.isDefault) {
    const map = contexts.get(source.tabId) || new Map(); map.set(`${source.sessionId || ''}:${params.context.auxData.frameId}`, params.context.id); contexts.set(source.tabId, map);
  } else if (method === 'Runtime.executionContextDestroyed') {
    for (const [key, value] of contexts.get(source.tabId) || []) if (key.startsWith(`${source.sessionId || ''}:`) && value === params.executionContextId) contexts.get(source.tabId).delete(key);
  } else if (method === 'Runtime.executionContextsCleared') {
    for (const key of contexts.get(source.tabId)?.keys() || []) if (key.startsWith(`${source.sessionId || ''}:`)) contexts.get(source.tabId).delete(key);
  } else if (method === 'Page.frameNavigated') {
    const tabRefs = refs.get(source.tabId); for (const [key, value] of tabRefs || []) if (value.frameId === params.frame.id) tabRefs.delete(key);
  } else if (method === 'Page.javascriptDialogOpening') dialogs.set(source.tabId, { type: params.type, message: params.message });
  else if (method === 'Page.javascriptDialogClosed') dialogs.delete(source.tabId);
});
chrome.debugger.onDetach.addListener((source, reason) => {
  attached.delete(source.tabId); refs.delete(source.tabId); childSessions.delete(source.tabId); contexts.delete(source.tabId);
  if (intentionalDetach.delete(source.tabId)) return;
  owners.delete(source.tabId); void chrome.tabs.ungroup(source.tabId).catch(() => {}); void saveSession();
  publishEvent({ type: 'event', event: 'detached', tabId: source.tabId, reason });
});
chrome.tabs.onRemoved.addListener(tabId => {
  owners.delete(tabId); attached.delete(tabId); refs.delete(tabId); childSessions.delete(tabId); contexts.delete(tabId); dialogs.delete(tabId); void saveSession();
  publishEvent({ type: 'event', event: 'tab_closed', tabId });
});
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  void (async () => {
    await initialize();
    if (request.type === 'status') return { connected, instanceId, port: config.port, enabled: config.enabled, paired: !!config.token, status: statusMessage, tabs: [...owners].map(([tabId, owner]) => ({ tabId, ...owner })), dialogs: [...dialogs].map(([tabId, dialog]) => ({ tabId, ...dialog })) };
    if (request.type === 'configure') {
      const next = validateConfig({ port: request.port, token: request.token || config.token, enabled: true });
      if (!next.token) fail('INVALID_ARGUMENT', 'Paste the pairing token first.');
      for (const controller of controllers.values()) controller.abort();
      for (const id of [...owners.keys()]) { await releaseTab(id); publishEvent({ type: 'event', event: 'detached', tabId: id, reason: 'user_reconfigured' }); }
      config = next; await chrome.storage.local.set({ config }); connected = false; socket?.close(); socket = null; await connect(); return { saved: true };
    }
    if (request.type === 'release_all') {
      for (const controller of controllers.values()) controller.abort();
      for (const id of [...owners.keys()]) { await releaseTab(id); publishEvent({ type: 'event', event: 'detached', tabId: id, reason: 'user_released' }); }
      config.enabled = false; await chrome.storage.local.set({ config }); connected = false;
      clearTimeout(reconnectTimer); clearInterval(heartbeatTimer); socket?.close(); socket = null;
      statusMessage = 'Paused. All tabs have been released.'; badge(); return { released: true };
    }
    fail('UNKNOWN_ACTION', 'Unknown popup request.');
  })().then(result => respond({ ok: true, result }), error => respond({ ok: false, error: commandError(error) }));
  return true;
});
chrome.alarms.create('bridge-reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'bridge-reconnect') void connect().catch(connectionError); });
chrome.runtime.onStartup.addListener(() => void connect().catch(connectionError));
void connect().catch(connectionError);
