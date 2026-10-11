import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelAssemblyCurrent, modelSceneFingerprint } from '../modelAssembly';
import type { SceneV1, VisualArtifact, VisualModelAssembly } from '../types';
import { modelAssemblyCurrentForRender } from './modelAssemblyValidity';

function fixture(): VisualArtifact {
  const scene: SceneV1 = { version: 1, label: 'Synthetic assembly', objects: ['body', 'shaft'].map((id, index) => ({ id, type: 'box', position: [index, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#8899aa' })) };
  const groups = scene.objects.map(object => ({ partId: object.id, name: object.id, objectIds: [object.id] }));
  const assembly: VisualModelAssembly = { version: 1, sceneFingerprint: modelSceneFingerprint(scene), summary: 'Synthetic', groups, selectedNodeIds: [], selectedImageIds: [], sources: [], unknowns: [],
    plan: { units: 'illustrative', sharedConstraints: [], unknowns: [], interfaces: [], modules: groups.map(group => ({ id: group.partId, name: group.name, prompt: 'Synthetic', nodeIds: [], sourceIds: [], center: [0, 0, 0], size: [1, 1, 1], primitiveBudget: 1 })) } };
  return { id: 'assembly', kind: 'model', label: scene.label, scene, assembly, mediaId: null, source: null, x: 0, y: 0, width: 200, height: 180, revisions: [], revisionIndex: 0 };
}
afterEach(() => vi.restoreAllMocks());

describe('render-only assembly validity', () => {
  it('hashes immutable rendering inputs once across repeated view and placement changes', () => {
    const artifact = fixture(), stringify = vi.spyOn(JSON, 'stringify');
    expect(modelAssemblyCurrentForRender(artifact)).toBe(true);
    expect(stringify.mock.calls.filter(([value]) => value === artifact.scene)).toHaveLength(1);
    stringify.mockClear();
    for (let frame = 0; frame < 60; frame++) expect(modelAssemblyCurrentForRender({ ...artifact, x: frame, y: frame } as VisualArtifact)).toBe(true);
    expect(stringify.mock.calls.length).toBe(0);
  });

  it('invalidates for edited scene, fingerprint, membership or contract and preserves current validation outcomes', () => {
    const original = fixture();
    expect(modelAssemblyCurrentForRender(original)).toBe(true);
    const cases: VisualArtifact[] = [
      { ...original, scene: { ...original.scene!, objects: original.scene!.objects.map((object, index) => index ? object : { ...object, color: '#ffffff' }) } },
      { ...original, assembly: { ...original.assembly!, sceneFingerprint: 'stale' } },
      { ...original, assembly: { ...original.assembly!, groups: original.assembly!.groups.map((group, index) => index ? group : { ...group, objectIds: ['missing'] }) } },
      { ...original, kind: 'image' },
      { ...original, scene: null },
      { ...original, assembly: undefined },
      structuredClone(original),
    ];
    for (const artifact of cases) {
      expect(modelAssemblyCurrentForRender(artifact)).toBe(modelAssemblyCurrent(artifact));
      expect(modelAssemblyCurrentForRender(artifact)).toBe(modelAssemblyCurrent(artifact));
    }
    expect(modelAssemblyCurrentForRender(original)).toBe(true);
  });

  it('leaves authoritative validation uncached for action and export inputs', () => {
    const artifact = fixture();
    expect(modelAssemblyCurrentForRender(artifact)).toBe(true);
    artifact.scene!.objects[0].scale = [2, 1, 1];
    expect(modelAssemblyCurrent(artifact)).toBe(false);
  });
});
