import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { DecompositionAssembly, SceneV1 } from './types';
import { objectGeometry } from './rendering/objectGeometry';
import { withinGeometryBudget } from './geometrySchema';

type Group = Pick<DecompositionAssembly['groups'][number], 'partId' | 'objectIds'>;
type Object = SceneV1['objects'][number];

const customVertices = new WeakMap<NonNullable<Object['geometry']>, Float32Array>();
// The four immutable base meshes are tiny and shared across every scene.
// Cache CPU positions only; no per-object geometry or GPU buffer is retained.
const primitiveVertices = new Map<Object['type'], Float32Array>();
/** Bounds respect the renderer's geometry, scale and XYZ rotations. */
export function decompositionObjectBounds(object: Object): Box3 {
  const transform = new Matrix4().compose(new Vector3(...object.position),
    new Quaternion().setFromEuler(new Euler(...object.rotation)), new Vector3(...object.scale));
  if (object.type === 'box' || (object.type === 'custom' && !object.geometry)) {
    return new Box3(new Vector3(-.5, -.5, -.5), new Vector3(.5, .5, .5)).applyMatrix4(transform);
  }
  let vertices = object.geometry ? customVertices.get(object.geometry) : primitiveVertices.get(object.type);
  if (!vertices) {
    const geometry = objectGeometry(object);
    vertices = new Float32Array(geometry.getAttribute('position').array);
    geometry.dispose();
    if (object.geometry) customVertices.set(object.geometry, vertices);
    else primitiveVertices.set(object.type, vertices);
  }
  // Transform the rendered vertices, not a rotated enclosing cube. The latter
  // falsely enlarges round parts (a 45° sphere rotation grew its box by 41%).
  const bounds = new Box3(), point = new Vector3();
  for (let index = 0; index < vertices.length; index += 3) {
    bounds.expandByPoint(point.fromArray(vertices, index).applyMatrix4(transform));
  }
  return bounds;
}
const boundsOf = (objects: Object[]) => objects.reduce((bounds, object) => bounds.union(decompositionObjectBounds(object)), new Box3());

/** Rendering context is derived; it never turns unclassified shapes into documented parts. */
export function decompositionContextScene(parts: SceneV1, source: SceneV1): SceneV1 {
  const mapped = new Set(parts.objects.map(object => object.id));
  const objects = [...source.objects.filter(object => !mapped.has(object.id)), ...parts.objects];
  if (!withinGeometryBudget(objects)) throw new Error('decompositionAssemblyInvalid');
  return { ...parts, objects };
}

/** Spatially ordered separation, independent of checklist order or world origin. */
export function layoutDecompositionGroups(scene: SceneV1, groups: Group[]): DecompositionAssembly['groups'] {
  const bounds = boundsOf(scene.objects), size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
  const extent = Math.max(size.x, size.y, size.z, .01);
  const dimensions = size.toArray();
  const normalAxis = dimensions.indexOf(Math.min(...dimensions));
  const planar = dimensions[normalAxis] < extent * .3;
  const assigned = new Set(groups.flatMap(group => group.objectIds));
  const obstacles: Box3[] = [];
  const context = scene.objects.filter(object => !assigned.has(object.id));
  if (context.length) obstacles.push(boundsOf(context));
  const planned = new Map<string, [number, number, number]>();
  const ordered = [...groups].sort((a, b) => a.partId.localeCompare(b.partId));
  for (const group of ordered) {
    const objects = scene.objects.filter(object => group.objectIds.includes(object.id));
    if (!objects.length) { planned.set(group.partId, [0, 0, 0]); continue; }
    const partBounds = boundsOf(objects), partCenter = partBounds.getCenter(new Vector3());
    // Only an actual broad thin solid is an anchor, never a name or scattered pad rows.
    const anchor = planar && objects.some(object => {
      if (object.type !== 'box') return false;
      const solid = decompositionObjectBounds(object).getSize(new Vector3()).toArray();
      return solid[normalAxis] < extent * .15 && solid.every((value, axis) => axis === normalAxis || value >= dimensions[axis] * .7);
    });
    if (anchor) { planned.set(group.partId, [0, 0, 0]); obstacles.push(partBounds); continue; }
    const direction = partCenter.clone().sub(center);
    if (planar) direction.setComponent(normalAxis, 0);
    if (direction.length() < extent * .01) direction.setComponent(planar ? (normalAxis + 1) % 3 : 0, 1);
    direction.normalize();
    if (planar) direction.setComponent(normalAxis, .85).normalize();
    let distance = extent * .22;
    let offset = direction.clone().multiplyScalar(distance), target = partBounds.clone().translate(offset);
    const padding = extent * .025;
    for (let step = 0; step < 48 && obstacles.some(other => other.clone().expandByScalar(padding).intersectsBox(target)); step++) {
      distance += extent * .08;
      offset = direction.clone().multiplyScalar(distance); target = partBounds.clone().translate(offset);
    }
    // Keep display offsets inside the persistent contract's finite bounds.
    offset.clampScalar(-10000, 10000);
    planned.set(group.partId, offset.toArray() as [number, number, number]);
    obstacles.push(partBounds.clone().translate(offset));
  }
  return groups.map(group => ({ ...group, explodeOffset: planned.get(group.partId)! }));
}
