/** Explicit text-JSON transport probe after provider schema refusals. No hidden retries. */
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadEnv } from 'vite';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { z } from 'zod';
import { generationDiagramSchema, parseDiagram, sampleContext } from './model';
if (!process.argv.includes('--run')) throw new Error('Use --run');
const dir = 'docs/design/interactive-artifacts/results/';
try { await access(dir + 'diagram-data-text.json'); throw new Error('Preserve sample'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
const previous = JSON.parse(await readFile(dir + 'diagram-data.json', 'utf8'));
const manifest = JSON.parse(await readFile(dir + 'manifest.json', 'utf8'));
const env = loadEnv('development', process.cwd(), '');
const client = createOpenRouter({ apiKey: process.env.OPENROUTER || env.OPENROUTER || env.VITE_DEV_OPENROUTER_API_KEY });
const schema = z.toJSONSchema(generationDiagramSchema);
const instruction = previous.instruction + '\nRetorne SOMENTE JSON, sem markdown, obedecendo ao schema abaixo. viewBox exatamente [0,0,largura,altura]. Apenas os atributos declarados são permitidos (line usa x1,y1,x2,y2). Use no máximo 40 elementos para manter legibilidade e controle de orçamento. bindings text substituem o texto completo, inclua a unidade em suffix (no máximo 24 caracteres). constants é um mapa de números. Todas as dependências de calculation devem existir anteriormente.\nSCHEMA\n' + JSON.stringify(schema);
const prompt = instruction + '\nCONTEXTO\n' + JSON.stringify(sampleContext);
const record: Record<string, unknown> = { id: 'diagram-data-text', attempt: 4, transport: 'text-json-local-validation', system: previous.system, instruction, inputHash: createHash('sha256').update(prompt).digest('hex'), status: 'failed' };
const started = Date.now();
try {
  const result = await generateText({ model: client.chat(manifest.model, { reasoning: { effort: 'medium' } }), system: previous.system, prompt, maxOutputTokens: 6500, maxRetries: 0, abortSignal: AbortSignal.timeout(150000) });
  Object.assign(record, { rawText: result.text, usage: result.usage, finishReason: result.finishReason, responseId: result.response.id });
  if (result.finishReason === 'length') throw new Error('truncated');
  const output = JSON.parse(result.text); record.output = output;
  parseDiagram(output, sampleContext.nodes.map(n => n.id)); record.status = 'valid';
} catch { record.error = 'Geração ou validação local falhou. Nenhum conserto manual do desenho.'; }
record.durationMs = Date.now() - started;
await writeFile(dir + 'diagram-data-text.json', JSON.stringify(record, null, 2));
manifest.runs.push({ id: record.id, status: record.status, durationMs: record.durationMs, attempt: 4 });
manifest.notes.push('O reparo por array também falhou antes de registrar uma resposta. Uma quarta tentativa explícita usa JSON como texto e validação local, após acrescentar x1/y1 ao contrato de linhas e instruções de serialização. Contrato, transporte e prompt técnico diferem do primeiro ensaio; não comparar taxa de sucesso como medida da arquitetura.');
await writeFile(dir + 'manifest.json', JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ id: record.id, status: record.status, durationMs: record.durationMs }));
