import 'fake-indexeddb/auto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runQualityBattery } from '../../../scripts/planning-quality-runner';

// Scripted provider responses exercise the REAL service and SDK transport.
// This is a harness integration test, never model quality evidence.
describe('production service rehearsal with scripted HTTP only', () => {
  it('preserves raw first output while recording service normalization and context propagation', async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'plan-quality-'));
    const output = path.join(temporary, 'run');
    const original = globalThis.fetch;
    const requestBodies: any[] = [];
    const header = { title: 'Placa e cabo', pitch: 'Identificar antes de conectar', approach: 'Comparar interfaces.', strategy: 'reaproveitar', archetype: 'construir', rank: 1, rankReason: 'Identificação primeiro.', estimates: { custo: 'R$ 20', tempo: '1 hora', dificuldade: 'iniciante' }, rulesCheck: [] };
    const node = { tempId: 'n1', kind: 'recurso', name: 'Arduino e cabo', fx: 'Modelo desconhecido → identificado', confidence: 120, confidenceReason: 'Primeira resposta sintética.', oQue: 'Identificar a placa e o cabo.', porQue: 'A interface é desconhecida.', comoConfirmar: 'Registrar o modelo legível da placa.', ruleConflict: null, order: null, decisionOptions: null, groundTruthHints: [{ kind: 'link', label: 'URL não pesquisada', value: 'https://invented.invalid/' }] };
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/models')) return Response.json({ data: [{ id: 'test/scripted', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['structured_outputs'] }] });
      const body = JSON.parse(init?.body as string); requestBodies.push(body);
      const payload = requestBodies.length === 1 ? { plans: [{ ...header, outline: { categorias: [{ name: 'Recursos', kind: 'recursos', nodes: [{ name: node.name, kind: 'recurso' }] }] } }] }
        : requestBodies.length === 2 ? { categorias: [{ tempId: 'cat', name: 'Recursos', kind: 'recursos', oQue: 'Material', porQue: 'Necessário', children: [node] }] } : { nodes: [node], edges: [] };
      const text = JSON.stringify(payload);
      const usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0 };
      if (!body.stream) return Response.json({ id: 'scripted', object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage });
      return new Response(`data: ${JSON.stringify({ id: 'scripted', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'scripted', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    };
    try {
      const manifest = await runQualityBattery({ live: true, apiKey: 'test-not-a-key', model: 'test/scripted', cases: ['arduino-and-cable'], output });
      expect(manifest.requests).toBe(3); expect(manifest.completedStages).toBe(3); expect(manifest.actualCostUsd).toBe(0);
      const raw = JSON.parse(await readFile(path.join(output, 'attempt-02.json'), 'utf8'));
      const expanded = JSON.parse(await readFile(path.join(output, 'arduino-and-cable-expand.json'), 'utf8'));
      expect(raw.responseText).toContain('invented.invalid'); expect(raw.responseText).toContain('120');
      expect(expanded.output.tree.categorias[0].children[0].confidence).toBe(100);
      expect(expanded.output.tree.categorias[0].children[0].groundTruthHints).toBeUndefined();
      expect(JSON.stringify(requestBodies[2].messages)).toContain('REST OF THE PLAN');
      expect(JSON.stringify(requestBodies[2].messages)).toContain('NEW CREATION');
      expect(await readFile(path.join(output, 'manifest.json'), 'utf8')).not.toContain('test-not-a-key');
    } finally { globalThis.fetch = original; await rm(temporary, { recursive: true, force: true }); }
  });

  it('skips provider metadata and paid transport entirely by default', async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'plan-quality-offline-'));
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network_must_not_run'); };
    try {
      const result = await runQualityBattery({ live: false, output: path.join(temporary, 'run') });
      expect(result.requests).toBe(0); expect(result.mode).toBe('offline-protocol-only');
      await expect(runQualityBattery({ live: false, output: path.join(temporary, 'run') })).rejects.toThrow();
    } finally { globalThis.fetch = original; await rm(temporary, { recursive: true, force: true }); }
  });
});
