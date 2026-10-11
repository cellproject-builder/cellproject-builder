import { counters, snapshot } from './instrumentation';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createJSONStorage } from 'zustand/middleware';
import { createStore, del } from 'idb-keyval';
import { ReactFlow, ReactFlowProvider, useReactFlow, Background } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '@/index.css';
import { CanvasAttachmentSurface } from '@/attachments/CanvasAttachmentSurface';
import { storeCanvasFile } from '@/visuals/media';
import { useWorkspaceStore } from '@/workspace/store';
import { useGraphStore } from '@/store';
import { useLocaleStore } from '@/i18n';
import { useThemeStore } from '@/theme';
import { buildDemoProject } from '@/data/demoProject';
import { capturePlanner, initializeWorkspace } from '@/workspace/planner';
import type { CanvasAttachments, CanvasResource } from '@/attachments/canvasModel';
import { testPdf } from './pdf';

const memory=new Map<string,string>();
const storage=createJSONStorage(()=>({getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);}}));
for(const store of [useWorkspaceStore,useGraphStore,useLocaleStore])store.persist.setOptions({storage:storage as never});
await Promise.all([useWorkspaceStore,useGraphStore,useLocaleStore].map(store=>store.persist.rehydrate()));
useLocaleStore.setState({locale:'pt-BR'});useThemeStore.getState().setTheme('oled');
const files=[testPdf('vector'),testPdf('scan')];
const media=await Promise.all(files.map(file=>storeCanvasFile(file,'board:pdf-load')));
Object.assign(counters,{createdWorkers:0,maxWorkers:0,pdfReads:0,pdfReadBytes:0});
const count=Math.max(1,Math.min(100,Number(new URLSearchParams(location.search).get('count'))||30));
const resources:CanvasResource[]=Array.from({length:count},(_,i)=>({id:`pdf-${i}`,name:`PDF ${i+1} · ${i%2?'digitalização':'vetores'}`,kind:'pdf',mediaId:media[i%2].id,mime:'application/pdf',size:media[i%2].size,text:null,url:null,addedAt:1,pages:20}));
const attachments:CanvasAttachments={resources,cards:resources.map((resource,i)=>({id:`card-${i}`,resourceIds:[resource.id],x:40+i%10*280,y:100+Math.floor(i/10)*340,width:240,height:290}))};
const project=buildDemoProject(); project.id='pdf-plan';project.name='Ensaio PDF';
// Current visual workspace property is determined from the actual domain contract.
const { getVisualWorkspace, mutateVisualWorkspace } = await import('@/visuals/domain');
useGraphStore.setState({project,selectedNodeId:project.rootId,focusedParentId:project.rootId,viewMode:'graph',lens:'structure',detailPanelOpen:false});
mutateVisualWorkspace(value=>({...value,attachments}));
useWorkspaceStore.setState({projects:{owner:{id:'owner',name:'Ensaio PDF',objective:'Dados sintéticos',archived:false,createdAt:1,updatedAt:1,planner:capturePlanner()}},boards:{'pdf-load':{id:'pdf-load',title:'Ensaio PDF',archived:false,createdAt:1,updatedAt:1,document:{version:1,viewport:{x:0,y:0,zoom:1},items:[],edges:[]},attachments}},activeProjectId:'owner',activeBoardId:'pdf-load',surface:'boards',tasks:{},comments:{},sprints:{},notes:{},folders:{},legacyImported:true});
initializeWorkspace();
const output=document.createElement('pre');output.setAttribute('aria-label','Resultado PDF');output.style.cssText='position:fixed;bottom:0;left:0;z-index:9999;max-height:130px;overflow:auto;background:#17171de8;color:#ddd;font:11px monospace;padding:6px;max-width:100vw';document.body.append(output);
const controls=document.createElement('aside');controls.style.cssText='position:fixed;top:8px;left:8px;z-index:9999;display:flex;gap:5px;background:#25252b;padding:6px;border-radius:9px';document.body.append(controls);
let api:ReturnType<typeof useReactFlow>, surface:'board'|'planner'='board';
function Fixture(){const host=React.useRef<HTMLDivElement>(null);const [kind,setKind]=React.useState(surface);const [epoch,setEpoch]=React.useState(0);const flow=useReactFlow();api=flow;
  React.useEffect(()=>{const listener=(event:Event)=>setKind((event as CustomEvent).detail);const reset=()=>setEpoch(value=>value+1);window.addEventListener('fixture-surface',listener);window.addEventListener('fixture-reset',reset);return()=>{window.removeEventListener('fixture-surface',listener);window.removeEventListener('fixture-reset',reset);};},[]);
  return <div ref={host} style={{width:'100vw',height:'100dvh',position:'relative'}}><ReactFlow nodes={[]} edges={[]} minZoom={.1} defaultViewport={{x:-20000,y:-20000,zoom:1}}><Background gap={20}/><CanvasAttachmentSurface key={`${kind}-${epoch}`} scope={{kind,id:kind==='board'?'pdf-load':'pdf-plan'}} containerRef={host}/></ReactFlow></div>;
}
const fixtureRoot=createRoot(document.getElementById('root')!);fixtureRoot.render(<ReactFlowProvider><Fixture/></ReactFlowProvider>);
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function settled(){let stable=0;const start=performance.now();while(performance.now()-start<30000){await pause(100);if(!snapshot().busy){if(++stable===5)return;}else stable=0;}throw new Error('PDF settle exceeded 30s');}
const history:unknown[]=[];
async function run(kind:'tour'|'dense'|'release'){
  for(const button of controls.querySelectorAll('button'))button.disabled=true;
  const frames:number[]=[],longTasks:number[]=[],before=snapshot();let raf=0,previous=0;
  const tick=(now:number)=>{if(previous)frames.push(now-previous);previous=now;raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
  const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(entry=>entry.duration)));observer.observe({type:'longtask'});
  const started=performance.now(),stages:unknown[]=[];
  try{
    if(kind==='tour'){for(let y=0;y<4;y++){await api.setViewport({x:-y*560,y:-y*680,zoom:1});await settled();stages.push(snapshot());output.textContent=`Percurso ${y+1}/4: ${JSON.stringify(stages.at(-1))}`;}}
    if(kind==='dense'){await api.setViewport({x:30,y:60,zoom:.19});await settled();stages.push(snapshot());}
    if(kind==='release'){await api.setViewport({x:-20000,y:-20000,zoom:1});await settled();await pause(1200);stages.push(snapshot());}
    const result={run:history.length+1,variant:import.meta.env.MODE,surface,scenario:kind,elapsedMs:+(performance.now()-started).toFixed(1),before,after:snapshot(),stages,frames:{p95:[...frames].sort((a,b)=>a-b)[Math.floor(frames.length*.95)]??0,max:Math.max(0,...frames),longTasks:longTasks.length,longTaskMax:Math.max(0,...longTasks)},files:files.map(file=>({name:file.name,bytes:file.size})),environment:{userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,dpr:devicePixelRatio}};history.push(result);output.textContent=JSON.stringify(result);output.dataset.history=JSON.stringify(history);output.dataset.results=String(history.length);
  }catch(error){output.textContent=String(error);}finally{observer.disconnect();cancelAnimationFrame(raf);for(const button of controls.querySelectorAll('button'))button.disabled=false;}
}
for(const kind of ['tour','dense','release'] as const){const button=document.createElement('button');button.textContent=`Medir ${kind}`;button.style.cssText='padding:7px;background:#3b334c;border-radius:6px';button.onclick=()=>void run(kind);controls.append(button);}
for(const kind of ['board','planner'] as const){const button=document.createElement('button');button.textContent=kind;button.style.cssText='padding:7px;background:#293b45;border-radius:6px';button.onclick=()=>{surface=kind;useWorkspaceStore.setState({surface:kind==='board'?'boards':'planner'});window.dispatchEvent(new CustomEvent('fixture-surface',{detail:kind}));};controls.append(button);}
const reset=document.createElement('button');reset.textContent='Reiniciar amostra';reset.onclick=()=>void(async()=>{for(const button of controls.querySelectorAll('button'))button.disabled=true;await api.setViewport({x:-20000,y:-20000,zoom:1});window.dispatchEvent(new Event('fixture-reset'));await pause(1200);Object.assign(counters,{createdWorkers:0,maxWorkers:0,pdfReads:0,pdfReadBytes:0});output.textContent=`Reiniciado: ${JSON.stringify(snapshot())}`;for(const button of controls.querySelectorAll('button'))button.disabled=false;})();controls.append(reset);
const cleanup=document.createElement('button');cleanup.textContent='Limpar fixture';cleanup.onclick=()=>void(async()=>{fixtureRoot.unmount();await pause(200);const db=createStore('cellproject-visual-media','media');for(const item of media)await del(item.id,db);output.textContent=`Fixture removida: ${JSON.stringify(snapshot())}`;})();controls.append(cleanup);
output.textContent=`Pronto: ${count} cards; fontes sintéticas ${files.map(file=>`${file.name} ${file.size} bytes`).join(', ')}. ${getVisualWorkspace(useGraphStore.getState().project!).attachments?.cards.length} cards no plano.`;
