import { describe, expect, it } from 'vitest';
import { assembleSavedParts, type SavedPart } from './assembly';
import { modelItem } from '../../../src/visuals/rendering/VisualCanvasLayer';

const part = (id: string): SavedPart => ({ id, name: id, source: 'synthetic test', position: [3,0,0], rotation: [0,0,Math.PI/2], explodeOffset: [0,2,0],
  scene: {version:1,label:id,objects:[{id:'same',type:'box',color:'#ffffff',position:[1,0,0],rotation:[0,0,0],scale:[1,2,1]}]} });
describe('composition of saved scenes', () => {
  it('namespaces IDs, composes rigid placements and preserves sources and provenance', () => {
    const parts = [part('a'),part('b')], before = JSON.stringify(parts);
    const result = assembleSavedParts(parts,[{from:'a',to:'b',description:'illustrative'}]);
    expect(result.scene.objects.map(object=>object.id)).toEqual(['a:same','b:same']);
    expect(result.scene.objects[0].position[0]).toBeCloseTo(3);
    expect(result.scene.objects[0].position[1]).toBeCloseTo(1);
    expect(result.sources[0].source).toBe('synthetic test');
    expect(JSON.stringify(parts)).toBe(before);
  });
  it('rejects dangling relationships and nonfinite transforms', () => {
    expect(()=>assembleSavedParts([part('a')],[{from:'a',to:'missing',description:'bad'}])).toThrow();
    expect(()=>assembleSavedParts([{...part('a'),position:[NaN,0,0]}],[])).toThrow();
  });
  it('animates the renderer groups and restores mounted positions without changing scene data', () => {
    const result=assembleSavedParts([part('a')],[]), before=JSON.stringify(result.scene);
    const item=modelItem(result.scene,result.groups), group=item.scene.getObjectByName('part:a')!;
    item.setInspection?.(1,null,.1);
    expect(group.position.y).toBeGreaterThan(0); expect(group.position.y).toBeLessThan(2);
    item.setInspection?.(1,null); expect(group.position.y).toBe(2);
    item.setInspection?.(0,null); expect(group.position.toArray()).toEqual([0,0,0]);
    expect(JSON.stringify(result.scene)).toBe(before); item.dispose();
  });
});
