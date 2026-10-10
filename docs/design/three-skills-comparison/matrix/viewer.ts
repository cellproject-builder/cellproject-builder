import * as THREE from 'three';
import { modelItem } from '../../../../src/visuals/rendering/VisualCanvasLayer';
import { parseMatrixManifest } from '../../../../src/visuals/comparison/matrix';
import type { MatrixCase, MatrixManifest, MatrixRun } from '../../../../src/visuals/comparison/matrix';

type Context = MatrixRun['context'];
type Condition = MatrixRun['condition'];
type ModelItem = ReturnType<typeof modelItem>;
interface View {
  condition: Condition;
  article: HTMLElement;
  viewport: HTMLElement;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  fallback: HTMLElement;
  renderer: THREE.WebGLRenderer | null;
  item: ModelItem | null;
  pivot: THREE.Group | null;
  available: boolean;
  contextLost: boolean;
}

const contexts: { id: Context; label: string; description: string }[] = [
  { id: 'none', label: 'Sem referência', description: 'Somente o pedido. Nenhuma imagem ou especificação é enviada.' },
  { id: 'image', label: 'Imagem', description: 'Os pixels da imagem abaixo são enviados ao modelo nas duas condições.' },
  { id: 'specs', label: 'Especificações', description: 'O texto de especificações abaixo é enviado ao modelo nas duas condições.' },
  { id: 'both', label: 'Imagem + specs', description: 'Os pixels da imagem e o texto de especificações são enviados nas duas condições.' },
];
const element = <T extends Element = HTMLElement>(selector: string, parent: ParentNode = document): T => {
  const value = parent.querySelector<T>(selector);
  if (!value) throw new Error(`Elemento ausente: ${selector}`);
  return value;
};
const write = (selector: string, value: string, parent: ParentNode = document) => {
  element<HTMLElement>(selector, parent).textContent = value;
};
const caseSelect = element<HTMLSelectElement>('#case-select');
const repeatSelect = element<HTMLSelectElement>('#repeat-select');
const rotate = element<HTMLButtonElement>('#rotate');
const reset = element<HTMLButtonElement>('#reset');
const refresh = element<HTMLButtonElement>('#refresh');
// Keep directory URLs out of Vite's asset transform, which removes their trailing slash.
const moduleLocation = import.meta.url;
const localBase = new URL('./', moduleLocation);
let manifest: MatrixManifest | null = null;
let currentCase = '';
let currentContext: Context = 'none';
let currentRepeat = 1;
let angle = 0;
let drawFrame = 0;
let disposed = false;

function localFile(path: string): string | null {
  try {
    if (!path || path.includes('\\') || path.startsWith('/')) return null;
    const url = new URL(path, localBase);
    const allowed = path.startsWith('../fixtures/') ? new URL('../fixtures/', localBase).pathname : localBase.pathname;
    return url.origin === localBase.origin && url.pathname.startsWith(allowed) ? url.href : null;
  } catch { return null; }
}

function externalLink(anchor: HTMLAnchorElement, url: string | null | undefined) {
  try {
    const target = new URL(url ?? '');
    if ((target.protocol !== 'https:' && target.protocol !== 'http:') || target.username || target.password) throw new Error();
    anchor.href = target.href;
    anchor.hidden = false;
  } catch { anchor.removeAttribute('href'); anchor.hidden = true; }
}

const seconds = (value: number | null) => value === null ? '—' : `${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
const usd = (value: number | null) => value === null ? 'Custo não informado' : `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 5 })}`;
const runStatus = (status: MatrixRun['status']) => ({ pending: 'Pendente', running: 'Em geração', success: 'JSON válido', failed: 'Falhou', 'budget-skipped': 'Limite de custo' })[status];
const finalRun = (run: MatrixRun) => run.status === 'success' || run.status === 'failed' || run.status === 'budget-skipped';

const views: View[] = (['baseline', 'skills'] as const).map(condition => {
  const article = element<HTMLElement>(`[data-condition="${condition}"]`);
  return {
    condition, article, viewport: element<HTMLElement>('.viewport', article),
    canvas: element<HTMLCanvasElement>('canvas', article), status: element<HTMLElement>('.status', article),
    fallback: element<HTMLElement>('.fallback', article), renderer: null, item: null, pivot: null,
    available: false, contextLost: false,
  };
});

function requestDraw() {
  if (!drawFrame && !disposed) drawFrame = requestAnimationFrame(draw);
}

function draw() {
  drawFrame = 0;
  if (disposed || document.hidden) return;
  for (const view of views) {
    if (!view.available || !view.renderer || !view.item || !view.pivot) continue;
    const width = view.viewport.clientWidth, height = view.viewport.clientHeight;
    if (!width || !height) continue;
    view.renderer.setSize(width, height, false);
    if (view.item.camera instanceof THREE.PerspectiveCamera) {
      view.item.camera.aspect = width / height;
      view.item.camera.updateProjectionMatrix();
    }
    view.pivot.rotation.y = angle;
    try { view.renderer.render(view.item.scene, view.item.camera); }
    catch { failView(view, 'O navegador não conseguiu renderizar este modelo. A execução JSON continua disponível.', 'Renderização indisponível'); }
  }
}

function updateControls() { rotate.disabled = reset.disabled = !views.some(view => view.available); }

function failView(view: View, message: string, status: string) {
  view.available = false;
  view.status.textContent = status;
  view.status.dataset.state = 'error';
  view.fallback.textContent = message;
  view.fallback.hidden = false;
  view.canvas.hidden = true;
  view.viewport.setAttribute('aria-label', message);
  view.viewport.tabIndex = -1;
  view.viewport.classList.add('unavailable');
  updateControls();
}

function clearView(view: View) {
  view.available = false;
  view.item?.dispose();
  view.item = null;
  view.pivot = null;
  view.fallback.hidden = false;
  view.canvas.hidden = true;
  view.status.removeAttribute('data-state');
}

function mountRun(view: View, run: MatrixRun | undefined) {
  clearView(view);
  const parent = view.article;
  const download = element<HTMLAnchorElement>('.download-run', parent);
  download.hidden = true;
  download.removeAttribute('href');
  if (run && finalRun(run)) {
    const path = localFile(`runs/${encodeURIComponent(run.id)}.json`);
    if (path) { download.href = path; download.download = `${run.id}.json`; download.hidden = false; }
  }
  write('.scene-label', run?.scene?.label ?? 'Nenhum modelo disponível para este par.', parent);
  write('.primitive-count', run?.scene ? `${run.scene.objects.length} primitivas` : '— primitivas', parent);
  write('.duration', seconds(run?.durationMs ?? null), parent);
  write('.cost', usd(run?.usage.costUsd ?? null), parent);
  write('.finish', run ? [run.finishReason ? `Término: ${run.finishReason}` : null, run.errorCode ? `Código: ${run.errorCode}` : null].filter(Boolean).join(' · ') || `Execução: ${runStatus(run.status).toLowerCase()}` : 'Execução ausente no registro', parent);
  if (!run || run.status !== 'success' || !run.scene) {
    const message = !run ? 'Esta execução não existe no registro. Nenhuma cena substituta foi criada.'
      : run.status === 'pending' ? 'Esta execução ainda não foi iniciada. Atualize o registro para acompanhar os resultados.'
        : run.status === 'running' ? 'Esta chamada está em andamento. Atualize o registro quando ela terminar.'
          : run.status === 'budget-skipped' ? 'A chamada não foi realizada pela política de limite de custo do experimento. Nenhuma cena substituta foi criada.'
            : run.errorCode === 'request-audit-failed' ? 'A auditoria local da requisição impediu o envio ao modelo. Nenhuma cena foi gerada; consulte o registro JSON.'
            : 'A chamada falhou ou não produziu uma cena válida. Consulte a execução JSON; nenhum objeto foi inventado para preencher esta vista.';
    failView(view, message, run ? runStatus(run.status) : 'Sem dados');
    if (run?.status === 'pending' || run?.status === 'running') view.status.removeAttribute('data-state');
    return;
  }
  if (view.contextLost) { failView(view, 'A sessão WebGL foi interrompida. Recarregue a página para restaurar a visualização.', 'WebGL interrompido'); return; }
  try {
    if (!view.renderer) {
      view.renderer = new THREE.WebGLRenderer({ canvas: view.canvas, alpha: true, antialias: true, premultipliedAlpha: true });
      view.renderer.setClearColor(0x000000, 0);
      view.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    view.item = modelItem(run.scene);
    view.pivot = view.item.scene.children.find((child): child is THREE.Group => child instanceof THREE.Group) ?? null;
    if (!view.pivot) throw new Error('Modelo sem grupo de visualização.');
    view.available = true;
    view.viewport.setAttribute('aria-label', `Modelo ${view.condition === 'baseline' ? 'sem' : 'com'} guia. Arraste para girar os dois modelos; use as setas esquerda e direita quando focado.`);
    view.viewport.tabIndex = 0;
    view.viewport.classList.remove('unavailable');
    view.canvas.hidden = false;
    view.fallback.hidden = true;
    view.status.textContent = 'Renderizado · válido';
    view.status.dataset.state = 'ready';
  } catch { failView(view, 'A renderização 3D não está disponível neste navegador. A cena válida continua disponível no JSON.', 'Renderização indisponível'); }
}

function changeAngle(delta: number) { angle = (angle + delta) % (Math.PI * 2); requestDraw(); }

function connectInteraction(view: View) {
  let pointer: number | null = null, lastX = 0;
  view.viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !view.available) return;
    pointer = event.pointerId; lastX = event.clientX;
    view.viewport.setPointerCapture(pointer);
    view.viewport.classList.add('dragging');
  });
  view.viewport.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    changeAngle((event.clientX - lastX) * .012); lastX = event.clientX;
  });
  const end = () => { pointer = null; view.viewport.classList.remove('dragging'); };
  view.viewport.addEventListener('pointerup', end);
  view.viewport.addEventListener('pointercancel', end);
  view.viewport.addEventListener('lostpointercapture', end);
  view.viewport.addEventListener('keydown', event => {
    if (!view.available || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault(); changeAngle(event.key === 'ArrowLeft' ? -.15 : .15);
  });
  view.canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); view.contextLost = true;
    failView(view, 'A sessão WebGL foi interrompida. Recarregue a página para restaurar a visualização.', 'WebGL interrompido');
  });
}

function selectedRun(condition: Condition, context = currentContext, repeat = currentRepeat) {
  return manifest?.runs.find(run => run.caseId === currentCase && run.context === context && run.repeat === repeat && run.condition === condition);
}

function renderReference(subject: MatrixCase) {
  const hasImage = currentContext === 'image' || currentContext === 'both';
  const hasSpecs = currentContext === 'specs' || currentContext === 'both';
  element('#reference-panel').toggleAttribute('hidden', !hasImage && !hasSpecs);
  element('#image-reference').toggleAttribute('hidden', !hasImage);
  element('#spec-reference').toggleAttribute('hidden', !hasSpecs);
  const image = element<HTMLImageElement>('#reference-image');
  image.hidden = false;
  const imageUrl = localFile(subject.image.path);
  image.removeAttribute('src');
  image.alt = `Imagem de referência enviada: ${subject.label}`;
  const imageLink = element<HTMLAnchorElement>('#reference-link');
  imageLink.removeAttribute('href');
  if (hasImage && imageUrl) { image.src = imageUrl; imageLink.href = imageUrl; }
  write('#image-caption', `${subject.image.credit} · ${subject.image.rights}`);
  externalLink(element<HTMLAnchorElement>('#source-link'), subject.image.sourcePageUrl || subject.image.sourceUrl);
  write('#spec-text', hasSpecs ? subject.specifications.text : '');
  const sourceList = element('#spec-sources');
  sourceList.replaceChildren();
  if (hasSpecs) for (const source of subject.specifications.sources) {
    const link = document.createElement('a'); link.className = 'source-link';
    link.textContent = `${source.title} ↗`; link.target = '_blank'; link.rel = 'noopener noreferrer';
    externalLink(link, source.url); sourceList.append(link);
  }
  write('#context-description', contexts.find(context => context.id === currentContext)!.description);
  write('#prompt-text', subject.prompt);
  const list = element('#criteria-list'); list.replaceChildren();
  for (const criterion of subject.criteria) { const item = document.createElement('li'); item.textContent = criterion; list.append(item); }
}

function renderOverview() {
  if (!manifest) return;
  const body = element('#overview-body'); body.replaceChildren();
  const caseRuns = manifest.runs.filter(run => run.caseId === currentCase);
  const finalized = caseRuns.filter(finalRun).length;
  const successes = caseRuns.filter(run => run.status === 'success').length;
  write('#completion', `${finalized}/${caseRuns.length} finalizadas · ${successes} válidas`);
  for (const context of contexts) for (let repeat = 1; repeat <= manifest.protocol.repetitions; repeat++) {
    const row = document.createElement('tr');
    row.dataset.active = String(context.id === currentContext && repeat === currentRepeat);
    const label = document.createElement('td'); label.textContent = `${context.label} · ${repeat}`; row.append(label);
    for (const condition of ['baseline', 'skills'] as const) {
      const run = selectedRun(condition, context.id, repeat);
      const cell = document.createElement('td');
      cell.textContent = run ? runStatus(run.status) : 'Sem registro';
      if (run?.status === 'failed' || run?.status === 'budget-skipped') cell.className = 'table-error';
      const metrics = document.createElement('span'); metrics.className = 'table-metrics';
      metrics.textContent = [seconds(run?.durationMs ?? null), run?.scene ? `${run.scene.objects.length} primitivas` : null, usd(run?.usage.costUsd ?? null)].filter(Boolean).join(' · ');
      cell.append(metrics); row.append(cell);
    }
    const action = document.createElement('td'); const button = document.createElement('button');
    button.type = 'button'; button.textContent = row.dataset.active === 'true' ? 'Em exibição' : 'Comparar';
    button.setAttribute('aria-label', `Comparar ${context.label.toLowerCase()}, repetição ${repeat}`);
    button.disabled = row.dataset.active === 'true';
    button.addEventListener('click', () => { currentContext = context.id; currentRepeat = repeat; renderPair(); element('.workbench').scrollIntoView({ block: 'start' }); });
    action.append(button); row.append(action); body.append(row);
  }
}

function renderPair() {
  if (!manifest) return;
  const subject = manifest.cases.find(item => item.id === currentCase);
  if (!subject) return;
  caseSelect.value = currentCase; repeatSelect.value = String(currentRepeat);
  for (const button of element('#contexts').querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.context === currentContext));
  const pair = [selectedRun('baseline'), selectedRun('skills')];
  write('#pair-count', `${pair.filter(run => run?.status === 'success').length}/2 modelos válidos`);
  renderReference(subject);
  angle = 0;
  for (const view of views) mountRun(view, selectedRun(view.condition));
  write('#baseline-system', pair[0]?.systemPrompt ?? 'Instruções não registradas para esta execução.');
  write('#skills-system', pair[1]?.systemPrompt ?? 'Instruções não registradas para esta execução.');
  renderOverview(); updateControls(); requestDraw();
}

function showManifest(data: MatrixManifest) {
  manifest = data;
  if (!data.cases.some(subject => subject.id === currentCase)) currentCase = data.cases[0]?.id ?? '';
  if (currentRepeat > data.protocol.repetitions) currentRepeat = 1;
  caseSelect.replaceChildren(); repeatSelect.replaceChildren();
  for (const subject of data.cases) { const option = document.createElement('option'); option.value = subject.id; option.textContent = subject.label; caseSelect.append(option); }
  for (let repeat = 1; repeat <= data.protocol.repetitions; repeat++) { const option = document.createElement('option'); option.value = String(repeat); option.textContent = `${repeat} de ${data.protocol.repetitions}`; repeatSelect.append(option); }
  caseSelect.disabled = repeatSelect.disabled = false;
  for (const button of element('#contexts').querySelectorAll<HTMLButtonElement>('button')) button.disabled = false;
  const totalCost = data.runs.reduce((total, run) => total + (run.usage.costUsd ?? 0), 0);
  const knownCosts = data.runs.filter(run => run.usage.costUsd !== null).length;
  const attempted = data.runs.filter(run => run.status === 'success' || run.status === 'failed').length;
  write('#model-line', `${data.protocol.provider} / ${data.protocol.model} · ${data.runs.length} execuções planejadas · ${attempted} tentadas · ${knownCosts ? `${usd(totalCost)} informado` : 'custo ainda não informado'}`);
  const date = new Date(data.updatedAt);
  write('#method-metadata', [
    `Experimento: ${data.id}`,
    `Atualizado: ${Number.isNaN(date.getTime()) ? data.updatedAt : date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    `Modelo: ${data.protocol.model} / raciocínio ${data.protocol.reasoningEffort}`,
    `Temperatura: omitida / limite: ${data.protocol.maxOutputTokens.toLocaleString('pt-BR')} tokens de saída`,
    `Repetições: ${data.protocol.repetitions} / teto de custo: ${usd(data.protocol.maxCostUsd)}`,
    `Revisão do guia: ${data.protocol.guideVersion}`,
    `Commit upstream: ${data.protocol.upstreamCommit}`,
    `Custos disponíveis: ${knownCosts}/${attempted} chamadas tentadas. Ausência de custo não significa custo zero.`,
  ].join('\n'));
  const notes = element('#notes'); notes.replaceChildren();
  for (const note of data.protocol.notes) { const paragraph = document.createElement('p'); paragraph.textContent = note; notes.append(paragraph); }
  element('#download-manifest').removeAttribute('hidden');
  renderPair();
}

async function load() {
  refresh.disabled = true;
  const alert = element<HTMLElement>('#load-error'); alert.hidden = true;
  try {
    const response = await fetch(new URL('./manifest.json', import.meta.url), { cache: 'no-store' });
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('O arquivo manifest.json ainda não está disponível.');
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new Error('O arquivo manifest.json não contém um registro JSON válido.'); }
    showManifest(parseMatrixManifest(value));
  } catch (error) {
    alert.textContent = `${error instanceof Error && !error.message.startsWith('[') && error.message.length < 300 ? error.message : 'O registro não corresponde ao contrato do experimento.'}${manifest ? ' As vistas mantêm o último registro carregado; ele pode estar desatualizado.' : ' Nenhuma cena substituta foi criada.'}`;
    alert.hidden = false;
    if (!manifest) {
      write('#model-line', 'Registro indisponível');
      for (const view of views) failView(view, 'Nenhum resultado registrado está disponível. Carregue o manifesto do experimento para comparar as gerações.', 'Sem dados');
    }
  } finally { refresh.disabled = false; }
}

const resize = new ResizeObserver(requestDraw);
for (const view of views) { connectInteraction(view); resize.observe(view.viewport); }
for (const context of contexts) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = context.label;
  button.disabled = true;
  button.dataset.context = context.id; button.setAttribute('aria-pressed', String(currentContext === context.id));
  button.addEventListener('click', () => { currentContext = context.id; renderPair(); });
  element('#contexts').append(button);
}
caseSelect.addEventListener('change', () => { currentCase = caseSelect.value; renderPair(); });
repeatSelect.addEventListener('change', () => { currentRepeat = Number(repeatSelect.value); renderPair(); });
rotate.addEventListener('click', () => changeAngle(Math.PI / 2));
reset.addEventListener('click', () => { angle = 0; requestDraw(); });
refresh.addEventListener('click', () => { void load(); });
element<HTMLImageElement>('#reference-image').addEventListener('error', event => {
  (event.currentTarget as HTMLImageElement).hidden = true;
  write('#image-caption', 'A prévia do arquivo registrado está indisponível. Consulte a origem e o caminho da imagem no manifesto.');
});
document.addEventListener('visibilitychange', requestDraw);
window.addEventListener('pagehide', () => {
  disposed = true; cancelAnimationFrame(drawFrame); resize.disconnect();
  for (const view of views) { view.item?.dispose(); view.renderer?.dispose(); }
});

void load();
