/** CPU only: npm run bench:planner -- scripts/visual-validity.bench.ts */
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { dirname } from 'node:path';
import { expect, it } from 'vitest';
import { modelAssemblyCurrent, modelAssemblySchema, modelSceneFingerprint } from '../src/visuals/modelAssembly';
import { sceneSchema } from '../src/visuals/normalize';
import { modelAssemblyCurrentForRender } from '../src/visuals/rendering/modelAssemblyValidity';
import type { SceneV1, VisualArtifact, VisualModelAssembly } from '../src/visuals/types';

function fixture(id: number, custom: boolean): VisualArtifact {
  const scene: SceneV1 = { version: 1, label: `Synthetic ${id}`, objects: Array.from({ length: 512 }, (_, index) => ({
    id: `part-${index}`, type: 'box', position: [index % 16, Math.floor(index / 16), 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#8899aa',
  })) };
  if (custom) for (let index = 0; index < 8; index++) {
    const vertices: [number, number, number][] = Array.from({ length: 144 }, (_, vertex) => [vertex % 12 / 12, Math.floor(vertex / 12) / 12, Math.sin(vertex / 12) / 100]);
    const indices: number[] = [];
    for (let row = 0; row < 11; row++) for (let column = 0; column < 11; column++) { const a = row * 12 + column; indices.push(a, a + 1, a + 12, a + 1, a + 13, a + 12); }
    scene.objects[index] = { ...scene.objects[index], type: 'custom', geometry: { kind: 'buffer', vertices, indices } };
  }
  const groups = Array.from({ length: 8 }, (_, index) => ({ partId: `module-${index}`, name: `Module ${index}`, objectIds: scene.objects.slice(index * 64, (index + 1) * 64).map(object => object.id) }));
  const assembly: VisualModelAssembly = { version: 1, sceneFingerprint: modelSceneFingerprint(scene), summary: 'Synthetic CPU fixture', groups, selectedNodeIds: [], selectedImageIds: [], sources: [], unknowns: [],
    plan: { units: 'illustrative', sharedConstraints: [], unknowns: [], interfaces: [], modules: groups.map(group => ({ id: group.partId, name: group.name, prompt: 'Synthetic part', nodeIds: [], sourceIds: [], center: [0, 0, 0], size: [100, 100, 100], primitiveBudget: 64 })) } };
  // Validation is outside timing; these are supported scenes/contracts, without lower geometry budgets.
  sceneSchema.parse(scene); modelAssemblySchema.parse(assembly);
  return { id: `synthetic-${id}`, kind: 'model', label: scene.label, scene, assembly, x: id * 1000, y: 0, width: 200, height: 180, mediaId: null, source: null, revisions: [], revisionIndex: 0 };
}

it('records repeated validation costs without timing assertions or GPU mocks', async () => {
  const rows = [], updates = 3;
  for (const custom of [false, true]) for (const count of [1, 8, 20]) {
    const artifacts = Array.from({ length: count }, (_, index) => fixture(index, custom));
    const baseline: number[] = [], cached: number[] = [];
    for (const artifact of artifacts) expect(modelAssemblyCurrentForRender(artifact)).toBe(modelAssemblyCurrent(artifact));
    for (let sample = 0; sample < 6; sample++) {
      let valid = 0, start = performance.now();
      for (let frame = 0; frame < updates; frame++) for (const artifact of artifacts) valid += Number(modelAssemblyCurrent(artifact));
      baseline.push((performance.now() - start) / updates); expect(valid).toBe(count * updates);
      valid = 0; start = performance.now();
      for (let frame = 0; frame < updates; frame++) for (const artifact of artifacts) valid += Number(modelAssemblyCurrentForRender(artifact));
      cached.push((performance.now() - start) / updates); expect(valid).toBe(count * updates);
    }
    const median = (samples: number[]) => +samples.slice(1).sort((a, b) => a - b)[2].toFixed(6);
    rows.push({ artifacts: count, objectsPerArtifact: 512, customObjectsPerArtifact: custom ? 8 : 0, sceneBytes: JSON.stringify(artifacts[0].scene).length,
      originalMedianMsPerUpdate: median(baseline), cachedMedianMsPerUpdate: median(cached), originalSamplesMsPerUpdate: baseline.slice(1), cachedSamplesMsPerUpdate: cached.slice(1) });
  }
  const report = { synthetic: true, measuredAt: new Date().toISOString(),
    environment: { node: process.version, cpu: cpus()[0]?.model, os: `${platform()} ${release()}`, runner: 'Vitest/jsdom; CPU validity only, not GPU/browser FPS' },
    protocol: { warmups: 1, samples: 5, viewportUpdatesPerSample: updates, cache: 'Render-only immutable scene+assembly; warmed before repeated updates', excludes: 'React, decomposition, geometry allocation, GPU rendering, persistence, network and real user data' }, rows };
  const destination = '.codex-audit-planning-performance/visual-validity-latest.json';
  await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: destination, ...report }, null, 2));
});
