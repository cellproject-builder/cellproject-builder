import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { buildDemoProject } from '@/data/demoProject';
import { initializeWorkspace } from '@/workspace/planner';
import { getVisualWorkspace, mutateVisualWorkspace, removeVisualArtifact, revertVisualArtifact, resolveVisualContext } from './domain';
import { generateVisualScene } from './generation';
import { reviseVisualModel } from './modelRevision';
import type { SceneV1, VisualArtifact, VisualPromptInput } from './types';
import { collectVisualMediaIds } from './references';
vi.mock('./generation', () => ({ generateVisualScene: vi.fn() }));
const scene = (label = 'Original'): SceneV1 => ({ version: 1, label, objects: [{ id: 'body', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1], color: '#aabbcc' }] });
const input = (): VisualPromptInput => ({ text: 'Arredonde os cantos, preserve as peças e referências.', mentions: [], attachments: [] });
const model = (): VisualArtifact => ({ id: 'model-edit', label: 'Original', kind: 'model', x: 12, y: 34, width: 300, height: 240, linkedNodeId: null, scene: scene(), mediaId: null, source: null, revisions: [{ scene: scene(), mediaId: null, createdAt: 1 }], revisionIndex: 0, origin: { proposalId: 'first', imageIds: [], imageMediaIds: [], instruction: 'Original request' } });
beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'revision-plan' }, selectedNodeId: null }); initializeWorkspace();
  mutateVisualWorkspace(w => ({ ...w, artifacts: [model()], mode: 'automatic' }));
  vi.mocked(generateVisualScene).mockReset();
  vi.mocked(generateVisualScene).mockImplementation(async draft => ({ scene: scene('Edited'), input: draft, contextFingerprint: resolveVisualContext(draft).fingerprint, contextSnapshot: '', referencedMediaIds: ['new-photo'], current: true }));
});
describe('contextual model revision', () => {
  it('revises the same artifact atomically and retains original, position, references and reversible history', async () => {
    const result = await reviseVisualModel('model-edit', input(), { signal: new AbortController().signal });
    expect(result).toMatchObject({ id: 'model-edit', label: 'Edited', x: 12, y: 34, width: 300, height: 240, revisionIndex: 1 });
    expect(result.origin?.instruction).toBe('Original request');
    expect(result.revisions.map(r => r.scene?.label)).toEqual(['Original', 'Edited']);
    expect(result.revisions[1]).toMatchObject({ input: input(), contextFingerprint: resolveVisualContext(input()).fingerprint, referencedMediaIds: ['new-photo'] });
    expect(collectVisualMediaIds(useGraphStore.getState().project!)).toContain('new-photo');
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
    expect(getVisualWorkspace(useGraphStore.getState().project).proposals).toHaveLength(0);
    expect(generateVisualScene).toHaveBeenCalledWith(input(), expect.objectContaining({ sourceModel: expect.objectContaining({ scene: scene() }) }));
    revertVisualArtifact('model-edit');
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts[0]).toMatchObject({ label: 'Original', scene: scene(), revisionIndex: 0 });
  });
  it('refuses an obsolete answer after the target changes or disappears, without inserting another artifact', async () => {
    vi.mocked(generateVisualScene).mockImplementationOnce(async draft => {
      mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => ({ ...a, scene: scene('Concurrent change') })) }));
      return { scene: scene('Late answer'), input: draft, contextFingerprint: 'test', contextSnapshot: '', referencedMediaIds: [], current: true };
    });
    await expect(reviseVisualModel('model-edit', input(), { signal: new AbortController().signal })).rejects.toThrow('visualContextChanged');
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts[0].scene?.label).toBe('Concurrent change');
    removeVisualArtifact('model-edit');
    await expect(reviseVisualModel('model-edit', input(), { signal: new AbortController().signal })).rejects.toThrow('visualArtifactMissing');
  });
  it('never applies stale context, cancellation, invalid geometry or a provider failure', async () => {
    const before = structuredClone(getVisualWorkspace(useGraphStore.getState().project));
    vi.mocked(generateVisualScene).mockResolvedValueOnce({ scene: scene('Stale'), input: input(), contextFingerprint: 'test', contextSnapshot: '', referencedMediaIds: [], current: false });
    await expect(reviseVisualModel('model-edit', input(), { signal: new AbortController().signal })).rejects.toThrow('visualContextChanged');
    const aborted = new AbortController(); aborted.abort();
    await expect(reviseVisualModel('model-edit', input(), { signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' });
    vi.mocked(generateVisualScene).mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(reviseVisualModel('model-edit', input(), { signal: new AbortController().signal })).rejects.toThrow('provider unavailable');
    expect(getVisualWorkspace(useGraphStore.getState().project)).toEqual(before);
  });
});
