import { useEffect } from 'react';
import { hasActiveAIActions } from '@/ai/actions';
import { useChatStore } from '@/chat/store';
import { restoreWorkspaceBackup, type WorkspaceData } from '@/data/workspaceTransfer';
import { liveInkGestureActive } from '@/ink/live';
import { useGraphStore, hasPendingGraphPersistence } from '@/store';
import type { Project } from '@/types';
import { normalizeVisualWorkspace } from '@/visuals/normalize';
import { getPlannerOwnerId, plannerBusy } from '@/workspace/planner';
import { useWorkspaceStore } from '@/workspace/store';
import { hasActiveDataIngestions } from './activity';
import { CloudConflictError, CloudRuntime, type CloudDocument } from './runtime';

const SYNC_KEYS = ['cellproject-workspace', 'cellproject-graph'] as const;
const POLL_MS = 2000;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** No cross-device replacement while a local gesture, text edit, paid call or unsent draft owns the data. */
export function cloudCanvasIdle(): boolean {
  if (liveInkGestureActive() || hasActiveDataIngestions() || hasActiveAIActions() || hasPendingGraphPersistence() || plannerBusy() || useChatStore.getState().running) return false;
  const graph = useGraphStore.getState();
  if (Object.keys(graph.drafts).length || graph.objectiveDraft.generatingSince || graph.objectiveDraft.expansion) return false;
  const focused = document.activeElement;
  return !(focused instanceof Element && focused.matches('textarea,[contenteditable="true"],input:not([type="button"]):not([type="checkbox"]):not([type="range"]):not([type="color"])'));
}

function remoteProject(value: unknown): Project | null {
  if (value === null || value === undefined) return null;
  if (!record(value) || typeof value.id !== 'string' || typeof value.rootId !== 'string' || !record(value.nodes) || !record(value.edges) || !Object.hasOwn(value.nodes, value.rootId)) throw new Error('Plano remoto inválido.');
  for (const [id, node] of Object.entries(value.nodes)) {
    if (!record(node) || node.id !== id || typeof node.name !== 'string' || node.position !== undefined && (!record(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))) throw new Error('Nó remoto inválido.');
  }
  for (const edge of Object.values(value.edges)) if (!record(edge) || typeof edge.source !== 'string' || typeof edge.target !== 'string' || !Object.hasOwn(value.nodes, edge.source) || !Object.hasOwn(value.nodes, edge.target)) throw new Error('Conexão remota inválida.');
  const project = value as unknown as Project;
  return project.visuals === undefined ? project : { ...project, visuals: normalizeVisualWorkspace(project.visuals) };
}

function parseWorkspace(value: unknown): WorkspaceData {
  if (!record(value)) throw new Error('Workspace remoto inválido.');
  const data = restoreWorkspaceBackup({ format: 'cellproject-workspace-backup', version: 1, exportedAt: '2026-01-01T00:00:00.000Z', data: { ...value, comments: value.comments ?? {}, boards: value.boards ?? {}, legacyImported: value.legacyImported ?? false } });
  for (const [id, managed] of Object.entries(data.projects)) {
    if (!managed || managed.id !== id || typeof managed.name !== 'string' || typeof managed.objective !== 'string') throw new Error('Projeto remoto inválido.');
    if (managed.planner) {
      const project = remoteProject(managed.planner.project), archivedProject = remoteProject(managed.planner.archivedProject);
      data.projects[id] = { ...managed, planner: { ...managed.planner, project, archivedProject } };
    }
  }
  for (const [id, note] of Object.entries(data.notes)) if (!note || note.id !== id || typeof note.title !== 'string' || !Array.isArray(note.blocks) || note.blocks.some(block => !block || typeof block.id !== 'string' || typeof block.text !== 'string')) throw new Error('Nota remota inválida.');
  return data;
}

/** Pause each persist adapter only for this synchronous set. Real edits after return retain their normal adapter. */
function withoutPersistenceEcho(apply: () => void) {
  const workspaceStorage = useWorkspaceStore.persist.getOptions().storage;
  const graphStorage = useGraphStore.persist.getOptions().storage;
  try {
    if (workspaceStorage) useWorkspaceStore.persist.setOptions({ storage: { ...workspaceStorage, setItem: () => {} } });
    if (graphStorage) useGraphStore.persist.setOptions({ storage: { ...graphStorage, setItem: () => {} } });
    apply();
  } finally {
    if (workspaceStorage) useWorkspaceStore.persist.setOptions({ storage: workspaceStorage });
    if (graphStorage) useGraphStore.persist.setOptions({ storage: graphStorage });
  }
}

/** Apply only domain documents; never rehydrate another device's active surface or singleton editor ownership. */
export function applyRemoteCanvasDocuments(documents: readonly CloudDocument[]) {
  let workspace: WorkspaceData | undefined, graphProject: Project | null | undefined;
  for (const document of documents) {
    if (!SYNC_KEYS.includes(document.key as typeof SYNC_KEYS[number])) continue;
    const envelope = JSON.parse(document.value) as { version?: unknown; state?: unknown };
    if (!record(envelope.state) || !Number.isSafeInteger(envelope.version)) throw new Error('Envelope remoto inválido.');
    if (document.key === 'cellproject-workspace') workspace = parseWorkspace(envelope.state);
    else graphProject = remoteProject(envelope.state.project);
  }
  const localWorkspace = useWorkspaceStore.getState(), localGraph = useGraphStore.getState(), owner = getPlannerOwnerId();
  let nextProject = localGraph.project;
  if (owner && workspace) {
    const managed = workspace.projects[owner];
    if (!managed || localGraph.project && managed.planner?.project?.id !== localGraph.project.id) throw new CloudConflictError();
    if (managed.planner) nextProject = managed.planner.project;
  } else if (graphProject && graphProject.id === localGraph.project?.id) nextProject = graphProject;
  // A local popup can hold an unsubmitted prompt after losing keyboard focus.
  if (nextProject?.visuals && localGraph.project?.visuals && nextProject.id === localGraph.project.id) nextProject = { ...nextProject, visuals: { ...nextProject.visuals, drafts: localGraph.project.visuals.drafts } };
  if (workspace) {
    for (const [id, board] of Object.entries(workspace.boards ?? {})) {
      const local = localWorkspace.boards[id];
      if (local) workspace.boards![id] = { ...board, document: { ...board.document, viewport: local.document.viewport } };
    }
    if (owner && workspace.projects[owner]?.planner) workspace.projects[owner] = { ...workspace.projects[owner], planner: { ...workspace.projects[owner].planner!, project: nextProject, selectedNodeId: localGraph.selectedNodeId, focusedParentId: localGraph.focusedParentId, lens: localGraph.lens, viewMode: localGraph.viewMode, detailPanelOpen: localGraph.detailPanelOpen, lastTutorNodeId: localGraph.lastTutorNodeId, drafts: localGraph.drafts, objectiveDraft: localGraph.objectiveDraft, pendingSuggestions: localGraph.pendingSuggestions, parkedSuggestions: localGraph.parkedSuggestions, archivedProject: localGraph.archivedProject, archivedPending: localGraph.archivedPending } };
  }
  // Both inputs are fully validated before the first setter. connectPlanner may fire
  // synchronously; the workspace domain snapshot is installed last to avoid its echo.
  withoutPersistenceEcho(() => {
    if (nextProject !== localGraph.project) useGraphStore.setState({ project: nextProject, lastAction: null, selectedNodeId: localGraph.selectedNodeId && nextProject?.nodes[localGraph.selectedNodeId] ? localGraph.selectedNodeId : nextProject?.rootId ?? null, focusedParentId: localGraph.focusedParentId && nextProject?.nodes[localGraph.focusedParentId] ? localGraph.focusedParentId : nextProject?.rootId ?? null });
    if (workspace) useWorkspaceStore.setState(workspace);
  });
}

/** Bounded fallback polling plus a fast, authenticated remote-commit signal from LiveInkChannel. */
export function CloudLiveSync({ runtime }: { runtime: CloudRuntime }) {
  useEffect(() => {
    let active = true;
    const commitRetries = new Set<number>();
    const idle = () => active && document.visibilityState !== 'hidden' && navigator.onLine !== false && cloudCanvasIdle();
    const refresh = () => { if (idle()) void runtime.refreshRemote({ keys: SYNC_KEYS, isIdle: idle, apply: applyRemoteCanvasDocuments }).catch(() => { /* CloudStatus owns conflicts/session/network presentation. */ }); };
    // A preview commit can beat its durable encrypted PUT to the server. Retry a
    // small bounded burst so the temporary stroke can become canonical promptly.
    const committed = () => {
      refresh();
      for (const timer of commitRetries) window.clearTimeout(timer);
      commitRetries.clear();
      for (const delay of [250, 750, 1250]) {
        const timer = window.setTimeout(() => { commitRetries.delete(timer); refresh(); }, delay);
        commitRetries.add(timer);
      }
    };
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener('dynamic-diary:cloud-commit', committed);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); for (const retry of commitRetries) window.clearTimeout(retry); window.removeEventListener('dynamic-diary:cloud-commit', committed); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [runtime]);
  return null;
}
