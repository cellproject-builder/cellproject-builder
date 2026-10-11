import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { useGraphStore, flushGraphPersistence } from '@/store';
import { useWorkspaceStore, flushWorkspacePersistence } from '@/workspace/store';
import { useConfigStore } from '@/config/store';
import { useLocaleStore } from '@/i18n';
import { useChatStore } from '@/chat/store';
import { useKBStore } from '@/kb/store';
import { buildDemoProject } from '@/data/demoProject';
import { capturePlanner } from '@/workspace/planner';
import { initializeTheme } from '@/theme';
import { boardRecordSchema } from '@/boards/model';
import { noteInkSchema } from '@/workspace/noteInkModel';
import '@xyflow/react/dist/style.css';
import '@/index.css';

// This fixture runs on a separate local origin, contains synthetic content only,
// and cannot reach accounts or providers (connect-src none). It mounts the actual
// production application, stores, validation, persistence and GPU compositor.
await Promise.all([useGraphStore, useWorkspaceStore, useConfigStore, useLocaleStore, useChatStore, useKBStore].map(store => store.persist.rehydrate()));
const project = buildDemoProject();
project.id = 'interaction-project'; project.name = 'Carga sintética · 500 nós';
const template = Object.values(project.nodes).find(node => node.kind === 'recurso')!;
for (let i = Object.keys(project.nodes).length; i < 500; i++) {
  const id = `load-node-${i}`;
  project.nodes[id] = { ...template, id, name: `Componente ${i}`, parentId: project.rootId, notes: 'Contexto sintético. '.repeat(445), position: { x: 300 + i % 10 * 320, y: 900 + Math.floor(i / 10) * 150 } };
}
const points = Array.from({ length: 2000 }, (_, i) => ({ x: i % 400, y: 40 + Math.sin(i / 20) * 30 }));
const ink = noteInkSchema.parse({ version: 1, width: 1200, height: 900, strokes: Array.from({ length: 50 }, (_, i) => ({ id: `stroke-${i}`, points, color: '#a78bfa', width: 2 })) });
const board = boardRecordSchema.parse({ id: 'load-board', title: 'Carga sintética · 100 mil pontos', createdAt: 1, updatedAt: 1, archived: false, document: { version: 1, edges: [], viewport: { x: 0, y: 0, zoom: .8 }, items: [
  ...Array.from({ length: 50 }, (_, i) => ({ id: `drawing-${i}`, kind: 'drawing', points, color: '#a78bfa', widthStroke: 2, x: (i % 5) * 420, y: Math.floor(i / 5) * 100, width: 400, height: 100 })),
  ...Array.from({ length: 20 }, (_, i) => ({ id: `model-${i}`, kind: 'model', x: 5000 + i % 5 * 380, y: Math.floor(i / 5) * 300, width: 360, height: 280, scene: { version: 1, label: `Módulo ${i}`, objects: Array.from({ length: 128 }, (_, j) => ({ id: `part-${j}`, type: 'box', position: [j % 8 * .3, Math.floor(j / 8) * .15, 0], rotation: [0, 0, 0], scale: [.2, .1, .1], color: '#94a3b8' })) } })),
] } });
const note = { id: 'load-note', title: 'Nota com 100 mil pontos', blocks: [{ id: 'load-block', type: 'text' as const, text: 'Texto de teste.' }], ink, projectId: null, taskId: null, folderId: null, pinned: true, deletedAt: null, createdAt: 1, updatedAt: 1 };
useGraphStore.setState({ project, selectedNodeId: project.rootId, focusedParentId: project.rootId, viewMode: 'graph', lens: 'structure', detailPanelOpen: false, pendingSuggestions: null });
useWorkspaceStore.setState({ projects: { owner: { id: 'owner', name: project.name, objective: project.objective, archived: false, createdAt: 1, updatedAt: 1, planner: capturePlanner() } }, notes: { [note.id]: note }, boards: { [board.id]: board }, tasks: {}, comments: {}, sprints: {}, folders: {}, activeProjectId: 'owner', activeBoardId: board.id, surface: 'planner', legacyImported: true });
useConfigStore.setState({ activeProvider: 'openrouter', providers: { openrouter: { apiKey: 'SYNTHETIC_NO_NETWORK', mainModel: 'synthetic', kbModel: 'synthetic' } } });
initializeTheme();
await flushGraphPersistence(); await flushWorkspacePersistence();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

const controls = document.createElement('aside');
controls.style.cssText = 'position:fixed;bottom:4px;left:4px;z-index:99999;background:#202027;color:#eee;border-radius:8px;padding:6px;max-width:95vw;font:12px monospace';
const result = document.createElement('output'); result.setAttribute('aria-label', 'Resultado de desempenho'); result.style.whiteSpace = 'pre-wrap';
const frame = () => new Promise<number>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Frame suspenso por mais de 3s; coloque a aba em primeiro plano e repita.')), 3000);
  requestAnimationFrame(time => { clearTimeout(timeout); resolve(time); });
});
const percentile = (samples: number[], p: number) => [...samples].sort((a,b) => a-b)[Math.floor((samples.length-1)*p)] ?? 0;
async function measure(kind: 'selection'|'viewport'|'typing') {
  for (const button of controls.querySelectorAll('button')) button.disabled = true;
  result.textContent = `${kind}: abrindo superfície`;
  const cpu: number[] = [], frames: number[] = [], longTasks: number[] = [];
  const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
  if (kind === 'selection') useWorkspaceStore.getState().navigate('planner');
  if (kind === 'viewport') useWorkspaceStore.getState().openBoard(board.id);
  if (kind === 'typing') useWorkspaceStore.getState().navigate('notes');
  for (let i=0;i<20;i++) await frame();
  result.textContent = `${kind}: 0/60`;
  observer.observe({ type: 'longtask' });
  const started = performance.now(); let previous = await frame();
  for (let i=0;i<60;i++) {
    const start = performance.now();
    if (kind === 'selection') useGraphStore.getState().selectNode(i % 2 ? project.rootId : template.id);
    if (kind === 'viewport') {
      const store = useWorkspaceStore.getState(), document = store.boards[board.id].document;
      const viewport = { x: i * 5, y: 0, zoom: .8 + i % 2 * .01 };
      if ('updateBoardViewport' in store) (store as unknown as { updateBoardViewport(id:string, viewport:typeof document.viewport):void }).updateBoardViewport(board.id, viewport);
      else store.updateBoard(board.id, { document: { ...document, viewport } });
    }
    if (kind === 'typing') {
      const current = useWorkspaceStore.getState().notes[note.id];
      useWorkspaceStore.getState().updateNote(note.id, { blocks: [{ ...current.blocks[0], text: `Texto de teste. ${'a'.repeat(i)}` }] });
    }
    cpu.push(performance.now()-start);
    const next = await frame(); frames.push(next-previous); previous=next;
    if (i % 10 === 9) result.textContent = `${kind}: ${i+1}/60`;
  }
  result.textContent = `${kind}: aguardando persistência`;
  await flushGraphPersistence(); await flushWorkspacePersistence(); await frame();
  observer.disconnect();
  result.textContent = JSON.stringify({ kind, iterations:60, elapsedMs: Math.round(performance.now()-started), synchronousUpdateP50:+percentile(cpu,.5).toFixed(2), synchronousUpdateP95:+percentile(cpu,.95).toFixed(2), frameP50:+percentile(frames,.5).toFixed(2), frameP95:+percentile(frames,.95).toFixed(2), longTasks:longTasks.length, longTaskMax:+Math.max(0,...longTasks).toFixed(2) });
  for (const button of controls.querySelectorAll('button')) button.disabled = false;
}
for (const kind of ['selection','viewport','typing'] as const) {
  const button = document.createElement('button'); button.textContent = `Medir ${kind}`; button.style.cssText='margin:2px;padding:5px'; button.onclick = () => void measure(kind).catch(error => { result.textContent=String(error); for (const b of controls.querySelectorAll('button')) b.disabled=false; }); controls.append(button);
}
controls.append(result); document.body.append(controls);
