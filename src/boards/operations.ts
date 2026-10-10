import { nanoid } from 'nanoid';
import { nearInkStroke, pointInPolygon } from '@/ink/geometry';
import type { InkPoint, InkSettings } from '@/ink/model';
import { boardDocumentSchema, boardItemSchema, createBoardDocument, type BoardDocument, type BoardItem } from './model';

const PREFIX = 'dynamic-board:v1\n';
type Selection = Pick<BoardDocument,'items'|'edges'>;
export function boardClipboard(document: BoardDocument, ids: string[]): string {
  const selected = new Set(ids);
  const snapshot = {items:document.items.filter(item => selected.has(item.id)),edges:document.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target))};
  const text = PREFIX + JSON.stringify(snapshot);
  if (text.length > 8 * 1024 * 1024) throw new Error('boardClipboardLimit');
  return text;
}
export function parseBoardClipboard(text: string): Selection | null {
  if (!text.startsWith(PREFIX)) return null;
  if (text.length > 8 * 1024 * 1024) throw new Error('boardClipboardLimit');
  const raw = JSON.parse(text.slice(PREFIX.length));
  const document = boardDocumentSchema.parse({...createBoardDocument(),items:raw.items,edges:raw.edges});
  return {items:document.items,edges:document.edges};
}
export function pasteBoardItems(document: BoardDocument, snapshot: Selection, point?: {x:number;y:number}): BoardDocument {
  if (!snapshot.items.length) return document;
  const left = Math.min(...snapshot.items.map(item => item.x)), top = Math.min(...snapshot.items.map(item => item.y));
  const dx = point ? point.x - left : 32, dy = point ? point.y - top : 32;
  const ids = new Map(snapshot.items.map(item => [item.id,nanoid(12)]));
  const items = structuredClone(snapshot.items).map(item => ({...item,id:ids.get(item.id)!,x:item.x+dx,y:item.y+dy}));
  const edges = snapshot.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => ({id:nanoid(12),source:ids.get(edge.source)!,target:ids.get(edge.target)!}));
  return boardDocumentSchema.parse({...document,items:[...document.items,...items],edges:[...document.edges,...edges]});
}
export function removeBoardItems(document: BoardDocument, ids: string[]): BoardDocument {
  const removed = new Set(ids);
  return {...document,items:document.items.filter(item => !removed.has(item.id)),edges:document.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target))};
}
export function drawingItem(points: InkPoint[], color: string, widthStroke: number, style: Partial<Pick<InkSettings,'tool'|'opacity'>> = {}): Extract<BoardItem,{kind:'drawing'}> {
  const x = Math.min(...points.map(point => point.x)) - 4, y = Math.min(...points.map(point => point.y)) - 4;
  const width = Math.max(...points.map(point => point.x)) - x + 4, height = Math.max(...points.map(point => point.y)) - y + 4;
  return boardItemSchema.parse({id:nanoid(12),kind:'drawing',x,y,width,height,color,widthStroke,...(style.tool?{tool:style.tool}:{}),...(style.opacity===undefined?{}:{opacity:style.opacity}),points:points.map(point => ({...point,x:point.x-x,y:point.y-y}))}) as Extract<BoardItem,{kind:'drawing'}>;
}

/** The eraser works in world coordinates, independently of the board viewport. */
export function boardDrawingIdsNearPath(document: BoardDocument, path: InkPoint[], radius: number): string[] {
  if (!path.length) return [];
  const padding = Math.max(0, radius), left = Math.min(...path.map(point=>point.x)), right = Math.max(...path.map(point=>point.x));
  const top = Math.min(...path.map(point=>point.y)), bottom = Math.max(...path.map(point=>point.y));
  return document.items.filter(item=>{
    if (item.kind!=='drawing') return false;
    const margin=padding+item.widthStroke;
    if (right<item.x-margin||left>item.x+item.width+margin||bottom<item.y-margin||top>item.y+item.height+margin) return false;
    const stroke={...item,width:item.widthStroke};
    const local=path.map(point=>({x:point.x-item.x,y:point.y-item.y}));
    if(nearInkStroke(stroke,local[0],padding,'board'))return true;
    for(let index=1;index<path.length;index++){
      const start=local[index-1],end=local[index];
      if(nearInkStroke(stroke,end,padding,'board'))return true;
      for(let segment=0;segment<item.points.length;segment++){
        const a=item.points[segment],b=item.points[segment+1]??a;
        if(segmentsCross(start,end,a,b))return true;
        const pair={...stroke,points:[a,b]};
        if(nearInkStroke(pair,projectPoint(a,start,end),padding,'board')||nearInkStroke(pair,projectPoint(b,start,end),padding,'board'))return true;
      }
    }
    return false;
  }).map(item=>item.id);
}

function projectPoint(point:InkPoint,start:InkPoint,end:InkPoint):InkPoint {
  const dx=end.x-start.x,dy=end.y-start.y;
  const progress=Math.max(0,Math.min(1,((point.x-start.x)*dx+(point.y-start.y)*dy)/(dx*dx+dy*dy||1)));
  return {x:start.x+dx*progress,y:start.y+dy*progress};
}

function segmentsCross(a:InkPoint,b:InkPoint,c:InkPoint,d:InkPoint):boolean {
  const cross=(p:InkPoint,q:InkPoint,r:InkPoint)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const on=(p:InkPoint,q:InkPoint,r:InkPoint)=>Math.abs(cross(p,q,r))<1e-6&&r.x>=Math.min(p.x,q.x)&&r.x<=Math.max(p.x,q.x)&&r.y>=Math.min(p.y,q.y)&&r.y<=Math.max(p.y,q.y);
  const ac=cross(a,b,c),ad=cross(a,b,d),ca=cross(c,d,a),cb=cross(c,d,b);
  return ac*ad<0&&ca*cb<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}

export function selectBoardItemsInLasso(document:BoardDocument,polygon:InkPoint[]):string[] {
  if(polygon.length<3)return [];
  const touches=(path:InkPoint[],closed=false)=>path.some(point=>pointInPolygon(point,polygon))||path.some((point,index)=>{
    const next=path[index+1]??(closed?path[0]:null);
    return next&&polygon.some((edge,edgeIndex)=>segmentsCross(point,next,edge,polygon[(edgeIndex+1)%polygon.length]));
  });
  return document.items.filter(item=>{
    if(item.kind==='drawing')return touches(item.points.map(point=>({...point,x:item.x+point.x,y:item.y+point.y})));
    const rectangle=[{x:item.x,y:item.y},{x:item.x+item.width,y:item.y},{x:item.x+item.width,y:item.y+item.height},{x:item.x,y:item.y+item.height}];
    return touches(rectangle,true)||polygon.some(point=>pointInPolygon(point,rectangle));
  }).map(item=>item.id);
}
