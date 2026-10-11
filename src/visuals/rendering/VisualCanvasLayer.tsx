import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useStoreApi } from '@xyflow/react';
import * as THREE from 'three';
import type { VisualArtifact } from '../types';
import { readVisualMedia } from '../media';
import { decompositionAssemblyCurrent } from '../decompositionState';
import { decompositionContextScene, layoutDecompositionGroups } from '../decompositionLayout';
import { modelAssemblyCurrent } from '../modelAssembly';
import { artifactScreenRect, containedImageRect, viewportPass } from './geometry';
import { useVisualViewStore } from './viewStore';
import { modelItem, type RenderItem } from './modelItem';
export { modelItem } from './modelItem';

/** The complete source remains visible. Only a separate linked artifact owns the exploded inspection. */
export function modelArtifactItem(artifact: VisualArtifact, original?: VisualArtifact): RenderItem | null {
  if (artifact.kind !== 'model' || !artifact.scene) return null;
  const assembly = artifact.sourceArtifactId && decompositionAssemblyCurrent(artifact) ? artifact.decomposition?.assembly : undefined;
  if (assembly && original && original.id === artifact.sourceArtifactId && original.scene) {
    const scene = decompositionContextScene(assembly.scene, original.scene);
    return modelItem(scene, layoutDecompositionGroups(scene, assembly.groups));
  }
  if (!assembly && modelAssemblyCurrent(artifact)) return modelItem(artifact.scene, layoutDecompositionGroups(artifact.scene, artifact.assembly!.groups));
  return modelItem(assembly?.scene ?? artifact.scene, assembly?.groups);
}

async function imageItem(mediaId: string): Promise<RenderItem | null> {
  const blob = await readVisualMedia(mediaId); if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    const img = texture.image as HTMLImageElement;
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
    camera.position.z = 2;
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false });
    const imageFrame = { value: new THREE.Vector3(1, 1, 0) };
    material.onBeforeCompile = shader => {
      shader.uniforms.visualImageFrame = imageFrame;
      shader.fragmentShader = `uniform vec3 visualImageFrame;\n${shader.fragmentShader}`.replace('#include <map_fragment>', `#include <map_fragment>
        vec2 imageSize = visualImageFrame.xy;
        float imageRadius = min(visualImageFrame.z, min(imageSize.x, imageSize.y) * 0.5);
        vec2 corner = abs((vMapUv - 0.5) * imageSize) - imageSize * 0.5 + imageRadius;
        float distanceToEdge = length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) - imageRadius;
        float edgeSoftness = max(fwidth(distanceToEdge), 0.0001);
        diffuseColor.a *= 1.0 - smoothstep(-edgeSoftness, 0.0, distanceToEdge);
      `);
    };
    material.customProgramCacheKey = () => 'rounded-reference-image-v1';
    scene.add(new THREE.Mesh(geometry, material));
    return { scene, camera, imageSize: { width: img.width, height: img.height },
      setImageFrame: (width, height, radius) => imageFrame.value.set(width, height, radius),
      dispose: () => { texture.dispose(); geometry.dispose(); material.dispose(); } };
  } finally { URL.revokeObjectURL(url); }
}

/** Only rendering inputs enter the cache key; movement and view changes reuse GPU resources. */
function renderItemIdentity(artifact: VisualArtifact, artifacts: VisualArtifact[]): string {
  const assembly = artifact.sourceArtifactId && decompositionAssemblyCurrent(artifact) ? artifact.decomposition?.assembly : undefined;
  const original = assembly ? artifacts.find(item => item.id === artifact.sourceArtifactId) : undefined;
  return JSON.stringify([artifact.kind, artifact.mediaId, artifact.scene,
    assembly ?? null, assembly ? original?.scene ?? null : null,
    modelAssemblyCurrent(artifact) ? artifact.assembly?.groups : null]);
}

/** Copy scalar inputs: React Flow can mutate its node lookup and measured records in place. */
function invalidateOnChangedValues(read: () => Array<number | string | null>, invalidate: () => void) {
  let previous = read();
  return {
    rebase: () => { previous = read(); },
    notify: () => {
      const next = read();
      if (next.length === previous.length && next.every((value, index) => value === previous[index])) return;
      previous = next; invalidate();
    },
  };
}

/** One transparent GPU surface, repainted only on changes or while a transition runs. */
export function VisualCanvasLayer({ artifacts, onAvailability }: { artifacts: VisualArtifact[]; onAvailability: (available: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const api = useReactFlow(), flowStore = useStoreApi();
  const latest = useRef(artifacts); latest.current = artifacts;
  const [lost, setLost] = useState(false);
  const availableCallback = useRef(onAvailability); availableCallback.current = onAvailability;
  const reconcileRef = useRef<(() => void) | null>(null);
  const enabled = artifacts.length > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return;
    if (typeof WebGL2RenderingContext === 'undefined') { availableCallback.current(false); return; }
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true }); }
    catch { availableCallback.current(false); return; }
    renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const imageRadius = Number.parseFloat(getComputedStyle(canvas).getPropertyValue('--ws-radius-panel')) || 12;
    let alive = true, contextLost = false, frame = 0, previousTime: number | null = null;
    const items = new Map<string, { identity: string; item: RenderItem | null }>();
    const invalidate = () => {
      if (!alive || contextLost || document.hidden || frame) return;
      frame = requestAnimationFrame(draw);
    };
    const liveRect = (artifact: VisualArtifact) => {
      const live = api.getNode(`visual:${artifact.id}`);
      return live ? { x: live.position.x, y: live.position.y, width: live.width ?? live.measured?.width ?? artifact.width,
        height: live.height ?? live.measured?.height ?? artifact.height } : artifact;
    };
    const draw = (time: number) => {
      frame = 0;
      if (!alive || contextLost || document.hidden) { previousTime = null; return; }
      const parent = canvas.parentElement;
      if (!parent || parent.clientWidth === 0 || parent.clientHeight === 0) { previousTime = null; return; }
      // Idle time is not animation time. Only consecutive transition frames share a clock.
      const deltaSeconds = previousTime === null ? 1 / 60 : Math.max(0, Math.min(.1, (time - previousTime) / 1000)); previousTime = time;
      const width = parent.clientWidth, height = parent.clientHeight;
      if (canvas.clientWidth !== width || canvas.clientHeight !== height || canvas.width !== Math.round(width * renderer.getPixelRatio()) || canvas.height !== Math.round(height * renderer.getPixelRatio())) renderer.setSize(width, height, false);
      renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height); renderer.clear(true, true, true);
      const viewport = api.getViewport(); let animating = false;
      for (const artifact of latest.current) {
        const item = items.get(artifact.id)?.item; if (!item) continue;
        let rect = artifactScreenRect(liveRect(artifact), viewport);
        if (item.imageSize) rect = containedImageRect(rect, item.imageSize.width, item.imageSize.height);
        const pass = viewportPass(rect, width, height); if (!pass) continue;
        if (item.setView) {
          const view = useVisualViewStore.getState();
          item.setView(view.angles[artifact.id] ?? 0, view.pitches[artifact.id] ?? 0, view.zooms[artifact.id] ?? 1);
          animating = (item.setInspection?.(view.explosions[artifact.id] ?? 0, view.selectedParts[artifact.id] ?? null, deltaSeconds) ?? false) || animating;
        }
        item.setImageFrame?.(rect.width / viewport.zoom, rect.height / viewport.zoom, imageRadius);
        if (item.fitAspect) item.fitAspect(rect.width / rect.height);
        else if (item.camera instanceof THREE.PerspectiveCamera) { item.camera.aspect = rect.width / rect.height; item.camera.updateProjectionMatrix(); }
        renderer.setViewport(pass.viewport.x, pass.viewport.y, pass.viewport.width, pass.viewport.height);
        renderer.setScissor(pass.scissor.x, pass.scissor.y, pass.scissor.width, pass.scissor.height);
        renderer.setScissorTest(true); renderer.clearDepth(); renderer.render(item.scene, item.camera);
      }
      if (animating) invalidate(); else previousTime = null;
    };
    const reconcile = () => {
      const artifacts = latest.current, ids = new Set(artifacts.map(artifact => artifact.id));
      for (const [id, previous] of items) if (!ids.has(id)) { previous.item?.dispose(); items.delete(id); }
      for (const artifact of artifacts) {
        const identity = renderItemIdentity(artifact, artifacts), previous = items.get(artifact.id);
        if (previous?.identity === identity) continue;
        previous?.item?.dispose();
        const entry = { identity, item: null as RenderItem | null }; items.set(artifact.id, entry);
        void (async () => {
          try {
            const item = artifact.kind === 'model' && artifact.scene ? modelArtifactItem(artifact, artifacts.find(original => original.id === artifact.sourceArtifactId))
              : artifact.mediaId ? await imageItem(artifact.mediaId) : null;
            if (!alive || items.get(artifact.id) !== entry) item?.dispose();
            else { entry.item = item; invalidate(); }
          } catch { /* Missing media is surfaced by the artifact fallback. */ }
        })();
      }
      // Prop changes can replace IDs or rectangles without a store notification.
      // The next comparison must start from the inputs of this reconciled drawing.
      flowChanged.rebase(); viewChanged.rebase();
      invalidate();
    };
    reconcileRef.current = reconcile;
    const onLost = (event: Event) => { event.preventDefault(); contextLost = true; availableCallback.current(false); cancelAnimationFrame(frame); frame = 0; };
    const onRestored = () => setLost(previous => !previous);
    const visibility = () => {
      previousTime = null;
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
      else invalidate();
    };
    canvas.addEventListener('webglcontextlost', onLost); canvas.addEventListener('webglcontextrestored', onRestored);
    document.addEventListener('visibilitychange', visibility);
    const flowChanged = invalidateOnChangedValues(() => {
      const viewport = api.getViewport(), values = [viewport.x, viewport.y, viewport.zoom];
      for (const artifact of latest.current) {
        const rect = liveRect(artifact); values.push(rect.x, rect.y, rect.width, rect.height);
      }
      return values;
    }, invalidate);
    const viewChanged = invalidateOnChangedValues(() => {
      const view = useVisualViewStore.getState(), values: Array<number | string | null> = [];
      for (const artifact of latest.current) if (artifact.kind === 'model' && artifact.scene) {
        values.push(view.angles[artifact.id] ?? 0, view.pitches[artifact.id] ?? 0, view.zooms[artifact.id] ?? 1,
          view.explosions[artifact.id] ?? 0, view.selectedParts[artifact.id] ?? null);
      }
      return values;
    }, invalidate);
    const unsubscribeFlow = flowStore.subscribe(flowChanged.notify), unsubscribeView = useVisualViewStore.subscribe(viewChanged.notify);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(invalidate) : null;
    if (canvas.parentElement) observer?.observe(canvas.parentElement);
    window.addEventListener('resize', invalidate);
    availableCallback.current(true); reconcile();
    return () => {
      alive = false; reconcileRef.current = null; cancelAnimationFrame(frame);
      unsubscribeFlow(); unsubscribeView(); observer?.disconnect(); window.removeEventListener('resize', invalidate);
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      document.removeEventListener('visibilitychange', visibility);
      items.forEach(entry => entry.item?.dispose()); items.clear(); renderer.dispose();
    };
  }, [enabled, api, flowStore, lost]);
  useEffect(() => { reconcileRef.current?.(); }, [artifacts]);
  if (!enabled) return null;
  return <canvas ref={canvasRef} data-visual-compositor aria-hidden="true"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3 }} />;
}
