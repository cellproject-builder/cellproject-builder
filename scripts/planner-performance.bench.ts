/** Explicit local CPU benchmark. Synthetic inputs; no AI, network or user data. */
import { writeFile, mkdir } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeTreeLayout } from '../src/graph/treeLayout';
import { computeAdaptiveTreeLayout } from '../src/graph/autoLayout';
import { projectProgress, projectEvidenceProgress, nextPendingForTutor, isNodeResolved, parseImportedProject } from '../src/store';
import type { ConceptNodeData, Project } from '../src/types';

type Shape = 'balanced' | 'wide' | 'deep';
function fixture(count: number, shape: Shape): Project {
  const nodes: Record<string, ConceptNodeData> = {}, edges: Project['edges'] = {};
  for (let index = 0; index < count; index++) {
    const id = index ? `n${index}` : 'root';
    const parentIndex = shape === 'deep' ? index - 1 : shape === 'wide' ? 0 : Math.floor((index - 1) / 5);
    const parentId = index ? parentIndex ? `n${parentIndex}` : 'root' : null;
    nodes[id] = {
      id, parentId, kind: index ? 'passo' : 'root', name: `Parte sintética ${index}`,
      fx: '', problem: '', confidence: 50, pros: [], cons: [], oQue: 'Fixture de volume',
      porQue: '', comoConfirmar: '', confirmado: false, order: index,
      state: 'concept', notes: '', history: [], aiSuggested: false, position: { x: 0, y: 0 },
    };
    if (parentId) edges[`e${index}`] = { id: `e${index}`, source: parentId, target: id, kind: 'direct' };
  }
  return { id: 'synthetic-performance', rootId: 'root', name: 'Volume sintético', objective: 'Benchmark, sem dados de usuário', archetype: 'construir', createdAt: 0, updatedAt: 0, nodes, edges };
}

const operations = {
  persistedLayout: (project: Project) => computeTreeLayout(project),
  adaptiveLayout: (project: Project) => computeAdaptiveTreeLayout(project, 'horizontal'),
  progress: (project: Project) => projectProgress(project),
  evidenceProgress: (project: Project) => projectEvidenceProgress(project),
  nextPending: (project: Project) => nextPendingForTutor(project),
  resolved: (project: Project) => isNodeResolved(project, project.rootId),
  importValidation: (project: Project) => parseImportedProject(project),
  serialization: (project: Project) => JSON.stringify(project),
};

describe('explicit planning CPU volume benchmark', () => {
  it('records timing, invariant failures and stack limits without hiding failed operations', async () => {
    const rows: Array<{ shape: Shape; workload: 'unresolved' | 'resolved'; nodes: number; jsonBytes: number; operation: string; samples: number; medianMs: number | null; p95Ms: number | null; error: string | null }> = [];
    for (const shape of ['balanced', 'wide', 'deep'] as const) {
      for (const count of [100, 1000, 5000, 12000]) {
        for (const workload of ['unresolved', 'resolved'] as const) {
        const project = fixture(count, shape);
        if (workload === 'resolved') for (const node of Object.values(project.nodes)) {
          node.confirmado = true;
          node.comoConfirmarAtendido = { at: 1, observacao: 'Synthetic benchmark fixture, not a physical observation' };
        }
        const original = JSON.stringify(project);
        const expectedLeaves = shape === 'deep' ? 1 : shape === 'wide' ? count - 1 : count - Math.ceil((count - 1) / 5);
        const parents = new Set(Object.values(project.nodes).map(node => node.parentId));
        for (const [operation, run] of Object.entries(operations)) {
          const durations: number[] = [];
          let failure: string | null = null;
          for (let iteration = 0; iteration < 6; iteration++) {
            try {
              const start = performance.now(), result = run(project);
              durations.push(performance.now() - start);
              if (operation.endsWith('Layout')) {
                const positions = result as Record<string, { x: number; y: number }>;
                if (Object.keys(positions).length !== count || Object.keys(project.nodes).some(id => !positions[id]) || Object.values(positions).some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('layoutInvariant');
              }
              if (operation === 'importValidation') {
                const imported = result as Project | null;
                if (!imported || imported.rootId !== project.rootId || Object.keys(imported.nodes).length !== count || Object.keys(imported.edges).length !== count - 1) throw new Error('importInvariant');
              }
              if (operation === 'progress') expect(result).toEqual({ total: expectedLeaves, done: workload === 'resolved' ? expectedLeaves : 0, doneWithSignal: workload === 'resolved' ? expectedLeaves : 0, doneWithoutSignal: 0, percent: workload === 'resolved' ? 100 : 0 });
              if (operation === 'evidenceProgress') expect(result).toEqual({ withEvidence: workload === 'resolved' ? expectedLeaves : 0, assumedKnown: 0 });
              if (operation === 'resolved' && result !== (workload === 'resolved')) throw new Error('resolvedInvariant');
              if (operation === 'nextPending') {
                const pending = result as ConceptNodeData | null;
                if (workload === 'resolved' ? pending !== null : !pending || pending.confirmado || !project.nodes[pending.id] || parents.has(pending.id)) throw new Error('pendingInvariant');
              }
              if (operation === 'serialization' && result !== original) throw new Error('serializationInvariant');
            } catch (error) { failure = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown'; break; }
          }
          const measured = durations.slice(1).sort((a, b) => a - b);
          rows.push({ shape, workload, nodes: count, jsonBytes: Buffer.byteLength(original), operation, samples: measured.length,
            medianMs: failure || !measured.length ? null : +measured[Math.floor(measured.length / 2)].toFixed(3),
            p95Ms: failure || !measured.length ? null : +measured[Math.ceil(measured.length * .95) - 1].toFixed(3), error: failure });
          expect(JSON.stringify(project), `${shape}/${workload}/${count}/${operation} mutates input`).toBe(original);
        }
        }
      }
    }
    const destination = process.env.PLANNER_PERF_OUTPUT || '.codex-audit-planning-performance/cpu-latest.json';
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify({ version: 2, synthetic: true, measuredAt: new Date().toISOString(),
      environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, runner: 'Vitest/jsdom; CPU only; not browser FPS or server load' },
      protocol: { warmupSamples: 1, measuredSamples: 5, concurrentBenchmarkWorkers: 1, workloads: ['unresolved', 'resolved'], sizes: [100, 1000, 5000, 12000], note: 'Timing includes only the operation. Invariants/input immutability checked outside timing; p95 of five samples is the maximum and not a stable tail estimate. 12000 is a stress case, not a supported-size promise.' }, rows }, null, 2) + '\n');
    // Import through the application's ordinary UI for a separate rendering
    // smoke test. This does not make the CPU benchmark a browser benchmark.
    const browserFixture = fixture(1000, 'balanced');
    const positions = computeTreeLayout(browserFixture);
    for (const node of Object.values(browserFixture.nodes)) node.position = positions[node.id];
    await writeFile(join(dirname(destination), 'browser-fixture-1000.json'), JSON.stringify(browserFixture));
    console.log(JSON.stringify({ output: destination, rows: rows.length, failedOperations: rows.filter(row => row.error).map(({ shape, nodes, operation, error }) => ({ shape, nodes, operation, error })) }, null, 2));
    expect(rows).toHaveLength(192);
    expect(rows.filter(row => row.error), 'Benchmark operation failures; see the saved report').toEqual([]);
  });
});
