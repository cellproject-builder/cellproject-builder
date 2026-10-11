import { frameMark, percentile, renderMetrics, webglInstrumentationEnabled } from './instrumentation';
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, useReactFlow, useStoreApi, type Node, type ReactFlowInstance, type Viewport } from '@xyflow/react';
import { VisualCanvasLayer } from '@three-audit/VisualCanvasLayer';
import { useVisualViewStore } from '@three-audit/viewStore';
import type { SceneV1, VisualArtifact } from '@/visuals/types';
import '@xyflow/react/dist/style.css';
import './style.css';

declare const __THREE_AUDIT_VARIANT__: string;

type Scenario = 'idle' | 'pan' | 'zoom' | 'orbit-one' | 'irrelevant-ui';
type Config = { models: 1 | 8 | 20; objects: number; geometry: 'boxes' | 'mixed' };
const configDefault: Config = { models: 1, objects: 64, geometry: 'mixed' };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
const output = () => document.querySelector<HTMLPreElement>('#result')!;
const publish = (value: unknown) => { output().textContent = JSON.stringify(value, null, 2); };
const status = (text: string) => { document.querySelector<HTMLElement>('#status')!.textContent = text; };

function scene(objects: number, geometry: Config['geometry']): SceneV1 {
  const side = Math.ceil(Math.cbrt(objects)), colors = ['#bfa3f7', '#92bdcf', '#d8d4e0', '#7096a6'];
  return { version: 1, label: 'Synthetic assembly', objects: Array.from({ length: objects }, (_, i) => ({
    id: `part-${i}`, type: geometry === 'boxes' ? 'box' : (['box', 'cylinder', 'sphere', 'torus'] as const)[i % 4],
    position: [(i % side) * 1.25, (Math.floor(i / side) % side) * 1.25, Math.floor(i / side / side) * 1.25],
    rotation: [i % 3 * .08, i % 5 * .04, 0], scale: [.8, .8, .8], color: colors[i % colors.length],
  })) };
}
function artifactsFor(config: Config): VisualArtifact[] {
  const columns = config.models === 1 ? 1 : config.models === 8 ? 4 : 5, rows = Math.ceil(config.models / columns);
  return Array.from({ length: config.models }, (_, i) => ({ id: `synthetic-model-${i}`, label: `Modelo ${i + 1}`, kind: 'model', x: 24 + i % columns * 960 / columns, y: 24 + Math.floor(i / columns) * 520 / rows, width: 960 / columns - 24, height: 520 / rows - 24, mediaId: null, scene: scene(config.objects, config.geometry), source: null, revisions: [], revisionIndex: 0 }));
}
function Tile({ data }: { data: { label: string } }) { return <div className="tile-label">{data.label}</div>; }
const nodeTypes = { tile: Tile };
let currentConfig = configDefault, artifacts: VisualArtifact[] = [], api: ReactFlowInstance | undefined;
let flowStore: ReturnType<typeof useStoreApi> | undefined;
let setConfig: ((config: Config) => void) | undefined;
let available = false, running = false;
const results: unknown[] = [];
function Controller() {
  const flow = useReactFlow(), store = useStoreApi();
  useEffect(() => { api = flow; flowStore = store; }, [flow, store]);
  return null;
}
function App() {
  const [config, applyConfig] = useState(configDefault);
  const stage = useRef<HTMLDivElement>(null);
  const items = useMemo(() => artifactsFor(config), [config]);
  const nodes = useMemo<Node[]>(() => items.map(item => ({ id: `visual:${item.id}`, type: 'tile', position: { x: item.x, y: item.y }, data: { label: item.label }, width: item.width, height: item.height, style: { width: item.width, height: item.height }, selectable: false, draggable: false })), [items]);
  const availability = useCallback((next: boolean) => { available = next; status(next ? 'WebGL real disponível. Escolha a carga e execute uma rodada curta.' : 'WebGL 2 indisponível ou contexto perdido.'); }, []);
  useEffect(() => { currentConfig = config; artifacts = items; setConfig = applyConfig; }, [config, items]);
  return <>
    <header><div><h1>Three · compositor real</h1><p id="status">Inicializando WebGL…</p></div><span className="badge">build otimizado · {__THREE_AUDIT_VARIANT__}</span></header>
    <div className="controls">
      <label>Modelos<select id="models" defaultValue="1"><option>1</option><option>8</option><option>20</option></select></label>
      <label>Objetos/modelo<select id="objects" defaultValue="64"><option>32</option><option>64</option><option>128</option><option>512</option></select></label>
      <label>Geometria<select id="geometry"><option value="mixed">Mista</option><option value="boxes">Caixas</option></select></label>
      <button onClick={() => void configureFromUI()}>Preparar carga</button>
      {(['idle', 'pan', 'zoom', 'orbit-one', 'irrelevant-ui'] as Scenario[]).map(s => <button key={s} onClick={() => void measure(s).catch(reportError)}>{s}</button>)}
      <button onClick={() => void measureAll().catch(reportError)}>Rodada completa (~10 s)</button>
      <button onClick={download}>Baixar JSON</button>
    </div>
    <div className="stage" ref={stage}><ReactFlow nodes={nodes} nodeTypes={nodeTypes} edges={[]} minZoom={.1} maxZoom={3} defaultViewport={{ x: 20, y: 12, zoom: .92 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag zoomOnScroll preventScrolling proOptions={{ hideAttribution: true }}><Controller/><VisualCanvasLayer artifacts={items} onAvailability={availability}/></ReactFlow></div>
    <p className="limit">Órbita altera só o modelo 1. “irrelevant-ui” alterna selectionKeyPressed no store real do ReactFlow. Warmup fora da medição. Instrumentação WebGL real; CPU de render ≠ duração GPU.</p>
    <pre id="result">Aguardando medição.</pre>
  </>;
}

function reportError(error: unknown) { status(`Falha: ${error instanceof Error ? error.message : String(error)}`); }
function baseViewport(): Viewport {
  const rect = document.querySelector<HTMLElement>('.stage')!.getBoundingClientRect();
  const zoom = Math.min(rect.width / 1008, rect.height / 568) * .88;
  return { x: (rect.width - 1008 * zoom) / 2, y: (rect.height - 568 * zoom) / 2, zoom };
}
async function resetView() {
  if (!api || !flowStore) throw new Error('ReactFlow ainda não está pronto.');
  useVisualViewStore.setState({ angles: {}, pitches: {}, zooms: {}, explosions: {}, selectedParts: {} });
  flowStore.setState({ selectionKeyPressed: false });
  await api.setViewport(baseViewport(), { duration: 0 });
  await nextFrame(); await nextFrame();
}
async function configure(config: Config) {
  if (running) throw new Error('Aguarde a rodada atual.');
  if (![1, 8, 20].includes(config.models) || !Number.isInteger(config.objects) || config.objects < 1 || config.objects > 512) throw new Error('Carga inválida.');
  const mark = frameMark(), started = performance.now();
  setConfig?.({ ...config });
  await wait(80); await resetView();
  // Separate allocation/initial shaders from interaction. No timer assertions.
  await wait(500); await nextFrame();
  const result = { phase: 'prepare-and-warmup', config: currentConfig, wallMs: performance.now() - started, deliberateWaitMs: 580, warmup: renderMetrics(mark) };
  publish(result); status('Carga preparada; shaders aquecidos. Execute o cenário.');
  return result;
}
async function configureFromUI() {
  try { await configure({ models: Number((document.querySelector('#models') as HTMLSelectElement).value) as Config['models'], objects: Number((document.querySelector('#objects') as HTMLSelectElement).value), geometry: (document.querySelector('#geometry') as HTMLSelectElement).value as Config['geometry'] }); } catch (error) { reportError(error); }
}
async function measure(scenario: Scenario, durationMs = 1800) {
  if (running) throw new Error('Já há uma medição em andamento.');
  if (!available || !api || !flowStore) throw new Error('WebGL/ReactFlow ainda não está pronto.');
  if (!['idle', 'pan', 'zoom', 'orbit-one', 'irrelevant-ui'].includes(scenario)) throw new Error('Cenário inválido.');
  running = true;
  try {
    await resetView(); await wait(180);
    const mark = frameMark(), start = performance.now(), base = api.getViewport();
    const frameIntervals: number[] = [], longTasks: { startTime: number; duration: number }[] = [];
    const observer = PerformanceObserver.supportedEntryTypes.includes('longtask') ? new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration }); }) : null;
    observer?.observe({ type: 'longtask' });
    let previous: number | undefined, steps = 0;
    status(`Medindo ${scenario}: ${currentConfig.models} × ${currentConfig.objects}…`);
    await new Promise<void>(resolve => {
      const step = (now: number) => {
        if (previous !== undefined) frameIntervals.push(now - previous);
        previous = now;
        const t = (now - start) / 1000;
        if (now - start >= Math.max(500, Math.min(5000, durationMs))) { resolve(); return; }
        steps++;
        if (scenario === 'pan') void api!.setViewport({ ...base, x: base.x + Math.sin(t * 3) * 22, y: base.y + Math.cos(t * 3) * 14 }, { duration: 0 });
        else if (scenario === 'zoom') { const zoom = base.zoom * (1 + Math.sin(t * 3) * .08); void api!.setViewport({ x: base.x - (zoom - base.zoom) * 504, y: base.y - (zoom - base.zoom) * 284, zoom }, { duration: 0 }); }
        else if (scenario === 'orbit-one') useVisualViewStore.getState().orbit(artifacts[0].id, .025, Math.sin(t * 3) * .004);
        else if (scenario === 'irrelevant-ui') flowStore!.setState({ selectionKeyPressed: steps % 2 === 0 });
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const end = performance.now();
    await nextFrame(); await wait(80);
    if (observer) for (const entry of observer.takeRecords()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    observer?.disconnect();
    const memory = (performance as any).memory;
    const result = {
      phase: 'interaction', config: { ...currentConfig }, scenario, actualMs: end - start, updateSteps: steps,
      displayFrameIntervalsMs: { samples: frameIntervals.length, p50: percentile(frameIntervals, .5), p95: percentile(frameIntervals, .95), max: frameIntervals.length ? Math.max(...frameIntervals) : null },
      compositor: renderMetrics(mark),
      longTasks: longTasks.filter(entry => entry.startTime + entry.duration > start && entry.startTime < end),
      jsHeapBytes: memory ? { used: memory.usedJSHeapSize, total: memory.totalJSHeapSize } : null,
      environment: { variant: __THREE_AUDIT_VARIANT__, productionReact: import.meta.env.PROD, devicePixelRatio, viewport: [innerWidth, innerHeight], userAgent: navigator.userAgent, webglInstrumentationEnabled, webglInstrumentation: webglInstrumentationEnabled ? 'Public WebGL draw*/viewport/buffer/texture/program methods; no renderer mock; no gl.finish.' : 'Disabled before context creation. No WebGL or getContext wrappers; display rAF and Long Tasks only.' },
    };
    results.push(result); publish(result); status('Medição concluída. Resultado guardado em memória; baixe JSON para conservar.');
    return result;
  } finally { running = false; }
}
async function measureAll() {
  const batch = [];
  for (const scenario of ['idle', 'pan', 'zoom', 'orbit-one', 'irrelevant-ui'] as Scenario[]) batch.push(await measure(scenario));
  publish({ config: currentConfig, results: batch });
  return batch;
}
function download() {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ variant: __THREE_AUDIT_VARIANT__, results }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'three-compositor-local.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Este fixture só pode ser usado em localhost.');
createRoot(document.querySelector('#root')!).render(<ReactFlowProvider><App/></ReactFlowProvider>);
Object.assign(window, { __threeAudit: { configure, measure, measureAll, results, ready: async () => { for (let i = 0; i < 100 && (!setConfig || !api || !available); i++) await wait(100); if (!available) throw new Error('WebGL indisponível.'); return configure(configDefault); } } });
