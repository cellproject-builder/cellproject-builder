/** Explicit diagnostic repetition; preserves the failed first attempt. */
import { readFile, writeFile, access } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject, APICallError } from 'ai';
import { diagramSchema, parseDiagram, sampleContext } from './model';
if (!process.argv.includes('--run')) throw new Error('Use --run');
const dir = 'docs/design/interactive-artifacts/results/';
try { await access(dir + 'diagram-data-diagnostic.json'); throw new Error('Preserve diagnostic'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
const previous = JSON.parse(await readFile(dir + 'diagram-data.json', 'utf8'));
const manifest = JSON.parse(await readFile(dir + 'manifest.json', 'utf8'));
const env = loadEnv('development', process.cwd(), '');
const key = process.env.OPENROUTER || env.OPENROUTER || env.VITE_DEV_OPENROUTER_API_KEY;
const client = createOpenRouter({ apiKey: key });
const record: Record<string, unknown> = { attempt: 2, reason: 'Diagnose first structured-schema rejection; original sample retained.', status: 'failed' };
const started = Date.now();
try {
  const result = await generateObject({ model: client.chat(manifest.model, { reasoning: { effort: 'medium' } }), system: previous.system, prompt: previous.instruction + '\nCONTEXTO\n' + JSON.stringify(sampleContext), schema: diagramSchema, maxOutputTokens: 6500, maxRetries: 0, abortSignal: AbortSignal.timeout(150000) });
  record.output = result.object; record.usage = result.usage;
  parseDiagram(result.object, sampleContext.nodes.map(n => n.id)); record.status = 'valid';
} catch (error) {
  record.errorName = error instanceof Error ? error.name : 'unknown';
  if (APICallError.isInstance(error)) record.httpStatus = error.statusCode;
  let message = error instanceof Error ? error.message : 'unknown';
  for (const secret of [key, env.TYPESAFE_API_KEY, env.TYPESAFE].filter(Boolean)) message = message.replaceAll(secret, '[redacted]');
  record.message = message.slice(0, 700);
}
record.durationMs = Date.now() - started;
await writeFile(dir + 'diagram-data-diagnostic.json', JSON.stringify(record, null, 2));
console.log(JSON.stringify({ status: record.status, errorName: record.errorName, httpStatus: record.httpStatus, message: record.message }));
