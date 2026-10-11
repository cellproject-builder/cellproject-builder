/** Run only this CPU benchmark: npm run bench:planner -- scripts/node-presentation.bench.ts */
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { dirname } from 'node:path';
import { expect, it } from 'vitest';
import { canConcludeNode, isBlocked, stepSequence } from '../src/store';
import { nodePresentation } from '../src/graph/nodePresentation';
import type { ConceptNodeData, Project } from '../src/types';

function fixture(count: number): Project {
  const nodes: Project['nodes'] = {};
  for (let index = 0; index < count; index++) {
    const id = index ? `n${index}` : 'root';
    nodes[id] = { id, parentId: index ? 'root' : null, kind: index ? 'passo' : 'root', name: `Synthetic ${index}`,
      fx: '', problem: '', confidence: 50, pros: [], cons: [], oQue: '', porQue: '', comoConfirmar: '',
      confirmado: false, order: index, state: 'concept', notes: '', history: [], aiSuggested: false, position: { x: 0, y: 0 } };
  }
  return { id: 'presentation-cpu', rootId: 'root', name: 'Synthetic CPU fixture', objective: '', archetype: 'construir', createdAt: 0, updatedAt: 0, nodes, edges: {} };
}

it('records cold and repeated canvas metadata costs without timing assertions', async () => {
  const rows = [];
  for (const count of [100, 300, 1000]) {
    const project = fixture(count), nodes = Object.values(project.nodes), before: number[] = [], cold: number[] = [], cached: number[] = [];
    let expected: Array<{ id: string; blocked: boolean; stepNo: number | null; canConclude: boolean }> = [];
    for (let iteration = 0; iteration < 6; iteration++) {
      let start = performance.now();
      expected = nodes.map((node: ConceptNodeData) => ({ id: node.id, blocked: node.kind === 'passo' && isBlocked(project, node.id),
        stepNo: node.kind === 'passo' ? stepSequence(project, node.id) : null,
        canConclude: node.kind === 'passo' && canConcludeNode(project, node.id).ready }));
      before.push(performance.now() - start);
      // New immutable record invalidates the cache; the fixture copy is outside timing.
      const fresh = { ...project, nodes: { ...project.nodes } };
      start = performance.now(); const result = nodePresentation(fresh); cold.push(performance.now() - start);
      start = performance.now(); for (let sample = 0; sample < 1000; sample++) nodePresentation(fresh); cached.push((performance.now() - start) / 1000);
      for (const node of expected) expect(result.get(node.id)).toMatchObject({ blocked: node.blocked, stepNo: node.stepNo, canConclude: node.canConclude });
    }
    const median = (samples: number[]) => +samples.slice(1).sort((a, b) => a - b)[2].toFixed(6);
    rows.push({ nodes: count, originalMedianMs: median(before), coldIndexMedianMs: median(cold), cachedIndexMedianMs: median(cached), originalSamplesMs: before.slice(1), coldIndexSamplesMs: cold.slice(1) });
  }
  const report = { synthetic: true, measuredAt: new Date().toISOString(),
    environment: { node: process.version, cpu: cpus()[0]?.model, os: `${platform()} ${release()}`, runner: 'Vitest/jsdom; CPU only, not browser FPS' },
    protocol: { warmups: 1, samples: 5, shape: 'Wide root with unresolved step leaves', excludes: 'React rendering, layout, persistence, network and real user data', cachedSamplesPerIteration: 1000 }, rows };
  const destination = '.codex-audit-planning-performance/node-presentation-latest.json';
  await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: destination, ...report }, null, 2));
});
