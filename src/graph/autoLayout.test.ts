import { describe, expect, it } from 'vitest';
import type { ConceptNodeData, Project } from '@/types';
import { computeAdaptiveTreeLayout, DEFAULT_NODE_DIMENSIONS, resolveOrientation, type Orientation } from './autoLayout';

type NodeSpec = { id: string; parentId: string | null; order?: number; name?: string };
function projectWith(specs: NodeSpec[]): Project {
  const nodes = Object.fromEntries(specs.map((spec): [string, ConceptNodeData] => [spec.id, {
    ...spec, name: spec.name ?? spec.id, order: spec.order ?? 0,
    kind: spec.parentId ? 'passo' : 'root', fx: '', problem: '', confidence: 75,
    pros: [], cons: [], oQue: '', porQue: '', comoConfirmar: '', confirmado: false,
    state: 'concept', notes: '', history: [], aiSuggested: false, position: { x: 19, y: 73 },
  }]));
  return { id: 'test', name: 'Test', objective: '', createdAt: 0, updatedAt: 0, rootId: 'root', nodes, edges: {} };
}
const branchingProject = () => projectWith([
  { id: 'root', parentId: null },
  { id: 'right', parentId: 'root', order: 2 },
  { id: 'left', parentId: 'root', order: 1 },
  { id: 'left-a', parentId: 'left', order: 1 },
  { id: 'left-b', parentId: 'left', order: 2 },
  ...Array.from({ length: 9 }, (_, order) => ({ id: `right-${order}`, parentId: 'right', order })),
]);

describe('available-space orientation', () => {
  it('chooses the longer available axis on first measurement', () => {
    expect(resolveOrientation(1000, 600)).toBe('horizontal');
    expect(resolveOrientation(450, 800)).toBe('vertical');
  });

  it('keeps the current orientation near square and switches after a clear change', () => {
    expect(resolveOrientation(970, 1000, 'horizontal')).toBe('horizontal');
    expect(resolveOrientation(1030, 1000, 'vertical')).toBe('vertical');
    expect(resolveOrientation(800, 1000, 'horizontal')).toBe('vertical');
    expect(resolveOrientation(1200, 1000, 'vertical')).toBe('horizontal');
  });

  it('ignores unavailable or invalid container measurements', () => {
    for (const [width, height] of [[0, 0], [0, 800], [-1, 600], [NaN, 600], [800, Infinity]]) {
      expect(resolveOrientation(width, height, 'horizontal')).toBe('horizontal');
      expect(resolveOrientation(width, height, 'vertical')).toBe('vertical');
    }
  });
});

describe.each<Orientation>(['vertical', 'horizontal'])('adaptive %s tree', (orientation) => {
  const main = orientation === 'vertical' ? 'y' : 'x';
  const cross = orientation === 'vertical' ? 'x' : 'y';

  it('anchors the root, keeps hierarchy direction and orders sibling branches', () => {
    const project = branchingProject();
    const positions = computeAdaptiveTreeLayout(project, orientation);
    expect(positions.root).toEqual({ x: 0, y: 0 });
    expect(Object.keys(positions).sort()).toEqual(Object.keys(project.nodes).sort());
    expect(positions.left[cross]).toBeLessThan(positions.right[cross]);
    for (const node of Object.values(project.nodes)) {
      if (node.parentId) expect(positions[node.id][main]).toBeGreaterThan(positions[node.parentId][main]);
    }
  });

  it('separates every card, including compact leaf groups beside deeper branches', () => {
    const project = branchingProject();
    const positions = computeAdaptiveTreeLayout(project, orientation);
    const ids = Object.keys(project.nodes);
    ids.forEach((id, index) => ids.slice(index + 1).forEach((other) => {
      expect(Math.abs(positions[id].x - positions[other].x) >= DEFAULT_NODE_DIMENSIONS.width || Math.abs(positions[id].y - positions[other].y) >= DEFAULT_NODE_DIMENSIONS.height).toBe(true);
    }));
  });

  it('reserves enough room for measured cards larger than the default', () => {
    const project = branchingProject();
    const dimensions = Object.fromEntries(Object.keys(project.nodes).map((id, i) => [id, { width: 300 + i * 13, height: 260 + i * 31 }]));
    const positions = computeAdaptiveTreeLayout(project, orientation, dimensions);
    const ids = Object.keys(project.nodes);
    ids.forEach((id, index) => ids.slice(index + 1).forEach((other) => {
      const a = positions[id], b = positions[other];
      const separated = a.x + dimensions[id].width <= b.x || b.x + dimensions[other].width <= a.x ||
        a.y + dimensions[id].height <= b.y || b.y + dimensions[other].height <= a.y;
      expect(separated, `${id} overlaps ${other}`).toBe(true);
    }));
  });

  it('keeps large leaf groups compact across the sibling axis', () => {
    const project = projectWith([{ id: 'root', parentId: null }, ...Array.from({ length: 12 }, (_, order) => ({ id: `leaf-${order}`, parentId: 'root', order }))]);
    const positions = computeAdaptiveTreeLayout(project, orientation);
    expect(Object.keys(positions)).toHaveLength(13);
    const crossPositions = Object.values(positions).map((p) => p[cross]);
    expect(Math.max(...crossPositions) - Math.min(...crossPositions)).toBeLessThan(700);
  });
});

it('returns fresh positions without editing or relying on saved project coordinates', () => {
  const project = branchingProject();
  const snapshot = structuredClone(project);
  Object.values(project.nodes).forEach((node) => { Object.freeze(node.position); Object.freeze(node); });
  Object.freeze(project.nodes); Object.freeze(project);
  const positions = computeAdaptiveTreeLayout(project, 'horizontal');
  positions.root.x = 999;
  expect(project).toEqual(snapshot);
  expect(computeAdaptiveTreeLayout(project, 'horizontal').root).toEqual({ x: 0, y: 0 });
});

it('returns no phantom node when the project has no root', () => {
  expect(computeAdaptiveTreeLayout(projectWith([]), 'vertical')).toEqual({});
});

it('includes orphaned nodes without modifying their stored parents', () => {
  const project = projectWith([
    { id: 'root', parentId: null }, { id: 'orphan', parentId: 'missing' },
    { id: 'extra-root', parentId: null }, { id: 'child', parentId: 'orphan' },
  ]);
  const snapshot = structuredClone(project);
  const positions = computeAdaptiveTreeLayout(project, 'vertical');
  expect(Object.keys(positions).sort()).toEqual(Object.keys(project.nodes).sort());
  expect(positions.child.y).toBeGreaterThan(positions.orphan.y);
  expect(Math.abs(positions.orphan.x - positions['extra-root'].x)).toBeGreaterThanOrEqual(300);
  expect(project).toEqual(snapshot);
});

it('cuts cycles in presentation so disconnected nodes still receive finite positions', () => {
  const project = projectWith([
    { id: 'root', parentId: 'attached' }, { id: 'attached', parentId: 'root' },
    { id: 'cycle-a', parentId: 'cycle-b' }, { id: 'cycle-b', parentId: 'cycle-a' },
    { id: 'self', parentId: 'self' },
  ]);
  const snapshot = structuredClone(project);
  const positions = computeAdaptiveTreeLayout(project, 'horizontal');
  expect(Object.keys(positions).sort()).toEqual(Object.keys(project.nodes).sort());
  expect(Object.values(positions).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  const ids = Object.keys(positions);
  ids.forEach((id, index) => ids.slice(index + 1).forEach((other) => {
    expect(Math.abs(positions[id].x - positions[other].x) >= DEFAULT_NODE_DIMENSIONS.width || Math.abs(positions[id].y - positions[other].y) >= DEFAULT_NODE_DIMENSIONS.height).toBe(true);
  }));
  expect(project).toEqual(snapshot);
});

it('uses a known node as the anchor when only the declared root ID is missing', () => {
  const project = projectWith([{ id: 'root', parentId: null }, { id: 'child', parentId: 'root' }]);
  project.rootId = 'missing';
  const positions = computeAdaptiveTreeLayout(project, 'vertical');
  expect(Object.keys(positions).sort()).toEqual(['child', 'root']);
  expect(positions.missing).toBeUndefined();
});

it('lays out a deeply unbalanced 3000-node tree without overflowing the call stack', () => {
  const project = projectWith(Array.from({ length: 3000 }, (_, i) => ({ id: i ? `node-${i}` : 'root', parentId: i ? (i === 1 ? 'root' : `node-${i - 1}`) : null })));
  const positions = computeAdaptiveTreeLayout(project, 'vertical');
  expect(Object.keys(positions)).toHaveLength(3000);
  expect(positions.root).toEqual({ x: 0, y: 0 });
  expect(positions['node-2999'].y).toBeGreaterThan(positions['node-2998'].y);
});
