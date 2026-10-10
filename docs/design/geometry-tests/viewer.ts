import * as THREE from 'three';
import { modelItem } from '/src/visuals/rendering/VisualCanvasLayer';
import { sceneSchema } from '/src/visuals/normalize';

const ring = (x: number, y: number, radius: number) => Array.from({length: 24}, (_, i) => {
  const a = -i * Math.PI * 2 / 24; return [x + Math.cos(a) * radius, y + Math.sin(a) * radius];
});
const object = (id: string, geometry: unknown, position = [0, 0, 0], color = '#b4a3ce') => ({id, type: 'custom', geometry, position, rotation: [0, 0, 0], scale: [1, 1, 1], color});
const primitive = (id: string, position: number[], scale: number[], color: string) => ({id, type: 'box', geometry: null, position, rotation: [0, 0, 0], scale, color});
const vertices: number[][] = [], indices: number[] = [];
for (let row = 0; row <= 16; row++) for (let col = 0; col <= 24; col++) {
  const x = (col / 24 - .5) * 7, z = (row / 16 - .5) * 4;
  vertices.push([x, .7 * Math.sin(x * .9) * Math.cos(z * .8) + .2 * x, z]);
}
for (let row = 0; row < 16; row++) for (let col = 0; col < 24; col++) {
  const a = row * 25 + col, b = a + 1, c = a + 25, d = c + 1; indices.push(a, c, b, b, c, d);
}
const definitions = {
  extrude: [object('support', {kind:'extrude', points:[[-3,-2],[3,-2],[3,2],[2,2],[2,-.5],[-2,-.5],[-2,2],[-3,2]],
    holes:[ring(-2.5,1,.23),ring(2.5,1,.23),ring(-2,-1.25,.23),ring(0,-1.25,.23),ring(2,-1.25,.23)], depth:.6, bevel:.06})],
  lathe: [object('shaft', {kind:'lathe', points:[[0,-3],[.55,-3],[.55,-1.9],[.72,-1.8],[.72,-.6],[1.6,-.6],[1.6,-.3],[.9,-.3],[.9,1.3],[.7,1.5],[.5,1.5],[.5,2.8],[.42,3],[0,3]], segments:64}, [0,0,0], '#a8b7c9')],
  tube: [object('cable', {kind:'tube', points:[[-3.4,-.4,0],[-2,1.2,-.7],[0,.5,1.1],[1.7,-.9,.8],[3.4,.2,0]],radius:.18,segments:80,radialSegments:12,closed:false},[0,0,0],'#9783bc'),
    primitive('left-terminal',[-3.4,-.4,0],[.65,.65,.8],'#c9ccd4'),primitive('right-terminal',[3.4,.2,0],[.65,.65,.8],'#c9ccd4')],
  buffer: [object('surface', {kind:'buffer',vertices,indices},[0,0,0],'#9daec2')],
};
try {
  const views = Object.entries(definitions).map(([id,objects]) => {
    const canvas = document.getElementById(id) as HTMLCanvasElement, item = modelItem(sceneSchema.parse({version:1,label:id,objects}));
    const renderer = new THREE.WebGLRenderer({canvas,alpha:true,antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.setClearColor(0x000000,0); renderer.outputColorSpace=THREE.SRGBColorSpace;
    let yaw=0,pitch=0,drag:{x:number;y:number}|null=null;
    canvas.addEventListener('pointerdown',event => {drag={x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);});
    canvas.addEventListener('pointermove',event=>{if(!drag)return;yaw+=(event.clientX-drag.x)*.009;pitch+=(event.clientY-drag.y)*.009;drag={x:event.clientX,y:event.clientY};item.setView?.(yaw,pitch);});
    canvas.addEventListener('pointerup',()=>{drag=null;});canvas.addEventListener('pointercancel',()=>{drag=null;});
    new ResizeObserver(()=>{const rect=canvas.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);item.fitAspect?.(rect.width/rect.height);}).observe(canvas);
    return {item,renderer,reset:()=>{yaw=0;pitch=0;item.setView?.(0,0);}};
  });
  document.getElementById('reset')!.addEventListener('click',()=>views.forEach(view=>view.reset()));
  const frame=()=>{views.forEach(view=>view.renderer.render(view.item.scene,view.item.camera));requestAnimationFrame(frame);};frame();
  window.addEventListener('pagehide',()=>views.forEach(view=>{view.item.dispose();view.renderer.dispose();}),{once:true});
} catch {document.getElementById('error')!.textContent='Não foi possível inicializar os ensaios WebGL neste navegador.';}
