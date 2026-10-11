import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { buildDemoProject } from '@/data/demoProject';
import { initializeWorkspace } from '@/workspace/planner';
import { getVisualWorkspace, mutateVisualWorkspace } from '@/visuals/domain';
import * as runtime from '@/cloud/runtime';
import { hasActiveDataIngestions } from '@/cloud/activity';
import { collectUnreferencedVisualMedia, readVisualMedia, storeCanvasFile } from '@/visuals/media';
import { collectVisualMediaIds, exportVisualPlan, prepareVisualPlanImport } from '@/visuals/portable';
import type { CanvasResource } from './canvasModel';

beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, boards: {}, activeBoardId: null, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'canvas-storage-plan' } }); initializeWorkspace();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local attachment storage must not call an external service'); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function textResource(scope: string): Promise<CanvasResource> {
  const media = await storeCanvasFile(new File(['Conteúdo original'], 'referencia.txt', { type: 'text/plain' }), scope);
  return { id: `resource-${media.id}`, name: 'referencia.txt', kind: 'text', mediaId: media.id, mime: 'text/plain', size: media.size, text: 'Conteúdo original', url: null, addedAt: Date.now() };
}

describe('canvas attachment original retention and portability', () => {
  it('keeps originals referenced by an inactive or archived board and collects them after removal', async () => {
    const boardId = useWorkspaceStore.getState().createBoard('Biblioteca de bancada');
    const resource = await textResource(`board:${boardId}`);
    useWorkspaceStore.getState().updateBoard(boardId, { attachments: { resources: [resource], cards: [] } });
    useWorkspaceStore.setState({ activeBoardId: null });
    await collectUnreferencedVisualMedia(Date.now() + 60 * 60 * 1000);
    expect(await readVisualMedia(resource.mediaId!)).not.toBeNull();
    useWorkspaceStore.getState().updateBoard(boardId, { archived: true });
    await collectUnreferencedVisualMedia(Date.now() + 60 * 60 * 1000);
    expect(await readVisualMedia(resource.mediaId!)).not.toBeNull();
    useWorkspaceStore.getState().updateBoard(boardId, { attachments: { resources: [], cards: [] } });
    await collectUnreferencedVisualMedia(Date.now() + 60 * 60 * 1000);
    expect(await readVisualMedia(resource.mediaId!)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('includes a library-only original in portable plan export/import without requiring a card or 3D artifact', async () => {
    const resource = await textResource('planner:canvas-storage-plan');
    mutateVisualWorkspace(workspace => ({ ...workspace, attachments: { resources: [resource], cards: [] } }));
    const project = useGraphStore.getState().project!;
    expect(collectVisualMediaIds(project)).toEqual([resource.mediaId]);
    const exported = await exportVisualPlan(project);
    expect('media' in exported && exported.media).toEqual([expect.objectContaining({ id: resource.mediaId, name: resource.name, mime: resource.mime })]);
    const restored = await prepareVisualPlanImport(JSON.parse(JSON.stringify(exported)));
    expect(getVisualWorkspace(restored).attachments?.resources).toEqual([resource]);
    expect((await readVisualMedia(resource.mediaId!))?.size).toBe(resource.size);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an envelope with missing original bytes instead of silently retaining broken library metadata', async () => {
    const resource = await textResource('planner:canvas-storage-plan');
    mutateVisualWorkspace(workspace => ({ ...workspace, attachments: { resources: [resource], cards: [] } }));
    const exported = await exportVisualPlan(useGraphStore.getState().project!);
    expect('media' in exported).toBe(true);
    await expect(prepareVisualPlanImport({ ...exported, media: [] })).rejects.toThrow('visualMediaMissing');
  });

  it('never returns original bytes loaded by a runtime that changed while awaiting them', async () => {
    let resolve: (bytes: ArrayBuffer) => void = () => {};
    const cloud = { media: () => [{ id: 'private-original', mime: 'text/plain' }], readMedia: vi.fn(() => new Promise<ArrayBuffer>(done => { resolve = done; })) };
    let current = cloud as unknown as ReturnType<typeof runtime.getCloudRuntime>;
    vi.spyOn(runtime, 'getCloudRuntime').mockImplementation(() => current);
    const pending = readVisualMedia('private-original');
    expect(cloud.readMedia).toHaveBeenCalledOnce(); current = null; resolve(new ArrayBuffer(16));
    await expect(pending).rejects.toThrow('visualProjectChanged');
  });

  it('rejects a completed upload after runtime replacement without forwarding bytes to the new account', async () => {
    const next = { writeMedia: vi.fn() };
    const original = { media: () => [], writeMedia: vi.fn(async () => { current = next as unknown as ReturnType<typeof runtime.getCloudRuntime>; }) };
    let current = original as unknown as ReturnType<typeof runtime.getCloudRuntime>;
    vi.spyOn(runtime, 'getCloudRuntime').mockImplementation(() => current);
    await expect(storeCanvasFile(new File(['Private original'], 'original.txt', { type: 'text/plain' }), 'board:private')).rejects.toThrow('visualProjectChanged');
    expect(original.writeMedia).toHaveBeenCalledOnce(); expect(next.writeMedia).not.toHaveBeenCalled();
    expect(hasActiveDataIngestions()).toBe(false);
  });
});
