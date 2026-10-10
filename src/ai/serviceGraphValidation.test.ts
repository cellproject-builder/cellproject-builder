import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import type { EdgeKind } from '@/types';

// Only the external model is replaced; response validation and materialization stay real.
const holder = vi.hoisted(() => ({ model: null as unknown as Record<string | symbol, unknown> }));
vi.mock('./client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./client')>();
  return {
    ...real,
    assertAIReady: () => {},
    currentModelIds: () => ({ main: 'openai/gpt-6.1-sol', kb: 'kb', provider: 'openrouter' }),
    aiModel: new Proxy({}, {
      get: (_target, prop) => {
        const value = holder.model[prop];
        return typeof value === 'function' ? value.bind(holder.model) : value;
      },
    }),
  };
});

import { decomposeNode, replanFromFailure } from './service';

const context = {
  projectName: 'Bench robot', projectObjective: 'Assemble and test the arm', breadcrumb: ['Arm'],
  nodeName: 'Control', nodeKind: 'passo' as const, nodeFx: 'command → movement', siblings: [],
  oQue: 'Connect the controller to the arm.',
};
const node = (tempId: string, name = tempId) => ({
  tempId, name, kind: 'passo', fx: 'before → after', confidence: 60, confidenceReason: 'Needs a bench test',
  oQue: name, porQue: 'Required for the test', comoConfirmar: 'Observe one completed movement.',
  ruleConflict: null, order: 1, decisionOptions: null, groundTruthHints: [],
});
const edge = (sourceTempId: string, targetTempId: string, kind: EdgeKind = 'direct') => ({
  sourceTempId, targetTempId, kind, note: null,
});
function reply(nodes: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[]) {
  holder.model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ nodes, edges, diagnosis: 'Measure before changing parts.' }) }],
      finishReason: { unified: 'stop', raw: 'stop' }, warnings: [],
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
    }),
  }) as unknown as Record<string | symbol, unknown>;
}

describe('suggestion graph integrity at the model boundary', () => {
  it.each(['decompose', 'replan'] as const)('rejects duplicate node IDs in %s rather than returning ambiguous suggestions', async (flow) => {
    reply([node('a', 'Check supply'), node('a', 'Check signal')], []);
    const result = flow === 'decompose'
      ? decomposeNode(context)
      : replanFromFailure({ ...context, failureContext: 'The arm did not move.' });
    await expect(result).rejects.toMatchObject({ info: { kind: 'schema' } });
  });

  it('rejects a blank node ID instead of inventing an identity for it', async () => {
    reply([node('  ', 'Check supply')], []);
    await expect(decomposeNode(context)).rejects.toMatchObject({ info: { kind: 'schema' } });
  });

  it.each(['direct', 'middleware', 'independent', 'optional'] as const)('rejects a %s self-edge', async (kind) => {
    reply([node('a')], [edge('a', 'a', kind)]);
    await expect(decomposeNode(context)).rejects.toMatchObject({ info: { kind: 'schema' } });
  });

  it('rejects a two-node dependency cycle as a whole batch', async () => {
    reply([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]);
    await expect(decomposeNode(context)).rejects.toMatchObject({ info: { kind: 'schema' } });
  });

  it('rejects a dependency cycle disconnected from an otherwise valid chain', async () => {
    reply([node('a'), node('b'), node('c'), node('d'), node('e')], [
      edge('a', 'b'), edge('c', 'd'), edge('d', 'e'), edge('e', 'c'),
    ]);
    await expect(replanFromFailure({ ...context, failureContext: 'The arm did not move.' }))
      .rejects.toMatchObject({ info: { kind: 'schema' } });
  });

  it('preserves a valid dependency diamond with shared prerequisites', async () => {
    reply([node('a'), node('b'), node('c'), node('d')], [
      edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd'),
    ]);
    const result = await decomposeNode(context);
    const [a, b, c, d] = result.nodes.map(item => item.tempId);
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(result.edges).toEqual([
      { sourceTempId: a, targetTempId: b, kind: 'direct', note: undefined },
      { sourceTempId: a, targetTempId: c, kind: 'direct', note: undefined },
      { sourceTempId: b, targetTempId: d, kind: 'direct', note: undefined },
      { sourceTempId: c, targetTempId: d, kind: 'direct', note: undefined },
    ]);
  });

  it('keeps discarding edges with absent endpoints without dropping valid nodes or edges', async () => {
    reply([node('a'), node('b')], [edge('a', 'missing'), edge('missing', 'a'), edge('a', 'b')]);
    const result = await decomposeNode(context);
    expect(result.nodes.map(item => item.name)).toEqual(['a', 'b']);
    expect(result.edges).toEqual([{
      sourceTempId: result.nodes[0].tempId, targetTempId: result.nodes[1].tempId,
      kind: 'direct', note: undefined,
    }]);
  });

  it('does not turn other relation kinds into ordered dependencies', async () => {
    reply([node('a'), node('b'), node('c')], [
      edge('a', 'b'), edge('b', 'c', 'optional'), edge('c', 'a', 'independent'), edge('b', 'a', 'middleware'),
    ]);
    const result = await replanFromFailure({ ...context, failureContext: 'The arm did not move.' });
    expect(result.nodes).toHaveLength(3);
    expect(result.edges.map(item => item.kind)).toEqual(['direct', 'optional', 'independent', 'middleware']);
    expect(result.diagnosis).toBe('Measure before changing parts.');
  });
});
