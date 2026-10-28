#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BridgeClient, ensureDaemon, getSettings, readToken } from '../core/client.mjs';
import { VERSION } from '../core/settings.mjs';

const help = `Browser Bridge ${VERSION} — Edge / DSH Desktop / Antigravity App

  browser-bridge status                         Start/check the shared daemon
  browser-bridge pair                           Show the local pairing token
  browser-bridge tabs                           List instances, handles and owners
  browser-bridge open URL [--instance ID]        Open and own a new tab
  browser-bridge claim TAB                      Claim an existing unowned tab
  browser-bridge snapshot TAB                   Read interactive elements
  browser-bridge content TAB                    Read page text
  browser-bridge click TAB --ref REF            Click a snapshot reference
  browser-bridge click TAB --selector CSS       Click a unique DOM target
  browser-bridge type TAB --ref REF --text TEXT  Fill an input
  browser-bridge press TAB KEY                  Send a keyboard key
  browser-bridge screenshot TAB [-o FILE]        Save a PNG (default: page.png)
  browser-bridge navigate TAB URL               Navigate an owned tab
  browser-bridge release TAB                    Keep page, release ownership
  browser-bridge close TAB                      Close an owned page
  browser-bridge session-close                  Release this session's pages
  browser-bridge call ACTION '{"tab":"..."}'     All protocol actions

Global: --session NAME (default cli-default; use a different name per task).
Advanced args: --json '{...}' adds action arguments. --full-page captures full page.
Environment: BROWSER_BRIDGE_PORT, BROWSER_BRIDGE_DATA_DIR, BROWSER_BRIDGE_SESSION.
The pair token grants local browser control; paste it only into your extension.
`;

export function parseArgs(argv) {
  const positional = [], options = {};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--full-page') options.fullPage = true;
    else if (value === '--help' || value === '-h') options.help = true;
    else if (value.startsWith('--') || value === '-o') {
      const key = value === '-o' ? 'output' : value.slice(2);
      if (!['session', 'instance', 'ref', 'selector', 'text', 'json', 'output'].includes(key)) throw new Error(`Unknown option: ${value}`);
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${value}`);
      options[key] = argv[++i];
    } else positional.push(value);
  }
  return { positional, options };
}

async function main() {
  const { positional: p, options: o } = parseArgs(process.argv.slice(2));
  if (o.help || !p.length || p[0] === 'help') return process.stdout.write(help);
  if (p[0] === 'pair') {
    const settings = await ensureDaemon(getSettings());
    const token = await readToken(settings);
    console.log(JSON.stringify({ endpoint: `ws://127.0.0.1:${settings.port}/extension`, token }, null, 2));
    return;
  }
  const client = new BridgeClient({ client: 'cli', sessionId: o.session || process.env.BROWSER_BRIDGE_SESSION || 'cli-default' });
  let action = p[0] === 'session-close' ? 'session_close' : p[0];
  let args = o.json ? JSON.parse(o.json) : {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('--json must be an object');
  if (action === 'call') {
    action = p[1];
    args = p[2] ? JSON.parse(p[2]) : args;
  } else if (action === 'open') {
    args.url = p[1];
    if (o.instance) args.instanceId = o.instance;
  } else if (!['status', 'tabs', 'session_close'].includes(action)) {
    args.tab = p[1];
    if (action === 'navigate') args.url = p[2];
    if (action === 'press') args.key = p[2];
    if (o.ref) args.ref = o.ref;
    if (o.selector) args.selector = o.selector;
    if (o.text !== undefined) args.text = o.text;
    if (o.fullPage) args.fullPage = true;
  }
  const result = await client.call(action, args);
  if (action === 'screenshot') {
    if (result?.mimeType !== 'image/png' || typeof result.data !== 'string') throw new Error('Invalid screenshot response');
    const destination = resolve(o.output || 'page.png');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from(result.data, 'base64'));
    console.log(JSON.stringify({ savedTo: destination, mimeType: result.mimeType }));
  } else console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ error: { code: error.code || 'CLI_ERROR', message: error.message, ...(error.details ? { details: error.details } : {}) } }));
  process.exitCode = 1;
});
