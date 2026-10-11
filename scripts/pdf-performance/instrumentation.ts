const nativeWorker=window.Worker;
const active=new Set<Worker>();
export const counters={createdWorkers:0,maxWorkers:0,pdfReads:0,pdfReadBytes:0};
window.Worker=class extends nativeWorker {
  constructor(url:string|URL, options?:WorkerOptions){super(url,options);active.add(this);counters.createdWorkers++;counters.maxWorkers=Math.max(counters.maxWorkers,active.size);}
  terminate(){active.delete(this);super.terminate();}
};
const arrayBuffer=Blob.prototype.arrayBuffer;
Blob.prototype.arrayBuffer=function(){if(this.type==='application/pdf'){counters.pdfReads++;counters.pdfReadBytes+=this.size;}return arrayBuffer.call(this);};
const fetch=window.fetch.bind(window);
window.fetch=(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href);if(url.origin!==location.origin||url.pathname.startsWith('/api/'))return Promise.reject(new Error('External/account APIs blocked in synthetic fixture'));return fetch(input,init);};
export function snapshot(){
  const canvases=[...document.querySelectorAll<HTMLCanvasElement>('.attachment-pdf-page canvas')];
  return {...counters,liveWorkers:active.size,canvases:canvases.length,rasterBytes:canvases.reduce((sum,canvas)=>sum+canvas.width*canvas.height*4,0),busy:document.querySelectorAll('.attachment-pdf-page[aria-busy="true"]').length,errors:document.querySelectorAll('.attachment-pdf-page [role="alert"]').length};
}
