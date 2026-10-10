import * as THREE from 'three';
import { modelItem } from '/src/visuals/rendering/VisualCanvasLayer';
import { sceneSchema } from '/src/visuals/normalize';
import { layoutDecompositionGroups } from '/src/visuals/decompositionLayout';
import { modelAssemblySchema, modelAssemblyMatchesScene } from '/src/visuals/modelAssembly';

try {
  const response=await fetch('../samples/mg90s-advanced-2026-10-10.txt');
  if(!response.ok)throw new Error('missing sample');
  const text=await response.text();
  const assembly=modelAssemblySchema.parse(JSON.parse(text.split('CONTRATO E REFERÊNCIAS\n\n')[1].split('\n\nCENA COMPLETA MONTADA')[0]));
  const scene=sceneSchema.parse(JSON.parse(text.split('CENA COMPLETA MONTADA\n\n')[1]));
  if(!modelAssemblyMatchesScene(assembly,scene))throw new Error('stale sample');
  const groups=layoutDecompositionGroups(scene,assembly.groups);
  const amount=document.getElementById('amount') as HTMLInputElement, output=document.getElementById('value')!, select=document.getElementById('part') as HTMLSelectElement;
  for(const group of assembly.groups){const option=document.createElement('option');option.value=group.partId;option.textContent=group.name;select.append(option);}
  const contract=document.getElementById('contract')!;
  for(const module of assembly.plan.modules){const heading=document.createElement('h3'),body=document.createElement('p');heading.textContent=module.name;body.textContent=module.prompt;contract.append(heading,body);}
  const unknowns=document.createElement('ul');for(const unknown of assembly.unknowns){const item=document.createElement('li');item.textContent=unknown;unknowns.append(item);}contract.append(unknowns);
  const initialYaw=.72,initialPitch=-.4;
  let yaw=initialYaw,pitch=initialPitch,target=1,selection:string|null=null;
  const views=['mounted','exploded-view'].map((id,index)=>{
    const canvas=document.getElementById(id) as HTMLCanvasElement,item=modelItem(scene,groups);
    const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
    new ResizeObserver(()=>{const rect=canvas.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);item.fitAspect?.(rect.width/rect.height);}).observe(canvas);
    let drag:{x:number;y:number}|null=null;
    canvas.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);});
    canvas.addEventListener('pointermove',event=>{if(!drag)return;yaw+=(event.clientX-drag.x)*.008;pitch+=(event.clientY-drag.y)*.008;drag={x:event.clientX,y:event.clientY};});
    canvas.addEventListener('pointerup',()=>{drag=null;});canvas.addEventListener('pointercancel',()=>{drag=null;});
    return {item,renderer,index};
  });
  function setAmount(value:number){target=value;amount.value=String(Math.round(value*100));output.textContent=`${Math.round(value*100)}%`;}
  document.getElementById('assembled')!.addEventListener('click',()=>setAmount(0));
  document.getElementById('exploded')!.addEventListener('click',()=>setAmount(1));
  amount.addEventListener('input',()=>setAmount(Number(amount.value)/100));
  select.addEventListener('change',()=>{selection=select.value||null;});
  document.getElementById('reset')!.addEventListener('click',()=>{yaw=initialYaw;pitch=initialPitch;});
  let previous=performance.now();const frame=(now:number)=>{const delta=(now-previous)/1000;previous=now;views.forEach(view=>{view.item.setView?.(yaw,pitch);view.item.setInspection?.(view.index?target:0,selection,delta);view.renderer.render(view.item.scene,view.item.camera);});requestAnimationFrame(frame);};requestAnimationFrame(frame);
  window.addEventListener('pagehide',()=>views.forEach(view=>{view.item.dispose();view.renderer.dispose();}),{once:true});
}catch{document.getElementById('error')!.textContent='Não foi possível carregar a amostra ou iniciar o renderer WebGL.';}
