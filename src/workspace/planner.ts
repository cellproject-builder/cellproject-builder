import { useGraphStore, EMPTY_OBJECTIVE_DRAFT, isDemoProject, type GraphState } from '@/store';
import type { Project } from '@/types';
import { nanoid } from 'nanoid';
import { t } from '@/i18n';
import { hasActiveAIActions } from '@/ai/actions';
import { useWorkspaceStore } from './store';
import type { PlannerSnapshot } from './types';
import { normalizeStoredProjectVisuals } from '@/visuals/projectBoundary';
import { plannerContentChanged, plannerContentValues } from '@/data/plannerPersistence';

let ownerId: string | null = null;

/** Identity of the workspace project currently owning the singleton editor. */
export function getPlannerOwnerId(): string | null { return ownerId; }

export function capturePlanner(state: GraphState = useGraphStore.getState()): PlannerSnapshot {
  const { project, selectedNodeId, focusedParentId, lens, viewMode, detailPanelOpen,
    lastTutorNodeId, drafts, objectiveDraft, pendingSuggestions, parkedSuggestions,
    archivedProject, archivedPending, archivedSession } = state;
  return { project, selectedNodeId, focusedParentId, lens, viewMode, detailPanelOpen,
    lastTutorNodeId, drafts, objectiveDraft, pendingSuggestions, parkedSuggestions,
    archivedProject, archivedPending, archivedSession };
}

function emptySnapshot(name = '', objective = '', project: Project | null = null): PlannerSnapshot {
  return { project, selectedNodeId: project?.rootId ?? null, focusedParentId: project?.rootId ?? null,
    lens: 'structure', viewMode: 'tutor', detailPanelOpen: true, lastTutorNodeId: null,
    drafts: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, name, objective, rules: [], expanded: {} },
    pendingSuggestions: null, parkedSuggestions: {}, archivedProject: null, archivedPending: null, archivedSession: null };
}

function sameDomain(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => sameDomain(value, b[index]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>, keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameDomain(left[key], right[key]));
}

/** Preserve authored work and paid results, without recovering empty UI state. */
function hasEditorDomainWork(state: GraphState): boolean {
  const hasObjectiveWork = (draft: GraphState['objectiveDraft'] | undefined) => Boolean(draft && (
    draft.name.trim() || draft.objective.trim() || draft.ruleDraft.trim() || draft.rules.some(rule => rule.trim()) ||
    draft.plans?.length || draft.outlines?.length || Object.keys(draft.expanded).length || draft.outlineResearch ||
    draft.planApproach || draft.referenceTarget?.trim()
  ));
  const hasDrafts = (drafts: GraphState['drafts']) => Object.values(drafts).some(draft => Object.values(draft).some(text => text?.trim()));
  const hasBatch = (batch: GraphState['pendingSuggestions']) => Boolean(batch?.nodes.length || batch?.edges.length);
  const hasParked = (batches: GraphState['parkedSuggestions']) => Object.values(batches).some(hasBatch);
  const archived = state.archivedSession;
  return Boolean(state.project && !isDemoProject(state.project) || state.archivedProject && !isDemoProject(state.archivedProject) ||
    hasObjectiveWork(state.objectiveDraft) || hasDrafts(state.drafts) || hasBatch(state.pendingSuggestions) || hasParked(state.parkedSuggestions) || hasBatch(state.archivedPending) ||
    archived && (hasObjectiveWork(archived.objectiveDraft) || hasDrafts(archived.drafts) || hasParked(archived.parkedSuggestions)));
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
          ...(graph.archivedSession?.projectId === project.id ? { drafts: graph.archivedSession.drafts, parkedSuggestions: graph.archivedSession.parkedSuggestions, objectiveDraft: graph.archivedSession.objectiveDraft } : {}),
          pendingSuggestions: graph.archivedPending,
        },
      };
    }
    const draft = graph.objectiveDraft;
    if (!graph.project && hasEditorDomainWork(graph)) {
      const id = nanoid(10), now = Date.now();
      projects[id] = { id, name: draft.name.trim() || t().store.projectFallbackName, objective: draft.objective,
        archived: false, createdAt: now, updatedAt: now, planner: capturePlanner(graph) };
    }
    useWorkspaceStore.setState({ projects, legacyImported: true });
  }
  const projects = useWorkspaceStore.getState().projects;
  if (graph.plannerOwnerId && projects[graph.plannerOwnerId]) ownerId = graph.plannerOwnerId;
  else {
    // Legacy envelopes lack ownership. An imported plan id alone may identify
    // several independent managed copies; only a unique candidate is safe.
    const matches = Object.values(projects).filter(project => project.planner && (graph.project ? project.planner.project?.id === graph.project.id : !project.planner.project));
    const exact = matches.filter(project => sameDomain(plannerContentValues({ ...emptySnapshot(), ...project.planner }), plannerContentValues(capturePlanner(graph))));
    ownerId = graph.project && matches.length === 1 ? matches[0].id : exact.length === 1 ? exact[0].id : null;
    if (!ownerId && hasEditorDomainWork(graph)) {
      // Preserve an ambiguous/orphan editor as its own managed project before
      // any later open can replace it. Never attach its work to the first copy.
      const id = nanoid(10), now = Date.now();
      useWorkspaceStore.setState({ projects: { ...projects, [id]: { id, name: graph.objectiveDraft.name.trim() || graph.project?.name || t().store.projectFallbackName, objective: graph.project?.objective ?? graph.objectiveDraft.objective, archived: false, createdAt: now, updatedAt: now, planner: capturePlanner(graph) } } });
      ownerId = id;
    }
  }
  if (graph.plannerOwnerId !== ownerId) useGraphStore.setState({ plannerOwnerId: ownerId });
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
    ...emptySnapshot(project.name, project.objective), ...project.planner,
    plannerOwnerId: projectId,
    project: normalizeStoredProjectVisuals(project.planner?.project),
    archivedProject: normalizeStoredProjectVisuals(project.planner?.archivedProject),
    lastAction: null, aiJobs: {}, centerRequest: null, mobileSheetOpen: false,
    replacedArchive: null,
  });
}

export function connectPlanner() {
  return useGraphStore.subscribe((state, previous) => {
    if (!ownerId) return;
    if (plannerContentChanged(state, previous)) useWorkspaceStore.getState().savePlanner(ownerId, capturePlanner(state));
  });
}
