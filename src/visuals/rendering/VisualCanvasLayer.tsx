import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import * as THREE from 'three';
import type { VisualArtifact, SceneV1 } from '../types';
import { readVisualMedia } from '../media';
import { decompositionAssemblyCurrent } from '../decomposition';
import { decompositionContextScene, layoutDecompositionGroups } from '../decompositionLayout';
import { modelAssemblyCurrent } from '../modelAssembly';
import { artifactScreenRect, containedImageRect, viewportPass } from './geometry';
import { useVisualViewStore } from './viewStore';
import { objectGeometry } from './objectGeometry';
import { withinGeometryBudget } from '../geometrySchema';

interface AssemblyGroup { partId: string; objectIds: string[]; explodeOffset: [number, number, number] }
interface RenderItem {
  scene: THREE.Scene; camera: THREE.Camera; dispose: () => void;
  setView?: (yaw: number, pitch: number, zoom?: number) => void;
  setInspection?: (explosion: number, selectedPartId: string | null, deltaSeconds?: number) => void;
  fitAspect?: (aspect: number) => void;
  imageSize?: { width: number; height: number };
  setImageFrame?: (width: number, height: number, radius: number) => void;
}

export function modelItem(definition: SceneV1, assemblyGroups: AssemblyGroup[] = []): RenderItem {
  if (!withinGeometryBudget(definition.objects)) throw new Error('visualGeometryBudgetExceeded');
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x506080, 2.8));
  const light = new THREE.DirectionalLight(0xffffff, 3.5);
  light.position.set(4, 6, 8); scene.add(light);
  const pivot = new THREE.Group(), group = new THREE.Group(); pivot.add(group); scene.add(pivot);
  const disposables: Array<{ dispose(): void }> = [];
  const parts = assemblyGroups.map(part => {
    const node = new THREE.Group(); node.name = `part:${part.partId}`; group.add(node);
    return { ...part, node, offset: new THREE.Vector3().fromArray(part.explodeOffset) };
  });
  const materials: Array<{ material: THREE.MeshStandardMaterial; partId: string | null }> = [];
  const geometries = new Map<string, THREE.BufferGeometry>();
  for (const object of definition.objects) {
    const geometryKey = object.type === 'custom' ? JSON.stringify(object.geometry) : object.type;
    let geometry = geometries.get(geometryKey);
    if (!geometry) { geometry = objectGeometry(object); geometries.set(geometryKey, geometry); disposables.push(geometry); }
    const material = new THREE.MeshStandardMaterial({ color: object.color, roughness: .6, metalness: .18,
      side: object.geometry?.kind === 'buffer' ? THREE.DoubleSide : THREE.FrontSide });
    const mesh = new THREE.Mesh(geometry, material);
    const part = parts.find(item => item.objectIds.includes(object.id));
    mesh.name = object.id; mesh.userData.objectId = object.id; mesh.userData.partId = part?.partId ?? null;
    mesh.position.fromArray(object.position); mesh.rotation.set(...object.rotation); mesh.scale.fromArray(object.scale);
    (part?.node ?? group).add(mesh); disposables.push(material);
    materials.push({ material, partId: part?.partId ?? null });
  }
  // Fit the union of both endpoints once. The view stays still while parts move,
  // and a bounding sphere keeps either endpoint visible at any orbit angle.
  const bounds = new THREE.Box3().setFromObject(group);
  parts.forEach(part => part.node.position.copy(part.offset));
  bounds.union(new THREE.Box3().setFromObject(group));
  parts.forEach(part => part.node.position.set(0, 0, 0));
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const guides = parts.map(part => {
    const origin = new THREE.Box3().setFromObject(part.node).getCenter(new THREE.Vector3());
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, origin]);
    const material = new THREE.LineDashedMaterial({ color: 0xb996f7, transparent: true, opacity: .24,
      dashSize: Math.max(size.length() * .008, .01), gapSize: Math.max(size.length() * .006, .008), depthWrite: false });
    const line = new THREE.Line(geometry, material); line.name = `guide:${part.partId}`; line.visible = false;
    group.add(line); disposables.push(geometry, material);
    return { partId: part.partId, offset: part.offset, origin, line, geometry, material };
  });
  group.position.sub(center);
  const radius = Math.max(size.length() / 2, .1);
  const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 30);
  const direction = new THREE.Vector3(1.8, 1.1, 2.5).normalize();
  const fitAspect = (aspect: number) => {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    camera.aspect = aspect;
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
    const limitingAngle = Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
    const distance = radius / Math.sin(limitingAngle) * 1.08;
    camera.position.copy(direction).multiplyScalar(distance);
    camera.near = Math.max(radius / 100, distance - radius * 1.2);
    camera.far = distance + radius * 2;
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  };
  fitAspect(1);
  let explosion = 0, selection: string | null = null;
  return {
    scene, camera, fitAspect,
    setView: (yaw, pitch, zoom = 1) => { pivot.rotation.set(pitch, yaw, 0, 'YXZ'); camera.zoom = Number.isFinite(zoom) ? Math.max(.4, Math.min(4, zoom)) : 1; camera.updateProjectionMatrix(); },
    setInspection: (target, selectedPartId, deltaSeconds) => {
      if (Number.isFinite(target)) {
        const next = Math.max(0, Math.min(1, target));
        const factor = deltaSeconds === undefined ? 1 : 1 - Math.exp(-Math.max(0, Math.min(.1, deltaSeconds)) * 9);
        explosion += (next - explosion) * factor;
        if (Math.abs(explosion - next) < .0001) explosion = next;
        parts.forEach(part => part.node.position.copy(part.offset).multiplyScalar(explosion));
        guides.forEach(guide => {
          const end = guide.origin.clone().addScaledVector(guide.offset, explosion);
          const positions = guide.geometry.getAttribute('position'); positions.setXYZ(1, end.x, end.y, end.z); positions.needsUpdate = true;
          guide.line.computeLineDistances(); guide.line.visible = explosion > .025 && guide.offset.lengthSq() > 0;
        });
      }
      const nextSelection = parts.some(part => part.partId === selectedPartId) ? selectedPartId : null;
      if (selection === nextSelection) return;
      selection = nextSelection;
      guides.forEach(guide => { guide.material.opacity = selection === null ? .24 : guide.partId === selection ? .65 : .08; });
      for (const { material, partId } of materials) {
        const dimmed = selection !== null && partId !== selection;
        material.opacity = dimmed ? .35 : 1;
        material.transparent = dimmed; material.depthWrite = !dimmed;
        material.emissive.set(0x000000);
        if (partId !== null && partId === selection) material.emissive.copy(material.color).multiplyScalar(.3);
        material.needsUpdate = true;
      }
    },
    dispose: () => disposables.forEach((item) => item.dispose()),
  };
}

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

/** One transparent GPU surface for all image/model artifacts. Pan/zoom remain CSS-space values. */
export function VisualCanvasLayer({ artifacts, onAvailability }: { artifacts: VisualArtifact[]; onAvailability: (available: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const api = useReactFlow();
  const latest = useRef(artifacts); latest.current = artifacts;
  const [lost, setLost] = useState(false);
  const availableCallback = useRef(onAvailability); availableCallback.current = onAvailability;
  const enabled = artifacts.length > 0;
  const identity = artifacts.map((artifact) => `${artifact.id}:${artifact.mediaId}:${artifact.revisionIndex}:${JSON.stringify(artifact.scene)}:${artifact.sourceArtifactId && decompositionAssemblyCurrent(artifact) ? JSON.stringify(artifact.decomposition?.assembly) : ''}:${modelAssemblyCurrent(artifact) ? JSON.stringify(artifact.assembly?.groups) : ''}`).join('|');

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
    let alive = true, frame = 0, previousTime = performance.now();
    const items = new Map<string, RenderItem>();
    availableCallback.current(true);
    void Promise.all(latest.current.map(async (artifact) => {
      try {
        const item = artifact.kind === 'model' && artifact.scene ? modelArtifactItem(artifact, latest.current.find(item => item.id === artifact.sourceArtifactId))
          : artifact.mediaId ? await imageItem(artifact.mediaId) : null;
        if (!alive) item?.dispose(); else if (item) items.set(artifact.id, item);
      } catch { /* Missing media is surfaced by the artifact fallback. */ }
    }));
    const onLost = (event: Event) => { event.preventDefault(); availableCallback.current(false); cancelAnimationFrame(frame); };
    const onRestored = () => setLost((previous) => !previous);
    canvas.addEventListener('webglcontextlost', onLost); canvas.addEventListener('webglcontextrestored', onRestored);
    const draw = (time: number) => {
      if (!alive) return;
      frame = requestAnimationFrame(draw);
      const deltaSeconds = Math.max(0, Math.min(.1, (time - previousTime) / 1000)); previousTime = time;
      const parent = canvas.parentElement;
      if (document.hidden || !parent || parent.clientWidth === 0 || parent.clientHeight === 0) return;
      const width = parent.clientWidth, height = parent.clientHeight;
      if (canvas.clientWidth !== width || canvas.clientHeight !== height || canvas.width !== Math.round(width * renderer.getPixelRatio())) {
        renderer.setSize(width, height, false);
      }
      renderer.setScissorTest(false); renderer.setViewport(0, 0, width, height); renderer.clear(true, true, true);
      const viewport = api.getViewport();
      for (const artifact of latest.current) {
        const item = items.get(artifact.id); if (!item) continue;
        if (item.setView) {
          const view = useVisualViewStore.getState();
          item.setView(view.angles[artifact.id] ?? 0, view.pitches[artifact.id] ?? 0, view.zooms[artifact.id] ?? 1);
          item.setInspection?.(view.explosions[artifact.id] ?? 0, view.selectedParts[artifact.id] ?? null, deltaSeconds);
        }
        const live = api.getNode(`visual:${artifact.id}`);
        const liveRect = live ? { x: live.position.x, y: live.position.y, width: live.width ?? live.measured?.width ?? artifact.width, height: live.height ?? live.measured?.height ?? artifact.height } : artifact;
        let rect = artifactScreenRect(liveRect, viewport);
        if (item.imageSize) rect = containedImageRect(rect, item.imageSize.width, item.imageSize.height);
        // Graph-space size keeps the GPU mask aligned with CSS corners while zooming.
        item.setImageFrame?.(rect.width / viewport.zoom, rect.height / viewport.zoom, imageRadius);
        const pass = viewportPass(rect, width, height); if (!pass) continue;
        if (item.fitAspect) item.fitAspect(rect.width / rect.height);
        else if (item.camera instanceof THREE.PerspectiveCamera) { item.camera.aspect = rect.width / rect.height; item.camera.updateProjectionMatrix(); }
        renderer.setViewport(pass.viewport.x, pass.viewport.y, pass.viewport.width, pass.viewport.height);
        renderer.setScissor(pass.scissor.x, pass.scissor.y, pass.scissor.width, pass.scissor.height);
        renderer.setScissorTest(true); renderer.clearDepth(); renderer.render(item.scene, item.camera);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => {
      alive = false; cancelAnimationFrame(frame);
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      items.forEach((item) => item.dispose()); renderer.dispose();
    };
  }, [enabled, identity, api, lost]);
  if (!enabled) return null;
  return <canvas ref={canvasRef} data-visual-compositor aria-hidden="true"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3 }} />;
}
