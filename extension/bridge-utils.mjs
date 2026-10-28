export class BridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const fail = (code, message) => { throw new BridgeError(code, message); };
export function validateConfig(value = {}) {
  const port = Number(value.port ?? 9224);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('INVALID_ARGUMENT', 'Port must be between 1024 and 65535.');
  const token = String(value.token ?? '').trim();
  if (token && (token.length < 24 || token.length > 512 || /\s/.test(token))) fail('INVALID_ARGUMENT', 'Paste the complete Browser Bridge pairing token.');
  return { port, token, enabled: value.enabled !== false };
}
export function allowedURL(value) {
  let url;
  try { url = new URL(value); } catch { fail('INVALID_ARGUMENT', 'A complete http(s) URL or about:blank is required.'); }
  if (!['https:', 'http:'].includes(url.protocol) && url.href !== 'about:blank') fail('UNSUPPORTED_URL', 'Only http(s) pages and about:blank are supported.');
  if (url.username || url.password) fail('INVALID_ARGUMENT', 'Credentials in URLs are not supported.');
  return url.href;
}
export function downloadFilename(filename) {
  if (filename === undefined || filename === '') return undefined;
  if (typeof filename !== 'string' || filename.length > 240 || /[\x00-\x1f<>:"|?*]/.test(filename)) fail('INVALID_ARGUMENT', 'Use a relative download filename without special path characters.');
  const normalized = filename.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) fail('INVALID_ARGUMENT', 'The filename must stay inside the browser download directory.');
  return normalized;
}
export function modifierBits(modifiers = []) {
  if (!Array.isArray(modifiers)) fail('INVALID_ARGUMENT', 'modifiers must be an array.');
  const bits = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
  return modifiers.reduce((sum, value) => {
    if (!Object.hasOwn(bits, value)) fail('INVALID_ARGUMENT', `Unknown modifier: ${value}`);
    return sum | bits[value];
  }, 0);
}
export function keyDefinition(key, modifiers = []) {
  const aliases = { Ctrl: 'Control', Esc: 'Escape', Return: 'Enter', Space: ' ', Spacebar: ' ', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Del: 'Delete' };
  key = aliases[key] ?? key;
  if (typeof key !== 'string' || !key) fail('INVALID_ARGUMENT', 'key must be non-empty.');
  const special = { Backspace: [8, 'Backspace'], Tab: [9, 'Tab'], Enter: [13, 'Enter'], Escape: [27, 'Escape'], ' ': [32, 'Space'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'], End: [35, 'End'], Home: [36, 'Home'], ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'], Insert: [45, 'Insert'], Delete: [46, 'Delete'], Shift: [16, 'ShiftLeft'], Control: [17, 'ControlLeft'], Alt: [18, 'AltLeft'], Meta: [91, 'MetaLeft'] };
  let code, vk;
  if (special[key]) [vk, code] = special[key];
  else if (/^F([1-9]|1[0-2])$/.test(key)) { vk = 111 + Number(key.slice(1)); code = key; }
  else if (/^[a-z]$/i.test(key)) { vk = key.toUpperCase().charCodeAt(0); code = `Key${key.toUpperCase()}`; }
  else if (/^[0-9]$/.test(key)) { vk = key.charCodeAt(0); code = `Digit${key}`; }
  else if ([...key].length === 1) { vk = 0; code = ''; }
  else fail('INVALID_ARGUMENT', `Unsupported key: ${key}. Use Enter, Tab, ArrowDown, or a single character.`);
  const mask = modifierBits(modifiers);
  const event = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mask };
  if (!(mask & 7) && ([...key].length === 1 || key === 'Enter')) event.text = key === 'Enter' ? '\r' : key;
  return event;
}
export function tabMetadata(tab) {
  return { id: tab.id, url: tab.url || tab.pendingUrl || '', title: tab.title || '', active: !!tab.active, windowId: tab.windowId, groupId: tab.groupId };
}
export function groupLabel(session) {
  const client = session.client === 'dsh' ? 'DSH' : session.client === 'antigravity' ? 'Antigravity' : 'Bridge';
  return `${client} · ${String(session.label || session.id.slice(0, 8)).replace(/[\x00-\x1f]/g, '').slice(0, 40)}`;
}
export function boundedNumber(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('INVALID_ARGUMENT', `${name} must be between ${min} and ${max}.`);
  return value;
}
export const commandError = error => ({ code: error?.code || 'BROWSER_ERROR', message: String(error?.message || error || 'Unknown browser error') });
export class SerialQueue {
  #tails = new Map();
  run(key, callback) {
    const current = (this.#tails.get(key) || Promise.resolve()).catch(() => {}).then(callback);
    this.#tails.set(key, current);
    current.finally(() => { if (this.#tails.get(key) === current) this.#tails.delete(key); }).catch(() => {});
    return current;
  }
}
