import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { assembleDecompositionGeometry } from './decompositionGeometry';
import { decompositionObjectBounds, layoutDecompositionGroups } from './decompositionLayout';
import type { ObjectDecomposition, SceneV1 } from './types';

const object = (id: string, position: [number, number, number], scale: [number, number, number]) => ({ id, type: 'box' as const, position, scale, rotation: [0, 0, 0] as [number, number, number], color: '#999999' });
const scene: SceneV1 = { version: 1, label: 'Board', objects: [object('pcb', [0, 0, 0], [8, .12, 4]), object('usb', [-3, .3, 0], [1, .5, .8]), object('module', [2, .3, 0], [2, .5, 2])] };
const dossier = { id: 'dossier', parts: [{ id: 'usb', name: 'Connector' }, { id: 'module', name: 'Module' }] } as ObjectDecomposition;
function assembly(original = scene, selected = ['usb', 'module']) {
  return assembleDecompositionGeometry({ label: 'Parts', parts: selected.map(partId => ({ partId, sourceObjectIds: [partId], objects: [] })) }, original, dossier, selected, 'fingerprint');
}

describe('spatial decomposition layout', () => {
  it('separates parts toward their own side of the assembly, independent of checklist order', () => {
    const first = assembly(), reversed = assembly(scene, ['module', 'usb']);
    expect(first.groups[0].explodeOffset[0]).toBeLessThan(0);
    expect(first.groups[1].explodeOffset[0]).toBeGreaterThan(0);
    for (const group of first.groups) expect(reversed.groups.find(g => g.partId === group.partId)!.explodeOffset).toEqual(group.explodeOffset);
    expect(first.groups.every(group => group.explodeOffset[1] > .5)).toBe(true);
  });

  it('uses object dimensions instead of distance from the world origin', () => {
    const translated = { ...scene, objects: scene.objects.map(o => ({ ...o, position: o.position.map((p, axis) => p + [4000, 80, -500][axis]) as [number, number, number] })) };
    for (const group of assembly().groups) {
      const offset = assembly(translated).groups.find(g => g.partId === group.partId)!.explodeOffset;
      offset.forEach((value, axis) => expect(value).toBeCloseTo(group.explodeOffset[axis], 8));
    }
  });

  it('keeps the broad support fixed and avoids overlapping part endpoints even when its id sorts last', () => {
    const groups = [{ partId: 'a-usb', objectIds: ['usb'] }, { partId: 'b-module', objectIds: ['module'] }, { partId: 'z-board', objectIds: ['pcb'] }];
    const planned = layoutDecompositionGroups(scene, groups);
    expect(planned[2].explodeOffset).toEqual([0, 0, 0]);
    const targets = planned.map(group => decompositionObjectBounds(scene.objects.find(o => o.id === group.objectIds[0])!).translate(new Vector3(...group.explodeOffset)));
    for (let index = 0; index < targets.length; index++) for (let other = index + 1; other < targets.length; other++) expect(targets[index].intersectsBox(targets[other])).toBe(false);
  });

  it('accounts for rotation and torus dimensions when computing spacing', () => {
    const rotated = { ...object('rotated', [0, 0, 0], [4, 1, 2]), rotation: [0, 0, Math.PI / 2] as [number, number, number] };
    const dimensions = decompositionObjectBounds(rotated).getSize(new Vector3());
    expect(dimensions.x).toBeCloseTo(1); expect(dimensions.y).toBeCloseTo(4);
    const torus = decompositionObjectBounds({ ...object('ring', [0, 0, 0], [1, 1, 1]), type: 'torus' });
    expect(torus.max.x - torus.min.x).toBeCloseTo(1.32); expect(torus.max.z - torus.min.z).toBeCloseTo(.32);
  });
});
