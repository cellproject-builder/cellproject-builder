import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { sceneSchema } from '../../../src/visuals/normalize';
import { modelAssemblySchema, modelAssemblyMatchesScene } from '../../../src/visuals/modelAssembly';
import { layoutDecompositionGroups } from '../../../src/visuals/decompositionLayout';
import { modelItem } from '../../../src/visuals/rendering/VisualCanvasLayer';

const text=readFileSync('docs/design/samples/mg90s-advanced-2026-10-10.txt','utf8').replace(/\r\n?/g,'\n');
const assembly=modelAssemblySchema.parse(JSON.parse(text.split('CONTRATO E REFERÊNCIAS\n\n')[1].split('\n\nCENA COMPLETA MONTADA')[0]));
const scene=sceneSchema.parse(JSON.parse(text.split('CENA COMPLETA MONTADA\n\n')[1]));
assert(modelAssemblyMatchesScene(assembly,scene));
const snapshot=JSON.stringify(scene), groups=layoutDecompositionGroups(scene,assembly.groups), item=modelItem(scene,groups);
item.scene.updateMatrixWorld(true);
const positions=scene.objects.map(object=>item.scene.getObjectByName(object.id)!.getWorldPosition(new Vector3()));
item.setInspection!(1,null);item.scene.updateMatrixWorld(true);
const boxes=groups.map(group=>new Box3().setFromObject(item.scene.getObjectByName(`part:${group.partId}`)!));
for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert(!boxes[i].intersectsBox(boxes[j]),'Exploded modules overlap');
item.setInspection!(0,null);item.scene.updateMatrixWorld(true);
scene.objects.forEach((object,index)=>assert(item.scene.getObjectByName(object.id)!.getWorldPosition(new Vector3()).distanceTo(positions[index])<1e-9));
assert.equal(JSON.stringify(scene),snapshot);item.dispose();
console.log(JSON.stringify({objects:scene.objects.length,modules:groups.length,exactCoverage:true,explodedBoundsDisjoint:true,reversible:true,sourceUnchanged:true,
  geometry:scene.objects.reduce<Record<string,number>>((result,object)=>{const kind=object.geometry?.kind??object.type;result[kind]=(result[kind]??0)+1;return result;},{}),
  readableSources:assembly.sources.length},null,2));
