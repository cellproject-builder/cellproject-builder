import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '@/App';
import { useGraphStore, flushGraphPersistence } from '@/store';
import { useWorkspaceStore, flushWorkspacePersistence } from '@/workspace/store';
import { useConfigStore } from '@/config/store';
import { useLocaleStore } from '@/i18n';
import { useChatStore } from '@/chat/store';
import { useKBStore } from '@/kb/store';
import { boardRecordSchema } from '@/boards/model';
import type { Note } from '@/workspace/types';
import { CloudRuntime, configureCloud, type CloudSnapshot, type RuntimeCheckpoint } from '@/cloud/runtime';
import { VaultTransport, type VaultHead } from '@/cloud/vault/transport';
import { createVault, type VaultSession } from '@/cloud/vault/crypto';
import { configureVault } from '@/cloud/vault/privacy';
import { OfflineRepository, acquireOfflineLease } from '@/cloud/offline/repository';
import { initializeTheme } from '@/theme';
import '@xyflow/react/dist/style.css';
import '@/index.css';

declare const __INTERACTION_VARIANT__: 'baseline' | 'candidate';
type Scenario = 'poll' | 'write';
type Counts = { runtimeCheckpoints: number; transportCheckpoints: number; workspaceWrites: number; vaultGets: number; vaultPuts: number; configGets: number; largeBase64Decodes: number; largeBase64Encodes: number };
type Result = { variant: string; kind: Scenario; iterations: number; documentBytes: number; modelCount: number; elapsedMs: number; synchronousUpdateP50: number; synchronousUpdateP95: number; frameP50: number; frameP95: number; frameMax: number; longTasks: number; longTaskTotal: number; longTaskMax: number; counts: Counts; durableVerified: boolean };
declare global {
  interface Window {
    __encryptedInteractionFixture?: { ready: boolean; run(kind: Scenario): Promise<Result>; cleanup(): Promise<void>; lastResult?: Result; documentBytes: number; ownerId: string; vaultId: string };
  }
}

const controls = document.getElementById('encrypted-controls')!;
const output = document.createElement('output');
output.setAttribute('aria-label', 'Resultado cifrado de desempenho');
output.style.cssText = 'display:block;white-space:pre-wrap';
const counts = (): Counts => ({ runtimeCheckpoints: 0, transportCheckpoints: 0, workspaceWrites: 0, vaultGets: 0, vaultPuts: 0, configGets: 0, largeBase64Decodes: 0, largeBase64Encodes: 0 });
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] ?? 0;
const rounded = (value: number) => +value.toFixed(2);
const frame = () => new Promise<number>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Frame suspenso por mais de 5 s; mantenha a aba em primeiro plano.')), 5000);
  requestAnimationFrame(time => { clearTimeout(timeout); resolve(time); });
});
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
let measuring = false, busy = false, cleaned = false, edits = 0, checkpointCounts = counts();
let app: Root | undefined, session: VaultSession | undefined, repository: OfflineRepository | undefined, transport: VaultTransport | undefined, runtime: CloudRuntime | undefined, releaseLease: (() => void) | null = null;
const nativeAtob = globalThis.atob, nativeBtoa = globalThis.btoa;

async function cleanup() {
  if (busy) throw new Error('Aguarde a medição antes de limpar o cofre sintético.');
  if (cleaned) return;
  busy = true;
  try {
    await flushWorkspacePersistence();
    await runtime?.flush();
    app?.unmount();
    configureCloud(null); configureVault(null, false);
    // These two slots belong exclusively to this randomly generated owner/vault.
    // Never clear a database, authorization, another owner or ordinary app stores.
    await repository?.remove('runtime'); await repository?.remove('transport');
    await repository?.settled();
    transport?.dispose(); session?.dispose(); releaseLease?.(); releaseLease = null;
    globalThis.atob = nativeAtob; globalThis.btoa = nativeBtoa;
    cleaned = true;
    if (window.__encryptedInteractionFixture) window.__encryptedInteractionFixture.ready = false;
    output.textContent = 'Cofre sintético removido. Reabra a página para outra sessão.';
  } finally { busy = false; setButtons(); }
}

function setButtons() {
  for (const button of controls.querySelectorAll('button')) button.disabled = busy || cleaned;
}

async function setup() {
  // Keep unrelated application stores in memory. The workspace retains its
  // unmodified production adapter and captured backend in both variants.
  for (const store of [useGraphStore, useConfigStore, useLocaleStore, useChatStore, useKBStore]) {
    store.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
    await store.persist.rehydrate();
  }
  useGraphStore.setState(useGraphStore.getInitialState());
  useConfigStore.setState(useConfigStore.getInitialState());
  useLocaleStore.setState(useLocaleStore.getInitialState());
  useChatStore.setState(useChatStore.getInitialState());
  useKBStore.setState(useKBStore.getInitialState());
  await flushGraphPersistence(); await flushWorkspacePersistence();
  initializeTheme();

  const modelCount = 20, targetBytes = 3 * 1024 * 1024;
  const board = boardRecordSchema.parse({ id: 'encrypted-board', title: 'Carga cifrada · 20 modelos fora da tela', createdAt: 1, updatedAt: 1, archived: false, document: {
    version: 1, edges: [], viewport: { x: 0, y: 0, zoom: .8 }, items: Array.from({ length: modelCount }, (_, i) => ({
      id: `model-${i}`, kind: 'model', x: 5000 + i % 5 * 380, y: Math.floor(i / 5) * 300, width: 360, height: 280,
      scene: { version: 1, label: `Módulo ${i}`, objects: Array.from({ length: 128 }, (_, j) => ({ id: `part-${j}`, type: 'box', position: [j % 8 * .3, Math.floor(j / 8) * .15, 0], rotation: [0, 0, 0], scale: [.2, .1, .1], color: '#94a3b8' })) },
    })),
  } });
  const note: Note = { id: 'encrypted-note', title: 'Nota editável sintética', blocks: [{ id: 'editable-block', type: 'text', text: 'Edição sintética 0' }], projectId: null, taskId: null, folderId: null, pinned: true, deletedAt: null, createdAt: 1, updatedAt: 1 };
  const padding: Note = { ...note, id: 'encrypted-padding', title: 'Carga sintética ASCII', blocks: [{ id: 'padding-block', type: 'text', text: '' }], pinned: false };
  const envelope = { version: 2, state: { projects: {}, tasks: {}, comments: {}, sprints: {}, folders: {}, boards: { [board.id]: board }, notes: { [note.id]: note, [padding.id]: padding }, legacyImported: true } };
  const encoder = new TextEncoder();
  padding.blocks[0].text = 'x'.repeat(Math.max(0, targetBytes - encoder.encode(JSON.stringify(envelope)).byteLength));
  const initialValue = JSON.stringify(envelope), documentBytes = encoder.encode(initialValue).byteLength;
  if (documentBytes !== targetBytes) throw new Error('A carga inicial deve conter exatamente 3 MiB.');
  const snapshot: CloudSnapshot = { documents: [{ key: 'cellproject-workspace', revision: 1, value: initialValue }], media: [] };
  const ownerId = `interaction-fixture-${crypto.randomUUID()}`;
  const vault = await createVault(ownerId, `Synthetic benchmark only ${crypto.randomUUID()}`);
  session = vault.session;
  releaseLease = await acquireOfflineLease(ownerId, vault.header.id);
  if (!releaseLease) throw new Error('A fixture precisa de Web Locks para manter um único escritor sintético.');
  repository = new OfflineRepository(session);
  const originalWrite = repository.write.bind(repository);
  repository.write = (slot, value) => {
    if (measuring && slot === 'runtime') checkpointCounts.runtimeCheckpoints++;
    if (measuring && slot === 'transport') checkpointCounts.transportCheckpoints++;
    return originalWrite(slot, value);
  };
  let head: VaultHead = { header: vault.header, revision: 1, manifest: await session.seal(JSON.stringify({ snapshot, files: {} }), 'manifest:1') };
  const receipts = new Map<string, { body: string; revision: number }>();
  // No native fetch fallback: every accepted route is resolved in memory.
  const fakeFetch: typeof fetch = async (input, init) => {
    const path = input instanceof Request ? new URL(input.url).pathname : String(input);
    const method = init?.method ?? 'GET';
    if (path === '/api/cloud/config' && method === 'GET') {
      if (measuring) checkpointCounts.configGets++;
      return Response.json({ enabled: true, authenticated: true, user: { id: ownerId, email: 'fixture@example.invalid' }, providers: {} });
    }
    if (path !== '/api/cloud/vault') throw new Error(`Rota externa bloqueada pela fixture: ${method} ${path}`);
    if (method === 'GET') { if (measuring) checkpointCounts.vaultGets++; return Response.json(head); }
    if (method !== 'PUT') throw new Error(`Método externo bloqueado: ${method}`);
    if (measuring) checkpointCounts.vaultPuts++;
    const raw = String(init?.body), body = JSON.parse(raw), previous = receipts.get(body.operationId);
    if (previous) return previous.body === raw ? Response.json({ revision: previous.revision }) : Response.json({ code: 'operation_identity_conflict' }, { status: 409 });
    if (body.baseRevision !== head.revision) return Response.json({ code: 'vault_revision_conflict' }, { status: 409 });
    head = { ...head, revision: head.revision + 1, manifest: body.manifest };
    receipts.set(body.operationId, { body: raw, revision: head.revision });
    return Response.json({ revision: head.revision });
  };
  transport = await VaultTransport.open(session, head, fakeFetch, { persistence: repository, networkReady: () => true });
  runtime = new CloudRuntime(transport.snapshot(), transport.fetch, undefined, () => transport!.refreshSnapshot(), {
    persistence: repository, networkReady: () => true,
    acknowledgeOperation: id => transport!.acknowledgeOperation(id), rejectOperation: id => transport!.discardRejectedOperation(id),
  });
  const originalRuntimeWrite = runtime.write.bind(runtime);
  runtime.write = (key, value) => { if (measuring && key === 'cellproject-workspace') checkpointCounts.workspaceWrites++; return originalRuntimeWrite(key, value); };
  await runtime.persistCheckpoint();
  configureCloud(runtime); configureVault(session, true);
  await useWorkspaceStore.persist.rehydrate();
  useWorkspaceStore.setState({ surface: 'boards', activeBoardId: board.id, activeProjectId: null });
  app = createRoot(document.getElementById('root')!);
  app.render(<StrictMode><App /></StrictMode>);
  for (let i = 0; i < 20; i++) await frame();
  await flushWorkspacePersistence(); await repository.settled();

  globalThis.atob = value => { if (measuring && value.length > 1024) checkpointCounts.largeBase64Decodes++; return nativeAtob.call(globalThis, value); };
  globalThis.btoa = value => { if (measuring && value.length > 1024) checkpointCounts.largeBase64Encodes++; return nativeBtoa.call(globalThis, value); };

  async function measure(kind: Scenario): Promise<Result> {
    if (busy || cleaned) throw new Error('A fixture está ocupada ou foi removida.');
    if (document.visibilityState !== 'visible') throw new Error('Mantenha a aba da fixture em primeiro plano.');
    busy = true; setButtons();
    let observing = false, sampling = true, sampler: Promise<void> | undefined;
    const longTasks: number[] = [], frames: number[] = [], cpu: number[] = [];
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
    try {
      await flushWorkspacePersistence(); await repository!.settled();
      for (let i = 0; i < 20; i++) await frame();
      checkpointCounts = counts();
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) { observer.observe({ type: 'longtask' }); observing = true; }
      let previous = await frame();
      const started = performance.now(); measuring = true;
      sampler = (async () => { while (sampling) { const next = await frame(); frames.push(next - previous); previous = next; } })();
      output.textContent = `${kind}: medindo cadeia cifrada real…`;
      if (kind === 'poll') {
        for (let i = 0; i < 3; i++) {
          if ((await runtime!.refreshRemote()).length) throw new Error('Polling idêntico alterou os documentos.');
          await frame();
        }
      } else {
        // One synchronous burst fits in the candidate's 200 ms scheduling window.
        // Leave the natural timer intact before the explicit final durability barrier.
        for (let i = 0; i < 10; i++) {
          const current = useWorkspaceStore.getState().notes[note.id], start = performance.now();
          useWorkspaceStore.getState().updateNote(note.id, { blocks: [{ ...current.blocks[0], text: `Edição sintética ${++edits}` }] });
          cpu.push(performance.now() - start);
        }
        await delay(250);
      }
      await flushWorkspacePersistence(); await runtime!.flush(); await repository!.settled();
      await frame(); await frame();
      sampling = false; await sampler;
      const elapsedMs = performance.now() - started;
      measuring = false;
      if (observing) longTasks.push(...observer.takeRecords().map(entry => entry.duration));
      observer.disconnect();
      const measuredCounts = { ...checkpointCounts };
      if (kind === 'poll' && measuredCounts.vaultPuts) throw new Error('Polling idêntico alterou o cofre.');
      if (runtime!.getSnapshot().pending || transport!.hasPendingOperations()) throw new Error('A fila cifrada não terminou.');
      // Verify the real encrypted readback after stopping timing and counters.
      const saved = await repository!.read<RuntimeCheckpoint>('runtime');
      const savedValue = saved?.confirmed.documents.find(doc => doc.key === 'cellproject-workspace')?.value;
      if (!savedValue || savedValue !== runtime!.get('cellproject-workspace')) throw new Error('O checkpoint cifrado não confirma o workspace final.');
      if (kind === 'write' && JSON.parse(savedValue).state.notes[note.id].blocks[0].text !== `Edição sintética ${edits}`) throw new Error('A edição final não foi preservada.');
      const result: Result = { variant: __INTERACTION_VARIANT__, kind, iterations: kind === 'poll' ? 3 : 10, documentBytes, modelCount, elapsedMs: rounded(elapsedMs), synchronousUpdateP50: rounded(percentile(cpu, .5)), synchronousUpdateP95: rounded(percentile(cpu, .95)), frameP50: rounded(percentile(frames, .5)), frameP95: rounded(percentile(frames, .95)), frameMax: rounded(Math.max(0, ...frames)), longTasks: longTasks.length, longTaskTotal: rounded(longTasks.reduce((sum, value) => sum + value, 0)), longTaskMax: rounded(Math.max(0, ...longTasks)), counts: measuredCounts, durableVerified: true };
      window.__encryptedInteractionFixture!.lastResult = result;
      output.textContent = JSON.stringify(result, null, 2);
      return result;
    } finally {
      measuring = false; sampling = false;
      await sampler?.catch(() => {}); observer.disconnect();
      busy = false; setButtons();
    }
  }

  controls.replaceChildren();
  const label = document.createElement('p'); label.textContent = `${__INTERACTION_VARIANT__} · ${documentBytes} bytes · 20 modelos × 128 objetos · AES/IDB reais · rede simulada`;
  controls.append(label);
  for (const kind of ['poll', 'write'] as const) {
    const button = document.createElement('button'); button.textContent = `Medir ${kind}`; button.style.cssText = 'margin:2px;padding:5px';
    button.onclick = () => { void measure(kind).catch(reason => { output.textContent = String(reason); }); }; controls.append(button);
  }
  const remove = document.createElement('button'); remove.textContent = 'Limpar cofre sintético'; remove.style.cssText = 'margin:2px;padding:5px';
  remove.onclick = () => { void cleanup().catch(reason => { output.textContent = String(reason); }); }; controls.append(remove, output);
  output.textContent = 'Pronto. Execute poll/write, copie o JSON e limpe o cofre sintético ao terminar.';
  window.__encryptedInteractionFixture = { ready: true, run: measure, cleanup, documentBytes, ownerId, vaultId: vault.header.id };
}

void setup().catch(reason => { controls.replaceChildren(output); output.textContent = `Falha ao preparar fixture: ${String(reason)}`; });
