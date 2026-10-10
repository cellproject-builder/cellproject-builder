#!/usr/bin/env node
// Paid evaluation is opt-in. Default execution writes only a reviewable protocol.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createServer, loadEnv } from 'vite';
import 'fake-indexeddb/auto';

const args = process.argv.slice(2);
const known = new Set(['--live', '--output', '--env-file', '--model', '--cases', '--max-requests', '--max-usd', '--summarize', '--help']);
for (let i = 0; i < args.length; i++) {
  if (!known.has(args[i])) throw new Error(`Unknown option: ${args[i]}`);
  if (!['--live', '--help'].includes(args[i])) { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value: ${args[i]}`); i++; }
}
if (args.includes('--help')) {
  console.log('node scripts/planning-quality.mjs [--live] [--output NEW_DIRECTORY] [--env-file PATH] [--model ID] [--cases comma,separated,ids] [--max-requests 12] [--max-usd 3]\nnode scripts/planning-quality.mjs --summarize EXISTING_RUN_DIRECTORY\nDefault: offline protocol only. Live: production service, no SDK retries; transport attempts count against both limits.');
  process.exit(0);
}
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const root = fileURLToPath(new URL('..', import.meta.url));
const live = args.includes('--live');
const output = path.resolve(value('--output') ?? path.join(root, 'docs/design/plan-quality/results', `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${live ? 'live' : 'offline'}`));
await mkdir(path.dirname(output), { recursive: true });
let apiKey;
if (live) {
  const envPath = path.resolve(value('--env-file') ?? path.join(root, '.env'));
  // Only the OpenRouter key enters memory. Nothing is printed or copied to the output.
  const env = loadEnv('', path.dirname(envPath), '');
  if (path.basename(envPath) !== '.env') throw new Error('--env-file must name .env');
  apiKey = process.env.OPENROUTER ?? env.OPENROUTER ?? env.VITE_DEV_OPENROUTER_API_KEY;
}
const server = await createServer({ configFile: false, root, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, entries: [] },
  resolve: { alias: { '@': path.join(root, 'src') } }, define: { __DEV_OPENROUTER_KEY__: JSON.stringify('') },
});
try {
  if (value('--summarize')) {
    if (live) throw new Error('--summarize cannot be combined with --live');
    const { summarizeQualityRun } = await server.ssrLoadModule('/scripts/planning-quality-summary.ts');
    await summarizeQualityRun(value('--summarize'));
  } else {
  const { runQualityBattery } = await server.ssrLoadModule('/scripts/planning-quality-runner.ts');
  await runQualityBattery({ live, output, apiKey, model: value('--model'), cases: value('--cases')?.split(','),
    maxRequests: value('--max-requests') === undefined ? 12 : Number(value('--max-requests')),
    maxUsd: value('--max-usd') === undefined ? 3 : Number(value('--max-usd')) });
  }
} finally { await server.close(); }
