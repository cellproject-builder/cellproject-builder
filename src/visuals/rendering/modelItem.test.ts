import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { modelArtifactItem, modelItem } from './VisualCanvasLayer';
import type { VisualArtifact } from '../types';
import { modelSceneFingerprint } from '../modelAssembly';
vi.mock('../decompositionState', () => ({ decompositionAssemblyCurrent: () => true }));

describe('linked decomposition rendering', () => {
  it('zooms the camera projection without changing the modeled geometry, dimensions or assembly', () => {
    const definition = { version: 1 as const, label: 'Motor', objects: [{ id: 'body', type: 'box' as const, position: [1, 2, 3] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [2, 1, 1] as [number, number, number], color: '#999999' }] };
    const original = JSON.stringify(definition), item = modelItem(definition), camera = item.camera as THREE.PerspectiveCamera;
    const position = item.scene.getObjectByName('body')!.position.clone();
    item.setView!(0, 0, 2); expect(camera.zoom).toBe(2);
    item.fitAspect!(1.5); expect(camera.zoom).toBe(2);
    item.setView!(0, 0, 1); expect(camera.zoom).toBe(1);
    expect(item.scene.getObjectByName('body')!.position.equals(position)).toBe(true);
    expect(JSON.stringify(definition)).toBe(original); item.dispose();
  });
  it('explodes an advanced model from its first generation and stops using groups after the scene changes', () => {
    const scene = { version: 1 as const, label: 'Assembly', objects: ['left', 'right'].map((id, index) => ({ id, type: 'box' as const, position: [index * 3, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number], color: '#999999' })) };
    const artifact = { id: 'advanced', kind: 'model', scene, assembly: { sceneFingerprint: modelSceneFingerprint(scene), groups: scene.objects.map(object => ({ partId: object.id, name: object.id, objectIds: [object.id] })) } } as VisualArtifact;
    const snapshot = JSON.stringify(artifact), item = modelArtifactItem(artifact)!;
    const part = item.scene.getObjectByName('part:right')!;
    expect(part).toBeDefined(); const origin = part.position.clone();
    item.setInspection!(1, 'right'); expect(part.position.distanceTo(origin)).toBeGreaterThan(0);
    item.setInspection!(0, null); expect(part.position.distanceTo(origin)).toBeLessThan(.00001);
    expect(JSON.stringify(artifact)).toBe(snapshot); item.dispose();
    const stale = modelArtifactItem({ ...artifact, scene: { ...scene, label: 'Changed' } })!;
    expect(stale.scene.getObjectByName('part:right')).toBeUndefined(); stale.dispose();
  });
  it('retains unclassified source geometry as stationary context, including legacy partial assemblies', () => {
    const box = (id: string, position: [number, number, number], scale: [number, number, number]) => ({ id, type: 'box' as const, position, scale, rotation: [0, 0, 0] as [number, number, number], color: '#999999' });
    const sourceScene = { version: 1 as const, label: 'Original', objects: [box('pcb', [0, 0, 0], [8, .1, 4]), box('module', [2, .3, 0], [2, .5, 2]), box('usb', [-3, .3, 0], [1, .5, .8])] };
    const original = { id: 'original', kind: 'model', scene: sourceScene } as VisualArtifact;
    const assembly = { scene: { ...sourceScene, objects: [sourceScene.objects[2]] }, groups: [{ partId: 'usb', objectIds: ['usb'], explodeOffset: [4, 0, 0] }] };
    const child = { id: 'child', kind: 'model', sourceArtifactId: 'original', scene: assembly.scene, decomposition: { assembly } } as VisualArtifact;
    const before = JSON.stringify([original, child]);
    const item = modelArtifactItem(child, original)!;
    const pcb = item.scene.getObjectByName('pcb')!, module = item.scene.getObjectByName('module')!, usb = item.scene.getObjectByName('usb')!;
    expect(pcb).toBeDefined(); expect(module).toBeDefined();
    const pcbPosition = pcb.getWorldPosition(new THREE.Vector3()), usbPosition = usb.getWorldPosition(new THREE.Vector3());
    item.setInspection!(1, null);
    expect(pcb.getWorldPosition(new THREE.Vector3()).distanceTo(pcbPosition)).toBe(0);
    expect(usb.getWorldPosition(new THREE.Vector3()).x).toBeLessThan(usbPosition.x);
    item.setInspection!(0, null);
    expect(usb.getWorldPosition(new THREE.Vector3()).distanceTo(usbPosition)).toBeLessThan(.0001);
    expect(JSON.stringify([original, child])).toBe(before);
    item.dispose();
  });
  it('keeps the original geometry visible and renders the parts only on the linked child', () => {
    const original = { version: 1 as const, label: 'Complete board', objects: [{ id: 'complete-board', type: 'box' as const, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [6, .2, 3] as [number, number, number], color: '#0088ff' }] };
    const parts = { ...original, label: 'Connector', objects: [{ ...original.objects[0], id: 'connector', scale: [1, 1, 1] as [number, number, number] }] };
    const parent = { id: 'original', kind: 'model', scene: original, decomposition: { assembly: { scene: parts, groups: [{ partId: 'usb', objectIds: ['connector'], explodeOffset: [4, 0, 0] }] } } } as VisualArtifact;
    const child = { ...parent, id: 'decomposition', sourceArtifactId: 'original', scene: parts } as VisualArtifact;
    const parentItem = modelArtifactItem(parent)!, childItem = modelArtifactItem(child)!;
    expect(parentItem.scene.getObjectByName('complete-board')).not.toBeUndefined();
    expect(parentItem.scene.getObjectByName('connector')).toBeUndefined();
    expect(childItem.scene.getObjectByName('connector')).not.toBeUndefined();
    const originalPosition = parentItem.scene.getObjectByName('complete-board')!.getWorldPosition(new THREE.Vector3());
    parentItem.setInspection!(1, null); childItem.setInspection!(1, null);
    expect(parentItem.scene.getObjectByName('complete-board')!.getWorldPosition(new THREE.Vector3()).distanceTo(originalPosition)).toBe(0);
    expect(childItem.scene.getObjectByName('part:usb')!.position.toArray()).toEqual([4, 0, 0]);
    parentItem.dispose(); childItem.dispose();
  });
});

describe('model viewport rotation', () => {
  it('rotates an off-origin scene around its framed center', () => {
    const item = modelItem({ version: 1, label: 'Offset box', objects: [{ id: 'box', type: 'box', position: [100, 10, -30], rotation: [0, 0, 0], scale: [4, 2, 1], color: '#0088ff' }] });
    const pivot = item.scene.children.find(child => child instanceof THREE.Group)!;
    expect(new THREE.Box3().setFromObject(pivot).getCenter(new THREE.Vector3()).length()).toBeLessThan(.0001);
    pivot.rotation.y = Math.PI / 3;
    expect(new THREE.Box3().setFromObject(pivot).getCenter(new THREE.Vector3()).length()).toBeLessThan(.0001);
    item.dispose();
  });

  it('inspects a model in both directions without changing its source, camera framing or transparent background', () => {
    const definition = { version: 1 as const, label: 'Offset assembly', objects: [
      { id: 'left', type: 'box' as const, position: [98, 10, -30] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 2, 1] as [number, number, number], color: '#0088ff' },
      { id: 'right', type: 'box' as const, position: [102, 10, -30] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 2, 1] as [number, number, number], color: '#0088ff' },
    ] };
    const source = JSON.stringify(definition);
    const item = modelItem(definition);
    const pivot = item.scene.children.find(child => child instanceof THREE.Group)!;
    const right = pivot.children[0].children[1];
    const before = right.getWorldPosition(new THREE.Vector3());
    const camera = item.camera.position.clone();
    item.setView!(Math.PI / 2, Math.PI / 4);
    const after = right.getWorldPosition(new THREE.Vector3());
    expect(after.distanceTo(before)).toBeGreaterThan(1);
    expect(after.length()).toBeCloseTo(before.length());
    expect(pivot.rotation.x).toBeCloseTo(Math.PI / 4);
    expect(pivot.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(item.camera.position.equals(camera)).toBe(true);
    expect(item.scene.background).toBeNull();
    expect(JSON.stringify(definition)).toBe(source);
    item.setView!(0, 0);
    expect(right.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(.0001);
    item.dispose();
  });
});

describe('reversible assembly inspection', () => {
  const definition = { version: 1 as const, label: 'Board', objects: [
    { id: 'shell', type: 'box' as const, position: [5, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [2, 1, 1] as [number, number, number], color: '#999999' },
    { id: 'pins', type: 'box' as const, position: [5, 1, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number], color: '#bbbbbb' },
    { id: 'pcb', type: 'box' as const, position: [0, -1, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [10, .2, 5] as [number, number, number], color: '#0088ff' },
  ] };
  const groups = [
    { partId: 'usb', objectIds: ['shell', 'pins'], explodeOffset: [4, 3, 0] as [number, number, number] },
    { partId: 'board', objectIds: ['pcb'], explodeOffset: [0, -3, 0] as [number, number, number] },
  ];

  it('moves all primitives of a part together, preserves assembled positions and reverses without drift', () => {
    const source = JSON.stringify(definition);
    const item = modelItem(definition, groups);
    const shell = item.scene.getObjectByName('shell')!, pins = item.scene.getObjectByName('pins')!;
    const start = shell.getWorldPosition(new THREE.Vector3());
    const spacing = pins.getWorldPosition(new THREE.Vector3()).sub(start);
    item.setInspection!(1, null);
    expect(shell.getWorldPosition(new THREE.Vector3()).sub(start).toArray()).toEqual([4, 3, 0]);
    expect(pins.getWorldPosition(new THREE.Vector3()).sub(shell.getWorldPosition(new THREE.Vector3())).distanceTo(spacing)).toBeLessThan(.0001);
    expect(shell.userData.partId).toBe('usb');
    for (let i = 0; i < 8; i++) { item.setInspection!(0, null); item.setInspection!(1, null); }
    item.setInspection!(0, null);
    expect(shell.getWorldPosition(new THREE.Vector3()).distanceTo(start)).toBeLessThan(.0001);
    expect(JSON.stringify(definition)).toBe(source);
    expect(item.scene.background).toBeNull();
    item.dispose();
  });

  it('shows reversible guide lines from assembled positions only while pieces are separated', () => {
    const item = modelItem(definition, groups);
    const guide = item.scene.getObjectByName('guide:usb') as THREE.Line;
    expect(guide).toBeDefined(); expect(guide.visible).toBe(false);
    item.setInspection!(.5, null);
    expect(guide.visible).toBe(true);
    const positions = guide.geometry.getAttribute('position');
    expect(new THREE.Vector3().fromBufferAttribute(positions, 1).sub(new THREE.Vector3().fromBufferAttribute(positions, 0)).toArray()).toEqual([2, 1.5, 0]);
    item.setInspection!(0, null);
    expect(guide.visible).toBe(false);
    item.dispose();
  });

  it('animates smoothly in either direction and restores original materials after selection clears', () => {
    const item = modelItem(definition, groups);
    const shell = item.scene.getObjectByName('shell') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const pcb = item.scene.getObjectByName('pcb') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const start = shell.getWorldPosition(new THREE.Vector3());
    item.setInspection!(1, 'usb', .016);
    const first = shell.getWorldPosition(new THREE.Vector3()).distanceTo(start);
    expect(first).toBeGreaterThan(0); expect(first).toBeLessThan(5);
    expect(shell.material.opacity).toBe(1);
    expect(shell.material.emissive.getHex()).not.toBe(0);
    expect(pcb.material.opacity).toBeLessThan(1);
    item.setInspection!(0, null, .016);
    expect(shell.getWorldPosition(new THREE.Vector3()).distanceTo(start)).toBeLessThan(first);
    expect(pcb.material.opacity).toBe(1); expect(pcb.material.transparent).toBe(false);
    expect(shell.material.emissive.getHex()).toBe(0);
    item.dispose();
  });

  it('fits both assembly endpoints after rotation into a narrow viewport without changing source dimensions', () => {
    const item = modelItem(definition, groups);
    item.fitAspect!(.3);
    item.setView!(Math.PI / 3, Math.PI / 4);
    const camera = item.camera as THREE.PerspectiveCamera;
    camera.updateMatrixWorld();
    for (const amount of [0, 1]) {
      item.setInspection!(amount, null);
      item.scene.updateMatrixWorld(true);
      item.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.computeBoundingBox();
        const bounds = object.geometry.boundingBox!;
        for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new THREE.Vector3(x, y, z).applyMatrix4(object.matrixWorld).project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(1);
          expect(Math.abs(projected.y)).toBeLessThan(1);
          expect(Math.abs(projected.z)).toBeLessThan(1);
        }
      });
    }
    item.dispose();
  });
});
