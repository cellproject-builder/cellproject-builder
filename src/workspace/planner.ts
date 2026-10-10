import { useGraphStore, EMPTY_OBJECTIVE_DRAFT, isDemoProject, type GraphState } from '@/store';
import type { Project } from '@/types';
import { nanoid } from 'nanoid';
import { t } from '@/i18n';
import { hasActiveAIActions } from '@/ai/actions';
import { useWorkspaceStore } from './store';
import type { PlannerSnapshot } from './types';
import { normalizeStoredProjectVisuals } from '@/visuals/projectBoundary';

let ownerId: string | null = null;

/** Identity of the workspace project currently owning the singleton editor. */
export function getPlannerOwnerId(): string | null { return ownerId; }

export function capturePlanner(state: GraphState = useGraphStore.getState()): PlannerSnapshot {
  const { project, selectedNodeId, focusedParentId, lens, viewMode, detailPanelOpen,
    lastTutorNodeId, drafts, objectiveDraft, pendingSuggestions, parkedSuggestions,
    archivedProject, archivedPending } = state;
  return { project, selectedNodeId, focusedParentId, lens, viewMode, detailPanelOpen,
    lastTutorNodeId, drafts, objectiveDraft, pendingSuggestions, parkedSuggestions,
    archivedProject, archivedPending };
}

function emptySnapshot(name = '', objective = '', project: Project | null = null): PlannerSnapshot {
  return { project, selectedNodeId: project?.rootId ?? null, focusedParentId: project?.rootId ?? null,
    lens: 'structure', viewMode: 'tutor', detailPanelOpen: true, lastTutorNodeId: null,
    drafts: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, name, objective, rules: [], expanded: {} },
    pendingSuggestions: null, parkedSuggestions: {}, archivedProject: null, archivedPending: null };
}

/** Read another project without swapping the singleton editor or its visible label. */
export function readPlanner(projectId: string): PlannerSnapshot {
  const project = useWorkspaceStore.getState().projects[projectId];
  if (!project) throw new Error('projectMissing');
  return ownerId === projectId ? capturePlanner() : project.planner ?? emptySnapshot(project.name, project.objective);
}

export function initializeWorkspace() {
  const currentGraph = useGraphStore.getState();
  const cleanCurrent = normalizeStoredProjectVisuals(currentGraph.project), cleanArchived = normalizeStoredProjectVisuals(currentGraph.archivedProject);
  if (cleanCurrent !== currentGraph.project || cleanArchived !== currentGraph.archivedProject) useGraphStore.setState({ project: cleanCurrent, archivedProject: cleanArchived });
  const currentProjects = useWorkspaceStore.getState().projects;
  let projectsChanged = false;
  const safeProjects = { ...currentProjects };
  for (const [id, managed] of Object.entries(currentProjects)) {
    if (!managed.planner) continue;
    const project = normalizeStoredProjectVisuals(managed.planner.project), archivedProject = normalizeStoredProjectVisuals(managed.planner.archivedProject);
    if (project !== managed.planner.project || archivedProject !== managed.planner.archivedProject) {
      safeProjects[id] = { ...managed, planner: { ...managed.planner, project, archivedProject } }; projectsChanged = true;
    }
  }
  if (projectsChanged) useWorkspaceStore.setState({ projects: safeProjects });
  const state = useWorkspaceStore.getState();
  // Persisted loading markers are not live requests after a reload. Clear
  // only those markers, keeping every outline, paid expansion and selection.
  if (!hasActiveAIActions()) {
    const graph = useGraphStore.getState();
    if (graph.objectiveDraft.generatingSince || graph.objectiveDraft.expansion) {
      useGraphStore.setState({ objectiveDraft: { ...graph.objectiveDraft, generatingSince: null, expansion: null } });
    }
    const projects = { ...state.projects };
    let changed = false;
    for (const project of Object.values(projects)) {
      const draft = project.planner?.objectiveDraft;
      if (project.planner && draft && (draft.generatingSince || draft.expansion)) {
        projects[project.id] = { ...project, planner: { ...project.planner, objectiveDraft: { ...draft, generatingSince: null, expansion: null } } };
        changed = true;
      }
    }
    if (changed) useWorkspaceStore.setState({ projects });
  }
  const graph = useGraphStore.getState();
  if (!state.legacyImported) {
    const projects = { ...useWorkspaceStore.getState().projects };
    for (const project of [graph.project, graph.archivedProject]) {
      if (!project || isDemoProject(project) || projects[project.id]) continue;
      projects[project.id] = {
        id: project.id, name: project.name, objective: project.objective,
        archived: false, createdAt: project.createdAt, updatedAt: project.updatedAt,
        planner: project === graph.project ? capturePlanner(graph) : {
          ...emptySnapshot(project.name, project.objective, project),
          pendingSuggestions: graph.archivedPending,
        },
      };
    }
    const draft = graph.objectiveDraft;
    if (!graph.project && (draft.name.trim() || draft.objective.trim() || draft.plans?.length || draft.outlines?.length || Object.keys(draft.expanded).length)) {
      const id = nanoid(10), now = Date.now();
      projects[id] = { id, name: draft.name.trim() || t().store.projectFallbackName, objective: draft.objective,
        archived: false, createdAt: now, updatedAt: now, planner: capturePlanner(graph) };
    }
    useWorkspaceStore.setState({ projects, legacyImported: true });
  }
  ownerId = Object.values(useWorkspaceStore.getState().projects)
    .find((p) => p.planner?.project?.id === graph.project?.id && graph.project)?.id ?? null;
}

export function plannerBusy() {
  const graph = useGraphStore.getState();
  return hasActiveAIActions() || Object.values(graph.aiJobs).some((jobs) => Object.keys(jobs).length > 0) ||
    Boolean(graph.objectiveDraft.generatingSince || graph.objectiveDraft.expansion);
}

export function openPlanner(projectId: string) {
  const state = useWorkspaceStore.getState(), project = state.projects[projectId];
  if (!project) throw new Error('projectMissing');
  if (ownerId === projectId) return;
  if (plannerBusy()) throw new Error('plannerBusy');
  if (ownerId) state.savePlanner(ownerId, capturePlanner());
  ownerId = projectId;
  useGraphStore.setState({
    ...(project.planner ?? emptySnapshot(project.name, project.objective)),
    project: normalizeStoredProjectVisuals(project.planner?.project),
    archivedProject: normalizeStoredProjectVisuals(project.planner?.archivedProject),
    lastAction: null, aiJobs: {}, centerRequest: null, mobileSheetOpen: false,
    replacedArchive: null,
  });
}

export function connectPlanner() {
  return useGraphStore.subscribe((state, previous) => {
    if (!ownerId) return;
    const snapshot = capturePlanner(state), before = capturePlanner(previous);
    if ((Object.keys(snapshot) as (keyof PlannerSnapshot)[]).some((key) => snapshot[key] !== before[key])) {
      useWorkspaceStore.getState().savePlanner(ownerId, snapshot);
    }
  });
}
