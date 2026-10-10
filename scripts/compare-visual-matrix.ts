/** Explicit local experiment. No inference during preparation, tests or builds.
 * npx vite-node --mode test scripts/compare-visual-matrix.ts --prepare
 * npx vite-node --mode test scripts/compare-visual-matrix.ts --run
 * --run resumes only pending cells; first outcomes are never retried/replaced.
 */
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { loadEnv } from 'vite';
import { generateObject, NoObjectGeneratedError } from 'ai';
import type { LanguageModelUsage, ModelMessage } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { matrixCaseSchema, matrixInput, matrixManifestSchema, matrixRunSchema, matrixSystem, planMatrix, summarizeRuns } from '../src/visuals/comparison/matrix';
import type { MatrixCase, MatrixManifest, MatrixRun } from '../src/visuals/comparison/matrix';
import { generationSceneSchema, sceneSchema } from '../src/visuals/comparison/legacyScene';
import { VISUAL_MODEL_GUIDE_SOURCE, LEGACY_VISUAL_MODEL_GUIDE_VERSION as VISUAL_MODEL_GUIDE_VERSION } from '../src/visuals/modelingGuide';
import { accountedCost, ATTEMPT_RESERVATION_USD, coordinateWorkers, safeRawText, sha256, verifyReferenceFetch } from './visual-matrix-runner';

const experimentRoot = resolve('docs/design/three-skills-comparison');
const destination = resolve(experimentRoot, 'matrix');
const manifestPath = resolve(destination, 'manifest.json');
const lockPath = resolve(destination, '.run.lock');
const runsPath = resolve(destination, 'runs');
const defaultModel = 'openai/gpt-6.1-sol';
class SetupError extends Error {}

function code(error: unknown): string | undefined { return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined; }
async function exists(path: string) { try { await access(path); return true; } catch (error) { if (code(error) === 'ENOENT') return false; throw error; } }
const safeTokens = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const safeCost = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function usageOf(usage?: LanguageModelUsage, providerMetadata?: unknown): MatrixRun['usage'] {
  const raw = usage?.raw as { cost?: unknown } | undefined;
  const metadata = providerMetadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined;
  return { inputTokens: safeTokens(usage?.inputTokens), outputTokens: safeTokens(usage?.outputTokens), totalTokens: safeTokens(usage?.totalTokens), costUsd: safeCost(raw?.cost) ?? safeCost(metadata?.openrouter?.usage?.cost) };
}

async function acquireLock() {
  try { await writeFile(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { flag: 'wx' }); }
  catch (error) {
    if (code(error) !== 'EEXIST') throw error;
    let pid: number | undefined;
    try { const previous = JSON.parse(await readFile(lockPath, 'utf8')); if (Number.isInteger(previous.pid) && previous.pid > 0) pid = previous.pid; } catch { /* Unknown lock stays protected. */ }
    if (!pid) throw new SetupError('O experimento está bloqueado por um processo anterior sem identificação.');
    try { process.kill(pid, 0); throw new SetupError('Outra execução deste experimento ainda está ativa.'); }
    catch (probeError) { if (code(probeError) !== 'ESRCH') throw probeError; }
    await rm(lockPath);
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), recoveredStalePid: pid }), { flag: 'wx' });
  }
}

async function validateImages(cases: MatrixCase[]): Promise<Map<string, Buffer>> {
  const images = new Map<string, Buffer>();
  for (const item of cases) {
    const path = resolve(destination, item.image.path);
    const scope = relative(resolve(experimentRoot, 'fixtures'), path);
    if (!scope || scope.startsWith(`..${sep}`) || scope === '..' || resolve(scope) === scope) throw new SetupError('Caminho de imagem fora das referências deste experimento.');
    const bytes = await readFile(path);
    if (sha256(bytes) !== item.image.sha256 || (item.image.bytes !== undefined && bytes.byteLength !== item.image.bytes)) throw new SetupError(`Integridade da referência inválida: ${item.id}.`);
    images.set(item.id, bytes);
  }
  return images;
}

async function prepare(): Promise<MatrixManifest> {
  const fixtures = JSON.parse(await readFile(resolve(experimentRoot, 'fixtures/cases.json'), 'utf8'));
  if (!Array.isArray(fixtures)) throw new SetupError('As referências precisam formar uma lista de casos.');
  const cases = fixtures.map(item => matrixCaseSchema.parse(item));
  await validateImages(cases);
  const now = new Date().toISOString();
  const runs: MatrixRun[] = planMatrix(cases, 2).map(plan => {
    const item = cases.find(candidate => candidate.id === plan.caseId)!;
    const input = matrixInput(item, plan.context);
    const systemPrompt = matrixSystem(item.prompt, plan.condition);
    return { ...plan, status: 'pending', scene: null, durationMs: null, finishReason: null,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null }, systemPrompt, ...input,
      hashes: { system: sha256(systemPrompt), userText: sha256(input.userText), image: input.imageInput?.sha256 ?? null },
      responseId: null, errorCode: null, rawText: null };
  });
  const manifest = matrixManifestSchema.parse({ version: 1, id: 'three-skills-matrix-v2', createdAt: now, updatedAt: now,
    protocol: { provider: 'openrouter', model: defaultModel, maxOutputTokens: 10_000, reasoningEffort: 'medium', temperature: null,
      repetitions: 2, guideVersion: VISUAL_MODEL_GUIDE_VERSION, upstreamCommit: VISUAL_MODEL_GUIDE_SOURCE.commit, maxCostUsd: 4,
      notes: [
        '32 primeiras tentativas: dois objetos × quatro contextos × duas condições × duas repetições; sem seleção posterior ou reparo.',
        'A condição skills usa o guia adaptado e receitas próprias do projeto, não isola o texto upstream puro.',
        'Imagem significa bytes reais enviados ao modelo; referências e metadados completos ficam preservados, mas só pixels e especificações da célula entram na mensagem.',
        'Mesma instrução por objeto, schema, modelo, raciocínio medium e limite de saída; temperature e seed omitidos, maxRetries=0.',
        'Ordem contrabalançada; duas chamadas concorrentes no máximo. A duração observada inclui influência da concorrência e é apenas descritiva.',
        'Reserva conservadora de US$0,25 por tentativa em andamento ou sem custo reportado; limite de despacho de US$4, não um teto de faturamento imposto ao provedor. Não reinicia falhas ou estados interrompidos.',
        'Cena ilustrativa SceneV1; nenhuma prova de CAD, tolerâncias, encaixe, funcionamento ou validação física. Duas repetições não demonstram superioridade científica.',
      ] }, cases, runs });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

function verifyPlan(manifest: MatrixManifest) {
  if (manifest.protocol.model !== defaultModel || manifest.protocol.maxOutputTokens !== 10_000 || manifest.protocol.repetitions !== 2 || manifest.protocol.maxCostUsd !== 4
    || manifest.protocol.guideVersion !== VISUAL_MODEL_GUIDE_VERSION || manifest.protocol.upstreamCommit !== VISUAL_MODEL_GUIDE_SOURCE.commit) throw new SetupError('Configuração preparada difere do protocolo fixado.');
  for (const run of manifest.runs) {
    const item = manifest.cases.find(candidate => candidate.id === run.caseId)!;
    const input = matrixInput(item, run.context);
    const system = matrixSystem(item.prompt, run.condition);
    if (run.systemPrompt !== system || run.userText !== input.userText || JSON.stringify(run.imageInput) !== JSON.stringify(input.imageInput)
      || run.hashes.system !== sha256(system) || run.hashes.userText !== sha256(input.userText)) throw new SetupError('Uma entrada preparada mudou; preserve o experimento original.');
  }
}

async function execute(manifest: MatrixManifest) {
  verifyPlan(manifest);
  const images = await validateImages(manifest.cases);
  await mkdir(runsPath, { recursive: true });
  let saveQueue = Promise.resolve();
  const persist = () => {
    manifest.updatedAt = new Date().toISOString();
    const data = JSON.stringify(matrixManifestSchema.parse(manifest), null, 2) + '\n';
    saveQueue = saveQueue.then(async () => { const tmp = `${manifestPath}.tmp`; await writeFile(tmp, data); await rename(tmp, manifestPath); });
    return saveQueue;
  };
  const replace = (run: MatrixRun) => { manifest.runs[manifest.runs.findIndex(candidate => candidate.id === run.id)] = run; };
  const finish = async (run: MatrixRun) => {
    matrixRunSchema.parse(run);
    await writeFile(resolve(runsPath, `${run.id}.json`), JSON.stringify(run, null, 2) + '\n', { flag: 'wx' });
    replace(run); await persist();
  };
  for (const planned of [...manifest.runs]) {
    const path = resolve(runsPath, `${planned.id}.json`);
    if (await exists(path)) {
      const recovered = matrixRunSchema.parse(JSON.parse(await readFile(path, 'utf8')));
      if (!['success', 'failed', 'budget-skipped'].includes(recovered.status) || recovered.id !== planned.id
        || recovered.order !== planned.order || recovered.caseId !== planned.caseId || recovered.context !== planned.context
        || recovered.repeat !== planned.repeat || recovered.condition !== planned.condition
        || recovered.systemPrompt !== planned.systemPrompt || recovered.userText !== planned.userText
        || JSON.stringify(recovered.imageInput) !== JSON.stringify(planned.imageInput)
        || recovered.hashes.system !== sha256(recovered.systemPrompt) || recovered.hashes.userText !== sha256(recovered.userText)
        || JSON.stringify(recovered.hashes) !== JSON.stringify(planned.hashes)) throw new SetupError('Resultado salvo não corresponde à tentativa preparada.');
      replace(recovered);
    } else if (planned.status === 'running') {
      await finish({ ...planned, status: 'failed', errorCode: 'interrupted-unknown-outcome', scene: null });
    } else if (planned.status !== 'pending') throw new SetupError('Falta o arquivo imutável de uma tentativa finalizada.');
  }
  await persist();
  const pending = manifest.runs.filter(run => run.status === 'pending');
  if (!pending.length) { console.log(JSON.stringify(summarizeRuns(manifest.runs))); return; }
  const env = loadEnv('development', process.cwd(), '');
  const apiKey = process.env.OPENROUTER || env.OPENROUTER;
  if (!apiKey) throw new SetupError('OPENROUTER não está configurado no ambiente local.');
  let cursor = 0;
  async function worker(shouldStop: () => boolean) {
    while (!shouldStop() && cursor < pending.length) {
      const planned = pending[cursor++];
      // Synchronous reservation precedes the first await, so both workers share one ledger.
      if (accountedCost(manifest.runs) + ATTEMPT_RESERVATION_USD > manifest.protocol.maxCostUsd + 1e-9) {
        await finish({ ...planned, status: 'budget-skipped', errorCode: 'conservative-budget-limit' });
        continue;
      }
      const running: MatrixRun = { ...planned, status: 'running' };
      replace(running); await persist();
      console.log(`Gerando ${planned.order + 1}/${manifest.runs.length}: ${planned.id}`);
      const started = performance.now();
      let outcome: MatrixRun = { ...running, status: 'failed' };
      try {
        const verifiedFetch = verifyReferenceFetch({ systemPrompt: planned.systemPrompt, userText: planned.userText, imageHash: planned.imageInput?.sha256 ?? null, mimeType: planned.imageInput?.mimeType ?? null }, fetch);
        const client = createOpenRouter({ apiKey, appName: 'dynamic_diary visual matrix', fetch: verifiedFetch });
        const content: Extract<ModelMessage, { role: 'user' }>['content'] = [{ type: 'text', text: planned.userText }];
        if (planned.imageInput) content.push({ type: 'image', image: images.get(planned.caseId)!, mediaType: planned.imageInput.mimeType });
        const result = await generateObject({ model: client.chat(manifest.protocol.model, { reasoning: { effort: 'medium' } }),
          schema: generationSceneSchema, system: planned.systemPrompt, messages: [{ role: 'user', content }],
          maxOutputTokens: manifest.protocol.maxOutputTokens, maxRetries: 0, abortSignal: AbortSignal.timeout(180_000) });
        outcome = { ...outcome, finishReason: result.finishReason, usage: usageOf(result.usage, result.providerMetadata), responseId: result.response.id,
          rawText: safeRawText(result.response.body) };
        if (result.finishReason === 'length') outcome.errorCode = 'truncated-first-response';
        else {
          const validated = sceneSchema.safeParse(result.object);
          if (validated.success) outcome = { ...outcome, status: 'success', scene: validated.data, errorCode: null };
          else outcome.errorCode = 'scene-validation-failed';
        }
      } catch (error) {
        if (NoObjectGeneratedError.isInstance(error)) outcome = { ...outcome, rawText: error.text ?? null, responseId: error.response?.id ?? null,
          usage: usageOf(error.usage), finishReason: error.finishReason ?? null, errorCode: error.finishReason === 'length' ? 'truncated-first-response' : 'structured-output-failed' };
        else outcome.errorCode = error instanceof Error && error.message === 'matrixRequestMismatch' ? 'request-audit-failed' : error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name) ? 'request-timeout' : 'provider-or-network-failed';
        if (outcome.errorCode === 'request-audit-failed') outcome.usage.costUsd = 0; // The guard throws before the remote fetch.
      }
      outcome.durationMs = Math.round(performance.now() - started);
      await finish(outcome);
      console.log(`${planned.id}: ${outcome.status}; custo ${outcome.usage.costUsd === null ? 'não informado' : `US$${outcome.usage.costUsd.toFixed(6)}`}.`);
      if (outcome.errorCode === 'request-audit-failed') throw new SetupError('Auditoria local bloqueou uma entrada antes da rede; despacho interrompido e resultado preservado.');
    }
  }
  await coordinateWorkers(worker);
  await saveQueue;
  console.log(JSON.stringify(summarizeRuns(manifest.runs)));
}

async function main() {
  const run = process.argv.includes('--run'), prepareOnly = process.argv.includes('--prepare');
  if (run === prepareOnly) throw new SetupError('Escolha --prepare (sem inferência) ou --run (chamadas pagas para células pendentes).');
  await mkdir(destination, { recursive: true });
  await acquireLock();
  try {
    let manifest: MatrixManifest;
    if (await exists(manifestPath)) manifest = matrixManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    else manifest = await prepare();
    verifyPlan(manifest);
    if (prepareOnly) { await validateImages(manifest.cases); console.log(`Matriz preparada e validada: ${manifest.runs.length} células; ${manifest.runs.filter(item => item.status === 'pending').length} pendentes. Nenhuma chamada de inferência.`); }
    else await execute(manifest);
  } finally { await rm(lockPath, { force: true }); }
}

main().catch(error => {
  // SDK errors can retain authorization headers and request bodies. Never print them.
  console.error(error instanceof SetupError ? error.message : 'A matriz falhou. Resultados anteriores foram preservados; nenhum cabeçalho ou chave foi registrado.');
  process.exitCode = 1;
});
