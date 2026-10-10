import { describe, expect, it } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { sceneSchema } from '../normalize';
import { decompositionObjectBounds, decompositionContextScene } from '../decompositionLayout';
import { modelItem } from './VisualCanvasLayer';
import { z } from 'zod';
import { generationSceneSchema } from '../normalize';

const shape = (geometry: unknown) => ({ version: 1, label: 'Custom part', objects: [{ id: 'part', type: 'custom', position: [10, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1], color: '#8899aa', geometry }] });
const extrude = { kind: 'extrude', points: [[-2, -2], [2, -2], [2, 2], [-2, 2]], holes: [[[-.5, -.5], [-.5, .5], [.5, .5], [.5, -.5]]], depth: 1, bevel: 0 };
describe('custom Three.js geometry', () => {
  it('sends a provider-compatible nested anyOf grammar rather than oneOf', () => {
    const schema = JSON.stringify(z.toJSONSchema(generationSceneSchema));
    expect(schema).toContain('"anyOf"'); expect(schema).not.toContain('"oneOf"');
    const objectSchema = z.toJSONSchema(generationSceneSchema).properties!.objects as {items:{properties:Record<string,unknown>;required:string[]}};
    expect(objectSchema.items.required.sort()).toEqual(Object.keys(objectSchema.items.properties).sort());
    expect(generationSceneSchema.safeParse(shape(extrude)).success).toBe(true);
  });
  it('renders extruded contours with real holes and uses their transformed bounds', () => {
    const definition = sceneSchema.parse(shape(extrude));
    const bounds = decompositionObjectBounds(definition.objects[0]);
    expect(bounds.min.toArray()).toEqual([6, -2, -.5]); expect(bounds.max.toArray()).toEqual([14, 2, .5]);
    const item = modelItem(definition), mesh = item.scene.getObjectByName('part')!;
    item.scene.updateMatrixWorld(true);
    const center = mesh.getWorldPosition(new Vector3());
    const hole = new Raycaster(center.clone().add(new Vector3(0, 0, 4)), new Vector3(0, 0, -1));
    const solid = new Raycaster(center.clone().add(new Vector3(2, 0, 4)), new Vector3(0, 0, -1));
    expect(hole.intersectObject(mesh)).toHaveLength(0); expect(solid.intersectObject(mesh).length).toBeGreaterThan(0);
    item.dispose();
  });
  it.each([
    { kind: 'lathe', points: [[0, -1], [1, -1], [1.2, 0], [.4, 1], [0, 1]], segments: 32 },
    { kind: 'tube', points: [[0, 0, 0], [1, 1, 0], [2, 0, 0]], radius: .1, segments: 32, radialSegments: 8, closed: false },
    { kind: 'buffer', vertices: [[0, 0, 0], [2, 0, 0], [0, 2, 0]], indices: [0, 1, 2] },
  ])('renders $kind as its own geometry with finite normals and bounds', geometry => {
    const scene = sceneSchema.parse(shape(geometry)), item = modelItem(scene);
    const mesh = item.scene.getObjectByName('part') as import('three').Mesh;
    expect(mesh.geometry.type).not.toBe('TorusGeometry');
    expect(Array.from(mesh.geometry.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
    expect(decompositionObjectBounds(scene.objects[0]).isEmpty()).toBe(false); item.dispose();
  });
  it.each([
    { ...extrude, points: [[0, 0], [1, 1], [0, 1], [1, 0]] },
    { ...extrude, holes: [[[20, 20], [21, 20], [20, 21]]] },
    { kind: 'buffer', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], indices: [0, 1, 9] },
    { kind: 'buffer', vertices: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], indices: [0, 1, 2] },
    { kind: 'lathe', points: [[-1, 0], [1, 1]], segments: 32 },
    { kind: 'tube', points: [[0, 0, 0], [0, 0, 0]], radius: 1, segments: 1000000, radialSegments: 8, closed: false },
    { ...extrude, code: 'alert(1)' },
  ])('rejects invalid topology, unbounded tessellation or code before rendering', geometry => {
    expect(sceneSchema.safeParse(shape(geometry)).success).toBe(false);
  });
  it('requires geometry for custom objects and rejects geometry on a primitive', () => {
    const definition = shape(extrude); delete (definition.objects[0] as {geometry?:unknown}).geometry;
    expect(sceneSchema.safeParse(definition).success).toBe(false);
    expect(sceneSchema.safeParse({ ...shape(extrude), objects: [{ ...shape(extrude).objects[0], type: 'box' }] }).success).toBe(false);
  });
  it('bounds aggregate tessellation before GPU allocation while accepting a detailed single object', () => {
    const geometry = { kind: 'tube', points: [[0, 0, 0], [1, 1, 0], [2, 0, 0]], radius: .1, segments: 256, radialSegments: 32, closed: false };
    const definition = shape(geometry);
    expect(sceneSchema.safeParse(definition).success).toBe(true);
    definition.objects = Array.from({ length: 40 }, (_, i) => ({ ...definition.objects[0], id: `tube-${i}` }));
    expect(sceneSchema.safeParse(definition).success).toBe(false);
  });
  it('shares identical geometry buffers without coupling object transforms', () => {
    const definition = sceneSchema.parse(shape(extrude));
    definition.objects.push({ ...definition.objects[0], id: 'second', position: [20, 0, 0] });
    const item = modelItem(definition), a = item.scene.getObjectByName('part') as import('three').Mesh, b = item.scene.getObjectByName('second') as import('three').Mesh;
    expect(a.geometry).toBe(b.geometry); expect(a.position).not.toBe(b.position);
    const before = a.position.clone(); b.position.x += 1; expect(a.position.equals(before)).toBe(true);
    item.dispose();
  });
  it('enforces the allocation budget across a decomposed scene and its retained source context', () => {
    const geometry = { kind: 'tube', points: [[0, 0, 0], [1, 1, 0], [2, 0, 0]], radius: .1, segments: 256, radialSegments: 32, closed: false };
    const definition = shape(geometry);
    const source = sceneSchema.parse({ ...definition, objects: Array.from({ length: 36 }, (_, i) => ({ ...definition.objects[0], id: `source-${i}` })) });
    const parts = sceneSchema.parse({ ...definition, objects: Array.from({ length: 36 }, (_, i) => ({ ...definition.objects[0], id: `part-${i}` })) });
    expect(() => decompositionContextScene(parts, source)).toThrow('decompositionAssemblyInvalid');
    expect(() => modelItem({ ...source, objects: [...source.objects, ...parts.objects] })).toThrow('visualGeometryBudgetExceeded');
  });
});
