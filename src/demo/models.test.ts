import { Box3, BufferGeometry, Material, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { geometryTriangleBudget } from '@/visuals/geometrySchema';
import { sceneSchema } from '@/visuals/normalize';
import { modelItem } from '@/visuals/rendering/modelItem';
import { createDemoGardenScene, createDemoRobotScene } from './models';

describe('handcrafted local demo models', () => {
  it.each([
    ['robot', createDemoRobotScene],
    ['garden', createDemoGardenScene],
  ] as const)('%s produces deterministic, independently editable scenes within the native budget', (_, create) => {
    const scene = create();
    expect(sceneSchema.parse(scene)).toEqual(scene);
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
    expect(scene.label).toMatch(/ilustrativo/i);
    expect(scene.objects.length).toBeGreaterThanOrEqual(50);
    expect(scene.objects.length).toBeLessThanOrEqual(150);
    expect(scene.objects.reduce((sum, object) => sum + geometryTriangleBudget(object.geometry), 0)).toBeLessThan(150_000);
    expect(new Set(scene.objects.map(object => object.id)).size).toBe(scene.objects.length);
    expect(create()).toEqual(scene);
    const second = create();
    scene.objects[0].position[0] += 100;
    expect(create()).toEqual(second);
  });

  it('models distinct assemblies with shaped links, articulated fingers, leaves and irrigation tubing', () => {
    const robot = createDemoRobotScene(), garden = createDemoGardenScene();
    for (const side of ['left', 'right']) {
      expect(robot.objects.filter(object => object.id.includes(`${side}:link`) && object.geometry?.kind === 'extrude')).toHaveLength(4);
      expect(robot.objects.filter(object => object.id.includes(`${side}:finger`))).toHaveLength(6);
      expect(robot.objects.some(object => object.id.includes(`${side}:cable`) && object.geometry?.kind === 'tube')).toBe(true);
    }
    expect(robot.objects.some(object => object.geometry?.kind === 'extrude' && object.geometry.holes.length > 0)).toBe(true);
    expect(garden.objects.filter(object => object.id.includes(':leaf:') && object.geometry?.kind === 'buffer').length).toBeGreaterThanOrEqual(18);
    expect(garden.objects.some(object => object.id.includes('reservoir') && object.geometry?.kind === 'lathe')).toBe(true);
    expect(garden.objects.filter(object => object.geometry?.kind === 'tube').length).toBeGreaterThanOrEqual(6);
    expect(robot.objects.some(object => object.id.includes('reservoir'))).toBe(false);
    expect(garden.objects.some(object => object.id.includes('finger'))).toBe(false);
  });

  it.each([createDemoRobotScene, createDemoGardenScene])('renders finite fitted native geometry and releases its owned resources', create => {
    const definition = create(), snapshot = structuredClone(definition);
    const item = modelItem(definition);
    const bounds = new Box3().setFromObject(item.scene), size = bounds.getSize(new Vector3());
    expect([...bounds.min.toArray(), ...bounds.max.toArray()]).toSatisfy((values: number[]) => values.every(Number.isFinite));
    expect(size.toArray().every(value => value > .2 && value < 20)).toBe(true);
    const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
    item.scene.traverse(object => {
      if (object instanceof Mesh) {
        geometries.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      }
    });
    let disposedGeometries = 0, disposedMaterials = 0;
    geometries.forEach(geometry => {
      geometry.computeBoundingSphere();
      expect(geometry.boundingSphere?.radius).toBeGreaterThan(0);
      expect(geometry.boundingSphere?.center.toArray().every(Number.isFinite)).toBe(true);
      expect(Array.from(geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      geometry.addEventListener('dispose', () => { disposedGeometries++; });
    });
    materials.forEach(material => material.addEventListener('dispose', () => { disposedMaterials++; }));
    for (const aspect of [.45, 1, 2.4]) {
      item.fitAspect?.(aspect);
      item.setView?.(.6, -.2, 1.1);
      const camera = item.camera as PerspectiveCamera;
      expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
      expect(camera.near).toBeGreaterThan(0);
      expect(camera.far).toBeGreaterThan(camera.near);
    }
    item.dispose();
    expect(disposedGeometries).toBe(geometries.size);
    expect(disposedMaterials).toBe(materials.size);
    expect(definition).toEqual(snapshot);
  });
});
