import * as THREE from 'three';
import { modelItem } from '../../../src/visuals/rendering/VisualCanvasLayer';
import { sceneSchema } from '../../../src/visuals/normalize';
import type { SceneV1 } from '../../../src/visuals/types';

type Condition = 'baseline' | 'skills';
interface ComparisonRun {
  condition: Condition;
  label: string;
  scene: SceneV1;
  durationMs: number;
  finishReason: string;
  usage: Record<string, unknown>;
  systemPrompt: string;
}
interface Comparison {
  version: 1;
  createdAt: string;
  provider: 'openrouter';
  model: string;
  prompt: string;
  temperature: number | null;
  maxOutputTokens: number;
  skillRevision: string;
  upstreamCommit: string;
  runs: ComparisonRun[];
  notes: string[];
}
interface View {
  renderer: THREE.WebGLRenderer;
  item: ReturnType<typeof modelItem>;
  pivot: THREE.Group;
  viewport: HTMLElement;
  status: HTMLElement;
  fallback: HTMLElement;
  available: boolean;
}

const element = <T extends Element = HTMLElement>(selector: string, parent: ParentNode = document): T => {
  const value = parent.querySelector<T>(selector);
  if (!value) throw new Error(`Elemento ausente: ${selector}`);
  return value;
};
const write = (selector: string, value: string, parent: ParentNode = document) => {
  element<HTMLElement>(selector, parent).textContent = value;
};
const views: View[] = [];
let angle = 0;
let drawFrame = 0;
let disposed = false;
const rotate = element<HTMLButtonElement>('#rotate');
const reset = element<HTMLButtonElement>('#reset');

function draw() {
  drawFrame = 0;
  if (disposed || document.hidden) return;
  for (const view of views) {
    if (!view.available) continue;
    const width = view.viewport.clientWidth;
    const height = view.viewport.clientHeight;
    if (!width || !height) continue;
    view.renderer.setSize(width, height, false);
    if (view.item.camera instanceof THREE.PerspectiveCamera) {
      view.item.camera.aspect = width / height;
      view.item.camera.updateProjectionMatrix();
    }
    view.pivot.rotation.y = angle;
    try { view.renderer.render(view.item.scene, view.item.camera); }
    catch { failView(view, 'O navegador não conseguiu renderizar este modelo. O JSON continua disponível para inspeção.'); }
  }
}

function requestDraw() {
  if (!drawFrame && !disposed) drawFrame = requestAnimationFrame(draw);
}

function failView(view: View, message: string) {
  view.available = false;
  view.status.textContent = 'Renderização indisponível';
  view.status.dataset.state = 'error';
  view.fallback.textContent = message;
  view.fallback.hidden = false;
  view.renderer.domElement.hidden = true;
}

function changeAngle(delta: number) {
  angle = (angle + delta) % (Math.PI * 2);
  requestDraw();
}

function connectInteraction(viewport: HTMLElement) {
  let pointer: number | null = null;
  let lastX = 0;
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointer = event.pointerId;
    lastX = event.clientX;
    viewport.setPointerCapture(pointer);
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointer) return;
    changeAngle((event.clientX - lastX) * .012);
    lastX = event.clientX;
  });
  const end = () => { pointer = null; viewport.classList.remove('dragging'); };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);
  viewport.addEventListener('lostpointercapture', end);
  viewport.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    changeAngle(event.key === 'ArrowLeft' ? -.15 : .15);
  });
}

function mount(run: ComparisonRun) {
  const article = element<HTMLElement>(`[data-condition="${run.condition}"]`);
  const viewport = element<HTMLElement>('.viewport', article);
  const fallback = element<HTMLElement>('.fallback', article);
  const status = element<HTMLElement>('.status', article);
  write('.scene-label', run.scene.label, article);
  write('.primitive-count', `${run.scene.objects.length} primitivas`, article);
  write('.duration', `${(run.durationMs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s de geração`, article);
  try {
    const renderer = new THREE.WebGLRenderer({ canvas: element<HTMLCanvasElement>('canvas', article), alpha: true, antialias: true, premultipliedAlpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const item = modelItem(run.scene);
    const pivot = item.scene.children.find((child): child is THREE.Group => child instanceof THREE.Group);
    if (!pivot) { item.dispose(); renderer.dispose(); throw new Error('Modelo sem grupo de visualização.'); }
    const view: View = { renderer, item, pivot, viewport, status, fallback, available: true };
    renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      failView(view, 'A sessão WebGL foi interrompida. Recarregue esta página para restaurar a visualização.');
    });
    fallback.hidden = true;
    status.textContent = 'Renderizado';
    status.dataset.state = 'ready';
    views.push(view);
    connectInteraction(viewport);
    resize.observe(viewport);
  } catch {
    fallback.textContent = 'A renderização 3D não está disponível neste navegador. Consulte os objetos no registro JSON.';
    status.textContent = 'Renderização indisponível';
    status.dataset.state = 'error';
  }
}

const resize = new ResizeObserver(requestDraw);
rotate.addEventListener('click', () => changeAngle(Math.PI / 2));
reset.addEventListener('click', () => { angle = 0; requestDraw(); });
document.addEventListener('visibilitychange', requestDraw);
window.addEventListener('pagehide', () => {
  disposed = true;
  cancelAnimationFrame(drawFrame);
  resize.disconnect();
  for (const view of views) { view.item.dispose(); view.renderer.dispose(); }
});

function parseComparison(value: unknown): Comparison {
  if (!value || typeof value !== 'object') throw new Error('O registro da comparação está vazio ou inválido.');
  const data = value as Partial<Comparison>;
  if (data.version !== 1 || data.provider !== 'openrouter' || typeof data.model !== 'string' || typeof data.prompt !== 'string'
    || (data.temperature !== null && (typeof data.temperature !== 'number' || !Number.isFinite(data.temperature)))
    || typeof data.maxOutputTokens !== 'number' || !Number.isFinite(data.maxOutputTokens) || data.maxOutputTokens <= 0
    || !Array.isArray(data.runs) || data.runs.length !== 2
    || new Set(data.runs.map(run => run.condition)).size !== 2
    || !data.runs.every(run => (run.condition === 'baseline' || run.condition === 'skills') && Number.isFinite(run.durationMs) && run.durationMs >= 0 && typeof run.systemPrompt === 'string')) {
    throw new Error('O registro precisa conter uma geração válida para cada condição.');
  }
  const runs = data.runs.map(run => ({ ...run, scene: sceneSchema.parse(run.scene) }));
  return { ...data, runs, notes: Array.isArray(data.notes) ? data.notes.filter(note => typeof note === 'string') : [] } as Comparison;
}

async function load() {
  try {
    const response = await fetch(new URL('./comparison.json', import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error('A amostra ainda não está disponível. O arquivo comparison.json não foi encontrado.');
    const comparison = parseComparison(await response.json());
    write('#prompt-text', comparison.prompt);
    write('#model-line', `${comparison.provider} / ${comparison.model} · ${comparison.temperature === null ? 'temperatura omitida nas duas chamadas' : `temperatura ${comparison.temperature.toLocaleString('pt-BR')}`} · limite ${comparison.maxOutputTokens.toLocaleString('pt-BR')} tokens`);
    const date = new Date(comparison.createdAt);
    write('#method-metadata', [
      `Registro: ${Number.isNaN(date.getTime()) ? comparison.createdAt : date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      `Revisão do guia: ${comparison.skillRevision ?? 'não informada'}`,
      `Commit upstream: ${comparison.upstreamCommit ?? 'não informado'}`,
    ].join('\n'));
    for (const note of comparison.notes) {
      const paragraph = document.createElement('p');
      paragraph.textContent = note;
      element('#notes').append(paragraph);
    }
    for (const run of comparison.runs) { write(`#${run.condition}-system`, run.systemPrompt); mount(run); }
    element<HTMLAnchorElement>('#download').hidden = false;
    rotate.disabled = reset.disabled = !views.some(view => view.available);
    requestDraw();
  } catch (error) {
    const message = error instanceof Error && !error.message.startsWith('[') ? error.message : 'O registro contém um modelo fora do contrato permitido. Nenhuma cena substituta foi criada.';
    write('#prompt-text', 'Não foi possível carregar o pedido e os modelos registrados.');
    write('#model-line', 'Amostra indisponível');
    const alert = element<HTMLElement>('#load-error');
    alert.textContent = message;
    alert.hidden = false;
    for (const article of document.querySelectorAll<HTMLElement>('.sample')) {
      write('.fallback', 'Nenhuma cena disponível. Gere o registro de comparação e recarregue a página.', article);
      write('.status', 'Sem dados', article);
      element<HTMLElement>('.status', article).dataset.state = 'error';
    }
  }
}

void load();
