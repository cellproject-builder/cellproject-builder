import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generationSceneSchema, sceneSchema } from './legacyScene';
import { CONTEXTS, matrixInput, matrixSystem, planMatrix, summarizeRuns, type MatrixCase, type MatrixRun } from './matrix';
const item: MatrixCase = { id: 'esp32', label: 'ESP32', prompt: 'Represente a ESP32.', image: { path: '../fixtures/image.png', mimeType: 'image/png', sha256: 'a'.repeat(64), width: 100, height: 200,
  sourceUrl: 'https://manufacturer.example/photo.png', sourcePageUrl: 'https://manufacturer.example/product', credit: 'Manufacturer', rights: 'Reserved' },
  specifications: { text: 'SPEC-ONLY: 48.26mm x 27.94mm', sources: [{ title: 'Dimensions', url: 'https://manufacturer.example/dimensions' }] }, criteria: ['Recognizable'] };
describe('reference comparison protocol', () => {
  it('reproduces all 32 recorded prompts without adopting the production geometry grammar', () => {
    const manifest = JSON.parse(readFileSync('docs/design/three-skills-comparison/matrix/manifest.json', 'utf8'));
    expect(manifest.protocol.guideVersion).toBe('scene-v1-modeling-guide/1');
    expect(manifest.runs).toHaveLength(32);
    for (const run of manifest.runs) {
      const item = manifest.cases.find((entry: MatrixCase) => entry.id === run.caseId);
      expect(matrixSystem(item.prompt, run.condition)).toBe(run.systemPrompt);
      expect(matrixInput(item, run.context).userText).toBe(run.userText);
    }
    expect(generationSceneSchema.shape.objects.element.shape.type.options).toEqual(['box', 'sphere', 'cylinder', 'cone', 'torus']);
    const primitive = { id: 'p', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#8899aa' };
    expect(sceneSchema.safeParse({ version: 1, label: 'Old', objects: [primitive] }).success).toBe(true);
    expect(sceneSchema.safeParse({ version: 1, label: 'Old', objects: [{ ...primitive, geometry: null }] }).success).toBe(false);
    expect(sceneSchema.safeParse({ version: 1, label: 'Old', objects: Array.from({ length: 129 }, (_, i) => ({ ...primitive, id: String(i) })) }).success).toBe(false);
  });
  it('plans every condition/context/repeat exactly once and reverses the pair order', () => {
    const runs = planMatrix([item, { id: 'mg90s' }], 2);
    expect(runs).toHaveLength(32); expect(new Set(runs.map(r => r.id)).size).toBe(32);
    expect(runs.map(r => r.order)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    for (const context of CONTEXTS) for (const id of ['esp32', 'mg90s']) {
      const pair = (repeat: number) => runs.filter(r => r.caseId === id && r.context === context && r.repeat === repeat).map(r => r.condition);
      expect(pair(1)).toEqual([...pair(2)].reverse());
    }
  });
  it('isolates reference cells and keeps filenames/provenance out of model messages', () => {
    for (const context of CONTEXTS) {
      const input = matrixInput(item, context), text = JSON.parse(input.userText);
      expect(text.instruction).toBe(item.prompt);
      expect(text.references.specifications).toBe(context === 'specs' || context === 'both' ? item.specifications.text : null);
      expect(input.imageInput?.sha256 ?? null).toBe(context === 'image' || context === 'both' ? item.image.sha256 : null);
      expect(input.userText).not.toContain('manufacturer.example'); expect(input.userText).not.toContain('fixtures');
    }
  });
  it('gives both conditions the same actual-image evidence protocol without changing the production prompt', () => {
    const baseline = matrixSystem('ESP32', 'baseline'), skills = matrixSystem('ESP32', 'skills');
    expect(baseline).not.toContain('their pixels have NOT been analyzed');
    expect(skills).not.toContain('their pixels have NOT been analyzed');
    expect(baseline.split('Benchmark reference protocol /1.')[1]).toBe(skills.split('Benchmark reference protocol /1.')[1]);
    expect(baseline).not.toContain('Modeling guide'); expect(skills).toContain('Modeling guide');
  });
  it('keeps failed/unknown-cost attempts visible instead of treating them as zero or successful samples', () => {
    const common = { durationMs: 100, usage: { costUsd: null }, scene: null };
    const runs = [{ ...common, status: 'failed' }, { ...common, status: 'pending', durationMs: null },
      { ...common, status: 'success', scene: { objects: [1, 2] }, usage: { costUsd: .04 } }] as MatrixRun[];
    expect(summarizeRuns(runs)).toMatchObject({ attempts: 2, successes: 1, failures: 1, pending: 1, unknownCosts: 1, costUsd: .04, meanPrimitives: 2 });
  });
});
