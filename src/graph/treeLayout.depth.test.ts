import { expect, it } from 'vitest';
import type { ConceptNodeData, Project } from '@/types';
import { computeTreeLayout, LAYOUT_Y_GAP } from './treeLayout';

const node = (id: string, parentId: string | null, order = 0): ConceptNodeData => ({
  id, parentId, order, kind: parentId ? 'passo' : 'root', name: id,
  fx: '', problem: '', confidence: 50, pros: [], cons: [], oQue: '', porQue: '',
  comoConfirmar: '', confirmado: false, state: 'concept', notes: '', history: [],
  aiSuggested: false, position: { x: 0, y: 0 },
});
const project = (nodes: ConceptNodeData[]): Project => ({
  id: 'layout-depth', rootId: 'root', name: 'Synthetic tree', objective: 'Test traversal',
  archetype: 'construir', createdAt: 0, updatedAt: 0, edges: {},
  nodes: Object.fromEntries(nodes.map(item => [item.id, item])),
});

it('lays out a 12000-node chain without consuming the JavaScript call stack', () => {
  const nodes = [node('root', null)];
  for (let index = 1; index < 12000; index++) nodes.push(node(`n${index}`, index === 1 ? 'root' : `n${index - 1}`));
  const positions = computeTreeLayout(project(nodes));
  expect(Object.keys(positions)).toHaveLength(12000);
  expect(positions.root).toEqual({ x: 0, y: 0 });
  expect(positions.n6000).toEqual({ x: 0, y: 6000 * LAYOUT_Y_GAP });
  expect(positions.n11999).toEqual({ x: 0, y: 11999 * LAYOUT_Y_GAP });
});

it('preserves ordered branch widths and the staggered two-column leaf grid', () => {
  const plan = project([
    node('root', null), node('last', 'root', 1), node('branch', 'root', 0),
    node('tail', 'branch', 1), node('grid', 'branch', 0),
    ...Array.from({ length: 5 }, (_, index) => node(`g${index}`, 'grid', index)),
  ]);
  expect(computeTreeLayout(plan)).toEqual({
    root: { x: 0, y: 0 }, branch: { x: -170, y: 300 }, grid: { x: -340, y: 600 },
    g0: { x: -530, y: 900 }, g1: { x: -150, y: 900 },
    g2: { x: -530, y: 1180 }, g3: { x: -150, y: 1180 }, g4: { x: -530, y: 1460 },
    tail: { x: 170, y: 600 }, last: { x: 510, y: 300 },
  });
});

it('rejects a reachable parent cycle explicitly instead of recursing indefinitely', () => {
  expect(() => computeTreeLayout(project([node('root', 'b'), node('a', 'root'), node('b', 'a')]))).toThrow(/ciclo/i);
});
