import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';

const holder = vi.hoisted(() => ({ model: null as unknown as Record<string | symbol, unknown> }));
vi.mock('./client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./client')>();
  return {
    ...real, assertAIReady: () => {},
    currentModelIds: () => ({ main: 'openai/gpt-6.1-sol', kb: 'kb', provider: 'openrouter' }),
    aiModel: new Proxy({}, {
      get: (_target, prop) => {
        const value = holder.model[prop];
        return typeof value === 'function' ? value.bind(holder.model) : value;
      },
    }),
  };
});

import { critiqueNode, decomposeNode, replanFromFailure } from './service';

const context = {
  projectName: 'Synthetic arm test', projectObjective: 'Investigate position control', breadcrumb: ['Arm', 'Servo'],
  nodeName: 'Servo', nodeKind: 'recurso' as const, nodeFx: 'command → position',
  oQue: 'The servo moves the arm.', siblings: [],
};
const research = {
  query: 'servo', findings: 'A retrieved digest claims the servo can hold this load.', searchedAt: 1,
  sources: [{ url: 'https://maker.example/servo', title: 'Servo family documentation' }],
};
function reply(object: unknown) {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify(object) }], warnings: [],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
    }),
  });
  holder.model = model as unknown as Record<string | symbol, unknown>;
  return model;
}

const suggestedNode = {
  tempId: 'a', kind: 'passo', name: 'Identificar documentação', fx: 'unknown → documented', confidence: 50,
  confidenceReason: 'Requires checking', oQue: 'Obter documentação da variante.', porQue: 'Determina como verificar.',
  comoConfirmar: 'Documento identificado pelo código da variante.', ruleConflict: null, order: 1,
  decisionOptions: null, groundTruthHints: [],
};

describe('criterion availability and independent outcomes', () => {
  it('does not assume diagnostic software or a threshold when the controller protocol is unknown', async () => {
    const model = reply({ nodes: [suggestedNode], edges: [] });
    const result = await decomposeNode({
      ...context, nodeName: 'Controlador', oQue: 'UNKNOWN: variante, protocolo, software e procedimento de diagnóstico.',
      comoConfirmarUsuario: 'Meu critério próprio ainda precisa de um método documentado.',
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain('Do not assume a procedure, instrument or software is available or documented');
    expect(prompt).toContain('never invent a threshold or replace the user');
    expect(prompt).toContain('Meu critério próprio ainda precisa de um método documentado.');
    expect(result.nodes[0].comoConfirmar).toBe('Documento identificado pelo código da variante.');
  });

  it('requires independent objectives to be split instead of using a filled form as proof of the result', async () => {
    const model = reply({ nodes: [suggestedNode], edges: [] });
    await decomposeNode({
      ...context, nodeKind: 'passo', nodeName: 'Confirmar variante e desempenho',
      oQue: 'Identificar a variante correta e verificar o desempenho pretendido.',
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain('If a node name joins independent objectives, split them into separate nodes');
    expect(prompt).toContain('never use filled fields or a completed checklist as proof of the intended result');
  });
});

describe('evidence policy sent to the planning model', () => {
  it('asks for a discriminating measurement when servo tremor does not establish its cause', async () => {
    const diagnosis = 'Causa indeterminada; qual a tensão no servo durante o tremor?';
    const model = reply({ diagnosis, nodes: [], edges: [] });
    const result = await replanFromFailure({
      ...context, failureContext: 'O servo treme.',
      currentChildren: [
        { name: 'Conferir alimentação', oQue: 'Etapa existente.', state: 'done' },
        { name: 'Conferir sinal', oQue: 'Etapa existente.', state: 'concept' },
      ],
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain('cause is undetermined');
    expect(prompt).toContain('discriminating measurement');
    expect(prompt).toContain('Preserve useful existing parts');
    expect(prompt).toContain('Conferir alimentação [done]');
    expect(prompt).toContain('Conferir sinal [concept]');
    expect(prompt).not.toContain('failed — do not reuse these');
    expect(prompt).not.toContain('assume part of the premise was wrong');
    expect(result).toEqual({ diagnosis, nodes: [], edges: [] });
  });

  it('does not turn missing verification or a stored criterion into proof of a false premise', async () => {
    const model = reply({ diagnosis: 'Ainda faltam observações discriminantes.', nodes: [], edges: [] });
    await replanFromFailure({
      ...context, failureContext: 'Não funcionou como esperado.',
      comoConfirmar: 'Critério próprio registrado antes do ensaio.', failedAnchors: ['Modelo ainda não conferido'],
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain('lack of verification does not establish falsity');
    expect(prompt).toContain('Compare with the reported observation');
    expect(prompt).toContain('Critério próprio registrado antes do ensaio.');
    expect(prompt).not.toContain('ANCHORS THAT PROVED FALSE');
    expect(prompt).not.toContain('ORIGINAL CONFIRMATION CRITERION (was not met)');
  });

  it('requires evidence before naming a contradicted premise and keeps documentary claims distinct from observations', async () => {
    const model = reply({ diagnosis: 'Ainda não foi determinada a causa.', nodes: [], edges: [] });
    await replanFromFailure({ ...context, failureContext: 'O servo treme.', research });
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain('only when supplied evidence contradicts it');
    expect(prompt).toContain('not physical observations');
    expect(prompt).not.toContain('facts and URLs are REAL, verified sources');
  });

  it('gives the critic documentary context without presenting it as a physical observation or established fact', async () => {
    const model = reply({ fraquezas: ['Variante pendente.'], premissasOcultas: ['Carga desconhecida.'], criterioAlternativo: 'Formule e registre o ensaio.' });
    const result = await critiqueNode({ ...context, porQue: 'Investigar controle.', comoConfirmar: '', research });
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toContain('documentary claims, not physical observations');
    expect(prompt).toContain('Check source applicability and variant');
    expect(prompt).not.toContain('Weigh the WEB RESEARCH facts above');
    expect(prompt).not.toContain('facts and URLs are REAL, verified sources');
    expect(result.fontes).toEqual(research.sources);
  });

  it('keeps the source URL allowlist after removing research authority claims', async () => {
    reply({ nodes: [{
      tempId: 'a', kind: 'recurso', name: 'Servo', fx: 'command → position', confidence: 50,
      confidenceReason: 'Requires checking', oQue: 'Servo to investigate', porQue: 'Controls position',
      comoConfirmar: 'Observe the selected criterion.', ruleConflict: null, order: null, decisionOptions: null,
      groundTruthHints: [
        { kind: 'link', label: 'Retrieved source', value: 'https://maker.example/servo' },
        { kind: 'link', label: 'Invented source', value: 'https://unlisted.example/servo' },
      ],
    }], edges: [] });
    const result = await decomposeNode({ ...context, research });
    expect(result.nodes[0].groundTruthHints).toEqual([
      { kind: 'link', label: 'Retrieved source', value: 'https://maker.example/servo' },
    ]);
  });
});
