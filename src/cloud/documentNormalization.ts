type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (value: JsonRecord, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function normalizeObjectiveDraft(value: unknown): unknown {
  return isRecord(value) && !owns(value, 'expanded') ? { ...value, expanded: {} } : value;
}

function normalizePlanner(planner: JsonRecord): JsonRecord {
  const objectiveDraft = normalizeObjectiveDraft(planner.objectiveDraft);
  let archivedSession = planner.archivedSession;
  if (isRecord(archivedSession)) {
    const archivedDraft = normalizeObjectiveDraft(archivedSession.objectiveDraft);
    if (archivedDraft !== archivedSession.objectiveDraft) archivedSession = { ...archivedSession, objectiveDraft: archivedDraft };
  }
  const archivedMissing = !owns(planner, 'archivedSession');

  if (!archivedMissing && objectiveDraft === planner.objectiveDraft && archivedSession === planner.archivedSession) return planner;
  return {
    ...planner,
    ...(objectiveDraft !== planner.objectiveDraft ? { objectiveDraft } : {}),
    ...(archivedMissing ? { archivedSession: null } : archivedSession !== planner.archivedSession ? { archivedSession } : {}),
  };
}

/** Compare legacy and hydrated planner documents without changing explicit values or unrelated paths. */
export function normalizePlannerDocument<T>(key: string, document: T): T {
  if (!isRecord(document) || !isRecord(document.state)) return document;
  const state = document.state;
  if (key === 'cellproject-graph') {
    const normalized = normalizePlanner(state);
    return normalized === state ? document : { ...document, state: normalized } as T;
  }
  if (key !== 'cellproject-workspace' || !isRecord(state.projects)) return document;

  let changed = false;
  const projects = Object.entries(state.projects).map(([id, project]) => {
    if (!isRecord(project) || !isRecord(project.planner)) return [id, project];
    const planner = normalizePlanner(project.planner);
    if (planner === project.planner) return [id, project];
    changed = true;
    return [id, { ...project, planner }];
  });
  return changed ? { ...document, state: { ...state, projects: Object.fromEntries(projects) } } as T : document;
}
