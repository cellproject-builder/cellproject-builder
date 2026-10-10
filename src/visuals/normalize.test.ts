import { describe, expect, it } from 'vitest';
import { buildDemoProject } from '@/data/demoProject';
import { normalizeVisualWorkspace } from './normalize';
import { normalizeStoredProjectVisuals } from './projectBoundary';
import type { DecompositionAssembly, ObjectDecomposition, SceneV1, VisualArtifact, VisualWorkspace } from './types';

const scene: SceneV1 = { version: 1, label: 'Arduino UNO', objects: [
  { id: 'pcb', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [4, .2, 3], color: '#008080' },
  { id: 'usb', type: 'box', position: [1, .5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#999999' },
] };
const assemblyScene: SceneV1 = { ...scene, label: 'USB documented part', objects: [scene.objects[1]] };
const dossier: ObjectDecomposition = { version: 1, id: 'dossier', artifactFingerprint: 'fingerprint', identity: 'Arduino UNO R3',
  sourceImageIds: [], researchedAt: 1, unknowns: [],
  sources: [{ id: 'datasheet', url: 'https://example.com/datasheet', title: 'Parts', text: 'USB connector', retrievedAt: 1 }],
  parts: [{ id: 'usb', name: 'USB connector', partNumber: null, quantity: null, role: 'USB', specifications: [], evidence: [{ sourceId: 'datasheet', quote: 'USB connector' }], unknowns: [] }],
  assembly: { dossierId: 'dossier', createdAt: 2, scene: assemblyScene, selectedPartIds: ['usb'], groups: [{ partId: 'usb', objectIds: ['usb'], explodeOffset: [3, 0, 0] }] },
};
const original = (): VisualArtifact => ({ id: 'original', label: 'Arduino', kind: 'model', linkedNodeId: 'concept', x: 30, y: 40,
  width: 280, height: 220, scene, mediaId: null, source: null, revisions: [{ scene, mediaId: null, createdAt: 1 }], revisionIndex: 0,
  origin: { proposalId: 'proposal', imageIds: [], imageMediaIds: [], instruction: 'Arduino UNO R3' }, decomposition: structuredClone(dossier),
});
const workspace = (artifacts: VisualArtifact[]): VisualWorkspace => ({ version: 1, mode: 'approval', artifacts, proposals: [],
  drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } },
});

describe('separate decomposition import and hydration', () => {
  it('migrates an in-place legacy assembly into a related model without changing its original', () => {
    const parent = original();
    const occupied = { ...parent, id: 'occupied', decomposition: undefined, x: 374 };
    const normalized = normalizeVisualWorkspace(workspace([parent, occupied]));
    const child = normalized.artifacts.find(artifact => artifact.id !== parent.id && artifact.id !== occupied.id)!;
    expect(normalized.artifacts[0]).toEqual({ ...parent, decomposition: { ...dossier, assemblyArtifactId: child.id } });
    expect(child).toMatchObject({ kind: 'model', sourceArtifactId: parent.id, scene: assemblyScene,
      decomposition: { ...dossier, assemblyArtifactId: child.id }, linkedNodeId: parent.linkedNodeId, origin: parent.origin });
    expect(child.x).toBeGreaterThanOrEqual(occupied.x + occupied.width + 48);
    expect(child.y).toBe(parent.y);
    expect(child.revisions).toEqual([{ scene: assemblyScene, mediaId: null, createdAt: 2 }]);
    expect(normalizeVisualWorkspace(workspace([parent, occupied])).artifacts.at(-1)?.id).toBe(child.id);
    expect(normalizeVisualWorkspace(normalized)).toEqual(normalized);
    const removedChild = { ...normalized, artifacts: normalized.artifacts.filter(artifact => artifact.id !== child.id) };
    expect(normalizeVisualWorkspace(removedChild)).toEqual(removedChild);
  });

  it('keeps an already related child intact and makes valid project hydration a no-op', () => {
    const parent = original();
    const child = { ...parent, id: 'existing-child', sourceArtifactId: parent.id, scene: assemblyScene, x: 420 };
    parent.decomposition!.assemblyArtifactId = child.id;
    const visuals = workspace([parent, child]);
    const project = { ...buildDemoProject(), visuals, nodes: { concept: {} } } as never;
    expect(normalizeVisualWorkspace(visuals).artifacts).toEqual([parent, child]);
    expect(normalizeStoredProjectVisuals(project)).toBe(project);
  });

  it('marks an existing legacy child once so deleting it does not resurrect it', () => {
    const parent = original();
    const child = { ...parent, id: 'existing-child', sourceArtifactId: parent.id, scene: assemblyScene, x: 420 };
    const normalized = normalizeVisualWorkspace(workspace([parent, child]));
    expect(normalized.artifacts).toHaveLength(2);
    expect(normalized.artifacts[0].decomposition).toMatchObject({ assemblyArtifactId: child.id });
    expect(normalizeVisualWorkspace({ ...normalized, artifacts: [normalized.artifacts[0]] }).artifacts).toHaveLength(1);
  });

  it('retains an orphaned decomposition after its original is removed', () => {
    const child = { ...original(), id: 'orphan', sourceArtifactId: 'removed-original', scene: assemblyScene };
    expect(normalizeVisualWorkspace(workspace([child])).artifacts).toEqual([child]);
  });

  it('rejects self references and cycles but accepts a missing source reference', () => {
    const parent = { ...original(), decomposition: undefined };
    expect(() => normalizeVisualWorkspace(workspace([{ ...parent, sourceArtifactId: parent.id }]))).toThrow();
    expect(() => normalizeVisualWorkspace(workspace([{ ...parent, sourceArtifactId: 'second' }, { ...parent, id: 'second', sourceArtifactId: parent.id }]))).toThrow();
    expect(normalizeVisualWorkspace(workspace([{ ...parent, sourceArtifactId: 'gone' }])).artifacts[0]).toMatchObject({ sourceArtifactId: 'gone' });
  });

  it('validates provenance of reused scene objects without accepting misleading geometry claims', () => {
    const parent = original();
    const child = { ...parent, id: 'child', sourceArtifactId: parent.id, scene: assemblyScene };
    const baseAssembly = child.decomposition!.assembly!;
    child.decomposition!.assembly = { ...baseAssembly, geometryBasis: 'source', reusedObjectIds: ['usb'] };
    expect(normalizeVisualWorkspace(workspace([child])).artifacts[0].decomposition?.assembly).toMatchObject({ geometryBasis: 'source', reusedObjectIds: ['usb'] });
    const invalidMetadata: Array<Pick<DecompositionAssembly, 'geometryBasis' | 'reusedObjectIds'>> = [
      { geometryBasis: 'source', reusedObjectIds: [] },
      { geometryBasis: 'generated', reusedObjectIds: ['usb'] },
      { geometryBasis: 'mixed', reusedObjectIds: ['usb'] },
      { geometryBasis: 'source', reusedObjectIds: ['missing'] },
      { geometryBasis: 'source', reusedObjectIds: ['usb', 'usb'] },
    ];
    for (const metadata of invalidMetadata) {
      child.decomposition!.assembly = { ...baseAssembly, ...metadata };
      expect(() => normalizeVisualWorkspace(workspace([child]))).toThrow();
    }
    child.decomposition!.assembly = { ...baseAssembly, geometryBasis: 'generated', reusedObjectIds: [] };
    expect(normalizeVisualWorkspace(workspace([child])).artifacts).toHaveLength(1);
  });
});
