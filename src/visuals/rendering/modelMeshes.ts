import * as THREE from 'three';
import type { SceneV1 } from '../types';
import { objectGeometry } from './objectGeometry';

type ModelObject = SceneV1['objects'][number];
interface Part { partId: string; objectIds: string[]; node: THREE.Group }
interface Appearance { material: THREE.MeshStandardMaterial; partId: string | null; setDimmed?: (dimmed: boolean) => void }

/** Rendering batches never change the editable scene or combine independently moving parts. */
export function addModelMeshes(objects: ModelObject[], group: THREE.Group, parts: Part[], disposables: Array<{ dispose(): void }>): Appearance[] {
  const geometries = new Map<string, THREE.BufferGeometry>(), appearances: Appearance[] = [];
  const owners = new Map<string, Part>();
  for (const part of parts) for (const id of part.objectIds) if (!owners.has(id)) owners.set(id, part);
  const buckets = new Map<string, { geometry: THREE.BufferGeometry; objects: ModelObject[]; part?: Part }>();
  for (const object of objects) {
    const geometryKey = object.type === 'custom' ? JSON.stringify(object.geometry) : object.type;
    let geometry = geometries.get(geometryKey);
    if (!geometry) { geometry = objectGeometry(object); geometries.set(geometryKey, geometry); disposables.push(geometry); }
    const part = owners.get(object.id);
    // InstancedMesh does not support reflected matrices. Keep those objects independent.
    const key = JSON.stringify([geometryKey, object.color, part?.partId ?? null, object.scale.every(value => value > 0) ? null : object.id]);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { geometry, objects: [], part }; buckets.set(key, bucket); }
    bucket.objects.push(object);
  }
  for (const { geometry, objects: members, part } of buckets.values()) {
    const material = new THREE.MeshStandardMaterial({ color: members[0].color, roughness: .6, metalness: .18,
      side: members[0].geometry?.kind === 'buffer' ? THREE.DoubleSide : THREE.FrontSide });
    disposables.push(material);
    const parent = part?.node ?? group, partId = part?.partId ?? null;
    const makeMesh = (object: ModelObject) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = object.id; mesh.userData.objectId = object.id; mesh.userData.partId = partId;
      mesh.position.fromArray(object.position); mesh.rotation.set(...object.rotation); mesh.scale.fromArray(object.scale);
      parent.add(mesh); return mesh;
    };
    if (members.length < 4 || !members[0].scale.every(value => value > 0)) {
      members.forEach(makeMesh); appearances.push({ material, partId }); continue;
    }
    const batch = new THREE.InstancedMesh(geometry, material, members.length), transform = new THREE.Object3D();
    batch.name = `instances:${members[0].id}`; batch.userData.partId = partId;
    // Raycaster.instanceId indexes this array; source IDs stay stable for editing and assembly.
    batch.userData.objectIds = members.map(object => object.id);
    members.forEach((object, index) => {
      transform.position.fromArray(object.position); transform.rotation.set(...object.rotation); transform.scale.fromArray(object.scale);
      transform.updateMatrix(); batch.setMatrixAt(index, transform.matrix);
    });
    batch.instanceMatrix.needsUpdate = true; batch.computeBoundingBox(); batch.computeBoundingSphere();
    parent.add(batch); disposables.push(batch);
    let transparentMeshes: THREE.Mesh[] | undefined;
    appearances.push({ material, partId, setDimmed: dimmed => {
      // Three sorts transparent meshes, not individual instances. Preserve that sorting
      // during inspection, then reuse the opaque batch when the selection clears.
      if (dimmed && !transparentMeshes) transparentMeshes = members.map(makeMesh);
      batch.visible = !dimmed; transparentMeshes?.forEach(mesh => { mesh.visible = dimmed; });
    } });
  }
  return appearances;
}
