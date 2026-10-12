import { useEffect } from 'react';
import { hasActiveAIActions } from '@/ai/actions';
import { useChatStore } from '@/chat/store';
import { restoreWorkspaceBackup, type WorkspaceData } from '@/data/workspaceTransfer';
import { getLiveInk, liveInkGestureActive } from '@/ink/live';
import { useGraphStore, hasPendingGraphPersistence, EMPTY_OBJECTIVE_DRAFT } from '@/store';
import type { Project } from '@/types';
import { normalizeVisualWorkspace } from '@/visuals/normalize';
import { getPlannerOwnerId, plannerBusy } from '@/workspace/planner';
import { useWorkspaceStore } from '@/workspace/store';
import type { PlannerSnapshot } from '@/workspace/types';
import { hasActiveDataIngestions } from './activity';
import { hasDeferredPersistence } from '@/data/selectiveJSONStorage';
import { CloudConflictError, CloudRuntime, type CloudDocument } from './runtime';
import { CONTENT_SYNC_KEYS, prepareRemoteContentDocuments } from './remoteContent';

const CANVAS_SYNC_KEYS = ['cellproject-workspace', 'cellproject-graph'] as const;
const SYNC_KEYS = [...CANVAS_SYNC_KEYS,...CONTENT_SYNC_KEYS] as const;
const POLL_MS = 2000;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** No cross-device replacement while a local gesture, text edit, paid call or unsent draft owns the data. */
export function cloudCanvasIdle(): boolean {
  if (liveInkGestureActive() || hasActiveDataIngestions() || hasActiveAIActions() || hasPendingGraphPersistence() || hasDeferredPersistence() || plannerBusy() || useChatStore.getState().running || useChatStore.getState().compacting) return false;
  const graph = useGraphStore.getState();
  if (Object.keys(graph.drafts).length || graph.objectiveDraft.generatingSince || graph.objectiveDraft.expansion) return false;
  if (Object.values(graph.project?.visuals?.drafts ?? {}).some(draft => draft.text.trim() || draft.attachments.length || draft.mentions.length)) return false;
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

function remoteObjectiveDraft(draft: PlannerSnapshot['objectiveDraft'] | undefined) {
  // Requests belong to one runtime. Their results travel across devices, their
  // loading markers cannot own or lock this device's singleton editor.
  return { ...EMPTY_OBJECTIVE_DRAFT, ...draft, expanded: draft?.expanded ?? {}, generatingSince: null, expansion: null };
}

function parseWorkspace(value: unknown): WorkspaceData {
  if (!record(value)) throw new Error('Workspace remoto inválido.');
  const data = restoreWorkspaceBackup({ format: 'cellproject-workspace-backup', version: 1, exportedAt: '2026-01-01T00:00:00.000Z', data: { ...value, comments: value.comments ?? {}, boards: value.boards ?? {}, legacyImported: value.legacyImported ?? false } });
  for (const [id, managed] of Object.entries(data.projects)) {
    if (!managed || managed.id !== id || typeof managed.name !== 'string' || typeof managed.objective !== 'string') throw new Error('Projeto remoto inválido.');
    if (managed.planner) {
      const project = remoteProject(managed.planner.project), archivedProject = remoteProject(managed.planner.archivedProject);
      const session = managed.planner.archivedSession;
      data.projects[id] = { ...managed, planner: { ...managed.planner, project, archivedProject, objectiveDraft: remoteObjectiveDraft(managed.planner.objectiveDraft), archivedSession: session ? { ...session, objectiveDraft: remoteObjectiveDraft(session.objectiveDraft) } : null } };
    }
  }
  for (const [id, note] of Object.entries(data.notes)) if (!note || note.id !== id || typeof note.title !== 'string' || !Array.isArray(note.blocks) || note.blocks.some(block => !block || typeof block.id !== 'string' || typeof block.text !== 'string')) throw new Error('Nota remota inválida.');
  return data;
}

function plannerDomain(snapshot: Partial<PlannerSnapshot>) {
  return {
    project: snapshot.project ?? null,
    drafts: snapshot.drafts ?? {},
    objectiveDraft: remoteObjectiveDraft(snapshot.objectiveDraft),
    pendingSuggestions: snapshot.pendingSuggestions ?? null,
    parkedSuggestions: snapshot.parkedSuggestions ?? {},
    archivedProject: snapshot.archivedProject ?? null,
    archivedPending: snapshot.archivedPending ?? null,
    archivedSession: snapshot.archivedSession ?? null,
  };
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

function acknowledgeAppliedInk(workspace: Pick<WorkspaceData, 'boards' | 'notes' | 'projects'>, graphProject: Project | null) {
  const ink = getLiveInk(); if (!ink) return;
  const acknowledgePlan = (project: Project | null | undefined) => { if (project) ink.acknowledge({ surface: 'planner', documentId: project.id }, project.visuals?.ink?.strokes.map(stroke => stroke.id) ?? []); };
  for (const board of Object.values(workspace.boards ?? {})) ink.acknowledge({ surface: 'board', documentId: board.id }, board.document.items.filter(item => item.kind === 'drawing').map(item => item.id));
  for (const note of Object.values(workspace.notes)) {
    ink.acknowledge({ surface: 'note', documentId: note.id }, note.ink?.strokes.map(stroke => stroke.id) ?? []);
    ink.acknowledge({ surface: 'notebook', documentId: note.id }, note.canvas?.strokes.map(stroke => stroke.id) ?? []);
  }
  for (const managed of Object.values(workspace.projects)) acknowledgePlan(managed.planner?.project);
  acknowledgePlan(graphProject);
}

/** Apply only domain documents; never rehydrate another device's active surface or singleton editor ownership. */
export function applyRemoteCanvasDocuments(documents: readonly CloudDocument[]) {
  const applyContent=prepareRemoteContentDocuments(documents);
  let workspace: WorkspaceData | undefined, graphSnapshot: Partial<PlannerSnapshot> | undefined;
  for (const document of documents) {
    if (!CANVAS_SYNC_KEYS.includes(document.key as typeof CANVAS_SYNC_KEYS[number])) continue;
    const envelope = JSON.parse(document.value) as { version?: unknown; state?: unknown };
    if (!record(envelope.state) || !Number.isSafeInteger(envelope.version)) throw new Error('Envelope remoto inválido.');
    if (document.key === 'cellproject-workspace') workspace = parseWorkspace(envelope.state);
    else graphSnapshot = { ...envelope.state, project: remoteProject(envelope.state.project), archivedProject: remoteProject(envelope.state.archivedProject) };
  }
  const localWorkspace = useWorkspaceStore.getState(), localGraph = useGraphStore.getState(), owner = getPlannerOwnerId();
  let nextDomain: ReturnType<typeof plannerDomain> | undefined;
  if (owner && workspace) {
    const managed = workspace.projects[owner];
    if (!managed || localGraph.project && managed.planner?.project?.id !== localGraph.project.id) throw new CloudConflictError();
    if (managed.planner) nextDomain = plannerDomain(managed.planner);
  } else if (!owner && graphSnapshot?.project && graphSnapshot.project.id === localGraph.project?.id) nextDomain = plannerDomain(graphSnapshot);
  const nextProject = nextDomain ? nextDomain.project : localGraph.project;
  const selectedNodeId = localGraph.selectedNodeId && nextProject?.nodes[localGraph.selectedNodeId] ? localGraph.selectedNodeId : nextProject?.rootId ?? null;
  const focusedParentId = localGraph.focusedParentId && nextProject?.nodes[localGraph.focusedParentId] ? localGraph.focusedParentId : nextProject?.rootId ?? null;
  if (workspace) {
    for (const [id, board] of Object.entries(workspace.boards ?? {})) {
      const local = localWorkspace.boards[id];
      if (local) workspace.boards![id] = { ...board, document: { ...board.document, viewport: local.document.viewport } };
    }
    if (owner && workspace.projects[owner]?.planner) workspace.projects[owner] = { ...workspace.projects[owner], planner: { ...workspace.projects[owner].planner!, ...nextDomain, selectedNodeId, focusedParentId, lens: localGraph.lens, viewMode: localGraph.viewMode, detailPanelOpen: localGraph.detailPanelOpen, lastTutorNodeId: localGraph.lastTutorNodeId } };
  }
  // Both inputs are fully validated before the first setter. connectPlanner may fire
  // synchronously; the workspace domain snapshot is installed last to avoid its echo.
  withoutPersistenceEcho(() => {
    if (nextDomain) useGraphStore.setState({ ...nextDomain, lastAction: null, selectedNodeId, focusedParentId });
    if (workspace) useWorkspaceStore.setState(workspace);
    applyContent();
  });
  // A commit signal can arrive before its durable PUT, or while typing defers
  // refresh. Hand the preview over only after the same stroke is canonical.
  acknowledgeAppliedInk(useWorkspaceStore.getState(), useGraphStore.getState().project);
}

/** Bounded fallback polling plus a fast, authenticated remote-commit signal from LiveInkChannel. */
export function CloudLiveSync({ runtime }: { runtime: CloudRuntime }) {
  useEffect(() => {
    let active = true;
    const commitRetries = new Set<number>();
    const idle = () => active && document.visibilityState !== 'hidden' && navigator.onLine !== false && cloudCanvasIdle();
    const refresh = () => { if (idle()) void runtime.refreshRemote({ keys: SYNC_KEYS, isIdle: idle, apply: applyRemoteCanvasDocuments }).catch(() => { /* CloudStatus owns conflicts/session/network presentation. */ }); };
    // focusout fires before activeElement settles. Check on the next task, so
    // switching between two text fields still preserves the editor guard.
    const focusLeft = () => {
      const timer = window.setTimeout(() => { commitRetries.delete(timer); refresh(); }, 0);
      commitRetries.add(timer);
    };
    // A preview commit can beat its durable encrypted PUT to the server. Retry a
    // small bounded burst so the temporary stroke can become canonical promptly.
    const committed = () => {
      // SSE and durable reads are independent: the saved stroke can arrive first.
      acknowledgeAppliedInk(useWorkspaceStore.getState(), useGraphStore.getState().project);
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
    document.addEventListener('focusout', focusLeft);
    return () => { active = false; window.clearInterval(timer); for (const retry of commitRetries) window.clearTimeout(retry); window.removeEventListener('dynamic-diary:cloud-commit', committed); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); document.removeEventListener('focusout', focusLeft); };
  }, [runtime]);
  return null;
}
