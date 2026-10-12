const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (values, key) => record(values) && Object.hasOwn(values, key) ? values[key] : undefined;
const ACCOUNT = Symbol('account');

function documentState(snapshot, key) {
  const documents = snapshot?.documents?.filter(value => value.key === key);
  if (documents?.length !== 1) return null;
  try { const value = JSON.parse(documents[0].value); return record(value.state) ? value.state : null; }
  catch { return null; }
}
function mediaReferences(value) {
  const pending = [value];
  const ids = new Set();
  let budget = 100000;
  while (pending.length && budget-- > 0) {
    const current = pending.pop();
    if (!record(current) && !Array.isArray(current)) continue;
    if (record(current) && typeof current.mediaId === 'string') ids.add(current.mediaId);
    for (const [key, child] of Object.entries(current)) {
      if (['referencedMediaIds', 'imageMediaIds'].includes(key) && Array.isArray(child)) for (const id of child) if (typeof id === 'string') ids.add(id);
      if (record(child) || Array.isArray(child)) pending.push(child);
    }
  }
  return pending.length ? null : ids;
}

/** Index once per operation; large media lists must not repeatedly parse the complete workspace. */
export function createMediaScopeResolver(snapshot) {
  const state = documentState(snapshot, 'cellproject-workspace');
  if (!state || !record(state.projects)) return () => false;
  const scopes = new Map(), references = new Map();
  let referencesComplete = true;
  const add = (index, key, value) => { const owners = index.get(key) ?? new Set(); owners.add(value); index.set(key, owners); };
  const addReferences = (value, ownerId) => {
    const ids = mediaReferences(value);
    if (!ids) { referencesComplete = false; return; }
    for (const id of ids) add(references, id, ownerId);
  };
  const owner = value => typeof value === 'string' && own(state.projects, value) ? value : value === null ? ACCOUNT : undefined;
  const addPlan = (project, ownerId) => {
    if (!record(project)) return;
    if (typeof project.id === 'string') { add(scopes, project.id, ownerId); add(scopes, `planner:${project.id}`, ownerId); }
    addReferences(project.visuals, ownerId);
  };
  for (const [ownerId, managed] of Object.entries(state.projects)) {
    add(scopes, ownerId, ownerId);
    addPlan(managed?.planner?.project, ownerId);
    addPlan(managed?.planner?.archivedProject, ownerId);
  }
  // An active checkpoint may carry work not captured into the managed envelope yet.
  const graph = documentState(snapshot, 'cellproject-graph');
  if (graph && own(state.projects, graph.plannerOwnerId)) {
    addPlan(graph.project, graph.plannerOwnerId);
    addPlan(graph.archivedProject, graph.plannerOwnerId);
  }
  for (const [noteId, note] of Object.entries(record(state.notes) ? state.notes : {})) {
    const noteOwner = owner(note?.projectId);
    if (noteOwner !== undefined) {
      add(scopes, `note:${noteId}`, noteOwner); add(scopes, `notebook:${noteId}`, noteOwner);
      addReferences(note?.canvas, noteOwner);
    }
  }
  for (const [boardId, board] of Object.entries(record(state.boards) ? state.boards : {})) {
    add(scopes, `board:${boardId}`, ACCOUNT); addReferences(board?.attachments, ACCOUNT);
  }
  return (metadata, projectId) => {
    if (!record(metadata) || typeof metadata.id !== 'string' || projectId !== null && typeof projectId !== 'string') return false;
    // Unscoped originals remain account assets; references cannot promote them into a project grant.
    if (metadata.projectId === undefined || metadata.projectId === null) return projectId === null;
    if (typeof metadata.projectId !== 'string') return false;
    // Explicit references recover unknown legacy IDs, never override a known/ambiguous owner.
    const candidates = scopes.get(metadata.projectId) ?? (referencesComplete ? references.get(metadata.id) : undefined);
    return candidates?.size === 1 && candidates.has(projectId === null ? ACCOUNT : projectId) || false;
  };
}

/** Resolve persisted UI aliases without trusting client-authored plan IDs as capabilities. */
export function mediaBelongsToScope(snapshot, metadata, projectId) { return createMediaScopeResolver(snapshot)(metadata, projectId); }
