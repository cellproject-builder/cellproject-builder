/** Paid single-response probe. No browser entry imports this file. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { diagramLabelsRequest } from './request';
import { preserveFirstAttempt, summarizeResponse } from './probe';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const primary = 'C:\\__dev_ops__\\@artigo\\cellproject-builder';
const destination = join(repository, 'docs/reports/data/diagram-labels-2026-10-11');
const model = 'openai/gpt-6.1-sol';
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

async function main() {
  const args = process.argv.slice(2), request = diagramLabelsRequest();
  if (args.includes('--print-prompt') && !args.includes('--run')) {
    console.log(JSON.stringify({ ...request, systemHash: hash(request.system), promptHash: hash(request.prompt) }, null, 2)); return;
  }
  if (!args.includes('--run') || args.includes('--print-prompt')) throw new Error('explicitRunRequired');
  const env = loadEnv('development', primary, '');
  const key = env.OPENROUTER || env.VITE_DEV_OPENROUTER_API_KEY;
  if (!key) throw new Error('missingKey');
  const sourcePaths = ['src/visuals/diagram/prompt.ts', 'src/visuals/diagram/model.ts', 'src/visuals/diagram/quality.ts'];
  const sources = await Promise.all(sourcePaths.map(async path => ({ path, sha256: hash(await readFile(join(repository, path), 'utf8')) })));
  const manifest: Record<string, unknown> = {
    version: 1, createdAt: new Date().toISOString(), status: 'started', synthetic: true,
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    sourceFiles: sources, promptSource: "buildDiagramSystem('plan')", schemaSource: 'generationDiagramSchema', parserSource: 'parseGeneratedDiagram(raw, [])',
    ...request, systemHash: hash(request.system), promptHash: hash(request.prompt), inputHash: hash(request.system + '\n' + request.prompt),
    model, reasoningEffort: 'medium', maxOutputTokens: 16000, maxRetries: 0, timeoutMs: 180000,
    notes: ['Primeira resposta, uma única chamada, sem reparo ou seleção de melhor resultado.', 'Cobertura de rótulos é diagnóstica; não comprova layout, pinagem, compatibilidade ou funcionamento físico.'],
  };
  await preserveFirstAttempt(destination, manifest);
  const started = Date.now();
  console.log('Uma chamada sintética iniciada; primeira tentativa reservada.');
  try {
    const client = createOpenRouter({ apiKey: key, appName: 'Cellproject diagram labels probe' });
    const result = await generateText({ model: client.chat(model, { reasoning: { effort: 'medium' } }), ...request, maxOutputTokens: 16000, maxRetries: 0, abortSignal: AbortSignal.timeout(180000) });
    // Save exact response before interpretation. No generated code is evaluated.
    await writeFile(join(destination, 'response.txt'), result.text, { encoding: 'utf8', flag: 'wx' });
    const summary = summarizeResponse(result.text, result.finishReason);
    await writeFile(join(destination, 'diagram.json'), JSON.stringify(summary.diagram, null, 2) + '\n', { flag: 'wx' });
    Object.assign(manifest, { status: summary.status, durationMs: Date.now() - started, usage: result.usage, finishReason: result.finishReason, responseId: result.response.id, responseTextHash: hash(result.text), parser: summary.parser, coverage: summary.coverage });
  } catch {
    // Provider/transport errors may include sensitive request details. Never persist them.
    Object.assign(manifest, { status: 'request-or-storage-failed', durationMs: Date.now() - started, error: 'A primeira tentativa falhou; consulte os arquivos preservados. Não houve reparo ou nova chamada.' });
    process.exitCode = 1;
  }
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ status: manifest.status, durationMs: manifest.durationMs, parser: manifest.parser, coverage: manifest.coverage, destination }));
  if (manifest.status !== 'valid') process.exitCode = 1;
}

main().catch(error => {
  const code = error instanceof Error && ['explicitRunRequired', 'missingKey', 'preserveFirstSample'].includes(error.message) ? error.message : 'probeInterrupted';
  console.error(`Probe não iniciado ou interrompido: ${code}. Nenhum segredo foi registrado; preserve a primeira tentativa.`);
  process.exitCode = 1;
});
