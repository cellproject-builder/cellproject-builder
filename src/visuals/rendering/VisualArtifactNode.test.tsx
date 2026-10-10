import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeProps } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { useGraphStore } from '@/store';
import { buildDemoProject } from '@/data/demoProject';
import type { MentionTarget, VisualArtifact } from '../types';
import { VisualArtifactNode } from './VisualArtifactNode';
import { useVisualPopupStore } from '../ui/uiStore';
import { useVisualViewStore } from './viewStore';
import { torqueDiagram } from '../diagram/fixture';

vi.mock('@xyflow/react', () => ({
  NodeResizer: (props: unknown) => { mocks.resizer(props); return null; },
  useViewport: () => ({ x: 0, y: 0, zoom: mocks.zoom }),
  Handle: ({ id, type, isConnectable }: { id: string; type: string; isConnectable: boolean }) => <span data-handle-id={id} data-handle-type={type} data-connectable={String(isConnectable)} />,
  Position: { Bottom: 'bottom', Left: 'left', Right: 'right' },
  NodeToolbar: ({ children, isVisible }: { children: React.ReactNode; isVisible: boolean }) => isVisible ? children : null,
}));
vi.mock('../media', () => ({ readVisualMedia: (...args: unknown[]) => mocks.readMedia(...args) }));

const selectedImage: MentionTarget = { id: 'photo-1', kind: 'image', label: 'Measured arm', detail: 'Image on canvas', fingerprint: 'v1' };
const mocks = vi.hoisted(() => ({ listMentions: vi.fn(), handoff: vi.fn(), setLink: vi.fn(), updateGeometry: vi.fn(), revert: vi.fn(), readMedia: vi.fn(), resizer: vi.fn(), assemblyCurrent: vi.fn(), zoom: .3 }));
vi.mock('../domain', () => ({ listMentionTargets: mocks.listMentions, removeVisualArtifact: vi.fn(), revertVisualArtifact: mocks.revert, setVisualArtifactLink: mocks.setLink, updateVisualArtifact: mocks.updateGeometry }));
vi.mock('@/references/chatHandoff', () => ({ requestChatReferences: mocks.handoff }));
vi.mock('@/workspace/planner', () => ({ getPlannerOwnerId: () => 'managed-project-1' }));
vi.mock('../decompositionState', () => ({ decompositionAssemblyCurrent: mocks.assemblyCurrent }));
vi.mock('../ui/ModelArtifactEditor', () => ({ ModelArtifactEditor: ({ onClose }: { onClose: () => void }) => <div aria-label="Model adjustment"><button onClick={onClose}>Close editor</button></div> }));

let host: HTMLDivElement;
let root: Root;
const artifact: VisualArtifact = { id: 'photo-1', label: 'Measured arm', kind: 'image', x: 0, y: 0, width: 200, height: 200, mediaId: null, scene: null, source: null, revisions: [], revisionIndex: 0 };
async function render(value = artifact, interaction: { selected?: boolean; dragging?: boolean } = {}) {
  const node: NodeProps = { id: `visual:${value.id}`, type: 'visual', data: { artifact: value }, selected: true, dragging: false, draggable: true, selectable: true, deletable: true, zIndex: 0, isConnectable: false, positionAbsoluteX: 0, positionAbsoluteY: 0, width: value.width, height: value.height, ...interaction };
  await act(async () => root.render(<VisualArtifactNode {...node} />));
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await useLocaleStore.persist.rehydrate(); useLocaleStore.setState({ locale: 'en' });
  await useGraphStore.persist.rehydrate(); useGraphStore.setState({ project: buildDemoProject() });
  vi.clearAllMocks(); mocks.listMentions.mockReturnValue([selectedImage]);
  mocks.readMedia.mockResolvedValue(null); mocks.zoom = .3;
  mocks.assemblyCurrent.mockReturnValue(false);
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:canvas-image'), revokeObjectURL: vi.fn() });
  useVisualPopupStore.setState({ searchOpen: true, modelOpen: true, modelBase: null, inspectedArtifactId: null });
  useVisualViewStore.setState({ angles: {}, pitches: {}, explosions: {}, selectedParts: {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

async function openLinkControls() {
  const label = useLocaleStore.getState().locale === 'en' ? 'Edit node link' : 'Editar vínculo';
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}

describe('optional visual reference links', () => {
  it('renders a diagram in the same free artifact shell with node selection, a contextual pencil and no 3D controls', async () => {
    const project = useGraphStore.getState().project!;
    const diagram: VisualArtifact = { ...artifact, kind: 'diagram', diagram: torqueDiagram(project.rootId, project.rootId), diagramValues: {}, width: 460, height: 296 };
    await render(diagram);
    expect(host.querySelector(`svg[aria-label="${diagram.diagram!.title}"]`)).not.toBeNull();
    const linkedElement = host.querySelector<SVGElement>('[data-element-id="joint"]')!;
    await act(async () => linkedElement.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useGraphStore.getState().selectedNodeId).toBe(project.rootId);
    expect(host.querySelector('[aria-label="Rotate 3D"]')).toBeNull(); expect(host.textContent).not.toContain('Decompose');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Edit diagram"]')!.click());
    expect(host.querySelector('[aria-label="Model adjustment"]')).not.toBeNull();
    expect(mocks.resizer.mock.calls.at(-1)![0]).toMatchObject({ minWidth: 240, minHeight: 160, keepAspectRatio: false });
  });
  it('offers a compact edit action only for a selected 3D model and keeps rotation icon-only', async () => {
    const model: VisualArtifact = { ...artifact, kind: 'model', scene: { version: 1, label: 'Motor', objects: [] } };
    mocks.zoom = 1; await render(model);
    const edit = host.querySelector<HTMLButtonElement>('[aria-label="Edit 3D model"]');
    expect(edit).not.toBeNull();
    expect(host.querySelector('[aria-label="Rotate 3D"]')?.textContent?.trim()).toBe('↻');
    await act(async () => edit!.click()); expect(host.querySelector('[aria-label="Model adjustment"]')).not.toBeNull();
    await render(model, { selected: false }); expect(host.querySelector('[aria-label="Model adjustment"]')).toBeNull();
    await render(artifact); expect(host.querySelector('[aria-label="Edit 3D model"]')).toBeNull();
  });
  it('Ctrl+wheel zooms an unselected model view and stops canvas zoom without changing artifact geometry', async () => {
    const model: VisualArtifact = { ...artifact, kind: 'model', scene: { version: 1, label: 'Motor', objects: [] } };
    useVisualViewStore.setState({ zooms: {} }); await render(model, { selected: false });
    const paneWheel = vi.fn(); host.addEventListener('wheel', paneWheel);
    const surface = host.querySelector('.visual-drag-surface')!;
    const wheel = new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true });
    await act(async () => surface.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true); expect(paneWheel).not.toHaveBeenCalled();
    expect(useVisualViewStore.getState().zooms[model.id]).toBeGreaterThan(1);
    expect(host.querySelector('.visual-artifact.is-selected')).toBeNull(); expect(mocks.updateGeometry).not.toHaveBeenCalled();
    surface.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })); expect(paneWheel).toHaveBeenCalledOnce();
    host.removeEventListener('wheel', paneWheel);
  });
  it('offers a free image and the current plan nodes, linking without changing geometry', async () => {
    await render();
    await openLinkControls();
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Link to a node"]')!;
    const node = Object.values(useGraphStore.getState().project!.nodes)[0];
    expect(select.value).toBe('');
    expect(select.options[0].text).toBe('Free image');
    expect([...select.options].some(option => option.value === node.id && option.text === node.name)).toBe(true);
    await act(async () => { select.value = node.id; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(mocks.setLink).toHaveBeenCalledWith(artifact.id, node.id);
    expect(mocks.updateGeometry).not.toHaveBeenCalled();
  });

  it('shows the linked node, explains free movement and lets the user unlink directly', async () => {
    const node = Object.values(useGraphStore.getState().project!.nodes)[0];
    await render({ ...artifact, linkedNodeId: node.id });
    await openLinkControls();
    expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe(node.id);
    expect(host.querySelector('.visual-drag-surface')!.getAttribute('title')).toBe('The link is a reference. You can move this object freely.');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Unlink from node"]')!.click());
    expect(mocks.setLink).toHaveBeenCalledWith(artifact.id, null);
    expect(mocks.updateGeometry).not.toHaveBeenCalled();
    const handle = host.querySelector('[data-handle-id="visual-link"]');
    expect(handle?.getAttribute('data-handle-type')).toBe('target');
    expect(handle?.getAttribute('data-connectable')).toBe('false');
  });

  it('treats a removed node as a free image and allows relinking to another node', async () => {
    const [removed, next] = Object.values(useGraphStore.getState().project!.nodes);
    await render({ ...artifact, linkedNodeId: removed.id });
    await openLinkControls();
    await act(async () => useGraphStore.setState(state => ({ project: { ...state.project!, nodes: Object.fromEntries(Object.entries(state.project!.nodes).filter(([id]) => id !== removed.id)) } })));
    const select = host.querySelector<HTMLSelectElement>('select')!;
    expect(select.value).toBe('');
    expect(host.querySelector('[aria-label="Unlink from node"]')).toBeNull();
    await act(async () => { select.value = next.id; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(mocks.setLink).toHaveBeenCalledWith(artifact.id, next.id);
  });

  it('translates link controls and supports generated objects as free references', async () => {
    useLocaleStore.setState({ locale: 'pt-BR' });
    await render({ ...artifact, id: 'model-1', kind: 'model' });
    await openLinkControls();
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Vincular a um node"]')!;
    expect(select.options[0].text).toBe('Objeto livre');
    const node = Object.values(useGraphStore.getState().project!.nodes)[0];
    await render({ ...artifact, linkedNodeId: node.id });
    await openLinkControls();
    expect(host.querySelector('[aria-label="Desvincular do node"]')).not.toBeNull();
    const imageSelect = host.querySelector<HTMLSelectElement>('select')!;
    await act(async () => { imageSelect.value = ''; imageSelect.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(mocks.setLink).toHaveBeenCalledWith(artifact.id, null);
  });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('compact image editing', () => {
  it('keeps the node selector collapsed until requested and closes it with Escape', async () => {
    await render();
    expect(host.querySelector('select')).toBeNull();
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Edit node link"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await openLinkControls();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const select = host.querySelector('select')!;
    expect(document.activeElement).toBe(select);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => select.dispatchEvent(escape));
    expect(host.querySelector('select')).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(escape.defaultPrevented).toBe(true);
    expect(mocks.setLink).not.toHaveBeenCalled();
  });

  it('fits a legacy image frame to the decoded image while preserving its visible position', async () => {
    const legacy = { ...artifact, mediaId: 'media-square', x: 40, y: 50, width: 280, height: 220 };
    useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { version: 1, mode: 'approval', artifacts: [legacy], proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } } } }));
    mocks.readMedia.mockResolvedValue(new Blob(['image']));
    await render(legacy, { dragging: true });
    const image = host.querySelector('img')!;
    Object.defineProperties(image, { naturalWidth: { value: 416 }, naturalHeight: { value: 416 } });
    await act(async () => image.dispatchEvent(new Event('load')));
    expect(mocks.updateGeometry).not.toHaveBeenCalled();
    await render(legacy);
    expect(mocks.updateGeometry).toHaveBeenCalledWith(legacy.id, { x: 70, y: 50, width: 220, height: 220 });
  });

  it.each(['removed', 'replaced', 'project changed'])('ignores a late image load when the image is %s', async mode => {
    const legacy = { ...artifact, mediaId: 'media-old', width: 280, height: 220 };
    useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { version: 1, mode: 'approval', artifacts: [legacy], proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } } } }));
    mocks.readMedia.mockResolvedValue(new Blob(['image']));
    await render(legacy, { dragging: true });
    const image = host.querySelector('img')!;
    Object.defineProperties(image, { naturalWidth: { value: 416 }, naturalHeight: { value: 416 } });
    await act(async () => image.dispatchEvent(new Event('load')));
    await act(async () => useGraphStore.setState(state => ({ project: { ...state.project!, id: mode === 'project changed' ? 'other-project' : state.project!.id,
      visuals: { ...state.project!.visuals!, artifacts: mode === 'removed' ? [] : [{ ...legacy, mediaId: mode === 'replaced' ? 'media-new' : legacy.mediaId }] } } })));
    await render(legacy);
    expect(mocks.updateGeometry).not.toHaveBeenCalled();
  });

  it('defers fitting during resize and uses the latest position and dimensions afterward', async () => {
    const legacy = { ...artifact, mediaId: 'media-resize', width: 280, height: 220 };
    useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { version: 1, mode: 'approval', artifacts: [legacy], proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } } } }));
    mocks.readMedia.mockResolvedValue(new Blob(['image']));
    await render(legacy);
    const resizer = mocks.resizer.mock.lastCall![0];
    await act(async () => resizer.onResizeStart());
    const image = host.querySelector('img')!;
    Object.defineProperties(image, { naturalWidth: { value: 416 }, naturalHeight: { value: 416 } });
    await act(async () => image.dispatchEvent(new Event('load')));
    expect(mocks.updateGeometry).not.toHaveBeenCalled();
    const updated = { x: 80, y: 90, width: 560, height: 440 };
    await act(async () => {
      useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { ...state.project!.visuals!, artifacts: [{ ...legacy, ...updated }] } } }));
      resizer.onResizeEnd(null, updated);
    });
    expect(mocks.updateGeometry).toHaveBeenLastCalledWith(legacy.id, { x: 140, y: 90, width: 440, height: 440 });
  });
});

describe('canvas reference handoff', () => {
  it('offers the entire object as a drag target before selection, with actions only after selection', async () => {
    await render(artifact, { selected: false });
    const surface = host.querySelector('.visual-drag-surface');
    expect(surface?.getAttribute('aria-label')).toBe('Move: Measured arm');
    expect(host.querySelector('[aria-label="Remove object"]')).toBeNull();
    await render();
    expect(host.querySelector('[aria-label="Remove object"]')).not.toBeNull();
  });
  it('hides actions during movement and exposes the dragging state for cursor feedback', async () => {
    await render(artifact, { selected: true, dragging: true });
    expect(host.querySelector('.visual-artifact.is-dragging')).not.toBeNull();
    expect(host.querySelector('[aria-label="Remove object"]')).toBeNull();
    await render();
    expect(host.querySelector('.visual-artifact.is-dragging')).toBeNull();
    expect(host.querySelector('[aria-label="Remove object"]')).not.toBeNull();
  });
  it('hands only the selected canvas photo to chat using the workspace project identity', async () => {
    await render();
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Discuss: Measured arm"]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(mocks.handoff).toHaveBeenCalledWith('managed-project-1', [selectedImage]);
    expect(mocks.listMentions).toHaveBeenCalledWith('');
    expect(useVisualPopupStore.getState().searchOpen).toBe(false);
    expect(useVisualPopupStore.getState().modelOpen).toBe(false);
  });
  it('does not send a removed or changed canvas selection and translates the discussion action', async () => {
    await useLocaleStore.setState({ locale: 'pt-BR' });
    mocks.listMentions.mockReturnValue([{ ...selectedImage, id: 'another-photo' }]);
    await render();
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Conversar sobre: Measured arm"]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(mocks.handoff).not.toHaveBeenCalled();
  });
  it('does not misrepresent a generated model as an image reference', async () => {
    await render({ ...artifact, id: 'model-1', kind: 'model', label: 'Arm model' });
    expect(host.querySelector('[aria-label^="Discuss:"]')).toBeNull();
  });
});

function pointer(surface: Element, type: string, values: Partial<PointerEvent> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 7, pointerType: 'mouse', button: 0, isPrimary: true, clientX: 30, clientY: 40, ...values });
  surface.dispatchEvent(event);
  return event;
}

describe('interactive model view', () => {
  const model: VisualArtifact = { ...artifact, id: 'model-1', kind: 'model', label: 'Arm model' };

  it('rotates an unselected model with Ctrl without selecting or exposing editing controls', async () => {
    await render(model, { selected: false });
    const surface = host.querySelector<HTMLDivElement>('.visual-drag-surface')!;
    const graphEvents: string[] = [];
    const observe = (event: Event) => graphEvents.push(event.type);
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick']) document.addEventListener(type, observe);
    const documentBefore = useGraphStore.getState().project;
    const popupsBefore = useVisualPopupStore.getState();
    try {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
        pointer(surface, 'pointerdown', { ctrlKey: true });
        surface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, ctrlKey: true }));
        pointer(surface, 'pointermove', { ctrlKey: true, clientX: 110, clientY: 75 });
      });
      expect(useVisualViewStore.getState().angles[model.id]).toBeCloseTo(.96);
      expect(useVisualViewStore.getState().pitches[model.id]).toBeCloseTo(.42);
      expect(host.querySelector('.visual-artifact.is-selected')).toBeNull();
      expect(host.querySelector('.visual-artifact.is-quick-orbit')).not.toBeNull();
      expect(host.querySelector('.visual-artifact-controls')).toBeNull();
      expect(mocks.resizer.mock.lastCall![0].isVisible).toBe(false);
      // The compatibility click may arrive after Control has already been released.
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
        pointer(surface, 'pointerup');
        surface.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        surface.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      });
      expect(graphEvents).toEqual([]);
      expect(useGraphStore.getState().project).toBe(documentBefore);
      expect(useVisualPopupStore.getState()).toBe(popupsBefore);
      expect(mocks.updateGeometry).not.toHaveBeenCalled();
      // An ordinary gesture after the shortcut still reaches the graph.
      await act(async () => {
        pointer(surface, 'pointerdown');
        surface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        surface.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(graphEvents).toEqual(['pointerdown', 'mousedown', 'click']);
    } finally {
      for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick']) document.removeEventListener(type, observe);
    }
  });

  it('temporarily hides selected-model controls while Control is held and restores the previous mode', async () => {
    await render(model);
    await openLinkControls();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true })));
    expect(host.querySelector('.visual-artifact-controls')).toBeNull();
    expect(mocks.resizer.mock.lastCall![0].isVisible).toBe(false);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' })));
    expect(host.querySelector('[aria-label="Rotate 3D"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('select')).not.toBeNull();
    expect(mocks.resizer.mock.lastCall![0].isVisible).toBe(true);
  });

  it.each(['pointercancel', 'lostpointercapture', 'blur', 'keyup'])('ends the temporary orbit on %s', async ending => {
    await render(model, { selected: false });
    const surface = host.querySelector<HTMLDivElement>('.visual-drag-surface')!;
    await act(async () => {
      pointer(surface, 'pointerdown', { ctrlKey: true });
      pointer(surface, 'pointermove', { ctrlKey: true, clientX: 60 });
      if (ending === 'blur') window.dispatchEvent(new Event('blur'));
      else if (ending === 'keyup') window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
      else pointer(surface, ending, { ctrlKey: true });
      pointer(surface, 'pointermove', { ctrlKey: true, clientX: 120 });
    });
    expect(useVisualViewStore.getState().angles[model.id]).toBeCloseTo(.36);
    expect(mocks.updateGeometry).not.toHaveBeenCalled();
  });

  it('leaves Ctrl interactions on images and secondary mouse buttons to their existing handlers', async () => {
    await render(artifact, { selected: false });
    const imageSurface = host.querySelector('.visual-drag-surface')!;
    let down!: Event;
    await act(async () => {
      down = pointer(imageSurface, 'pointerdown', { ctrlKey: true });
      pointer(imageSurface, 'pointermove', { ctrlKey: true, clientX: 100 });
    });
    expect(down.defaultPrevented).toBe(false);
    expect(useVisualViewStore.getState().angles[artifact.id]).toBeUndefined();
    await render(model, { selected: false });
    const modelSurface = host.querySelector('.visual-drag-surface')!;
    await act(async () => {
      down = pointer(modelSurface, 'pointerdown', { ctrlKey: true, button: 2 });
      pointer(modelSurface, 'pointermove', { ctrlKey: true, clientX: 100 });
    });
    expect(down.defaultPrevented).toBe(false);
    expect(useVisualViewStore.getState().angles[model.id]).toBeUndefined();
  });

  it('separates moving an object from rotating its view with a mouse or touch', async () => {
    await render(model);
    const surface = host.querySelector<HTMLDivElement>('.visual-drag-surface')!;
    const rotate = host.querySelector<HTMLButtonElement>('[aria-label="Rotate 3D"]');
    expect(rotate).not.toBeNull();
    expect(rotate!.getAttribute('aria-pressed')).toBe('false');
    await act(async () => pointer(surface, 'pointerdown'));
    expect(useVisualViewStore.getState().angles[model.id]).toBeUndefined();
    await act(async () => rotate!.click());
    expect(surface.classList.contains('nodrag')).toBe(true);
    expect(surface.classList.contains('nopan')).toBe(true);
    expect(host.textContent).toContain('Drag or swipe to rotate');
    const capture = vi.fn(); Object.assign(surface, { setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
    const parentDown = vi.fn(); document.addEventListener('pointerdown', parentDown);
    await act(async () => {
      pointer(surface, 'pointerdown', { pointerType: 'touch' });
      pointer(surface, 'pointermove', { pointerType: 'touch', clientX: 110, clientY: 75 });
      pointer(surface, 'pointerup', { pointerType: 'touch', clientX: 110, clientY: 75 });
    });
    expect(capture).toHaveBeenCalledWith(7);
    expect(parentDown).not.toHaveBeenCalled();
    document.removeEventListener('pointerdown', parentDown);
    expect(useVisualViewStore.getState().angles[model.id]).toBeGreaterThan(0);
    expect(useVisualViewStore.getState().pitches[model.id]).toBeGreaterThan(0);
    expect(mocks.updateGeometry).not.toHaveBeenCalled();
    const angle = useVisualViewStore.getState().angles[model.id];
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Move object"]')!.click());
    expect(surface.classList.contains('nodrag')).toBe(false);
    await act(async () => pointer(surface, 'pointermove', { clientX: 160 }));
    expect(useVisualViewStore.getState().angles[model.id]).toBe(angle);
  });

  it('supports keyboard rotation, reset and Escape without changing the document', async () => {
    await render(model);
    const rotate = host.querySelector<HTMLButtonElement>('[aria-label="Rotate 3D"]');
    expect(rotate).not.toBeNull();
    await act(async () => rotate!.click());
    const surface = host.querySelector<HTMLDivElement>('.visual-drag-surface')!;
    expect(document.activeElement).toBe(surface);
    await act(async () => {
      surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    });
    expect(useVisualViewStore.getState().angles[model.id]).toBeGreaterThan(0);
    expect(useVisualViewStore.getState().pitches[model.id]).toBeLessThan(0);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Reset view"]')!.click());
    expect(useVisualViewStore.getState().angles[model.id]).toBe(0);
    expect(useVisualViewStore.getState().pitches[model.id]).toBe(0);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => surface.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(host.querySelector('[aria-label="Rotate 3D"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(mocks.updateGeometry).not.toHaveBeenCalled();
  });

  it('ends a rotation gesture on cancellation or deselection and offers Portuguese controls', async () => {
    useLocaleStore.setState({ locale: 'pt-BR' });
    await render(model);
    const rotate = host.querySelector<HTMLButtonElement>('[aria-label="Girar 3D"]');
    expect(rotate).not.toBeNull();
    await act(async () => rotate!.click());
    const surface = host.querySelector<HTMLDivElement>('.visual-drag-surface')!;
    await act(async () => {
      pointer(surface, 'pointerdown');
      pointer(surface, 'pointermove', { clientX: 80 });
      pointer(surface, 'pointercancel');
    });
    const angle = useVisualViewStore.getState().angles[model.id];
    await act(async () => pointer(surface, 'pointermove', { clientX: 150 }));
    expect(useVisualViewStore.getState().angles[model.id]).toBe(angle);
    await render(model, { selected: false });
    expect(surface.classList.contains('nodrag')).toBe(false);
    await render(model);
    expect(host.querySelector('[aria-label="Girar 3D"]')?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('integrated decomposition inspection', () => {
  const model: VisualArtifact = { ...artifact, id: 'model-1', kind: 'model', label: 'Arduino Uno R3' };

  it('opens decomposition for the selected model in the existing studio without adding a second canvas artifact', async () => {
    await render(model);
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Decompose model"]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(useVisualPopupStore.getState().inspectedArtifactId).toBe(model.id);
    expect(useVisualPopupStore.getState().modelOpen).toBe(true);
    expect(mocks.updateGeometry).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Show exploded view"]')).toBeNull();
  });

  it('offers reversible exploded view only for a current assembly and keeps inspection out of persistent geometry', async () => {
    mocks.assemblyCurrent.mockReturnValue(true);
    const child = { ...model, sourceArtifactId: 'original-board' } as VisualArtifact;
    await render(child);
    useVisualViewStore.getState().orbit(model.id, .4, .3);
    const explode = host.querySelector<HTMLButtonElement>('[aria-label="Show exploded view"]')!;
    expect(explode).not.toBeNull();
    expect(explode.getAttribute('aria-pressed')).toBe('false');
    await act(async () => explode.click());
    expect(useVisualViewStore.getState().explosions[model.id]).toBe(1);
    const assembled = host.querySelector<HTMLButtonElement>('[aria-label="Assemble model"]')!;
    expect(assembled.getAttribute('aria-pressed')).toBe('true');
    await act(async () => assembled.click());
    expect(useVisualViewStore.getState().explosions[model.id]).toBe(0);
    expect(useVisualViewStore.getState().angles[model.id]).toBeCloseTo(.4);
    expect(useVisualViewStore.getState().pitches[model.id]).toBeCloseTo(.3);
    expect(mocks.updateGeometry).not.toHaveBeenCalled();
    mocks.assemblyCurrent.mockReturnValue(false);
    await render(child);
    expect(host.querySelector('[aria-label="Show exploded view"]')).toBeNull();
  });

  it('keeps parent assembly controls off and lets a child navigate back without mutating either model', async () => {
    const withAssembly = { ...model, decomposition: { assembly: {} } } as VisualArtifact;
    await render(withAssembly);
    expect(host.querySelector('[aria-label="Restore original model"]')).toBeNull();
    expect(host.querySelector('[aria-label="Show exploded view"]')).toBeNull();
    const child = { ...withAssembly, id: 'components', sourceArtifactId: model.id } as VisualArtifact;
    await render(child);
    expect(host.querySelector('[aria-label="Decompose model"]')).toBeNull();
    expect(host.querySelector('[aria-label="Inspect components"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Back to original"]')!.click());
    expect(useVisualPopupStore.getState().inspectedArtifactId).toBe(model.id);
    expect(mocks.revert).not.toHaveBeenCalled();
    await act(async () => useLocaleStore.setState({ locale: 'pt-BR' }));
    expect(host.querySelector('[aria-label="Voltar ao original"]')).not.toBeNull();
    const sourceHandle = host.querySelector('[data-handle-id="visual-origin"]');
    expect(sourceHandle?.getAttribute('data-handle-type')).toBe('source');
    expect(sourceHandle?.getAttribute('data-connectable')).toBe('false');
  });

  it('opens an existing linked decomposition from the original without replacing its geometry', async () => {
    const child = { ...model, id: 'components', sourceArtifactId: model.id } as VisualArtifact;
    const currentOriginal = { ...model, decomposition: { assemblyArtifactId: 'components' } } as VisualArtifact;
    const historical = { ...child, id: 'older-components' };
    await act(async () => useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { version: 1, mode: 'approval', artifacts: [currentOriginal, historical, child], proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } } } })));
    mocks.assemblyCurrent.mockReturnValue(true);
    await render(currentOriginal);
    expect(host.querySelector('[aria-label="Show exploded view"]')).toBeNull();
    const open = host.querySelector<HTMLButtonElement>('[aria-label="Open decomposition"]');
    expect(open).not.toBeNull();
    await act(async () => open!.click());
    expect(useVisualPopupStore.getState().inspectedArtifactId).toBe('components');
    expect(mocks.updateGeometry).not.toHaveBeenCalled();
  });

  it('translates compact actions and lets images open research without offering exploded controls', async () => {
    useLocaleStore.setState({ locale: 'pt-BR' });
    mocks.assemblyCurrent.mockReturnValue(true);
    await render(model);
    expect(host.querySelector('[aria-label="Decompor modelo"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Ver visão explodida"]')).toBeNull();
    await render({ ...model, sourceArtifactId: 'original-board' } as VisualArtifact);
    expect(host.querySelector('[aria-label="Inspecionar componentes"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Ver visão explodida"]')).not.toBeNull();
    await render(artifact);
    expect(host.querySelector('[aria-label="Decompor modelo"]')).toBeNull();
    expect(host.querySelector('[aria-label="Ver visão explodida"]')).toBeNull();
    const decompose = host.querySelector<HTMLButtonElement>('[aria-label="Decompor imagem"]');
    expect(decompose).not.toBeNull();
    await act(async () => decompose!.click());
    expect(useVisualPopupStore.getState().inspectedArtifactId).toBe(artifact.id);
    expect(useVisualPopupStore.getState().modelOpen).toBe(true);
    expect(host.querySelector('[aria-label="Usar como base 3D"]')).not.toBeNull();
    await act(async () => useLocaleStore.setState({ locale: 'en' }));
    await render(artifact);
    expect(host.querySelector('[aria-label="Decompose image"]')).not.toBeNull();
  });
});
