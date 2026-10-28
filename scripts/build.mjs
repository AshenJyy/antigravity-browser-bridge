import { build } from 'esbuild';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, basename } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(root, 'runtime'), { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: { mcp: 'adapters/mcp.mjs', service: 'core/service.mjs', cli: 'scripts/cli.mjs' },
  outdir: 'runtime', outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  banner: { js: "import { createRequire as __bridgeCreateRequire } from 'node:module'; const require = __bridgeCreateRequire(import.meta.url);" },
  external: ['bufferutil', 'utf-8-validate'],
  sourcemap: false, legalComments: 'linked',
  logLevel: 'info', metafile: true
});

// Carry dependency license texts with the standalone distribution.
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  let cursor = dirname(resolve(root, input));
  while (cursor !== dirname(cursor)) {
    try { await readFile(resolve(cursor, 'package.json')); packages.add(cursor); break; } catch {}
    cursor = dirname(cursor);
  }
}
const notices = [];
for (const directory of [...packages].sort()) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const licenses = (await readdir(directory)).filter(name => /^(license|licence|copying|notice)(\.|$)/i.test(name));
  notices.push(`\n===== ${manifest.name || basename(directory)} ${manifest.version || ''} (${manifest.license || 'see source'}) =====\n`);
  for (const name of licenses) {
    try { notices.push(await readFile(resolve(directory, name), 'utf8')); } catch {}
  }
}
await writeFile(resolve(root, 'runtime/THIRD_PARTY_LICENSES.txt'), notices.join('\n'), 'utf8');
