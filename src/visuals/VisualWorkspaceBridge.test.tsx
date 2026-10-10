import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDemoProject } from '@/data/demoProject';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { initializeWorkspace } from '@/workspace/planner';
import { useLocaleStore } from '@/i18n';
import { getVisualWorkspace, mutateVisualWorkspace } from './domain';
import { addLocalImage, addReferenceImage } from './media';
import { VisualWorkspaceBridge } from './VisualWorkspaceBridge';
import { REFERENCE_DRAG_TYPE } from './drag';
import type { ImageReference, VisualArtifact } from './types';

const mocks = vi.hoisted(() => ({ screenToFlowPosition: vi.fn(), warn: vi.fn() }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ screenToFlowPosition: mocks.screenToFlowPosition }) }));
vi.mock('@/components/ui/Toast', () => ({ toast: { show: mocks.warn } }));
vi.mock('./controller', () => ({
  setVisualPlacementResolver: vi.fn(), useVisualSearchStore: () => null,
  applyModelAtViewport: vi.fn(), runVisualGeneration: vi.fn(), runVisualSearch: vi.fn(),
}));
vi.mock('./ui/TabbedVisualExplorer', () => ({ TabbedVisualExplorer: () => null }));
vi.mock('./media', () => ({ addLocalImage: vi.fn(), addReferenceImage: vi.fn(), attachVisualFile: vi.fn(), readVisualMedia: vi.fn() }));
vi.mock('./clipboard', () => ({ copyVisualReference: vi.fn(), referenceFromClipboard: vi.fn() }));
vi.mock('./search', () => ({ reviewVisualReference: vi.fn() }));

const reference: ImageReference = { id: 'ref-a', title: 'Wide board', imageUrl: '/api/visuals/media?sessionId=s&candidateId=c', sourcePageUrl: 'https://example.com/board', description: '', credit: null, license: null, width: 400, height: 200, sessionId: 's' };
let container: HTMLDivElement;
let root: Root;
let nextId: number;
function artifact(source: ImageReference | null, point: { x: number; y: number }): VisualArtifact {
  return { id: `image-${nextId++}`, label: source?.title ?? 'Local image', kind: 'image', ...point, width: 340, height: 180, source, mediaId: 'm1', scene: null, revisions: [], revisionIndex: 0 };
}
function transfer(payload?: unknown, files: File[] = []): DataTransfer {
  return {
    types: payload ? [REFERENCE_DRAG_TYPE] : ['Files'],
    files, items: files.map(file => ({ kind: 'file', type: file.type })),
    getData: (type: string) => type === REFERENCE_DRAG_TYPE && payload ? JSON.stringify(payload) : '',
    dropEffect: 'none',
  } as unknown as DataTransfer;
}
async function drag(type: string, data: DataTransfer, target: HTMLElement = container, point = { x: 500, y: 350 }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { dataTransfer: { value: data }, clientX: { value: point.x }, clientY: { value: point.y }, relatedTarget: { value: null } });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
const hint = () => container.querySelector('.visual-drop-feedback');
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate(), useLocaleStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'plan-a' }, selectedNodeId: null });
  initializeWorkspace(); useLocaleStore.setState({ locale: 'pt-BR' }); nextId = 1;
  mocks.warn.mockReset();
  mocks.screenToFlowPosition.mockImplementation(({ x, y }) => ({ x: (x - 100) / 2, y: (y - 50) / 2 }));
  vi.mocked(addReferenceImage).mockReset().mockImplementation(async (ref, point) => {
    const image = artifact(ref, point);
    mutateVisualWorkspace(w => ({ ...w, artifacts: [...w.artifacts, image] }));
    return image;
  });
  vi.mocked(addLocalImage).mockReset().mockImplementation(async (_file, point) => {
    const image = artifact(null, point);
    mutateVisualWorkspace(w => ({ ...w, artifacts: [...w.artifacts, image] }));
    return image;
  });
  container = document.createElement('div'); document.body.append(container);
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 800, height: 600 } as DOMRect);
  root = createRoot(container);
  await act(async () => root.render(<VisualWorkspaceBridge project={useGraphStore.getState().project!} containerRef={{ current: container }} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('native image placement', () => {
  it('keeps the grabbed point under the cursor using decoded artifact bounds despite different search dimensions', async () => {
    const data = transfer({ projectId: 'plan-a', reference, anchor: { x: .25, y: .75 } });
    const over = await drag('dragover', data);
    expect(over.defaultPrevented).toBe(true); expect(data.dropEffect).toBe('copy');
    expect(hint()?.textContent).toContain('Solte para adicionar ao plano');
    await drag('drop', data);
    expect(mocks.screenToFlowPosition).toHaveBeenLastCalledWith({ x: 500, y: 350 });
    // Flow cursor = (200,150); decoded image = 340x180. The 400x200 source metadata must not add padding.
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts[0]).toMatchObject({ x: 115, y: 15, width: 340, height: 180 });
    expect(hint()).toBeNull();
  });

  it('centers image files using their inserted frame instead of the old fixed offset', async () => {
    await drag('drop', transfer(undefined, [new File(['png'], 'photo.png', { type: 'image/png' })]));
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts[0]).toMatchObject({ x: 30, y: 60 });
  });

  it('rejects a reference from another project without inserting it', async () => {
    await drag('drop', transfer({ projectId: 'plan-b', reference }));
    expect(addReferenceImage).not.toHaveBeenCalled();
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(0);
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it('leaves text editors and popup references to their own handlers', async () => {
    const data = transfer({ projectId: 'plan-a', reference });
    await drag('dragover', data); expect(hint()).not.toBeNull();
    for (const element of [document.createElement('textarea'), document.createElement('div')]) {
      if (element.tagName === 'DIV') element.dataset.visualPopup = 'search';
      container.append(element);
      expect((await drag('dragover', data, element)).defaultPrevented).toBe(false);
      expect(hint()).toBeNull();
      expect((await drag('drop', data, element)).defaultPrevented).toBe(false);
    }
    expect(addReferenceImage).not.toHaveBeenCalled();
  });

  it('does not advertise or intercept unsupported files and plain web links', async () => {
    const text = transfer(undefined, [new File(['text'], 'notes.txt', { type: 'text/plain' })]);
    expect((await drag('dragover', text)).defaultPrevented).toBe(false);
    expect(text.dropEffect).toBe('none'); expect(hint()).toBeNull();
    await drag('drop', text);
    const url = { types: ['text/uri-list'], items: [], files: [], getData: () => 'https://example.com/a.png', dropEffect: 'none' } as unknown as DataTransfer;
    expect((await drag('dragover', url)).defaultPrevented).toBe(false);
    expect(addLocalImage).not.toHaveBeenCalled(); expect(addReferenceImage).not.toHaveBeenCalled();
  });

  it('clears the target on leave, cancellation, outside hover and scope changes', async () => {
    const data = transfer({ projectId: 'plan-a', reference });
    await drag('dragover', data); await drag('dragleave', data); expect(hint()).toBeNull();
    await drag('dragover', data); await drag('dragend', data); expect(hint()).toBeNull();
    await drag('dragover', data); await drag('dragover', data, document.body); expect(hint()).toBeNull();
    await drag('dragover', data);
    await act(async () => useGraphStore.setState(s => ({ project: { ...s.project!, id: 'plan-b' } })));
    expect(hint()).toBeNull();
  });

  it('does not realign an async image if the project switches away and back while it loads', async () => {
    let resolve!: (value: VisualArtifact) => void;
    vi.mocked(addReferenceImage).mockImplementation(() => new Promise<VisualArtifact>(r => { resolve = r; }));
    await drag('drop', transfer({ projectId: 'plan-a', reference }));
    const project = useGraphStore.getState().project!;
    await act(async () => {
      useGraphStore.setState({ project: { ...project, id: 'plan-b' } });
      useGraphStore.setState({ project });
      resolve(artifact(reference, { x: 200, y: 150 }));
    });
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(0);
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it('coalesces repeated drops while the same reference is loading instead of moving it on completion', async () => {
    let resolve!: (value: VisualArtifact) => void;
    vi.mocked(addReferenceImage).mockImplementation((_reference, point) => new Promise<VisualArtifact>(r => {
      resolve = image => { mutateVisualWorkspace(w => ({ ...w, artifacts: [...w.artifacts, image] })); r(image); };
      expect(point).toEqual({ x: 200, y: 150 });
    }));
    const data = transfer({ projectId: 'plan-a', reference });
    await drag('drop', data);
    await drag('drop', data, container, { x: 800, y: 550 });
    expect(addReferenceImage).toHaveBeenCalledOnce();
    await act(async () => resolve(artifact(reference, { x: 200, y: 150 })));
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts[0]).toMatchObject({ x: 30, y: 60 });
  });
});
