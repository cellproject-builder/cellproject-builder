import * as THREE from 'three';
import type { SceneV1 } from '../types';
import { addModelMeshes } from './modelMeshes';
import { withinGeometryBudget } from '../geometrySchema';

export interface AssemblyGroup { partId: string; objectIds: string[]; explodeOffset: [number, number, number] }
export interface RenderItem {
  scene: THREE.Scene; camera: THREE.Camera; dispose: () => void;
  setView?: (yaw: number, pitch: number, zoom?: number) => void;
  /** True while an exploded-view transition still needs another frame. */
  setInspection?: (explosion: number, selectedPartId: string | null, deltaSeconds?: number) => boolean;
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
  const materials = addModelMeshes(definition.objects, group, parts, disposables);
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
      let animating = false;
      if (Number.isFinite(target)) {
        const next = Math.max(0, Math.min(1, target));
        const factor = deltaSeconds === undefined ? 1 : 1 - Math.exp(-Math.max(0, Math.min(.1, deltaSeconds)) * 9);
        const previous = explosion;
        explosion += (next - explosion) * factor;
        if (Math.abs(explosion - next) < .0001) explosion = next;
        animating = parts.length > 0 && explosion !== next;
        if (explosion !== previous) {
          parts.forEach(part => part.node.position.copy(part.offset).multiplyScalar(explosion));
          guides.forEach(guide => {
            const end = guide.origin.clone().addScaledVector(guide.offset, explosion);
            const positions = guide.geometry.getAttribute('position'); positions.setXYZ(1, end.x, end.y, end.z); positions.needsUpdate = true;
            guide.line.computeLineDistances(); guide.line.visible = explosion > .025 && guide.offset.lengthSq() > 0;
          });
        }
      }
      const nextSelection = parts.some(part => part.partId === selectedPartId) ? selectedPartId : null;
      if (selection === nextSelection) return animating;
      selection = nextSelection;
      guides.forEach(guide => { guide.material.opacity = selection === null ? .24 : guide.partId === selection ? .65 : .08; });
      for (const { material, partId, setDimmed } of materials) {
        const dimmed = selection !== null && partId !== selection;
        setDimmed?.(dimmed);
        material.opacity = dimmed ? .35 : 1;
        material.transparent = dimmed; material.depthWrite = !dimmed;
        material.emissive.set(0x000000);
        if (partId !== null && partId === selection) material.emissive.copy(material.color).multiplyScalar(.3);
        material.needsUpdate = true;
      }
      return animating;
    },
    dispose: () => disposables.forEach((item) => item.dispose()),
  };
}
