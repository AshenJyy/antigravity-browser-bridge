import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client';
import { BridgeClient } from '../core/client.mjs';
import { tools, callTool } from '../core/tools.mjs';
import { DshSessions } from './dsh-sessions.mjs';

export const name = 'browser-bridge';
export const inject = ['tools', 'skills'];
export const Config = z.object({
  autoStart: z.boolean().default(true),
  port: z.number().min(1024).max(65535).description('Shared bridge port; leave unset to use BROWSER_BRIDGE_PORT or 9224.'),
  dataDir: z.string().description('Shared Browser Bridge state directory; leave empty to use the platform default.'),
});

function registerSkill(ctx) {
  const path = fileURLToPath(new URL('../skills/browser-bridge/SKILL.md', import.meta.url));
  const resourceBase = { kind: 'directory', path: fileURLToPath(new URL('../skills/browser-bridge/', import.meta.url)) };
  const summary = { path, name: 'browser-bridge', description: 'Inspect and control the user’s real Edge browser using Browser Bridge.',
    invocation: { modelInvocable: true, userInvocable: true }, provider: name, source: 'bundled', resourceBase };
  const candidate = { ...summary, rank: 600, locator: path };
  ctx.skills.registerProvider(() => ({ name,
    list: async (options = {}) => { options.signal?.throwIfAborted(); return [candidate]; },
    get: async (_candidate, options = {}) => {
      const raw = await readFile(path, { encoding: 'utf8', signal: options.signal });
      return { ...summary, content: raw.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim() };
    },
  }));
}

export function apply(ctx, config = {}) {
  const sessions = new DshSessions(options => new BridgeClient({
    ...options, autoStart: config.autoStart !== false,
    settings: { port: config.port, dataDir: config.dataDir },
  }));
  registerBrowserTools(ctx, sessions);
  registerSkill(ctx);
  ctx.on('agent/disposed', ({ agent }) => sessions.releaseAgent(agent).catch(() => {
    ctx.logger?.warn('Browser Bridge could not release all tabs for a disposed agent.');
  }));
  ctx.on('dispose', async () => {
    const failures = await sessions.close();
    if (failures.length) ctx.logger?.warn('Browser Bridge could not release every session during unload.');
  });
}

export function registerBrowserTools(ctx, sessions) {
  for (const tool of tools) {
    ctx.tools.register(createMcpToolDefinition(ctx, {
      name: tool.name, rawName: tool.name, description: tool.description, inputSchema: tool.inputSchema,
      call: (args, exec) => sessions.run(exec, (client, options) => callTool(client, tool.name, args, options)),
    }));
  }
}
