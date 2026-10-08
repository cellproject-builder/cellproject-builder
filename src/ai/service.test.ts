import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APICallError, NoObjectGeneratedError, RetryError } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';

// O modelo é trocado por um mock — nada sai pra rede. Os testes cobrem o
// contrato do service: normalização null→undefined, política de âncoras,
// recuperação parcial, cancelamento e classificação de erros.
const holder = vi.hoisted(() => ({ model: null as unknown as Record<string | symbol, unknown> }));

vi.mock('./client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./client')>();
  return {
    ...real,
    assertAIReady: () => {},
    currentModelIds: () => ({ main: 'openai/gpt-6.1-sol', kb: 'kb', provider: 'openrouter' }),
    aiModel: new Proxy(
      {},
      {
        get: (_t, prop) => {
          const v = holder.model[prop];
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(holder.model) : v;
        },
      },
    ),
  };
});

import {
  generatePlans,
  decomposeNode,
  explainNode,
  replanFromFailure,
  classifyAIError,
  AIError,
  type PlanProgressEvent,
} from './service';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

function textStream(chunks: string[], finish: 'stop' | 'length' = 'stop', delayMs = 0) {
  const parts: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    ...chunks.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: finish, raw: finish }, usage },
  ];
  return new ReadableStream<LanguageModelV3StreamPart>({
    async start(c) {
      // Atraso só antes do primeiro pedaço de texto (modelo "pensando").
      for (const p of parts) {
        if (delayMs && p.type === 'text-delta' && p === parts[2]) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
        c.enqueue(p);
      }
      c.close();
    },
  });
}

function useStreamModel(chunks: string[], finish: 'stop' | 'length' = 'stop', delayMs = 0) {
  const model = new MockLanguageModelV3({
    doStream: async () => ({ stream: textStream(chunks, finish, delayMs) }),
  });
  holder.model = model as unknown as Record<string | symbol, unknown>;
  return model;
}

function useGenerateModel(json: unknown) {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify(json) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    }),
  });
  holder.model = model as unknown as Record<string | symbol, unknown>;
  return model;
}

function node(tempId: string, extra: Record<string, unknown> = {}) {
  return {
    tempId,
    kind: 'recurso',
    name: `Nó ${tempId}`,
    fx: 'antes → depois',
    confidence: 72.4,
    confidenceReason: 'motivo',
    oQue: 'o que',
    porQue: 'por que',
    comoConfirmar: 'Multímetro: não apita.',
    ruleConflict: null,
    order: null,
    decisionOptions: null,
    groundTruthHints: [],
    ...extra,
  };
}

function plan(title: string, rank: number) {
  return {
    title,
    pitch: 'pitch',
    approach: 'approach',
    strategy: 'reaproveitar',
    archetype: 'construir',
    rank,
    rankReason: 'motivo',
    estimates: { custo: 'R$ 100–200', tempo: '1 fim de semana', dificuldade: 'iniciante' },
    rulesCheck: [],
    tree: {
      categorias: [
        {
          tempId: 'cat1',
          name: 'Recursos',
          kind: 'recursos',
          oQue: 'o',
          porQue: 'p',
          children: [
            node('r1', {
              ruleConflict: 'Viola orçamento: ~R$420',
              groundTruthHints: [
                { kind: 'link', label: 'site', value: 'https://example.com/tutorial' },
                { kind: 'spec', label: 'conector', value: 'XT60' },
                { kind: 'medida', label: 'peso', value: '< 15g' },
                { kind: 'spec', label: 'extra', value: 'ESP32' },
              ],
            }),
            node('r2', { kind: 'passo', order: 2 }),
          ],
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('generatePlans', () => {
  it('hidrata planos: null→undefined, sem link sem pesquisa, no máx. 2 âncoras', async () => {
    const json = JSON.stringify({ plans: [plan('A', 1), plan('B', 2), plan('C', 3)] });
    useStreamModel([json.slice(0, 200), json.slice(200)]);
    const events: PlanProgressEvent[] = [];
    const plans = await generatePlans('objetivo', (ev) => events.push(ev));

    expect(plans).toHaveLength(3);
    const r1 = plans[0].tree.categorias[0].children[0];
    expect(r1.groundTruthHints?.some((h) => h.kind === 'link')).toBe(false);
    expect(r1.groundTruthHints?.length).toBeLessThanOrEqual(2);
    expect(r1.order).toBeUndefined();
    expect(r1.decisionOptions).toBeUndefined();
    expect(r1.confidence).toBe(72);
    expect(r1.cons).toEqual(['Viola orçamento: ~R$420']);
    expect(plans[0].tree.categorias[0].children[1].order).toBe(2);
    expect(plans[0].estimates?.dificuldade).toBe('iniciante');

    expect(events.every((e) => typeof e.startedAt === 'number')).toBe(true);
    expect(events.at(-1)?.phase).toBe('done');
  });

  it('recupera planos completos quando o JSON final não fecha', async () => {
    const full = JSON.stringify({ plans: [plan('A', 1), plan('B', 2), plan('C', 3)] });
    // Corta no meio do terceiro plano — como um maxOutputTokens estourado.
    const cut = full.slice(0, full.lastIndexOf('"title":"C"') + 40);
    useStreamModel([cut], 'length');
    const events: PlanProgressEvent[] = [];
    const plans = await generatePlans('objetivo', (ev) => events.push(ev));

    expect(plans.map((p) => p.title)).toEqual(['A', 'B']);
    const done = events.at(-1);
    expect(done?.phase).toBe('done');
    expect(done?.warning).toMatch(/1/);
  });

  it('emite "thinking" quando nada chega logo após conectar', async () => {
    const json = JSON.stringify({ plans: [plan('A', 1)] });
    // O primeiro pedaço demora mais que o limiar de "pensando".
    useStreamModel([json], 'stop', 1500);
    const phases: string[] = [];
    await generatePlans('objetivo', (ev) => phases.push(ev.phase));
    expect(phases).toContain('thinking');
    expect(phases.indexOf('thinking')).toBeGreaterThan(phases.indexOf('connecting'));
  });

  it('abortar o signal cancela em <1s com kind "aborted"', async () => {
    const model = new MockLanguageModelV3({
      // Stream que nunca entrega nada — simula o modelo raciocinando.
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
          },
        }),
      }),
    });
    holder.model = model as unknown as Record<string | symbol, unknown>;
    const ctrl = new AbortController();
    const t0 = Date.now();
    setTimeout(() => ctrl.abort(), 50);
    const err = await generatePlans('objetivo', undefined, undefined, undefined, undefined, {
      signal: ctrl.signal,
    }).catch((e) => e);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(err).toBeInstanceOf(AIError);
    expect((err as AIError).info.kind).toBe('aborted');
    expect(model.doStreamCalls[0].abortSignal?.aborted).toBe(true);
  });

  it('estoura o timeout com kind "timeout"', async () => {
    holder.model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV3StreamPart>({ start() {} }),
      }),
    }) as unknown as Record<string | symbol, unknown>;
    const err = await generatePlans('objetivo', undefined, undefined, undefined, undefined, {
      timeoutMs: 60,
    }).catch((e) => e);
    expect((err as AIError).info.kind).toBe('timeout');
  });

  it('aceita kbContext como Promise (seleção da base em paralelo)', async () => {
    const model = useStreamModel([JSON.stringify({ plans: [plan('A', 1)] })]);
    const kb = Promise.resolve([
      { docId: 'doc1', titulo: 'Manual', dominio: 'drones', resumo: ['r'], fatos: [] },
    ]);
    await generatePlans('objetivo', undefined, kb as never);
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain('[doc1]');
  });
});

describe('decomposeNode / replanFromFailure', () => {
  const base = {
    projectName: 'P',
    projectObjective: 'objetivo',
    breadcrumb: ['Raiz'],
    nodeName: 'Conferir alimentação',
    nodeKind: 'passo' as const,
    nodeFx: 'fiação → conferida',
    siblings: [],
  };

  it('manda o conteúdo do nó e o que o usuário já sabe; filtra link sem pesquisa', async () => {
    const model = useGenerateModel({
      nodes: [
        node('a', {
          groundTruthHints: [{ kind: 'link', label: 'x', value: 'https://betaflight.com/docs' }],
        }),
      ],
      edges: [{ sourceTempId: 'a', targetTempId: 'zz', kind: 'direct', note: null }],
    });
    const res = await decomposeNode({
      ...base,
      oQue: 'XT60 positivo→BAT+',
      comoConfirmar: 'critério da IA',
      comoConfirmarUsuario: 'critério do usuário',
      knownElsewhere: ['Soldar fios'],
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain('NODE CONTENT');
    expect(prompt).toContain('XT60 positivo');
    expect(prompt).toContain('critério do usuário');
    expect(prompt).toContain('USER ALREADY KNOWS');
    expect(prompt).toContain('Soldar fios');
    expect(res.nodes[0].groundTruthHints).toBeUndefined();
    expect(res.edges).toHaveLength(0);
  });

  it('com pesquisa, só aceita link da lista de fontes e sem repetir', async () => {
    useGenerateModel({
      nodes: [
        node('a', {
          groundTruthHints: [
            { kind: 'link', label: 'ok', value: 'https://real.example/doc/' },
            { kind: 'link', label: 'inventado', value: 'https://fake.example' },
          ],
        }),
        node('b', {
          groundTruthHints: [{ kind: 'link', label: 'repetido', value: 'https://real.example/doc' }],
        }),
      ],
      edges: [],
    });
    const res = await decomposeNode({
      ...base,
      research: {
        query: 'q',
        findings: 'fatos',
        sources: [{ url: 'https://real.example/doc', title: 'Doc' }],
        searchedAt: 0,
      },
    });
    expect(res.nodes[0].groundTruthHints).toEqual([
      { kind: 'link', label: 'ok', value: 'https://real.example/doc' },
    ]);
    expect(res.nodes[1].groundTruthHints).toBeUndefined();
  });

  it('replan mostra a decomposição anterior e devolve o diagnóstico', async () => {
    const model = useGenerateModel({
      diagnosis: 'O conector não era XT60.',
      nodes: [node('a')],
      edges: [],
    });
    const res = await replanFromFailure({
      ...base,
      oQue: 'o que',
      failureContext: 'não ligou',
      currentChildren: [{ name: 'Filho velho', oQue: 'velho', state: 'problem' }],
      failedAnchors: ['XT90'],
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain('PREVIOUS DECOMPOSITION');
    expect(prompt).toContain('Filho velho');
    expect(prompt).toContain('XT90');
    expect(res.diagnosis).toBe('O conector não era XT60.');
    expect(res.nodes).toHaveLength(1);
  });
});

describe('explainNode', () => {
  const ctx = {
    projectName: 'P',
    projectObjective: 'objetivo',
    breadcrumb: [],
    nodeName: 'Soldar',
    nodeKind: 'passo' as const,
    oQue: 'o que',
    porQue: 'por que',
    comoConfirmar: 'CRITERIO-DA-IA-SECRETO',
  };

  it('sem critério travado, o critério da IA não vai pro prompt', async () => {
    const model = useStreamModel(['**O QUE É**', '\n- texto']);
    const deltas: string[] = [];
    const text = await explainNode(ctx, { onDelta: (s) => deltas.push(s) });
    const call = JSON.stringify(model.doStreamCalls[0].prompt);
    expect(call).not.toContain('CRITERIO-DA-IA-SECRETO');
    expect(text).toBe('**O QUE É**\n- texto');
    expect(deltas.at(-1)).toBe('**O QUE É**\n- texto');
  });

  it('com critério travado, usa o do usuário', async () => {
    const model = useStreamModel(['ok']);
    await explainNode({ ...ctx, criterionLocked: true, comoConfirmarUsuario: 'CRITERIO-USUARIO' });
    const call = JSON.stringify(model.doStreamCalls[0].prompt);
    expect(call).toContain('CRITERIO-USUARIO');
    expect(call).not.toContain('CRITERIO-DA-IA-SECRETO');
  });
});

describe('classifyAIError', () => {
  const apiError = (statusCode: number, body: unknown) =>
    new APICallError({
      message: 'Provider returned error',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      requestBodyValues: {},
      statusCode,
      responseBody: JSON.stringify(body),
    });

  it('400 invalid schema → schema', () => {
    const info = classifyAIError(
      apiError(400, {
        error: { message: "Invalid schema for response_format 'PlansResponse': ...", code: 400 },
      }),
    );
    expect(info.kind).toBe('schema');
    expect(info.detail).toContain('response_format');
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [402, 'credits'],
    [404, 'model'],
    [429, 'rate'],
    [500, 'unknown'],
  ])('%i → %s', (status, kind) => {
    expect(classifyAIError(apiError(status, { error: { message: 'x' } })).kind).toBe(kind);
  });

  it('RetryError embrulhando 429 → rate', () => {
    const err = new RetryError({
      message: 'retry',
      reason: 'maxRetriesExceeded',
      errors: [apiError(429, {}), apiError(429, {})],
    });
    expect(classifyAIError(err).kind).toBe('rate');
  });

  it('AbortError → aborted; TimeoutError → timeout', () => {
    expect(classifyAIError(new DOMException('x', 'AbortError')).kind).toBe('aborted');
    expect(classifyAIError(new DOMException('x', 'TimeoutError')).kind).toBe('timeout');
  });

  it('NoObjectGeneratedError → schema', () => {
    const err = new NoObjectGeneratedError({
      message: 'no object',
      text: '{',
      response: { id: '1', timestamp: new Date(), modelId: 'm' },
      usage: {
        inputTokens: 1,
        inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokens: 1,
        outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
        totalTokens: 2,
      },
      finishReason: 'length',
    });
    expect(classifyAIError(err).kind).toBe('schema');
  });

  it('falha de rede → network', () => {
    expect(classifyAIError(new TypeError('Failed to fetch')).kind).toBe('network');
  });
});
