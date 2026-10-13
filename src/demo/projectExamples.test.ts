import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createDemoServoScene, createDemoRobotScene, createDemoGardenScene, createDemoAssembly } from './models';
import { modelAssemblySchema, modelAssemblyCurrent } from '@/visuals/modelAssembly';
import { artifactSchema, sceneSchema } from '@/visuals/normalize';
import { modelSceneFingerprint } from '@/visuals/modelAssembly';
import { modelArtifactItem } from '@/visuals/rendering/VisualCanvasLayer';
import { servoSignalDiagram } from './servoDiagrams';
import { parseDiagram, evaluateDiagram } from '@/visuals/diagram/model';

it('renders actual native servo groups that move and highlight in exploded inspection without changing the saved model', () => {
  const scene = createDemoServoScene();
  const assembly = createDemoAssembly(scene, 'servo-node');
  expect(modelAssemblySchema.parse(assembly)).toEqual(assembly);
  expect(assembly.groups.map(group => group.name)).toEqual(expect.arrayContaining(['Motor DC', 'Trem de engrenagens', 'Carcaça e fixação']));
  const artifact = artifactSchema.parse({ id: 'servo-example', label: scene.label, kind: 'model', scene, assembly, x: 0, y: 0, width: 620, height: 500, mediaId: null, source: null, revisions: [{ scene, assembly, createdAt: 1, mediaId: null }], revisionIndex: 0 });
  expect(modelAssemblyCurrent(artifact)).toBe(true);
  const item = modelArtifactItem(artifact)!;
  const positions = assembly.groups.map(group => item.scene.getObjectByName(`part:${group.partId}`)!.position.clone());
  const before = JSON.stringify(scene);
  item.setInspection?.(1, 'motor'); item.scene.updateMatrixWorld(true);
  assembly.groups.forEach((group, index) => {
    expect(item.scene.getObjectByName(`part:${group.partId}`)!.position.distanceTo(positions[index])).toBeGreaterThan(.1);
  });
  expect(item.scene.getObjectByName('part:motor')!.getWorldPosition(new Vector3()).toArray().every(Number.isFinite)).toBe(true);
  item.setInspection?.(0, null);
  assembly.groups.forEach(group => expect(item.scene.getObjectByName(`part:${group.partId}`)!.position.length()).toBe(0));
  expect(JSON.stringify(scene)).toBe(before); item.dispose();
});

it('keeps the local PWM diagram linked to plan nodes and updates its pulse from the requested position', () => {
  const diagram = parseDiagram(servoSignalDiagram('robot'), ['robot:step:3', 'robot:step:6']);
  expect(evaluateDiagram(diagram, { position: 0 }).pulse).toBe(1);
  expect(evaluateDiagram(diagram, { position: 90 }).pulse).toBe(1.5);
  expect(evaluateDiagram(diagram, { position: 180 }).pulse).toBe(2);
  expect(diagram.elements.filter(element => element.nodeId)).toHaveLength(2);
});

it.each([createDemoServoScene, createDemoRobotScene, createDemoGardenScene])('retains native assembly validity through scene normalization', create => {
  const scene = create();
  expect(modelSceneFingerprint(sceneSchema.parse(scene))).toBe(modelSceneFingerprint(scene));
  const assembly = createDemoAssembly(scene, 'node');
  artifactSchema.parse({ id: 'model', label: scene.label, kind: 'model', scene, assembly, x: 0, y: 0, width: 620, height: 500, mediaId: null, source: null, revisions: [{ scene, assembly, createdAt: 1, mediaId: null }], revisionIndex: 0 });
});
