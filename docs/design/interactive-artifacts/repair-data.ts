/** One explicit transport repair. Original first attempt and diagnostic remain saved. */
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadEnv } from 'vite';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { generationDiagramSchema, parseDiagram, sampleContext } from './model';
if (!process.argv.includes('--run')) throw new Error('Use --run');
const dir = 'docs/design/interactive-artifacts/results/';
try { await access(dir + 'diagram-data-repaired.json'); throw new Error('Preserve repaired sample'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
const previous = JSON.parse(await readFile(dir + 'diagram-data.json', 'utf8'));
const manifest = JSON.parse(await readFile(dir + 'manifest.json', 'utf8'));
const env = loadEnv('development', process.cwd(), '');
const client = createOpenRouter({ apiKey: process.env.OPENROUTER || env.OPENROUTER || env.VITE_DEV_OPENROUTER_API_KEY });
const instruction = previous.instruction + '\nviewBox deve ser exatamente [0,0,largura,altura].';
const record: Record<string, unknown> = { id: 'diagram-data-repaired', attempt: 3, repairedTransport: true, reason: 'Provider rejected tuple item schema with HTTP 400. Use homogeneous four-number array in transport, exact tuple validated locally.', status: 'failed', system: previous.system, instruction, inputHash: createHash('sha256').update(JSON.stringify(sampleContext) + instruction).digest('hex') };
const started = Date.now();
try {
  const result = await generateObject({ model: client.chat(manifest.model, { reasoning: { effort: 'medium' } }), system: previous.system, prompt: instruction + '\nCONTEXTO\n' + JSON.stringify(sampleContext), schema: generationDiagramSchema, maxOutputTokens: 6500, maxRetries: 0, abortSignal: AbortSignal.timeout(150000) });
  Object.assign(record, { output: result.object, usage: result.usage, finishReason: result.finishReason, responseId: result.response.id });
  if (result.finishReason === 'length') throw new Error('truncated');
  parseDiagram(result.object, sampleContext.nodes.map(n => n.id)); record.status = 'valid';
} catch { record.error = 'Geração ou validação falhou. Resposta original preservada, sem reparo de desenho.'; }
record.durationMs = Date.now() - started;
await writeFile(dir + 'diagram-data-repaired.json', JSON.stringify(record, null, 2));
manifest.runs.push({ id: record.id, status: record.status, durationMs: record.durationMs, attempt: 3 });
manifest.notes.push('A tentativa declarativa inicial e uma repetição diagnóstica foram recusadas com HTTP 400 por schema de tupla. Uma terceira tentativa explícita corrigiu apenas o transporte e acrescentou a instrução viewBox [0,0,largura,altura]. Os resultados originais foram preservados; esta condição não é uma primeira tentativa bem sucedida.');
await writeFile(dir + 'manifest.json', JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ id: record.id, status: record.status, durationMs: record.durationMs }));
