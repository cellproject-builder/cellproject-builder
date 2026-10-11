import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import * as THREE from 'three';
import type { VisualArtifact } from '../types';
import { VisualCanvasLayer } from './VisualCanvasLayer';
import { useVisualViewStore } from './viewStore';
import { modelSceneFingerprint } from '../modelAssembly';

const audit = vi.hoisted(() => ({
  renderers: [] as Array<{ render: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; setSize: ReturnType<typeof vi.fn>; setViewport: ReturnType<typeof vi.fn> }>,
  geometries: [] as Array<{ dispose: MockInstance<() => void> }>,
  frames: new Map<number, FrameRequestCallback>(), nextFrame: 0,
  flow: new Set<() => void>(), observers: [] as Array<{ notify(): void; disconnect: ReturnType<typeof vi.fn> }>,
  viewport: { x: 0, y: 0, zoom: 1 }, hidden: false,
  nodes: new Map<string, { position: { x: number; y: number }; width?: number; height?: number; measured?: { width?: number; height?: number } }>(),
  selectionKeyPressed: false,
  assemblyCurrent: false, readMedia: vi.fn(),
}));
vi.mock('@xyflow/react', () => {
  const api = { getViewport: () => audit.viewport, getNode: (id: string) => audit.nodes.get(id) };
  const store = { subscribe: (listener: () => void) => { audit.flow.add(listener); return () => audit.flow.delete(listener); } };
  return { useReactFlow: () => api, useStoreApi: () => store };
});
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  return { ...actual, WebGLRenderer: class {
    render = vi.fn(); dispose = vi.fn(); setSize = vi.fn();
    setClearColor = vi.fn(); setPixelRatio = vi.fn(); getPixelRatio = () => 1;
    setScissorTest = vi.fn(); setViewport = vi.fn(); clear = vi.fn(); setScissor = vi.fn(); clearDepth = vi.fn();
    constructor() { audit.renderers.push(this); }
  } };
});
vi.mock('./objectGeometry', () => ({ objectGeometry: () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1), dispose = vi.spyOn(geometry, 'dispose'); audit.geometries.push({ dispose }); return geometry;
} }));
vi.mock('../decompositionState', () => ({ decompositionAssemblyCurrent: () => audit.assemblyCurrent }));
vi.mock('../media', () => ({ readVisualMedia: (...args: unknown[]) => audit.readMedia(...args) }));
vi.mock('../decompositionLayout', () => ({
  decompositionContextScene: (scene: unknown) => scene,
  layoutDecompositionGroups: (_scene: unknown, groups: Array<{ partId: string; objectIds: string[] }>) => groups.map(group => ({ ...group, explodeOffset: [3, 0, 0] })),
}));

const model = (id = 'motor'): VisualArtifact => ({ id, kind: 'model', label: id, x: 0, y: 0, width: 200, height: 180, mediaId: null, source: null, revisionIndex: 0, revisions: [], scene: { version: 1, label: id, objects: [{ id: 'body', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] } });
function assembledModel() {
  const artifact = model(); artifact.scene!.objects.push({ ...artifact.scene!.objects[0], id: 'cap', position: [2, 0, 0] });
  const groups = artifact.scene!.objects.map(object => ({ partId: object.id, name: object.id, objectIds: [object.id] }));
  artifact.assembly = { version: 1, summary: 'Fixture', sceneFingerprint: modelSceneFingerprint(artifact.scene!), groups, selectedNodeIds: [], selectedImageIds: [], sources: [], unknowns: [],
    plan: { units: 'illustrative', sharedConstraints: [], unknowns: [], interfaces: [], modules: groups.map(group => ({ id: group.partId, name: group.name, prompt: 'Fixture part', nodeIds: [], sourceIds: [], center: [0, 0, 0], size: [1, 1, 1], primitiveBudget: 1 })) } };
  return artifact;
}
let root: Root, host: HTMLDivElement;
const availability = vi.fn(); let time = 0;
async function render(artifacts = [model()]) { await act(async () => { root.render(<VisualCanvasLayer artifacts={artifacts} onAvailability={availability} />); }); }
async function frame(elapsed = 1000 / 60) {
  const first = audit.frames.entries().next().value;
  if (!first) return false;
  audit.frames.delete(first[0]); time += elapsed; await act(async () => first[1](time)); return true;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  audit.renderers.length = 0; audit.geometries.length = 0; audit.frames.clear(); audit.flow.clear(); audit.observers.length = 0; audit.nextFrame = 0; audit.hidden = false; audit.viewport = { x: 0, y: 0, zoom: 1 }; audit.nodes.clear(); audit.selectionKeyPressed = false; time = performance.now(); availability.mockClear(); audit.assemblyCurrent = false; audit.readMedia.mockReset();
  vi.stubGlobal('WebGL2RenderingContext', class {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { audit.frames.set(++audit.nextFrame, callback); return audit.nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => audit.frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { disconnect = vi.fn(); notify: () => void; constructor(callback: () => void) { this.notify = callback; audit.observers.push(this); } observe() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800); vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => audit.hidden);
  useVisualViewStore.setState({ angles: {}, pitches: {}, zooms: {}, explosions: {}, selectedParts: {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shared visual renderer lifecycle', () => {
  it('does not redraw 3D artifacts when flow notifications only change selection UI or another node', async () => {
    await render([model('left'), model('right')]); await frame();
    const renderer = audit.renderers[0]; expect(renderer.render).toHaveBeenCalledTimes(2);
    audit.selectionKeyPressed = true; for (const listener of audit.flow) listener();
    expect(audit.frames.size).toBe(0);
    audit.nodes.set('plan-step', { position: { x: 400, y: 300 } });
    for (const listener of audit.flow) listener();
    expect(audit.frames.size).toBe(0); expect(renderer.render).toHaveBeenCalledTimes(2);
  });

  it('repaints live movement and measured resizing even when the node lookup and records retain identity', async () => {
    const live = { position: { x: 0, y: 0 }, measured: { width: 200, height: 180 }, width: undefined as number | undefined, height: undefined as number | undefined };
    audit.nodes.set('visual:motor', live); await render(); await frame();
    const renderer = audit.renderers[0];
    live.position.x = 30; for (const listener of audit.flow) listener();
    expect(audit.frames.size).toBe(1); await frame();
    expect(renderer.setViewport).toHaveBeenLastCalledWith(30, 420, 200, 180);
    live.measured.width = 260; live.measured.height = 220;
    for (const listener of audit.flow) listener();
    expect(audit.frames.size).toBe(1); await frame();
    expect(renderer.setViewport).toHaveBeenLastCalledWith(30, 380, 260, 220);
    live.width = 280; live.height = 240; for (const listener of audit.flow) listener();
    expect(audit.frames.size).toBe(1); await frame();
    expect(renderer.setViewport).toHaveBeenLastCalledWith(30, 360, 280, 240);
    // Explicit dimensions win over measured dimensions in the renderer too.
    live.measured.width = 999; for (const listener of audit.flow) listener();
    expect(audit.frames.size).toBe(0); expect(renderer.render).toHaveBeenCalledTimes(4);
  });

  it('repaints camera transforms mutated in place and ignores subsequent unchanged notifications', async () => {
    await render(); await frame(); const renderer = audit.renderers[0];
    audit.viewport.x = 20; audit.viewport.y = 40; audit.viewport.zoom = 1.5;
    for (const listener of audit.flow) listener();
    expect(audit.frames.size).toBe(1); await frame();
    expect(renderer.setViewport).toHaveBeenLastCalledWith(20, 290, 300, 270);
    for (const listener of audit.flow) listener();
    expect(audit.frames.size).toBe(0); expect(renderer.render).toHaveBeenCalledTimes(2);
  });

  it('ignores views outside this canvas and unchanged views while retaining rotation of present models', async () => {
    await render([model('left'), model('right')]); await frame(); const renderer = audit.renderers[0];
    const views = useVisualViewStore.getState();
    views.orbit('another-canvas-model', .2, .1); views.zoomBy('another-canvas-model', -100);
    views.setExplosion('another-canvas-model', 1); views.selectPart('another-canvas-model', 'part');
    expect(audit.frames.size).toBe(0); expect(renderer.render).toHaveBeenCalledTimes(2);
    views.orbit('left', .2, .1); expect(audit.frames.size).toBe(1); await frame();
    expect(renderer.render).toHaveBeenCalledTimes(4);
    views.orbit('left', 0, 0); views.zoomBy('left', 0); views.setExplosion('left', 0); views.selectPart('left', null);
    expect(audit.frames.size).toBe(0);
  });

  it('rebases view comparisons when replacing an artifact with a previously configured model', async () => {
    const views = useVisualViewStore.getState(); views.zoomBy('right', -100);
    await render([model('left')]); await frame();
    await render([model('right')]); await frame();
    const renderer = audit.renderers[0], camera = renderer.render.mock.lastCall![1] as THREE.PerspectiveCamera;
    expect(camera.zoom).toBeGreaterThan(1);
    // Reset returns to the old artifact's value, but changes what is currently drawn.
    views.reset('right'); expect(audit.frames.size).toBe(1); await frame();
    expect(camera.zoom).toBe(1); expect(renderer.render).toHaveBeenCalledTimes(3);
  });

  it.each(['motor', 'replacement'])('rebases flow comparisons after replacing artifact geometry with ID %s', async id => {
    const artifact = model(); await render([artifact]); await frame();
    await render([{ ...artifact, id, x: 80, width: 240 }]); await frame();
    const renderer = audit.renderers[0];
    expect(renderer.setViewport).toHaveBeenLastCalledWith(80, 420, 240, 180);
    // React Flow can publish the original rectangle after a prop-based update,
    // including a replacement that keeps the same artifact ID.
    audit.nodes.set(`visual:${id}`, { position: { x: 0, y: 0 }, width: 200, height: 180 });
    for (const listener of audit.flow) listener();
    expect(audit.frames.size).toBe(1); await frame();
    expect(renderer.setViewport).toHaveBeenLastCalledWith(0, 420, 200, 180);
    expect(renderer.render).toHaveBeenCalledTimes(3);
  });

  it('stops at rest and repaints on viewport, 3D view and container changes', async () => {
    await render([model('left'), model('right')]); await frame();
    expect(audit.renderers[0].render).toHaveBeenCalledTimes(2); expect(audit.frames.size).toBe(0);
    audit.viewport = { x: 30, y: 10, zoom: 1.3 }; for (const listener of audit.flow) listener();
    expect(audit.frames.size).toBe(1); await frame(); expect(audit.renderers[0].render).toHaveBeenCalledTimes(4);
    useVisualViewStore.getState().orbit('left', .2, .1); useVisualViewStore.getState().zoomBy('left', -100);
    expect(audit.frames.size).toBe(1); await frame(); expect(audit.frames.size).toBe(0);
    audit.observers[0].notify(); expect(audit.frames.size).toBe(1); await frame(); expect(audit.frames.size).toBe(0);
  });

  it('retains the renderer and unchanged geometry when one model is edited or removed', async () => {
    const left = model('left'), right = model('right'); await render([left, right]); await frame();
    expect(audit.geometries).toHaveLength(2);
    await render([{ ...left, scene: { ...left.scene!, label: 'Edited' } }, right]); await frame();
    expect(audit.renderers).toHaveLength(1); expect(audit.geometries).toHaveLength(3);
    expect(audit.geometries[0].dispose).toHaveBeenCalledOnce(); expect(audit.geometries[1].dispose).not.toHaveBeenCalled();
    await render([right]); await frame(); expect(audit.renderers).toHaveLength(1);
    expect(audit.geometries[2].dispose).toHaveBeenCalledOnce(); expect(audit.geometries[1].dispose).not.toHaveBeenCalled();
  });

  it('pauses when hidden and releases frames, observers, subscriptions and GPU resources on unmount', async () => {
    await render(); await frame();
    audit.hidden = true; document.dispatchEvent(new Event('visibilitychange')); useVisualViewStore.getState().orbit('motor', .2, 0);
    expect(audit.frames.size).toBe(0);
    audit.hidden = false; document.dispatchEvent(new Event('visibilitychange')); expect(audit.frames.size).toBe(1); await frame();
    await act(async () => root.unmount());
    expect(audit.frames.size).toBe(0); expect(audit.flow.size).toBe(0); expect(audit.observers[0].disconnect).toHaveBeenCalledOnce();
    expect(audit.renderers[0].dispose).toHaveBeenCalledOnce(); expect(audit.geometries[0].dispose).toHaveBeenCalledOnce();
    root = createRoot(host);
  });

  it('animates an exploded assembly until it settles, then becomes idle again', async () => {
    const artifact = assembledModel();
    await render([artifact]); await frame();
    useVisualViewStore.getState().setExplosion(artifact.id, 1);
    let count = 0; while (await frame()) { if (++count > 200) throw new Error('Animation never settled'); }
    expect(count).toBeGreaterThan(2); expect(count).toBeLessThan(120); expect(audit.frames.size).toBe(0);
    useVisualViewStore.getState().setExplosion(artifact.id, 0);
    let reverse = 0; while (await frame()) { if (++reverse > 200) throw new Error('Reverse animation never settled'); }
    expect(reverse).toBeGreaterThan(2); expect(audit.frames.size).toBe(0);
  });

  it('starts an explosion smoothly after long idle periods and preserves elapsed time during animation', async () => {
    const artifact = assembledModel(); await render([artifact]); await frame();
    expect(audit.frames.size).toBe(0); time += 10_000;
    useVisualViewStore.getState().setExplosion(artifact.id, 1); await frame();
    const scene = audit.renderers[0].render.mock.lastCall![0] as THREE.Scene;
    const part = scene.getObjectByName('part:body')!;
    expect(part.position.x / 3).toBeCloseTo(1 - Math.exp(-9 / 60));
    await frame(1000 / 30);
    expect(part.position.x / 3).toBeCloseTo(1 - Math.exp(-9 * (1 / 60 + 1 / 30)));
    let count = 0; while (await frame()) { if (++count > 200) throw new Error('Animation never settled'); }
    time += 10_000; useVisualViewStore.getState().setExplosion(artifact.id, 0); await frame();
    expect(part.position.x / 3).toBeCloseTo(Math.exp(-9 / 60));
  });

  it('restores a lost WebGL context and resumes demand-driven drawing', async () => {
    await render(); await frame(); const canvas = host.querySelector('canvas')!;
    await act(async () => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    expect(availability.mock.lastCall?.[0]).toBe(false); expect(audit.frames.size).toBe(0);
    useVisualViewStore.getState().orbit('motor', .1, 0); expect(audit.frames.size).toBe(0);
    await act(async () => canvas.dispatchEvent(new Event('webglcontextrestored')));
    expect(audit.renderers).toHaveLength(2); expect(audit.renderers[0].dispose).toHaveBeenCalledOnce(); expect(audit.geometries[0].dispose).toHaveBeenCalledOnce();
    expect(availability.mock.lastCall?.[0]).toBe(true); await frame(); expect(audit.frames.size).toBe(0);
  });

  it('disposes an image that finishes loading after its artifact was removed', async () => {
    audit.readMedia.mockResolvedValue(new Blob(['image']));
    const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: () => 'blob:fixture', revokeObjectURL: revoke });
    let finish!: (texture: THREE.Texture<HTMLImageElement>) => void;
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render([{ ...model(), kind: 'image', scene: null, mediaId: 'media' }]);
    expect(finish).toBeTypeOf('function'); await render([]);
    const image = document.createElement('img'); image.width = 32; image.height = 24; const texture = new THREE.Texture(image); const disposed = vi.spyOn(texture, 'dispose');
    await act(async () => finish(texture));
    expect(disposed).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:fixture'); expect(audit.frames.size).toBe(0);
  });

  it('draws an image that finishes loading after the canvas has become idle', async () => {
    audit.readMedia.mockResolvedValue(new Blob(['image']));
    const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: () => 'blob:fixture', revokeObjectURL: revoke });
    let finish!: (texture: THREE.Texture<HTMLImageElement>) => void;
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render([model(), { ...model('reference'), kind: 'image', scene: null, mediaId: 'media' }]); await frame();
    expect(audit.renderers[0].render).toHaveBeenCalledOnce(); expect(audit.frames.size).toBe(0);
    const image = document.createElement('img'); image.width = 32; image.height = 24;
    await act(async () => finish(new THREE.Texture(image)));
    expect(audit.frames.size).toBe(1); await frame();
    expect(audit.renderers[0].render).toHaveBeenCalledTimes(3); expect(audit.frames.size).toBe(0);
    expect(revoke).toHaveBeenCalledWith('blob:fixture');
  });

  it('refreshes a dependent assembly when its original source model changes', async () => {
    audit.assemblyCurrent = true;
    const original = model('original'), child = model('child');
    Object.assign(child, { sourceArtifactId: original.id, decomposition: { assembly: { scene: child.scene, groups: [{ partId: 'body', objectIds: ['body'], explodeOffset: [3, 0, 0] }] } } });
    await render([original, child]); await frame(); expect(audit.geometries).toHaveLength(2);
    await render([{ ...original, scene: { ...original.scene!, label: 'Updated source' } }, child]); await frame();
    expect(audit.geometries).toHaveLength(4); expect(audit.geometries[1].dispose).toHaveBeenCalledOnce(); expect(audit.renderers).toHaveLength(1);
  });
});
