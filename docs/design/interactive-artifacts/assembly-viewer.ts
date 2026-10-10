import * as THREE from 'three';
import { modelItem } from '../../../src/visuals/rendering/VisualCanvasLayer';
import { sceneSchema } from '../../../src/visuals/normalize';
import { modelAssemblySchema } from '../../../src/visuals/modelAssembly';
import { layoutDecompositionGroups } from '../../../src/visuals/decompositionLayout';
import { assembleSavedParts } from './assembly';

try {
  const response=await fetch('../samples/mg90s-advanced-2026-10-10.txt');
  if(!response.ok)throw new Error('Missing sample');
  const text=await response.text();
  const contract=modelAssemblySchema.parse(JSON.parse(text.split('CONTRATO E REFERÊNCIAS\n\n')[1].split('\n\nCENA COMPLETA MONTADA')[0]));
  const original=sceneSchema.parse(JSON.parse(text.split('CENA COMPLETA MONTADA\n\n')[1]));
  const offsets=layoutDecompositionGroups(original,contract.groups);
  const parts=contract.groups.map(group=>({id:group.partId,name:group.name,source:'mg90s-advanced-2026-10-10.txt',
    scene:{...original,label:group.name,objects:original.objects.filter(object=>group.objectIds.includes(object.id))},
    position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],
    explodeOffset:offsets.find(item=>item.partId===group.partId)!.explodeOffset}));
  const result=assembleSavedParts(parts,contract.plan.interfaces.map(link=>({from:link.moduleIds[0],to:link.moduleIds[1],description:link.description})));
  const item=modelItem(result.scene,result.groups), canvas=document.getElementById('assembly') as HTMLCanvasElement;
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setClearColor(0,0); renderer.outputColorSpace=THREE.SRGBColorSpace;
  const observer=new ResizeObserver(()=>{const rect=canvas.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);item.fitAspect?.(rect.width/rect.height);}); observer.observe(canvas);
  const select=document.getElementById('part') as HTMLSelectElement, amount=document.getElementById('amount') as HTMLInputElement;
  for(const part of parts){const label=document.createElement('span');label.textContent=`${part.name} · ${part.scene.objects.length} objetos`;document.getElementById('sources')!.append(label);const option=document.createElement('option');option.value=part.id;option.textContent=part.name;select.append(option);}
  let target=0,selected:string|null=null,yaw=.5,pitch=-.2,drag:{x:number;y:number}|null=null;
  const set=(value:number)=>{target=value;amount.value=String(value*100);document.getElementById('value')!.textContent=`${Math.round(value*100)}%`;};
  document.getElementById('mounted')!.addEventListener('click',()=>set(0));document.getElementById('exploded')!.addEventListener('click',()=>set(1));amount.addEventListener('input',()=>set(Number(amount.value)/100));
  select.addEventListener('change',()=>{selected=select.value||null;const links=result.connections.filter(link=>link.from===selected||link.to===selected);document.getElementById('connections')!.textContent=selected?links.map(link=>`${parts.find(part=>part.id===(link.from===selected?link.to:link.from))!.name}: ${link.description}`).join(' · '):'Selecione uma peça para inspecionar suas relações.';});
  canvas.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);});canvas.addEventListener('pointermove',event=>{if(!drag)return;yaw+=(event.clientX-drag.x)*.008;pitch+=(event.clientY-drag.y)*.008;drag={x:event.clientX,y:event.clientY};});canvas.addEventListener('pointerup',()=>{drag=null;});canvas.addEventListener('pointercancel',()=>{drag=null;});
  let frame=0,previous=performance.now();const draw=(now:number)=>{const delta=(now-previous)/1000;previous=now;item.setView?.(yaw,pitch);item.setInspection?.(target,selected,delta);renderer.render(item.scene,item.camera);frame=requestAnimationFrame(draw);};frame=requestAnimationFrame(draw);
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);observer.disconnect();item.dispose();renderer.dispose();},{once:true});
}catch(error){document.getElementById('error')!.textContent=`Não foi possível iniciar a amostra: ${error instanceof Error?error.message:'erro desconhecido'}`;}
