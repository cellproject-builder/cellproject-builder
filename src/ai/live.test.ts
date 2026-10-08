// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { useConfigStore, PROVIDER_DEFAULTS } from '@/config/store';
import { useLocaleStore } from '@/i18n';
import {
  generatePlans,
  outlinePlans,
  expandPlan,
  countOutlineNodes,
  decomposeNode,
  replanFromFailure,
  explainNode,
  critiqueNode,
  type PlanProgressEvent,
} from './service';
import { runResearch } from './research';

// Validação AO VIVO contra o OpenRouter — pulada por padrão (custa créditos).
// Rodar com:  LIVE_OPENROUTER_KEY=sk-or-... npx vitest run src/ai/live.test.ts
//        ou:  LIVE_ENV_FILE=caminho/.env (lê a linha OPENROUTER=)
// Opcional:   LIVE_MODEL=openai/gpt-6.1-sol (padrão = default do OpenRouter)
function readKey(): string | undefined {
  if (process.env.LIVE_OPENROUTER_KEY) return process.env.LIVE_OPENROUTER_KEY;
  const file = process.env.LIVE_ENV_FILE;
  if (!file || !existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('OPENROUTER='));
  return line?.slice('OPENROUTER='.length).trim().replace(/^["']|["']$/g, '') || undefined;
}
const key = readKey();
const model = process.env.LIVE_MODEL ?? PROVIDER_DEFAULTS.openrouter.mainModel;

describe.skipIf(!key)(`IA ao vivo (${model})`, () => {
  beforeAll(() => {
    useLocaleStore.getState().setLocale('pt-BR');
    useConfigStore.getState().saveProviderConfig('openrouter', {
      apiKey: key!,
      ...PROVIDER_DEFAULTS.openrouter,
      mainModel: model,
    });
    useConfigStore.getState().setActiveProvider('openrouter');
  });

  const ctxBase = {
    projectName: 'Drone FPV',
    projectObjective: 'Montar meu primeiro drone FPV 5 polegadas para voar no parque',
    breadcrumb: ['Drone FPV', 'Execução'],
    siblings: [{ name: 'Comprar peças', fx: 'nada → peças em mãos' }],
    strategy: 'reaproveitar' as const,
    archetype: 'construir' as const,
    rules: ['orçamento máximo R$ 1500'],
  };

  it('generatePlans → planos válidos', async () => {
    const phases: PlanProgressEvent['phase'][] = [];
    const t0 = Date.now();
    const plans = await generatePlans(
      ctxBase.projectObjective,
      (ev) => {
        if (phases.at(-1) !== ev.phase) phases.push(ev.phase);
      },
      undefined,
      ctxBase.rules,
    );
    const ms = Date.now() - t0;
    const nodes = plans.flatMap((p) => p.tree.categorias.flatMap((c) => c.children));
    const hints = nodes.flatMap((n) => n.groundTruthHints ?? []);
    console.log(
      `[live] generatePlans ${ms}ms · ${plans.length} planos · ${nodes.length} nós · ${hints.length} âncoras · fases ${phases.join('>')}`,
    );
    console.log('[live] estimates', JSON.stringify(plans.map((p) => p.estimates)));
    console.log('[live] rulesCheck', JSON.stringify(plans.map((p) => p.rulesCheck)));
    console.log('[live] comoConfirmar', JSON.stringify(nodes.slice(0, 6).map((n) => n.comoConfirmar)));
    console.log('[live] confidence', JSON.stringify(nodes.map((n) => n.confidence)));
    expect(plans.length).toBeGreaterThan(0);
    expect(hints.some((h) => h.kind === 'link')).toBe(false);
    expect(nodes.every((n) => (n.groundTruthHints?.length ?? 0) <= 2)).toBe(true);
  }, 300_000);

  // Planejamento em duas fases: mede o primeiro parcial e o total de cada
  // fase. Opcional: LIVE_OUTLINE_EFFORT=low|medium|high|model (model = padrão
  // do modelo) e LIVE_EXPAND_EFFORT idem.
  it('outlinePlans + expandPlan → tempos e árvore', async () => {
    const effortEnv = (v: string | undefined) =>
      v === 'model' ? null : (v as 'low' | 'medium' | 'high' | undefined);
    const t0 = Date.now();
    let firstChunk = 0;
    let firstCard = 0;
    const phases: string[] = [];
    const outlines = await outlinePlans(
      ctxBase.projectObjective,
      (ev) => {
        if (phases.at(-1) !== ev.phase) phases.push(ev.phase);
        if (ev.phase === 'streaming' && !firstChunk) firstChunk = Date.now() - t0;
        // Primeiro card "mostrável": título + ao menos uma categoria com nós.
        if (!firstCard && (ev.partial?.plans?.length ?? 0) > 1) firstCard = Date.now() - t0;
      },
      undefined,
      ctxBase.rules,
      undefined,
      { effort: effortEnv(process.env.LIVE_OUTLINE_EFFORT) },
    );
    const outlineMs = Date.now() - t0;
    console.log(
      `[live] outlinePlans total ${outlineMs}ms · 1º parcial ${firstChunk}ms · 1º card completo ${firstCard}ms · ${outlines.length} esboços · fases ${phases.join('>')}`,
    );
    for (const o of outlines) {
      console.log(
        `[live]  #${o.rank} ${o.strategy} "${o.title}" · ${o.estimates?.custo} · ${o.estimates?.tempo} · ${countOutlineNodes(o)} nós`,
      );
      console.log(
        `[live]    ${o.outline.categorias.map((c) => `${c.name}: ${c.nodes.map((n) => n.name).join(' | ')}`).join(' // ')}`,
      );
    }
    expect(outlines.length).toBeGreaterThan(0);

    const chosen = [...outlines].sort((a, b) => a.rank - b.rank)[0];
    const t1 = Date.now();
    let firstExpand = 0;
    let firstNode = 0;
    let lastReady = 0;
    const plan = await expandPlan(
      ctxBase.projectObjective,
      chosen,
      (ev) => {
        if (ev.phase === 'streaming' && !firstExpand) firstExpand = Date.now() - t1;
        if ((ev.nodesReady ?? 0) > 0 && !firstNode) firstNode = Date.now() - t1;
        lastReady = ev.nodesReady ?? lastReady;
      },
      undefined,
      ctxBase.rules,
      { research: null, effort: effortEnv(process.env.LIVE_EXPAND_EFFORT) },
    );
    const expandMs = Date.now() - t1;
    const nodes = plan.tree.categorias.flatMap((c) => c.children);
    console.log(
      `[live] expandPlan total ${expandMs}ms · 1º parcial ${firstExpand}ms · 1º nó completo ${firstNode}ms · ${nodes.length} nós (esboço ${countOutlineNodes(chosen)}, último nodesReady ${lastReady})`,
    );
    console.log(`[live]  nomes ${JSON.stringify(nodes.map((n) => n.name))}`);
    console.log(`[live]  comoConfirmar ${JSON.stringify(nodes.slice(0, 4).map((n) => n.comoConfirmar))}`);
    console.log(`[live]  oQue ${JSON.stringify(nodes.slice(0, 3).map((n) => n.oQue))}`);
    console.log(`[live] TOTAL duas fases ${outlineMs + expandMs}ms`);
    expect(plan.id).toBe(chosen.id);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.flatMap((n) => n.groundTruthHints ?? []).some((h) => h.kind === 'link')).toBe(false);
  }, 400_000);

  it('decomposeNode → nós válidos', async () => {
    const t0 = Date.now();
    const res = await decomposeNode({
      ...ctxBase,
      nodeName: 'Soldar ESC e controladora',
      nodeKind: 'passo',
      nodeFx: 'peças soltas → eletrônica soldada',
      oQue: 'Soldar o ESC 4-em-1 na controladora (stack 30x30) e o XT60 nos pads de bateria.',
      comoConfirmar: 'Multímetro em continuidade entre BAT+ e BAT−: não apita.',
      knownElsewhere: ['Estanhar fios'],
    });
    console.log(`[live] decomposeNode ${Date.now() - t0}ms · ${res.nodes.length} nós · ${res.edges.length} arestas`);
    console.log('[live] decompose nomes', JSON.stringify(res.nodes.map((n) => n.name)));
    expect(res.nodes.length).toBeGreaterThan(0);
  }, 180_000);

  it('replanFromFailure → diagnóstico + nós', async () => {
    const t0 = Date.now();
    const res = await replanFromFailure({
      ...ctxBase,
      nodeName: 'Vincular rádio ao receptor',
      nodeKind: 'passo',
      nodeFx: 'rádio e receptor separados → vinculados',
      oQue: 'Entrar em modo bind no receptor ELRS e no rádio.',
      failureContext: 'O LED do receptor fica piscando rápido e nunca vincula. Versões do ELRS diferentes?',
      currentChildren: [{ name: 'Apertar bind no rádio', oQue: 'menu ELRS → Bind', state: 'problem' }],
      comoConfirmar: 'LED do receptor fica sólido.',
    });
    console.log(`[live] replan ${Date.now() - t0}ms · diagnosis="${res.diagnosis}" · ${res.nodes.length} nós`);
    expect(res.nodes.length).toBeGreaterThan(0);
    expect(res.diagnosis).toBeTruthy();
  }, 180_000);

  it('runResearch → digest com fontes reais (modelo de pesquisa)', async () => {
    const t0 = Date.now();
    const digest = await runResearch('Conector XT60 especificação de corrente', 'datasheet oficial');
    console.log(`[live] research ${Date.now() - t0}ms · ${digest.sources.length} fontes · ${digest.findings.length} chars`);
    expect(digest.findings.length).toBeGreaterThan(0);
  }, 180_000);

  it('explainNode (stream) e critiqueNode', async () => {
    let deltas = 0;
    const t0 = Date.now();
    const text = await explainNode(
      {
        ...ctxBase,
        nodeName: 'Soldar XT60',
        nodeKind: 'passo',
        oQue: 'Soldar o conector XT60 nos pads de bateria do ESC.',
        porQue: 'Sem ele o drone não recebe energia.',
        comoConfirmar: 'CRITERIO-IA',
        criterionLocked: false,
      },
      { onDelta: () => deltas++ },
    );
    console.log(`[live] explain ${Date.now() - t0}ms · ${text.length} chars · ${deltas} deltas`);
    expect(text.length).toBeGreaterThan(100);

    const t1 = Date.now();
    const crit = await critiqueNode({
      ...ctxBase,
      nodeName: 'Soldar XT60',
      nodeKind: 'passo',
      nodeFx: 'sem conector → conector soldado',
      oQue: 'Soldar o conector XT60 nos pads de bateria do ESC.',
      porQue: 'Sem ele o drone não recebe energia.',
      comoConfirmar: 'Conector firme?',
    });
    console.log(`[live] critique ${Date.now() - t1}ms · ${crit.fraquezas.length} fraquezas`);
    expect(crit.criterioAlternativo).toBeTruthy();
  }, 240_000);
});
