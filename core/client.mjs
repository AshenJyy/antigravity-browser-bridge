import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getSettings, readToken, BridgeError } from './settings.mjs';

export { getSettings, readToken, BridgeError } from './settings.mjs';
const starting = new Map();

async function probe(settings, token) {
  let response;
  try {
    response = await fetch(`${settings.baseUrl}/v1/status`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(750), redirect: 'error',
    });
  } catch { return false; }
  let value;
  try { value = await response.json(); } catch { /* A foreign service may return HTML. */ }
  const details = { httpStatus: response.status, baseUrl: settings.baseUrl, dataDir: settings.dataDir, tokenPath: settings.tokenPath };
  if (response.status === 401) throw new BridgeError('BRIDGE_AUTH_MISMATCH', 'The running service rejected this local token. It may have started with another token or data directory. Run scripts/Repair-Pairing.ps1 to restart only a recognized Browser Bridge service without replacing the token.', details);
  if (response.status === 403) throw new BridgeError('BRIDGE_REQUEST_REJECTED', `The service rejected the request: ${value?.error?.code || 'HTTP_403'}. ${value?.error?.message || 'Check the loopback endpoint and any request proxy.'}`, details);
  if (!response.ok || !value?.ok || value.result?.protocol !== 2) throw new BridgeError('BRIDGE_PORT_IN_USE', `Port ${settings.port} is not serving the expected authenticated Browser Bridge v2 API. Run scripts/Repair-Pairing.ps1; an unrelated process will not be stopped.`, details);
  return true;
}

/** Start at most one logical daemon, including races between separate host processes. */
export async function ensureDaemon(overrides = getSettings()) {
  const settings = getSettings(overrides);
  if (settings.port === 0) throw new BridgeError('INVALID_PORT', 'Clients require a concrete bridge port.');
  const key = `${settings.baseUrl}|${settings.dataDir}`;
  if (starting.has(key)) return starting.get(key);
  const promise = (async () => {
    const token = await readToken(settings);
    if (await probe(settings, token)) return settings;
    const child = spawn(process.execPath, [fileURLToPath(new URL('./service.mjs', import.meta.url))], {
      detached: true, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, BROWSER_BRIDGE_PORT: String(settings.port), BROWSER_BRIDGE_DATA_DIR: settings.dataDir },
    });
    let spawnError;
    child.on('error', error => { spawnError = error; });
    child.unref();
    for (let attempt = 0; attempt < 50; attempt++) {
      if (spawnError) throw new BridgeError('DAEMON_START_FAILED', spawnError.message);
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
      if (await probe(settings, token)) return settings;
    }
    throw new BridgeError('DAEMON_START_FAILED', 'Browser Bridge did not start. Run the bridge service in a terminal to inspect startup errors.');
  })();
  starting.set(key, promise);
  try { return await promise; } finally { if (starting.get(key) === promise) starting.delete(key); }
}

export class BridgeClient {
  constructor({ client = 'cli', sessionId = randomUUID(), autoStart = true, settings } = {}) {
    this.client = client;
    this.sessionId = sessionId;
    this.autoStart = autoStart;
    this.settings = getSettings(settings);
    this.used = false;
  }
  async request(path, body, { signal, autoStart = this.autoStart, timeoutMs = 120000 } = {}) {
    signal?.throwIfAborted();
    if (autoStart) await ensureDaemon(this.settings);
    signal?.throwIfAborted();
    const token = await readToken(this.settings);
    if (body !== undefined) this.used = true;
    let response;
    try {
      response = await fetch(`${this.settings.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (signal?.aborted) throw new BridgeError('CANCELLED', 'Browser operation cancelled. Inspect the tab before retrying a mutation.');
      throw new BridgeError('BRIDGE_UNAVAILABLE', `Bridge request failed: ${error.message}. The action was not retried; its outcome may be unknown.`);
    }
    let value;
    try { value = await response.json(); } catch { throw new BridgeError('INVALID_RESPONSE', 'Bridge returned an invalid response. The action was not retried.'); }
    if (!response.ok || !value.ok) throw new BridgeError(value.error?.code || 'BRIDGE_ERROR', value.error?.message || `Bridge HTTP ${response.status}`, value.error?.details);
    return value.result;
  }
  call(action, args = {}, options) { return this.request('/v1/call', { sessionId: this.sessionId, client: this.client, action, args }, options); }
  status(options) { return this.request('/v1/status', undefined, options); }
  async close(options = {}) {
    if (!this.used) return { released: [], errors: [] };
    const result = await this.request('/v1/call', { sessionId: this.sessionId, client: this.client, action: 'session_close', args: {} }, { ...options, autoStart: false, timeoutMs: 3000 });
    if (!result.errors?.length) this.used = false;
    return result;
  }
}
