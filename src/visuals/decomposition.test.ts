import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateObject } from 'ai';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { capturePlanner, initializeWorkspace } from '@/workspace/planner';
import { buildDemoProject } from '@/data/demoProject';
import { getVisualWorkspace, mutateVisualWorkspace, revertVisualArtifact } from './domain';
import { normalizeVisualWorkspace } from './normalize';
import { researchDecomposition, researchDecompositionParts } from './decompositionResearch';
import { readVisualImage } from './media';
import { applyDecompositionAssembly, decompositionAssemblyCurrent, decompositionIsCurrent, decompositionTxt, generateDecompositionAssembly, researchArtifactDecomposition } from './decomposition';
import type { DecompositionPart, DecompositionSource, SceneV1, VisualArtifact } from './types';

vi.mock('./decompositionResearch', () => ({ researchDecomposition: vi.fn(), researchDecompositionParts: vi.fn() }));
vi.mock('ai', () => ({ generateObject: vi.fn() }));
vi.mock('@/ai/client', () => ({ aiModel: {}, assertAIReady: vi.fn(), callOpts: () => ({}) }));
vi.mock('./media', async importOriginal => ({ ...await importOriginal<typeof import('./media')>(), readVisualImage: vi.fn() }));

const scene: SceneV1 = { version: 1, label: 'Arduino Uno R3', objects: [{ id: 'board', type: 'box', position: [0,0,0], rotation: [0,0,0], scale: [8,.2,5], color: '#008899' }] };
const artifact: VisualArtifact = { id: 'arduino-model', kind: 'model', label: scene.label, x: 150, y: 250, width: 360, height: 280, scene, mediaId: null, source: null, revisions: [{scene, mediaId:null, createdAt:1}], revisionIndex:0 };
const source: DecompositionSource = {id:'official',url:'https://docs.arduino.cc/hardware/uno-rev3/',title:'UNO R3',text:'Arduino Uno R3 uses ATmega328P. The board includes a USB type B connector.',retrievedAt:1};
const parts: DecompositionPart[] = [
  {id:'mcu', name:'ATmega328P',partNumber:'ATmega328P',quantity:null,role:'Microcontrolador',specifications:['ATmega328P'],evidence:[{sourceId:source.id,quote:'Arduino Uno R3 uses ATmega328P.'}],unknowns:['Altura não documentada']},
  {id:'usb',name:'USB tipo B',partNumber:null,quantity:null,role:'Conector',specifications:['USB type B'],evidence:[{sourceId:source.id,quote:'The board includes a USB type B connector.'}],unknowns:[]},
];
const geometryResponse = {object:{label:'Componentes Arduino',parts:[
  {partId:'mcu',sourceObjectIds:[] as string[],objects:[
    {...scene.objects[0],id:'mcu-body',scale:[3,.5,1]},
    {...scene.objects[0],id:'mcu-pin',position:[1,0,0],scale:[.1,.1,.1]},
  ]},
  {partId:'usb',sourceObjectIds:[] as string[],objects:[{...scene.objects[0],id:'usb-body',position:[-3,0,0],scale:[1,1,1]}]},
]},finishReason:'stop'};
const signal = () => new AbortController().signal;
beforeEach(async () => {
  await Promise.all([useGraphStore.persist.rehydrate(),useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({projects:{},notes:{},activeProjectId:null,legacyImported:true});
  useGraphStore.setState({project:{...buildDemoProject(),id:'decomposition-plan'},selectedNodeId:null,aiJobs:{}});
  initializeWorkspace();
  const owner = useWorkspaceStore.getState().createProject('Decomposição');
  useWorkspaceStore.getState().savePlanner(owner,capturePlanner()); initializeWorkspace();
  useWorkspaceStore.setState({activeProjectId:owner});
  mutateVisualWorkspace(w=>({...w,artifacts:[structuredClone(artifact)],proposals:[]}));
  vi.mocked(researchDecomposition).mockReset().mockResolvedValue({identity:'Arduino Uno R3 DIP A000066',sources:[source],parts,unknowns:['Lista parcial da documentação recuperada.']});
  vi.mocked(researchDecompositionParts).mockReset().mockResolvedValue({identity:'Arduino Uno R3 DIP A000066',sources:[source],parts,unknowns:[]});
  vi.mocked(generateObject).mockReset().mockResolvedValue(structuredClone(geometryResponse) as never);
  vi.mocked(readVisualImage).mockReset().mockResolvedValue({image:new Uint8Array([1,2,3]),mediaType:'image/png'});
});
const current = () => getVisualWorkspace(useGraphStore.getState().project).artifacts[0];

describe('documented object decomposition',()=>{
  it('stores one related dossier with real excerpts, without creating extra artifacts',async()=>{
    const dossier=await researchArtifactDecomposition(artifact.id,'Arduino Uno R3 DIP A000066',{signal:signal()});
    expect(dossier.parts.map(p=>p.id)).toEqual(['mcu','usb']);
    expect(decompositionTxt(artifact.id)).toContain('"id": "board"');
    expect(current().decomposition).toEqual(dossier);
    expect(decompositionIsCurrent(current())).toBe(true);
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
    expect(normalizeVisualWorkspace(getVisualWorkspace(useGraphStore.getState().project)).artifacts[0].decomposition).toEqual(dossier);
  });
  it('requires an existing-product identity and rejects a component without a documentary excerpt',async()=>{
    await expect(researchArtifactDecomposition(artifact.id,' ',{signal:signal()})).rejects.toThrow('decompositionIdentityRequired');
    vi.mocked(researchDecomposition).mockResolvedValue({identity:'Arduino Uno',sources:[source],parts:[{...parts[0],evidence:[{sourceId:source.id,quote:'Imaginary processor not in the document'}]}],unknowns:[]});
    await expect(researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()})).rejects.toThrow('decompositionNoEvidence');
    expect(current().decomposition).toBeUndefined();
  });
  it('detects a transient project switch during research without storing the result',async()=>{
    vi.mocked(researchDecomposition).mockImplementation(async()=>{
      const original=useGraphStore.getState().project!;
      useGraphStore.setState({project:{...original,id:'other'}});useGraphStore.setState({project:original});
      return {identity:'Uno',sources:[source],parts,unknowns:[]};
    });
    await expect(researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()})).rejects.toThrow('visualProjectChanged');
    expect(current().decomposition).toBeUndefined();
  });
  it('marks the dossier stale when the model changes but not when it moves on the canvas',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    mutateVisualWorkspace(w=>({...w,artifacts:w.artifacts.map(a=>({...a,x:a.x+10}))}));
    expect(decompositionIsCurrent(current())).toBe(true);
    mutateVisualWorkspace(w=>({...w,artifacts:w.artifacts.map(a=>({...a,scene:{...scene,label:'Changed model'}}))}));
    expect(decompositionIsCurrent(current())).toBe(false);
    await expect(generateDecompositionAssembly(artifact.id,['mcu'],{signal:signal()})).rejects.toThrow('decompositionStale');
  });
  it('prepares individual piece groups and applies them only explicitly, preserving the original model and canvas',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const proposal=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    expect(current().decomposition?.assembly).toBeUndefined();
    expect(proposal.assembly.groups.find(g=>g.partId==='mcu')?.objectIds).toEqual(['mcu-body','mcu-pin']);
    const original=structuredClone(current());
    const child=applyDecompositionAssembly(artifact.id,proposal);
    expect(decompositionAssemblyCurrent(current())).toBe(true);
    expect(current()).toMatchObject({x:150,y:250,scene,revisionIndex:0});
    expect(current().decomposition?.assembly?.scene.objects).toHaveLength(3);
    expect(child).toMatchObject({kind:'model',sourceArtifactId:artifact.id,scene:proposal.assembly.scene});
    expect(child.id).not.toBe(artifact.id);
    expect(child.x).toBeGreaterThanOrEqual(original.x+original.width);
    expect(current()).toMatchObject({scene:original.scene,revisions:original.revisions,x:original.x,y:original.y,width:original.width,height:original.height});
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(2);
    expect(decompositionAssemblyCurrent(child)).toBe(true);
    expect(normalizeVisualWorkspace(getVisualWorkspace(useGraphStore.getState().project)).artifacts[0].decomposition?.assembly).toEqual(proposal.assembly);
  });
  it('reuses every mapped source primitive exactly, retaining small details and original assembled transforms',async()=>{
    const detailedScene:SceneV1={...scene,objects:[
      {...scene.objects[0],id:'mcu-body',position:[1,.6,2],rotation:[0,.4,0],scale:[2,.5,1],color:'#112233'},
      {...scene.objects[0],id:'mcu-pin-1',type:'cylinder',position:[1,.3,1.2],rotation:[0,0,1.57],scale:[.08,.7,.08],color:'#cccccc'},
      {...scene.objects[0],id:'mcu-pin-2',type:'cylinder',position:[1,.3,2.8],rotation:[0,0,1.57],scale:[.08,.7,.08],color:'#dddddd'},
      {...scene.objects[0],id:'usb-shell',position:[-3,.6,0],color:'#aaaaaa'},
      scene.objects[0],
    ]};
    mutateVisualWorkspace(w=>({...w,artifacts:[{...artifact,scene:detailedScene}]}));
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    vi.mocked(generateObject).mockResolvedValueOnce({object:{label:'Peças preservadas',parts:[
      {partId:'mcu',sourceObjectIds:['mcu-body','mcu-pin-1','mcu-pin-2'],objects:[]},
      {partId:'usb',sourceObjectIds:['usb-shell'],objects:[]},
    ]},finishReason:'stop'} as never);
    const pending=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    expect(pending.assembly.scene.objects).toEqual(detailedScene.objects.slice(0,4));
    expect(pending.assembly).toMatchObject({geometryBasis:'source',reusedObjectIds:['mcu-body','mcu-pin-1','mcu-pin-2','usb-shell']});
    const child=applyDecompositionAssembly(artifact.id,pending);
    expect(child.scene?.objects).toEqual(detailedScene.objects.slice(0,4));
    expect(current().scene).toEqual(detailedScene);
  });
  it('combines reused and newly modelled absent pieces without replacing source geometry',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const raw=structuredClone(geometryResponse.object);
    raw.parts[0]={partId:'mcu',sourceObjectIds:['board'],objects:[]};
    vi.mocked(generateObject).mockResolvedValueOnce({object:raw,finishReason:'stop'} as never);
    const pending=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    expect(pending.assembly.scene.objects[0]).toEqual(scene.objects[0]);
    expect(pending.assembly).toMatchObject({geometryBasis:'mixed',reusedObjectIds:['board']});
    expect(pending.assembly.scene.objects).toHaveLength(2);
  });
  it('rejects altered reused geometry at approval without changing the original or creating a child',async()=>{
    const originalScene:SceneV1={...scene,objects:[{...scene.objects[0],id:'mcu-body',scale:[2,.5,1],color:'#112233'}]};
    mutateVisualWorkspace(w=>({...w,artifacts:[{...artifact,scene:originalScene}]}));
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const raw=structuredClone(geometryResponse.object);
    raw.parts[0]={partId:'mcu',sourceObjectIds:['mcu-body'],objects:[]};
    vi.mocked(generateObject).mockResolvedValueOnce({object:raw,finishReason:'stop'} as never);
    const pending=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    pending.assembly.scene.objects.find(o=>o.id==='mcu-body')!.color='#ffffff';
    const before=structuredClone(current());
    expect(()=>applyDecompositionAssembly(artifact.id,pending)).toThrow('decompositionAssemblyInvalid');
    expect(current()).toEqual(before);
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
  });
  it('uses only original linked or retained reference pixels and deduplicates their media',async()=>{
    const originalImage:VisualArtifact={...artifact,id:'image-original',kind:'image',mediaId:'pixels-original',scene:null,revisions:[{scene:null,mediaId:'pixels-original',createdAt:1}]};
    const unrelatedImage:VisualArtifact={...originalImage,id:'unrelated',mediaId:'unrelated-media'};
    mutateVisualWorkspace(w=>({...w,artifacts:[{...artifact,origin:{proposalId:'original-request',instruction:'Arduino',imageIds:[originalImage.id],imageMediaIds:['pixels-original','retained-detail']}},originalImage,unrelatedImage]}));
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    const request=vi.mocked(generateObject).mock.calls[0][0];
    expect(request.prompt).toBeUndefined();
    const message=request.messages?.[0];
    expect(message?.content).toEqual(expect.arrayContaining([{type:'image',image:new Uint8Array([1,2,3]),mediaType:'image/png'}]));
    expect(Array.isArray(message?.content) ? message.content.filter(p=>p.type==='image') : []).toHaveLength(2);
    expect(request.system).toContain('Actual image pixels are included with explicit user consent.');
    expect(JSON.stringify(request.messages)).not.toContain('unrelated');
  });
  it('reports an unsupported vision provider without writing a new child or assembly',async()=>{
    mutateVisualWorkspace(w=>({...w,artifacts:[{...artifact,origin:{proposalId:'request',instruction:'Arduino',imageIds:[],imageMediaIds:['pixels-original']}}]}));
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    vi.mocked(generateObject).mockRejectedValueOnce(new Error('No endpoints found that support image input'));
    await expect(generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()})).rejects.toThrow('visualVisionUnsupported');
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
    expect(current().decomposition?.assembly).toBeUndefined();
  });
  it('rejects combined reused and generated scenes above 128 primitives',async()=>{
    const fullScene:SceneV1={...scene,objects:Array.from({length:128},(_,index)=>({...scene.objects[0],id:`original-${index}`}))};
    mutateVisualWorkspace(w=>({...w,artifacts:[{...artifact,scene:fullScene}]}));
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const raw=structuredClone(geometryResponse.object);
    raw.parts[0]={partId:'mcu',sourceObjectIds:fullScene.objects.map(o=>o.id),objects:[]};
    vi.mocked(generateObject).mockResolvedValueOnce({object:raw,finishReason:'stop'} as never);
    await expect(generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()})).rejects.toThrow('decompositionAssemblyInvalid');
    expect(current().scene).toEqual(fullScene);
  });
  it('creates linked children without overlap and copies the original node association and provenance',async()=>{
    const origin={proposalId:'original-request',imageIds:[],imageMediaIds:[],instruction:'Arduino detalhado'};
    mutateVisualWorkspace(w=>({...w,artifacts:[{...artifact,linkedNodeId:'node-a',origin},{...artifact,id:'obstacle',x:590,y:250}]}));
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const child=applyDecompositionAssembly(artifact.id,await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()}));
    expect(child).toMatchObject({linkedNodeId:'node-a',origin,sourceArtifactId:artifact.id});
    expect(child.x).toBeGreaterThanOrEqual(590+artifact.width);
    expect(decompositionTxt(child.id)).toContain(`Artefato original: ${artifact.id}`);
    expect(decompositionTxt(child.id)).toContain(`Artefato decomposto: ${child.id}`);
    expect(decompositionTxt(child.id)).toContain('"id": "board"');
  });
  it('marks a child stale when the original changes or disappears and prevents decomposing a child again',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const child=applyDecompositionAssembly(artifact.id,await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()}));
    await expect(researchArtifactDecomposition(child.id,'Arduino Uno',{signal:signal()})).rejects.toThrow('decompositionUseOriginal');
    await expect(generateDecompositionAssembly(child.id,['mcu'],{signal:signal()})).rejects.toThrow('decompositionUseOriginal');
    mutateVisualWorkspace(w=>({...w,artifacts:w.artifacts.map(a=>a.id===artifact.id?{...a,label:'Original alterado'}:a)}));
    expect(decompositionIsCurrent(child)).toBe(false);
    expect(decompositionAssemblyCurrent(child)).toBe(false);
    mutateVisualWorkspace(w=>({...w,artifacts:w.artifacts.filter(a=>a.id!==artifact.id)}));
    expect(decompositionIsCurrent(child)).toBe(false);
  });
  it('marks an older child stale when the original receives a new research dossier',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const child=applyDecompositionAssembly(artifact.id,await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()}));
    expect(decompositionIsCurrent(child)).toBe(true);
    const snapshot=structuredClone(child.scene);
    await researchArtifactDecomposition(artifact.id,'Outra revisão real',{signal:signal()});
    expect(decompositionIsCurrent(child)).toBe(false);
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts.find(a=>a.id===child.id)?.scene).toEqual(snapshot);
  });
  it('marks a modified child scene stale while preserving an unchanged original',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const child=applyDecompositionAssembly(artifact.id,await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()}));
    mutateVisualWorkspace(w=>({...w,artifacts:w.artifacts.map(a=>a.id===child.id?{...a,scene:{...a.scene!,label:'Edited child'}}:a)}));
    const edited=getVisualWorkspace(useGraphStore.getState().project).artifacts.find(a=>a.id===child.id)!;
    expect(decompositionAssemblyCurrent(edited)).toBe(false);
    expect(decompositionIsCurrent(current())).toBe(true);
    expect(current().scene).toEqual(scene);
  });
  it.each(['unknown source','duplicate source','replacement geometry','duplicate part','missing part'])('rejects invalid source segmentation: %s',async(kind)=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const raw=structuredClone(geometryResponse.object);
    if(kind==='unknown source') raw.parts[0].sourceObjectIds=['not-in-original'];
    if(kind==='duplicate source') {raw.parts[0].sourceObjectIds=['board'];raw.parts[0].objects=[];raw.parts[1].sourceObjectIds=['board'];raw.parts[1].objects=[];}
    if(kind==='replacement geometry') raw.parts[0].sourceObjectIds=['board'];
    if(kind==='duplicate part') raw.parts[1].partId='mcu';
    if(kind==='missing part') raw.parts.pop();
    vi.mocked(generateObject).mockResolvedValueOnce({object:raw,finishReason:'stop'} as never);
    await expect(generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()})).rejects.toThrow('decompositionAssemblyInvalid');
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
  });
  it('rejects geometry assigned to a part outside the human selection',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    await expect(generateDecompositionAssembly(artifact.id,['mcu'],{signal:signal()})).rejects.toThrow('decompositionAssemblyInvalid');
    expect(current().decomposition?.assembly).toBeUndefined();
  });
  it('rejects stale pending geometry after a new research result',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const assembly=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    await researchArtifactDecomposition(artifact.id,'Arduino Uno R3',{signal:signal()});
    expect(()=>applyDecompositionAssembly(artifact.id,assembly)).toThrow('decompositionStale');
  });
  it('exports a linked TXT with identity, excerpts, sources and geometry grouped by component',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno R3',{signal:signal()});
    applyDecompositionAssembly(artifact.id,await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()}));
    const txt=decompositionTxt(artifact.id);
    expect(txt).toContain('CONTEXTO VISUAL NÃO CLASSIFICADO');
    expect(txt).toContain(artifact.id);expect(txt).toContain(source.url);expect(txt).toContain(source.text.split('. ')[0]);
    expect(txt).toContain('mcu-body');expect(txt).toContain('USB tipo B');expect(txt).toContain('ilustrativ');
    expect(decompositionTxt(artifact.id)).toBe(txt);
  });
  it('identifies documented codes first in TXT and qualifies AI names and functions as interpretations',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno R3',{signal:signal()});
    const txt=decompositionTxt(artifact.id);
    expect(txt).toContain('[mcu] ATmega328P\nNome sugerido pela IA: ATmega328P');
    expect(txt).toContain('[usb] Componente sem código documentado\nNome sugerido pela IA: USB tipo B');
    expect(txt).toContain('Função sugerida pela IA: Microcontrolador');
    expect(txt).toContain('Trechos e códigos documentados não validam, por si só, as classificações e funções sugeridas pela IA.');
  });
  it('instructs geometry to prioritize documentary evidence over provisional AI classifications',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno R3',{signal:signal()});
    await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    const request=vi.mocked(generateObject).mock.calls[0][0];
    expect(request.system).toContain('Part names and roles are provisional AI interpretations, not verified classifications.');
    expect(request.system).toContain('Prioritize partNumber, verbatim specifications and source quotes');
    expect(request.system).toContain('Never infer a verified component type or dimensions from names or roles alone.');
  });
  it('fails closed when imported groups refer to nonexistent or multiply assigned geometry',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const assembly=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    applyDecompositionAssembly(artifact.id,assembly);
    const raw=structuredClone(getVisualWorkspace(useGraphStore.getState().project));
    raw.artifacts[0].decomposition!.assembly!.groups[0].objectIds.push('missing');
    expect(()=>normalizeVisualWorkspace(raw)).toThrow();
  });
  it('invalidates research when an origin image changes, but ignores its canvas placement',async()=>{
    const image: VisualArtifact={...artifact,id:'reference',kind:'image',scene:null,mediaId:'image-one',revisions:[{scene:null,mediaId:'image-one',createdAt:1}]};
    mutateVisualWorkspace(w=>({...w,artifacts:[{...artifact,origin:{proposalId:'old',imageIds:[image.id],imageMediaIds:['image-one'],instruction:'Arduino'}},image]}));
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    mutateVisualWorkspace(w=>({...w,artifacts:w.artifacts.map(a=>a.id===image.id?{...a,x:999}:a)}));
    expect(decompositionIsCurrent(current())).toBe(true);
    mutateVisualWorkspace(w=>({...w,artifacts:w.artifacts.map(a=>a.id===image.id?{...a,mediaId:'image-two'}:a)}));
    expect(decompositionIsCurrent(current())).toBe(false);
  });
  it('blocks unsupported part numbers and specifications at the import boundary',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const raw=structuredClone(getVisualWorkspace(useGraphStore.getState().project));
    raw.artifacts[0].decomposition!.parts[0].specifications.push('invented 9 volt supply');
    expect(()=>normalizeVisualWorkspace(raw)).toThrow();
    raw.artifacts[0].decomposition!.parts[0].specifications.pop();
    raw.artifacts[0].decomposition!.parts[0].partNumber='OTHER-CHIP';
    expect(()=>normalizeVisualWorkspace(raw)).toThrow();
    raw.artifacts[0].decomposition!.parts[0].partNumber='ATmega328P';
    raw.artifacts[0].decomposition!.parts[0].quantity=99;
    expect(()=>normalizeVisualWorkspace(raw)).toThrow();
  });
  it('rejects an artifact changed and restored while component geometry is pending',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    vi.mocked(generateObject).mockImplementation(async()=>{
      mutateVisualWorkspace(w=>({...w,artifacts:w.artifacts.map(a=>({...a,label:'Transient'}))}));
      mutateVisualWorkspace(w=>({...w,artifacts:w.artifacts.map(a=>({...a,label:artifact.label}))}));
      return {object:{...scene,objects:scene.objects.map(o=>({...o,partId:'mcu'}))},finishReason:'stop'} as never;
    });
    await expect(generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()})).rejects.toThrow('decompositionStale');
    expect(current().decomposition?.assembly).toBeUndefined();
  });
  it('does not write an aborted documentary result',async()=>{
    const controller=new AbortController();
    vi.mocked(researchDecomposition).mockImplementation(async()=>{controller.abort();return {identity:'Uno',sources:[source],parts,unknowns:[]};});
    await expect(researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:controller.signal})).rejects.toThrow();
    expect(current().decomposition).toBeUndefined();
  });
  it('preserves the original part number when a second source changes only letter casing',async()=>{
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    vi.mocked(researchDecompositionParts).mockResolvedValue({identity:'Arduino Uno',sources:[source],parts:parts.map(p=>({...p,partNumber:p.partNumber?.toUpperCase()??null})),unknowns:[]});
    const pending=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    expect(pending.dossier.parts[0].partNumber).toBe('ATmega328P');
    expect(current().decomposition?.parts[0].partNumber).toBe('ATmega328P');
  });
  it('backfills legacy model provenance before researching so proposal retention does not invalidate the dossier',async()=>{
    const legacyId='legacy';
    mutateVisualWorkspace(w=>({...w,artifacts:[{...artifact,id:`model-${legacyId}`}],proposals:[{id:legacyId,projectId:'decomposition-plan',label:scene.label,scene,input:{text:'Arduino board',mentions:[],attachments:[]},contextFingerprint:'legacy',referencedMediaIds:['original-image'],createdAt:1,status:'applied'}]}));
    await researchArtifactDecomposition(`model-${legacyId}`,'Arduino Uno',{signal:signal()});
    expect(current().origin).toMatchObject({proposalId:legacyId,imageMediaIds:['original-image']});
    mutateVisualWorkspace(w=>({...w,proposals:[]}));
    expect(decompositionIsCurrent(current())).toBe(true);
  });
  it('reverts the original revision without removing its separate decomposition snapshot',async()=>{
    const previousScene={...scene,label:'Previous original'};
    mutateVisualWorkspace(w=>({...w,artifacts:w.artifacts.map(a=>a.id===artifact.id?{...a,revisionIndex:1,revisions:[
      {scene:previousScene,mediaId:null,createdAt:1},{scene,mediaId:null,createdAt:2},
    ]}:a)}));
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    const child=applyDecompositionAssembly(artifact.id,await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()}));
    revertVisualArtifact(artifact.id);
    expect(current()).toMatchObject({scene:previousScene,revisionIndex:0,x:150,y:250});
    expect(current().decomposition?.assembly).toEqual(child.decomposition?.assembly);
    expect(getVisualWorkspace(useGraphStore.getState().project).artifacts.find(a=>a.id===child.id)).toEqual(child);
    expect(current().decomposition?.parts).toHaveLength(2);
    expect(decompositionIsCurrent(current())).toBe(false);
    expect(decompositionIsCurrent(child)).toBe(false);
  });

  async function applyInitialAssembly() {
    await researchArtifactDecomposition(artifact.id,'Arduino Uno',{signal:signal()});
    applyDecompositionAssembly(artifact.id,await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()}));
  }
  function enrichNextResearch() {
    const dimensions: DecompositionSource = { ...source, id:'dimensions', url:'https://example.com/atmega328p',
      text:'The ATmega328P package measures 7.5 mm.' };
    vi.mocked(researchDecompositionParts).mockResolvedValue({ identity:'Arduino Uno', sources:[source,dimensions], parts:[
      {...parts[0], specifications:['7.5 mm'], evidence:[{sourceId:'dimensions',quote:dimensions.text}]}, parts[1],
    ], unknowns:['Dimensões do encapsulamento documentadas; montagem continua ilustrativa.'] });
  }

  it('stages researched specifications and geometry without changing an applied model until approval',async()=>{
    await applyInitialAssembly();
    const before = JSON.stringify(current());
    enrichNextResearch();
    const pending=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    expect(JSON.stringify(current())).toBe(before);
    expect(pending.dossier.sources.some(s=>s.id==='dimensions')).toBe(true);
    expect(pending.dossier.parts[0].specifications).toContain('7.5 mm');
    expect(pending.dossier.unknowns).toContain('Lista parcial da documentação recuperada.');
    expect(pending.dossier.unknowns).toContain('Pesquisa individual: Dimensões do encapsulamento documentadas; montagem continua ilustrativa.');
    expect(pending.baseDossierFingerprint).toBeTruthy();
    applyDecompositionAssembly(artifact.id,pending);
    expect(current().decomposition?.sources.some(s=>s.id==='dimensions')).toBe(true);
    expect(current().decomposition?.assembly).toEqual(pending.assembly);
    expect(current().scene).toEqual(scene);
    expect(decompositionAssemblyCurrent(current())).toBe(true);
  });

  it('applies revised AI names and functions only after approval while preserving membership evidence and original code',async()=>{
    const mistakenPart={...parts[0],name:'Capacitor',role:'Armazenamento de carga'};
    vi.mocked(researchDecomposition).mockResolvedValue({identity:'Arduino Uno R3 DIP A000066',sources:[source],parts:[mistakenPart,parts[1]],unknowns:[]});
    await researchArtifactDecomposition(artifact.id,'Arduino Uno R3',{signal:signal()});
    const initial=structuredClone(current().decomposition!);
    const manufacturer: DecompositionSource={id:'manufacturer',url:'https://example.com/atmega328p-datasheet',title:'Component datasheet',text:'ATMEGA328P is an 8-bit microcontroller.',retrievedAt:2};
    const revisedPart={...parts[0],partNumber:'ATMEGA328P',name:'Microcontrolador ATmega328P',role:'Executa o programa da placa',specifications:['ATMEGA328P'],evidence:[{sourceId:manufacturer.id,quote:manufacturer.text}]};
    vi.mocked(researchDecompositionParts).mockResolvedValue({identity:initial.identity,sources:[manufacturer,source],parts:[revisedPart,parts[1]],unknowns:[]});
    const pending=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    expect(current().decomposition).toEqual(initial);
    expect(pending.dossier.parts[0]).toMatchObject({id:'mcu',partNumber:'ATmega328P',name:revisedPart.name,role:revisedPart.role});
    expect(pending.dossier.parts[0].evidence).toEqual(expect.arrayContaining([...mistakenPart.evidence,...revisedPart.evidence]));
    applyDecompositionAssembly(artifact.id,pending);
    expect(current().decomposition?.parts[0]).toEqual(pending.dossier.parts[0]);
    expect(decompositionAssemblyCurrent(current())).toBe(true);
  });

  it.each(['abort','provider failure'])('preserves an applied model and dossier when regeneration ends with %s',async(reason)=>{
    await applyInitialAssembly();
    const before = JSON.stringify(current());
    enrichNextResearch();
    const controller = new AbortController();
    if (reason==='abort') vi.mocked(generateObject).mockImplementationOnce(async()=>{controller.abort();return structuredClone(geometryResponse) as never;});
    else vi.mocked(generateObject).mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:controller.signal})).rejects.toThrow();
    expect(JSON.stringify(current())).toBe(before);
    expect(decompositionAssemblyCurrent(current())).toBe(true);
  });

  it('rejects a second pending proposal after a different assembly is approved against the same research',async()=>{
    await applyInitialAssembly();
    const before = JSON.stringify(current());
    vi.mocked(generateObject)
      .mockResolvedValueOnce({...geometryResponse,object:{...geometryResponse.object,label:'First pending assembly'}} as never)
      .mockResolvedValueOnce({...geometryResponse,object:{...geometryResponse.object,label:'Second pending assembly'}} as never);
    const first=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    const second=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    expect(JSON.stringify(current())).toBe(before);
    applyDecompositionAssembly(artifact.id,first);
    expect(()=>applyDecompositionAssembly(artifact.id,second)).toThrow('decompositionStale');
    expect(current().decomposition?.assembly?.scene.label).toBe('First pending assembly');
  });

  it('rejects an in-flight geometry result after another assembly is approved without changing documentary facts',async()=>{
    await applyInitialAssembly();
    vi.mocked(generateObject).mockResolvedValueOnce({...geometryResponse,object:{...geometryResponse.object,label:'Another approval'}} as never);
    const approved=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    let release!: (value: never) => void, started!: () => void;
    const ready = new Promise<void>(resolve=>{started=resolve;});
    vi.mocked(generateObject).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;started();}));
    const inFlight=generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    await ready;
    applyDecompositionAssembly(artifact.id,approved);
    release(structuredClone(geometryResponse) as never);
    await expect(inFlight).rejects.toThrow('decompositionStale');
    expect(current().decomposition?.assembly?.scene.label).toBe('Another approval');
  });

  it('invalidates a pending proposal after the user restores the original model',async()=>{
    mutateVisualWorkspace(w=>({...w,artifacts:w.artifacts.map(a=>a.id===artifact.id?{...a,revisionIndex:1,revisions:[
      {scene:{...scene,label:'Previous original'},mediaId:null,createdAt:1},{scene,mediaId:null,createdAt:2},
    ]}:a)}));
    await applyInitialAssembly();
    const applied=current().decomposition?.assembly;
    const pending=await generateDecompositionAssembly(artifact.id,['mcu','usb'],{signal:signal()});
    revertVisualArtifact(artifact.id);
    expect(()=>applyDecompositionAssembly(artifact.id,pending)).toThrow('decompositionStale');
    expect(current().decomposition?.assembly).toEqual(applied);
  });
});
