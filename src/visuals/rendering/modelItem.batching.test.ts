import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { SceneV1 } from '../types';
import { modelItem } from './modelItem';

const repeated = (count = 24): SceneV1 => ({ version: 1, label: 'Repeated fasteners', objects: Array.from({ length: count }, (_, index) => ({
  id: `fastener-${index}`, type: 'box', color: '#8899aa', position: [index % 6, Math.floor(index / 6), 0],
  rotation: [0, 0, index * .02], scale: [1, .5, .25],
})) });
const batches = (scene: THREE.Scene) => {
  const result: THREE.InstancedMesh[] = []; scene.traverse(node => { if (node instanceof THREE.InstancedMesh) result.push(node); }); return result;
};
const visibleMeshes = (scene: THREE.Scene) => {
  const result: THREE.Mesh[] = []; scene.traverseVisible(node => { if (node instanceof THREE.Mesh) result.push(node); }); return result;
};

describe('repeated model geometry submission', () => {
  it('submits repeated opaque shapes as one batch while retaining every source identity and transform', () => {
    const source = repeated(), original = JSON.stringify(source), item = modelItem(source);
    expect(visibleMeshes(item.scene)).toHaveLength(1);
    const batch = batches(item.scene)[0]; expect(batch.count).toBe(24);
    expect(batch.userData.objectIds).toEqual(source.objects.map(object => object.id));
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    batch.getMatrixAt(7, matrix); matrix.decompose(position, rotation, scale);
    expect(position.toArray()).toEqual([1, 1, 0]);
    expect(scale.x).toBeCloseTo(1); expect(scale.y).toBeCloseTo(.5); expect(scale.z).toBeCloseTo(.25);
    expect(new THREE.Euler().setFromQuaternion(rotation).z).toBeCloseTo(.14);
    expect(JSON.stringify(source)).toBe(original); item.dispose();
  });

  it('keeps moving parts separate and restores opaque batching after transparent inspection', () => {
    const source = repeated(), item = modelItem(source, [
      { partId: 'left', objectIds: source.objects.slice(0, 12).map(object => object.id), explodeOffset: [3, 0, 0] },
      { partId: 'right', objectIds: source.objects.slice(12).map(object => object.id), explodeOffset: [0, 4, 0] },
    ]);
    expect(batches(item.scene)).toHaveLength(2);
    const right = item.scene.getObjectByName('part:right')!;
    item.setInspection!(1, 'left'); expect(right.position.toArray()).toEqual([0, 4, 0]);
    // Transparent pieces need individual sorting; opaque selected pieces stay instanced.
    expect(visibleMeshes(item.scene).filter(mesh => mesh.material instanceof THREE.Material && mesh.material.transparent)).toHaveLength(12);
    item.setInspection!(0, null); expect(right.position.toArray()).toEqual([0, 0, 0]);
    expect(visibleMeshes(item.scene)).toHaveLength(2);
    const instances = batches(item.scene), disposed = instances.map(batch => vi.spyOn(batch, 'dispose'));
    item.dispose(); disposed.forEach(spy => expect(spy).toHaveBeenCalledOnce());
  });

  it('preserves custom contours and holes in repeated shapes', () => {
    const source = repeated(6);
    source.objects = source.objects.map(object => ({ ...object, type: 'custom', geometry: { kind: 'extrude',
      points: [[-2, -2], [2, -2], [2, 2], [-2, 2]], holes: [[[-.5, -.5], [-.5, .5], [.5, .5], [.5, -.5]]], depth: 1, bevel: 0 },
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }));
    const item = modelItem(source), batch = batches(item.scene)[0]; expect(batch).toBeDefined();
    item.scene.updateMatrixWorld(true);
    const center = batch.getWorldPosition(new THREE.Vector3());
    expect(new THREE.Raycaster(center.clone().add(new THREE.Vector3(0, 0, 4)), new THREE.Vector3(0, 0, -1)).intersectObject(batch)).toHaveLength(0);
    const hits = new THREE.Raycaster(center.clone().add(new THREE.Vector3(1, 0, 4)), new THREE.Vector3(0, 0, -1)).intersectObject(batch);
    expect(hits.length).toBeGreaterThan(0); expect(hits.every(hit => typeof hit.instanceId === 'number')).toBe(true);
    item.dispose();
  });

  it('keeps reflected objects and different colors out of an incompatible batch', () => {
    const source = repeated(10); source.objects[0].scale = [-1, 1, 1]; source.objects[1].color = '#ff0000';
    const item = modelItem(source);
    expect(batches(item.scene).map(batch => batch.count)).toEqual([8]);
    expect(item.scene.getObjectByName('fastener-0')).toBeInstanceOf(THREE.Mesh);
    expect(item.scene.getObjectByName('fastener-1')).toBeInstanceOf(THREE.Mesh);
    expect(visibleMeshes(item.scene)).toHaveLength(3); item.dispose();
  });
});
