import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { outlinePlans, expandPlan, decomposeNode, type DecomposeContext, type AIPlanOut } from '../src/ai/service';
import { useConfigStore, PROVIDER_DEFAULTS } from '../src/config/store';
import { useLocaleStore } from '../src/i18n/store';
import type { AIPlanOutline, AISuggestedNode } from '../src/types';
import { BudgetLedger, createRecordedFetch, redact, type AttemptRecord } from './planning-quality-core';
import { qualityCases, sourceProvenance, type QualityCase } from './planning-quality-cases';

export interface QualityRunOptions { live: boolean; output: string; apiKey?: string; model?: string; cases?: string[]; maxRequests?: number; maxUsd?: number }
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const errorText = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export function selectDecomposition(plan: AIPlanOut): { node: AISuggestedNode; context: DecomposeContext } {
  const categories = plan.tree.categorias;
  const resources = categories.find(category => category.kind === 'recursos') ?? categories[0];
  const node = resources?.children.find(child => /bateria|energia|controle|eletr[oô]nica|arduino|placa/i.test(child.name)) ?? resources?.children[0];
  if (!node) throw new Error('no_decomposition_candidate');
  return { node, context: {
    projectName: plan.title, projectObjective: '', breadcrumb: [plan.title, resources.name, node.name],
    nodeName: node.name, nodeKind: node.kind, nodeFx: node.fx, oQue: node.oQue, porQue: node.porQue, comoConfirmar: node.comoConfirmar,
    siblings: resources.children.filter(item => item !== node).map(item => ({ name: item.name, fx: item.fx })),
    strategy: plan.strategy, archetype: plan.archetype, planApproach: plan.planApproach, referenceTarget: plan.referenceTarget,
    planOverview: categories.flatMap(category => category.children.filter(item => item !== node).map(item => ({ category: category.name, name: item.name, oQue: item.oQue }))),
  } };
}

/** A real service evaluation. Only storage, language and transport logging are scripted. */
export async function runQualityBattery(options: QualityRunOptions) {
  const cases = options.cases?.length ? options.cases.map(id => {
    const found = qualityCases.find(item => item.id === id); if (!found) throw new Error(`unknown_case:${id}`); return found;
  }) : qualityCases.filter(item => item.group === 'core');
  if (new Set(cases.map(item => item.id)).size !== cases.length) throw new Error('duplicate_case');
  const output = path.resolve(options.output);
  await mkdir(output, { recursive: false }); // refuse to overwrite any prior run, especially a first attempt
  const secrets = options.apiKey ? [options.apiKey] : [];
  const save = async (name: string, value: unknown) => { await writeFile(path.join(output, name), JSON.stringify(redact(value, secrets), null, 2) + '\n', 'utf8'); };
  const model = options.model ?? PROVIDER_DEFAULTS.openrouter.mainModel;
  const sourcePaths = ['src/ai/service.ts', 'src/ai/schemas.ts', 'src/ai/client.ts', 'src/ai/transport.ts', 'src/ai/research.ts', 'src/ai/planStructure.ts', 'src/planningIntent.ts', 'src/config/store.ts', 'src/i18n/messages.ts', 'package-lock.json', 'scripts/planning-quality-core.ts', 'scripts/planning-quality-cases.ts', 'scripts/planning-quality-runner.ts', 'scripts/planning-quality.mjs'];
  const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async file => [file, sha256(await readFile(file, 'utf8'))])));
  const revision = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean), diffSha256: sha256(execFileSync('git', ['diff', '--no-ext-diff', 'HEAD'], { encoding: 'utf8' })), sourceHashes };
  const manifest: Record<string, unknown> = {
    formatVersion: 1, startedAt: new Date().toISOString(), mode: options.live ? 'live-production-service' : 'offline-protocol-only',
    product: 'Dynamic Diary', model, modelSource: options.model ? 'explicit --model override' : 'PROVIDER_DEFAULTS.openrouter.mainModel from src/config/store.ts',
    configuration: 'Isolated in-memory IndexedDB; no user browser config, projects or chats read. Portuguese locale. Production service/schema/normalizers/client; logging fetch wrapper only.',
    selection: 'First rank=1 outline, otherwise lowest rank with original order tie-break. Decompose first energy/control/board resource by label, otherwise first resource; no response editing.',
    commonOptions: { locale: 'pt-BR', webResearchEnabled: false, maxRetries: 0, effort: 'production stage default', callOpts: 'production per-stage defaults', rules: [], research: null },
    limits: { maxRequests: options.maxRequests ?? 12, maxUsd: options.maxUsd ?? 3, includesTransportRetries: true, costMode: 'conservative per-request reservation, no refunds for unknown/failed calls' },
    revision, sourceProvenance, cases, typesafe: { executed: false, semanticValidation: false }, physicalValidation: false,
  };
  await save('manifest.json', manifest);
  await save('review-template.json', cases.map(item => ({ case: item.id, status: 'not_evaluated', focus: item.focus,
    dimensions: ['coverage', 'interfaces', 'source_fidelity', 'coherence', 'question_quality', 'uncertainty', 'criterion_quality'].map(id => ({ id, score: null, evidence: [], counterevidence: [], notes: '' })) })));
  if (!options.live) {
    manifest.endedAt = new Date().toISOString(); manifest.requests = 0;
    await save('manifest.json', manifest);
    console.log(`Protocol saved; paid calls skipped (${cases.length} cases): ${output}`);
    return manifest;
  }
  if (!options.apiKey) throw new Error('OPENROUTER_key_missing');
  const originalFetch = globalThis.fetch;
  const metadataResponse = await originalFetch('https://openrouter.ai/api/v1/models');
  if (!metadataResponse.ok) throw new Error(`model_metadata_http_${metadataResponse.status}`);
  const catalog = await metadataResponse.json() as { data: Array<Record<string, any>> };
  const metadata = catalog.data.find(item => item.id === model);
  if (!metadata) throw new Error(`configured_model_unavailable:${model}`);
  const prices = { prompt: Number(metadata.pricing?.prompt), completion: Number(metadata.pricing?.completion) };
  for (const tier of metadata.pricing?.overrides ?? []) {
    if (tier.prompt !== undefined) prices.prompt = Math.max(prices.prompt, Number(tier.prompt));
    if (tier.completion !== undefined) prices.completion = Math.max(prices.completion, Number(tier.completion));
  }
  if (!metadata.supported_parameters?.includes('structured_outputs') && !metadata.supported_parameters?.includes('response_format')) throw new Error('configured_model_missing_structured_output_support');
  manifest.providerMetadata = { fetchedAt: new Date().toISOString(), url: 'https://openrouter.ai/api/v1/models', model: metadata, reservedPrices: prices };
  await save('manifest.json', manifest);
  await Promise.all([useConfigStore.persist.rehydrate(), useLocaleStore.persist.rehydrate()]);
  useConfigStore.setState({ activeProvider: 'openrouter', providers: { openrouter: { apiKey: options.apiKey, ...PROVIDER_DEFAULTS.openrouter, mainModel: model } }, webResearchEnabled: false });
  useLocaleStore.getState().setLocale('pt-BR');

  const ledger = new BudgetLedger(options.maxRequests ?? 12, options.maxUsd ?? 3, prices);
  let currentStage = 'initialization';
  const attempts = new Map<number, AttemptRecord>();
  const recordedFetch = createRecordedFetch({ ledger, model, stage: () => currentStage, secrets, remote: originalFetch,
    onRecord: async record => { attempts.set(record.attempt, record); await save(`attempt-${String(record.attempt).padStart(2, '0')}.json`, { ...record, requestSha256: sha256(record.requestText), responseSha256: record.responseText === undefined ? null : sha256(record.responseText) }); } });
  const stageResults: any[] = [];
  const originalWarn = console.warn;
  const warnings: { stage: string; text: unknown; at: string }[] = [];
  console.warn = (...args: unknown[]) => { const warning = { stage: currentStage, text: redact(args.map(arg => arg instanceof Error ? errorText(arg) : arg), secrets), at: new Date().toISOString() }; warnings.push(warning); originalWarn('[planning-quality warning]', JSON.stringify(warning.text)); };
  globalThis.fetch = recordedFetch;
  async function stage<T>(item: QualityCase, name: string, invoke: (progress: (event: any) => void) => Promise<T>): Promise<T | undefined> {
    currentStage = `${item.id}:${name}`;
    const startedAt = Date.now();
    const record: any = { case: item.id, stage: name, status: 'running', startedAt: new Date(startedAt).toISOString(), firstAttempt: true, events: [] };
    const progress = ({ partial: _partial, research: _research, ...event }: any) => record.events.push(event);
    try { record.output = await invoke(progress); record.status = 'success'; return record.output; }
    catch (error) { record.status = 'failed'; record.error = errorText(error); record.errorInfo = (error as any)?.info; return undefined; }
    finally {
      await recordedFetch.flush();
      record.elapsedMs = Date.now() - startedAt; record.attempts = [...attempts.values()].filter(attempt => attempt.stage === currentStage).map(attempt => attempt.attempt);
      stageResults.push(record); await save(`${item.id}-${name}.json`, record);
      console.log(`${currentStage}: ${record.status}; ${record.elapsedMs}ms; requests=${ledger.attempts}; reserved=$${ledger.reservedUsd.toFixed(4)}`);
    }
  }
  try {
    for (const item of cases) {
      if (ledger.attempts >= ledger.maxRequests) break;
      const common = { ...item.intent, maxRetries: 0 };
      const outlines = await stage<AIPlanOutline[]>(item, 'outline', progress => outlinePlans(item.objective, progress, item.kb, [], undefined, common));
      if (!outlines?.length) continue;
      const chosen = outlines.map((outline, index) => ({ outline, index })).sort((a, b) => a.outline.rank - b.outline.rank || a.index - b.index)[0].outline;
      await save(`${item.id}-selection.json`, { rank: chosen.rank, id: chosen.id, title: chosen.title, policy: manifest.selection });
      const expanded = await stage<AIPlanOut>(item, 'expand', progress => expandPlan(item.objective, chosen, progress, item.kb, [], { ...common, research: null }));
      if (!expanded) continue;
      const selected = selectDecomposition(expanded); selected.context.projectObjective = item.objective;
      await save(`${item.id}-decompose-input.json`, selected.context);
      await stage(item, 'decompose', () => decomposeNode(selected.context, item.kb, { maxRetries: 0, signal: AbortSignal.timeout(120_000) }));
    }
  } finally {
    await recordedFetch.flush(); globalThis.fetch = originalFetch; console.warn = originalWarn;
    useConfigStore.setState({ activeProvider: null, providers: {}, webResearchEnabled: false });
    const recorded = [...attempts.values()];
    Object.assign(manifest, { endedAt: new Date().toISOString(), requests: ledger.attempts, reservedUsd: ledger.reservedUsd,
      actualCostUsd: recorded.every(attempt => attempt.usage?.costUsd != null) ? recorded.reduce((sum, attempt) => sum + (attempt.usage?.costUsd ?? 0), 0) : null,
      reportedPartialCostUsd: recorded.reduce((sum, attempt) => sum + (attempt.usage?.costUsd ?? 0), 0),
      completedStages: stageResults.filter(stage => stage.status === 'success').length, failedStages: stageResults.filter(stage => stage.status === 'failed').length, warnings });
    await save('manifest.json', manifest);
    await save('summary.json', stageResults.map(({ output: _output, events: _events, ...summary }) => summary));
  }
  return manifest;
}
