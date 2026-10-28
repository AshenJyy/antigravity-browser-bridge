import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, open, readFile, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export const VERSION = '2.0.1';
export const PROTOCOL = 2;

export class BridgeError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
  toJSON() { return { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) }; }
}

export function getSettings(overrides = {}) {
  const defaultDir = platform() === 'win32'
    // Packaged Windows hosts can see different redirected AppData directories.
    // Keep the default identity outside AppData so Desktop, App and shells agree.
    ? join(homedir(), '.browser-bridge')
    : platform() === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'BrowserBridge')
      : join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'browser-bridge');
  const port = Number(overrides.port ?? process.env.BROWSER_BRIDGE_PORT ?? 9224);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new BridgeError('INVALID_PORT', 'BROWSER_BRIDGE_PORT must be an integer from 1 to 65535.');
  const dataDir = resolve(overrides.dataDir || process.env.BROWSER_BRIDGE_DATA_DIR || defaultDir);
  return { dataDir, port, baseUrl: `http://127.0.0.1:${port}`, tokenPath: join(dataDir, 'token') };
}

/** Read or exclusively create this installation's token. Never log its value. */
export async function readToken(settings = getSettings()) {
  await mkdir(settings.dataDir, { recursive: true, mode: 0o700 });
  let file;
  try {
    file = await open(settings.tokenPath, 'wx', 0o600);
    const token = await legacyWindowsToken(settings) || randomBytes(32).toString('hex');
    await file.writeFile(token + '\n', 'utf8');
    await file.sync();
    return token;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally { await file?.close(); }
  // Another adapter may be writing the same exclusively-created token.
  for (let attempt = 0; attempt < 50; attempt++) {
    const info = await lstat(settings.tokenPath);
    if (!info.isFile() || info.isSymbolicLink()) throw new BridgeError('INVALID_TOKEN_FILE', 'The bridge token must be a regular file.');
    const token = (await readFile(settings.tokenPath, 'utf8')).trim();
    if (/^[a-f0-9]{64}$/.test(token)) return token;
    if (token.length) throw new BridgeError('INVALID_TOKEN_FILE', 'The bridge token file is malformed.');
    await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
  }
  throw new BridgeError('INVALID_TOKEN_FILE', 'The bridge token file was not initialized.');
}

/** Migrate the old default once; an explicit custom data directory stays independent. */
async function legacyWindowsToken(settings) {
  if (platform() !== 'win32' || settings.dataDir.toLowerCase() !== resolve(homedir(), '.browser-bridge').toLowerCase()) return;
  const legacyPath = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'BrowserBridge', 'token');
  try {
    const info = await lstat(legacyPath);
    if (!info.isFile() || info.isSymbolicLink()) return;
    const token = (await readFile(legacyPath, 'utf8')).trim();
    if (/^[a-f0-9]{64}$/.test(token)) return token;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
