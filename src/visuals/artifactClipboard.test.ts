import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { initializeWorkspace } from '@/workspace/planner';
import { buildDemoProject } from '@/data/demoProject';
import { getVisualWorkspace, mutateVisualWorkspace, removeVisualArtifact, updateVisualArtifact } from './domain';
import { copyArtifactSnapshot, parseArtifactClipboard, pasteArtifactSnapshot } from './artifactClipboard';
import { importVisualMedia, readVisualMedia } from './media';
import { normalizeVisualWorkspace } from './normalize';
import { useVisualViewStore } from './rendering/viewStore';
import type { VisualArtifact } from './types';

const model = (): VisualArtifact => ({ id: 'original', label: 'Arduino UNO', kind: 'model', x: 100, y: 200, width: 280, height: 220, linkedNodeId: null,
  scene: { version: 1, label: 'Arduino UNO', objects: [{ id: 'pcb', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [4, .2, 3], color: '#008080' }] },
  mediaId: null, source: null, revisions: [{ scene: null, mediaId: null, createdAt: 1 }], revisionIndex: 0,
  origin: { proposalId: 'proposal', imageIds: [], imageMediaIds: [], instruction: 'Arduino UNO R3' },
});
beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'copy-plan' } });
  initializeWorkspace();
  useVisualViewStore.setState({ angles: {}, pitches: {}, explosions: {}, selectedParts: {} });
});

describe('canvas artifact clipboard', () => {
  it('pastes independent model snapshots repeatedly, retaining geometry, provenance, links and view', async () => {
    const original = model(); original.linkedNodeId = useGraphStore.getState().project!.rootId;
    original.revisions[0].scene = original.scene;
    mutateVisualWorkspace(w => ({ ...w, artifacts: [original] }));
    useVisualViewStore.getState().orbit(original.id, .7, .25);
    const payload = parseArtifactClipboard(copyArtifactSnapshot(original.id))!;
    original.scene!.objects[0].color = '#ff0000';
    const first = await pasteArtifactSnapshot(payload);
    const second = await pasteArtifactSnapshot(payload);
    expect(new Set([original.id, first.id, second.id]).size).toBe(3);
    expect(first).toMatchObject({ label: 'Arduino UNO', width: 280, height: 220, linkedNodeId: original.linkedNodeId, origin: original.origin });
    expect(first.scene!.objects[0].color).toBe('#008080');
    expect(first.scene).not.toBe(second.scene);
    expect(first.revisions).not.toBe(second.revisions);
    expect([first.x, first.y]).toEqual([132, 232]);
    expect([second.x, second.y]).toEqual([164, 264]);
    expect(useVisualViewStore.getState().angles[first.id]).toBe(.7);
    expect(useVisualViewStore.getState().pitches[first.id]).toBe(.25);
    updateVisualArtifact(first.id, { x: 900 });
    removeVisualArtifact(original.id);
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts.map(a => [a.id, a.x])).toEqual([[first.id, 900], [second.id, 164]]);
    expect(normalizeVisualWorkspace(JSON.parse(JSON.stringify(getVisualWorkspace(useGraphStore.getState().project)))).artifacts).toHaveLength(2);
  });

  it('duplicates an image using its immutable local bytes even after the source is removed', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close() {} }));
    try {
      await importVisualMedia([{ id: 'clipboard-image', name: 'board.png', mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1sAAAAASUVORK5CYII=' }]);
      const image: VisualArtifact = { ...model(), kind: 'image', mediaId: 'clipboard-image', scene: null, revisions: [{ scene: null, mediaId: 'clipboard-image', createdAt: 1 }] };
      mutateVisualWorkspace(w => ({ ...w, artifacts: [image] }));
      const payload = parseArtifactClipboard(copyArtifactSnapshot(image.id))!;
      removeVisualArtifact(image.id);
      const copy = await pasteArtifactSnapshot(payload);
      expect(copy).toMatchObject({ kind: 'image', mediaId: 'clipboard-image', scene: null });
      expect(await readVisualMedia(copy.mediaId!)).not.toBeNull();
      expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
      const plan = useGraphStore.getState().project!;
      const pending = pasteArtifactSnapshot(payload);
      useGraphStore.setState({ project: { ...plan, id: 'another-plan' } });
      useGraphStore.setState({ project: plan });
      await expect(pending).rejects.toThrow('visualProjectChanged');
      expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('leaves unrelated text alone and rejects malformed, executable or foreign-project clipboard data', async () => {
    expect(parseArtifactClipboard('ordinary copied text')).toBeNull();
    mutateVisualWorkspace(w => ({ ...w, artifacts: [model()] }));
    const serialized = copyArtifactSnapshot('original');
    expect(() => parseArtifactClipboard(serialized.replace('"version":1', '"version":99'))).toThrow('visualClipboardInvalid');
    expect(() => parseArtifactClipboard(serialized.replace('"type":"box"', '"type":"script"'))).toThrow('visualClipboardInvalid');
    const payload = parseArtifactClipboard(serialized)!;
    useGraphStore.setState(state => ({ project: { ...state.project!, id: 'other-plan' } }));
    await expect(pasteArtifactSnapshot(payload)).rejects.toThrow('visualProjectChanged');
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
  });

  it('clears a deleted node link and refuses unavailable image bytes or a full canvas', async () => {
    const original = { ...model(), linkedNodeId: 'removed-node' };
    mutateVisualWorkspace(w => ({ ...w, artifacts: [original] }));
    const copy = await pasteArtifactSnapshot(parseArtifactClipboard(copyArtifactSnapshot(original.id))!);
    expect(copy.linkedNodeId).toBeNull();
    const missing = { ...model(), kind: 'image' as const, scene: null, mediaId: 'missing', revisions: [{ scene: null, mediaId: 'missing', createdAt: 1 }] };
    mutateVisualWorkspace(w => ({ ...w, artifacts: [missing] }));
    await expect(pasteArtifactSnapshot(parseArtifactClipboard(copyArtifactSnapshot(missing.id))!)).rejects.toThrow('visualMediaMissing');
    mutateVisualWorkspace(w => ({ ...w, artifacts: Array.from({ length: 512 }, (_, i) => ({ ...model(), id: `model-${i}` })) }));
    await expect(pasteArtifactSnapshot(parseArtifactClipboard(copyArtifactSnapshot('model-0'))!)).rejects.toThrow('visualArtifactLimit');
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(512);
  });
});
