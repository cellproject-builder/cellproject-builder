export interface RenderFrame { timestamp: number; start: number; cpuMs: number; calls: number; triangles: number; viewportCalls: number }
declare const __THREE_AUDIT_WEBGL_DEFAULT__: boolean;
const instrumentParameter = new URL(location.href).searchParams.get('instrument');
export const webglInstrumentationEnabled = instrumentParameter === 'on' ? true : instrumentParameter === 'off' ? false : __THREE_AUDIT_WEBGL_DEFAULT__;
const frames: RenderFrame[] = [];
let current: RenderFrame | null = null;
const contexts: Array<{ gl: WebGLRenderingContext | WebGL2RenderingContext; canvas: HTMLCanvasElement; buffers: Map<WebGLBuffer, number>; textures: Set<WebGLTexture>; programs: Set<WebGLProgram>; uploadBytes: number }> = [];
const nativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = callback => nativeRaf(timestamp => {
  const previous = current, frame: RenderFrame = { timestamp, start: performance.now(), cpuMs: 0, calls: 0, triangles: 0, viewportCalls: 0 };
  current = frame;
  try { callback(timestamp); }
  finally { frame.cpuMs = performance.now() - frame.start; if (frame.calls) frames.push(frame); current = previous; }
});

const originalContext = HTMLCanvasElement.prototype.getContext;
if (webglInstrumentationEnabled) HTMLCanvasElement.prototype.getContext = function (...args: unknown[]) {
  const context = Reflect.apply(originalContext, this, args);
  if (context && String(args[0]).startsWith('webgl') && this.hasAttribute('data-visual-compositor') && !contexts.some(entry => entry.gl === context)) observe(context as WebGL2RenderingContext, this);
  return context;
} as typeof originalContext;

function observe(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
  const resources = { gl, canvas, buffers: new Map<WebGLBuffer, number>(), textures: new Set<WebGLTexture>(), programs: new Set<WebGLProgram>(), uploadBytes: 0 };
  contexts.push(resources);
  const bound = new Map<number, WebGLBuffer | null>();
  const wrap = (name: string, after: (args: any[], result: any) => void) => {
    const original = (gl as any)[name];
    if (typeof original !== 'function') return;
    (gl as any)[name] = (...args: any[]) => { const result = Reflect.apply(original, gl, args); after(args, result); return result; };
  };
  const drawn = (mode: number, count: number, instances = 1) => {
    if (!current) return;
    current.calls++;
    current.triangles += (mode === gl.TRIANGLES ? Math.floor(count / 3) : mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN ? Math.max(0, count - 2) : 0) * instances;
  };
  wrap('drawElements', a => drawn(a[0], a[1]));
  wrap('drawArrays', a => drawn(a[0], a[2]));
  wrap('drawElementsInstanced', a => drawn(a[0], a[1], a[4]));
  wrap('drawArraysInstanced', a => drawn(a[0], a[2], a[3]));
  wrap('viewport', () => { if (current) current.viewportCalls++; });
  wrap('createBuffer', (_a, result) => { if (result) resources.buffers.set(result, 0); });
  wrap('deleteBuffer', a => resources.buffers.delete(a[0]));
  wrap('bindBuffer', a => bound.set(a[0], a[1]));
  wrap('bufferData', a => {
    const size = typeof a[1] === 'number' ? a[1] : a[1]?.byteLength ?? 0, buffer = bound.get(a[0]);
    resources.uploadBytes += size;
    if (buffer) resources.buffers.set(buffer, size);
  });
  wrap('createTexture', (_a, result) => { if (result) resources.textures.add(result); });
  wrap('deleteTexture', a => resources.textures.delete(a[0]));
  wrap('createProgram', (_a, result) => { if (result) resources.programs.add(result); });
  wrap('deleteProgram', a => resources.programs.delete(a[0]));
}

export function percentile(values: number[], ratio: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}
export const frameMark = () => frames.length;
export function renderMetrics(mark: number) {
  if (!webglInstrumentationEnabled) return { instrumented: false, renderedFrames: null, renderCpuMs: null, drawCalls: null, triangles: null, resources: null, reason: 'Public WebGL wrappers are disabled; display rAF intervals and Long Tasks remain available.' };
  const selected = frames.slice(mark), calls = selected.map(frame => frame.calls), triangles = selected.map(frame => frame.triangles);
  return {
    instrumented: true,
    renderedFrames: selected.length,
    renderCpuMs: { p50: percentile(selected.map(frame => frame.cpuMs), .5), p95: percentile(selected.map(frame => frame.cpuMs), .95), max: selected.length ? Math.max(...selected.map(frame => frame.cpuMs)) : null },
    drawCalls: { total: calls.reduce((a, b) => a + b, 0), p50PerFrame: percentile(calls, .5), p95PerFrame: percentile(calls, .95) },
    triangles: { total: triangles.reduce((a, b) => a + b, 0), p50PerFrame: percentile(triangles, .5), p95PerFrame: percentile(triangles, .95) },
    resources: contexts.map(({ gl, canvas, buffers, textures, programs, uploadBytes }) => {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { drawingBuffer: [canvas.width, canvas.height], liveBuffers: buffers.size, estimatedBufferBytes: [...buffers.values()].reduce((a, b) => a + b, 0), cumulativeUploadBytes: uploadBytes, liveTextures: textures.size, livePrograms: programs.size, vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), gpu: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) };
    }),
  };
}

// Account APIs and persistence are deliberately unavailable to this fixture.
window.fetch = async () => { throw new Error('Runtime fetch is prohibited in the local synthetic renderer fixture.'); };
