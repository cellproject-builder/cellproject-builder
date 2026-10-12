import { mergeCloudDocument } from './documentMerge';

export interface ConflictCopyInput { key: string; base: string | null; local: string; remote: string | null }
export interface ConflictCopyResult { documents: { key: string; value: string }[]; copies: number }
type Row = Record<string, unknown>;
interface Envelope { state: Row; version: number }
interface Parsed { input: ConflictCopyInput; base: Envelope | null; local: Envelope; remote: Envelope | null }
interface IdMaps { projects: Map<string, string>; plans: Map<string, string>; tasks: Map<string, string>; sprints: Map<string, string>; comments: Map<string, string>; notes: Map<string, string>; folders: Map<string, string>; boards: Map<string, string> }
const WORKSPACE = 'cellproject-workspace', GRAPH = 'cellproject-graph', CHAT = 'dynamic_diary-chat';
const SUFFIX = ' (cópia deste aparelho)';
const collections = ['projects', 'tasks', 'sprints', 'comments', 'notes', 'folders', 'boards'] as const;
const ownedCollections = ['tasks', 'sprints', 'comments', 'notes'] as const;
const plannerFields = ['project', 'selectedNodeId', 'focusedParentId', 'lens', 'viewMode', 'detailPanelOpen', 'lastTutorNodeId', 'drafts', 'objectiveDraft', 'archivedProject', 'pendingSuggestions', 'parkedSuggestions', 'archivedPending'];
const conversationFields = ['id', 'sessionId', 'title', 'createdAt', 'updatedAt', 'archivedAt', 'deletedAt', 'messages', 'modelHistory', 'pendingHistory', 'compaction', 'contextUsage', 'contextObservation'];
const record = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = <T>(value: T): T => structuredClone(value);
const encode = (value: Envelope): string => JSON.stringify(value);
const omit = (value: Row, fields: readonly string[]): Row => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => same(value, b[index]));
  return record(a) && record(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}
function rows(state: Row, collection: string): Record<string, Row> {
  const value = state[collection];
  if (value === undefined) return {};
  if (!record(value) || Object.values(value).some(row => !record(row))) throw new Error('Unsupported collection');
  return value as Record<string, Row>;
}
function parse(key: string, value: string): Envelope {
  if (mergeCloudDocument(key, value, value, value) === null) throw new Error('Invalid document');
  const parsed: unknown = JSON.parse(value);
  if (!record(parsed) || !record(parsed.state) || !Number.isSafeInteger(parsed.version)) throw new Error('Invalid envelope');
  return parsed as unknown as Envelope;
}
function mergedState(base: Row, local: Row, remote: Row, key = WORKSPACE, version = 2): Row | null {
  const value = mergeCloudDocument(key, encode({ state: base, version }), encode({ state: local, version }), encode({ state: remote, version }));
  return value === null ? null : (JSON.parse(value) as Envelope).state;
}
function validateRelations(state: Row): void {
  const projects = rows(state, 'projects'), tasks = rows(state, 'tasks'), sprints = rows(state, 'sprints'), folders = rows(state, 'folders');
  for (const collection of ownedCollections) for (const row of Object.values(rows(state, collection))) {
    if (row.projectId !== undefined && row.projectId !== null && (typeof row.projectId !== 'string' || !projects[row.projectId])) throw new Error('Missing project');
    if (collection === 'tasks' && row.sprintId !== undefined && row.sprintId !== null) {
      const sprint = typeof row.sprintId === 'string' ? sprints[row.sprintId] : undefined;
      if (!sprint || sprint.projectId !== row.projectId) throw new Error('Missing sprint');
    }
    if ((collection === 'notes' || collection === 'comments') && row.taskId !== undefined && row.taskId !== null) {
      const task = typeof row.taskId === 'string' ? tasks[row.taskId] : undefined;
      if (!task || task.projectId !== row.projectId) throw new Error('Missing task');
    }
    if (collection === 'notes' && row.folderId !== undefined && row.folderId !== null && (typeof row.folderId !== 'string' || !folders[row.folderId])) throw new Error('Missing folder');
  }
}
function remap(value: unknown, ids: IdMaps, planScope = false): unknown {
  if (Array.isArray(value)) return value.map(item => remap(item, ids, planScope));
  if (!record(value)) return value;
  const next: Row = {};
  for (const [key, item] of Object.entries(value)) {
    const map = key === 'projectId' ? planScope ? ids.plans.has(String(item)) ? ids.plans : ids.projects : ids.projects.has(String(item)) ? ids.projects : ids.plans
      : key === 'sourcePlanId' ? ids.plans : key === 'taskId' ? ids.tasks : key === 'sprintId' ? ids.sprints
        : key === 'folderId' ? ids.folders : key === 'noteId' || key === 'noteRef' ? ids.notes : null;
    next[key] = typeof item === 'string' && map?.has(item) ? map.get(item)! : remap(item, ids, planScope);
  }
  if (value.kind === 'note' && typeof value.id === 'string' && ids.notes.has(value.id)) next.id = ids.notes.get(value.id)!;
  return next;
}
function copiedPlanner(snapshot: Row, ids: IdMaps): Row {
  const next = remap(snapshot, ids, true) as Row;
  for (const field of ['project', 'archivedProject']) {
    const project = next[field];
    if (record(project) && typeof project.id === 'string' && ids.plans.has(project.id)) next[field] = { ...project, id: ids.plans.get(project.id)! };
  }
  return next;
}
function copyTitle(row: Row, field: string, maximum = Infinity): string {
  const value = typeof row[field] === 'string' && row[field] ? row[field] : field === 'name' ? 'Projeto recuperado' : 'Conteúdo recuperado';
  if (value.length + SUFFIX.length > maximum) throw new Error('Copy title exceeds domain limit');
  return `${value}${SUFFIX}`;
}

/** Preserve incompatible local units under fresh identities; originals retain the remote version. */
export function preserveConflictCopies(inputs: readonly ConflictCopyInput[]): ConflictCopyResult | null {
  try {
    const byKey = new Map<string, Parsed>(), output = new Map<string, string>(), conflicts = new Set<string>(), seenKeys = new Set<string>();
    const occupied = new Set<string>();
    const scan = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(scan); return; }
      if (!record(value)) return;
      for (const [key, item] of Object.entries(value)) { occupied.add(key); if ((key === 'id' || key === 'sessionId') && typeof item === 'string') occupied.add(item); scan(item); }
    };
    for (const input of inputs) {
      if (seenKeys.has(input.key)) return null;
      seenKeys.add(input.key);
      // Raw settings still use the ordinary merge; only domain envelopes can be copied.
      const value = mergeCloudDocument(input.key, input.base, input.local, input.remote);
      if (![WORKSPACE, GRAPH, CHAT].includes(input.key)) { if (value === null) return null; output.set(input.key, value); continue; }
      const local = parse(input.key, input.local), base = input.base === null ? null : parse(input.key, input.base), remote = input.remote === null ? null : parse(input.key, input.remote);
      if (base && base.version !== local.version || remote && remote.version !== local.version) return null;
      [base, local, remote].forEach(scan);
      if (input.key === WORKSPACE) [base, local, remote].forEach(envelope => { if (envelope) validateRelations(envelope.state); });
      byKey.set(input.key, { input, base, local, remote });
      let validMerged = value !== null;
      if (input.key === WORKSPACE && value !== null) {
        try { validateRelations(parse(input.key, value).state); } catch { validMerged = false; }
      }
      if (validMerged) output.set(input.key, value!);
      else if (base && remote === null && same(base, local)) { /* A remote document deletion stays deleted. */ }
      else conflicts.add(input.key);
      if (conflicts.has(input.key) && [base, local, remote].some(envelope => envelope && Object.keys(envelope).some(field => field !== 'state' && field !== 'version'))) return null;
    }
    let counter = 0, copies = 0;
    const fresh = () => { let id: string; do { id = `recovered_${++counter}`; } while (occupied.has(id)); occupied.add(id); return id; };
    const ids: IdMaps = { projects: new Map(), plans: new Map(), tasks: new Map(), sprints: new Map(), comments: new Map(), notes: new Map(), folders: new Map(), boards: new Map() };
    const managedCopies = new Map<string, Row>();
    const workspaceInput = byKey.get(WORKSPACE);
    let workspaceEnvelope: Envelope | undefined = output.has(WORKSPACE) ? parse(WORKSPACE, output.get(WORKSPACE)!) : undefined;
    if (conflicts.has(WORKSPACE)) {
      if (!workspaceInput?.remote || !workspaceInput.base) return null;
      const base = workspaceInput.base.state, local = workspaceInput.local.state, remote = workspaceInput.remote.state;
      const metadata = mergedState(omit(base, collections), omit(local, collections), omit(remote, collections), WORKSPACE, workspaceInput.local.version);
      if (metadata === null) return null;
      const state: Row = { ...metadata };
      const projectCopies = new Set<string>(), rowCopies = new Map<string, Set<string>>();
      for (const collection of collections) {
        const b = rows(base, collection), l = rows(local, collection), r = rows(remote, collection), merged: Record<string, Row> = {};
        rowCopies.set(collection, new Set());
        for (const id of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
          const value = mergedState({ [collection]: b[id] ? { [id]: b[id] } : {} }, { [collection]: l[id] ? { [id]: l[id] } : {} }, { [collection]: r[id] ? { [id]: r[id] } : {} }, WORKSPACE, workspaceInput.local.version);
          if (value !== null) { Object.assign(merged, rows(value, collection)); continue; }
          if (r[id]) merged[id] = clone(r[id]);
          if (!l[id]) continue;
          if (collection === 'projects') projectCopies.add(id);
          else if ((ownedCollections as readonly string[]).includes(collection) && typeof l[id].projectId === 'string') projectCopies.add(l[id].projectId as string);
          else if (collection === 'notes' || collection === 'folders' || collection === 'boards') rowCopies.get(collection)!.add(id);
          else return null;
        }
        if (Object.hasOwn(base, collection) || Object.hasOwn(local, collection) || Object.hasOwn(remote, collection)) state[collection] = merged;
      }
      // Independent additions can depend on a project/task deleted remotely. Recover their whole local owner.
      for (const collection of ownedCollections) for (const [id, row] of Object.entries(rows(state, collection))) {
        if (typeof row.projectId === 'string' && (!rows(state, 'projects')[row.projectId] ||
          typeof row.taskId === 'string' && !rows(state, 'tasks')[row.taskId] || typeof row.sprintId === 'string' && !rows(state, 'sprints')[row.sprintId])) {
          const localRow = rows(local, collection)[id];
          if (!localRow || typeof localRow.projectId !== 'string') return null;
          projectCopies.add(localRow.projectId);
        }
      }
      for (const id of projectCopies) {
        const project = rows(local, 'projects')[id];
        if (!project) return null;
        ids.projects.set(id, fresh());
        if (record(project.planner)) for (const field of ['project', 'archivedProject']) {
          const plan = project.planner[field];
          if (record(plan) && typeof plan.id === 'string' && !ids.plans.has(plan.id)) ids.plans.set(plan.id, fresh());
        }
        for (const collection of ownedCollections) for (const [rowId, row] of Object.entries(rows(local, collection))) if (row.projectId === id) ids[collection].set(rowId, fresh());
      }
      for (const collection of ['notes', 'folders', 'boards'] as const) for (const id of rowCopies.get(collection)!) ids[collection].set(id, fresh());
      // A local copy must not restore a deleted folder under its former identity.
      for (const [id] of ids.notes) {
        const folderId = rows(local, 'notes')[id].folderId;
        if (typeof folderId === 'string' && !rows(state, 'folders')[folderId] && !ids.folders.has(folderId)) {
          if (!rows(local, 'folders')[folderId]) return null;
          ids.folders.set(folderId, fresh());
        }
      }
      for (const id of projectCopies) {
        const project = rows(local, 'projects')[id], newId = ids.projects.get(id)!;
        const originals = rows(state, 'projects'), remoteProject = rows(remote, 'projects')[id];
        if (remoteProject) originals[id] = clone(remoteProject);
        else delete originals[id];
        state.projects = originals;
        const next = remap(project, ids) as Row;
        next.id = newId; next.name = copyTitle(project, 'name');
        if (record(project.planner)) next.planner = copiedPlanner(project.planner, ids);
        (state.projects as Record<string, Row>)[newId] = next;
        if (record(project.planner) && record(next.planner)) managedCopies.set(id, next.planner);
        copies++;
        for (const collection of ownedCollections) {
          const destination = rows(state, collection);
          for (const [rowId, row] of Object.entries(destination)) if (row.projectId === id && !rows(remote, collection)[rowId]) delete destination[rowId];
          for (const [rowId, row] of Object.entries(rows(remote, collection))) if (row.projectId === id) destination[rowId] = clone(row);
          state[collection] = destination;
        }
      }
      for (const collection of ['tasks', 'sprints', 'comments', 'notes', 'folders', 'boards'] as const) {
        const destination = rows(state, collection);
        for (const [oldId, newId] of ids[collection]) {
          const original = rows(local, collection)[oldId], next = remap(original, ids) as Row;
          next.id = newId;
          if (collection === 'notes') next.title = copyTitle(original, 'title');
          if (collection === 'boards') next.title = copyTitle(original, 'title', 240);
          if (collection === 'folders') next.name = copyTitle(original, 'name');
          destination[newId] = next;
          if (collection === 'boards' || collection === 'notes' && rowCopies.get('notes')!.has(oldId)) copies++;
        }
        if (Object.keys(destination).length || Object.hasOwn(state, collection)) state[collection] = destination;
      }
      validateRelations(state);
      workspaceEnvelope = { ...workspaceInput.remote, state };
      output.set(WORKSPACE, encode(workspaceEnvelope));
      conflicts.delete(WORKSPACE);
    }
    if (conflicts.has(GRAPH)) {
      const graph = byKey.get(GRAPH)!;
      if (!graph.remote || !graph.base || !workspaceEnvelope || !workspaceInput) return null;
      const local = graph.local.state;
      if (Object.keys(local).some(field => !plannerFields.includes(field))) return null;
      const owners = Object.entries(rows(workspaceInput.local.state, 'projects')).filter(([, managed]) => record(managed.planner) && same(managed.planner, local));
      if (owners.length > 1) return null;
      const copied = owners.length === 1 ? managedCopies.get(owners[0][0]) : undefined;
      if (copied) output.set(GRAPH, encode({ ...graph.local, state: copied }));
      else {
        if (!record(local.project) || typeof local.project.id !== 'string') return null;
        const newId = fresh(), ownIds: IdMaps = { ...ids, plans: new Map() };
        for (const field of ['project', 'archivedProject']) {
          const project = local[field];
          if (record(project) && typeof project.id === 'string') ownIds.plans.set(project.id, fresh());
        }
        const snapshot = copiedPlanner(local, ownIds), project = local.project;
        const recovered = { id: newId, name: copyTitle(project, 'name'), objective: typeof project.objective === 'string' ? project.objective : '', archived: false,
          createdAt: typeof project.createdAt === 'number' ? project.createdAt : 0, updatedAt: typeof project.updatedAt === 'number' ? project.updatedAt : 0, planner: snapshot };
        workspaceEnvelope.state.projects = { ...rows(workspaceEnvelope.state, 'projects'), [newId]: recovered };
        output.set(WORKSPACE, encode(workspaceEnvelope));
        output.set(GRAPH, graph.input.remote!);
        copies++;
      }
      conflicts.delete(GRAPH);
    }
    if (conflicts.has(CHAT)) {
      const chat = byKey.get(CHAT)!;
      if (!chat.base || !chat.remote) return null;
      const b = chat.base.state, l = chat.local.state, r = chat.remote.state;
      const metadata = mergedState(omit(b, [...conversationFields, 'archivedSessions']), omit(l, [...conversationFields, 'archivedSessions']), omit(r, [...conversationFields, 'archivedSessions']));
      if (metadata === null) return null;
      const sessionMap = (state: Row): Map<string, Row> => {
        const inactive = state.archivedSessions ?? [];
        if (!Array.isArray(inactive)) throw new Error('Invalid sessions');
        const map = new Map<string, Row>();
        for (const item of [Object.fromEntries(Object.entries(state).filter(([key]) => conversationFields.includes(key))), ...inactive]) {
          if (!record(item) || typeof item.sessionId !== 'string' || !item.sessionId || map.has(item.sessionId) || !Array.isArray(item.messages) || !Array.isArray(item.modelHistory)) throw new Error('Invalid conversation');
          map.set(item.sessionId, item);
        }
        return map;
      };
      const bs = sessionMap(b), ls = sessionMap(l), rs = sessionMap(r), activeId = r.sessionId as string;
      const retained = new Map(rs);
      const copySession = (session: Row) => {
        if (session.deletedAt !== undefined && session.deletedAt !== null) return;
        const id = fresh(), next = clone(session);
        next.id = id; next.sessionId = id;
        const title = typeof session.title === 'string' ? session.title : String((session.messages as Row[]).find(message => message.role === 'user')?.text ?? 'Conversa recuperada').slice(0, 160 - SUFFIX.length);
        // A derived label may be shortened; an existing authored title stays intact.
        if (title.length > 160) throw new Error('Invalid conversation title');
        next.title = title.length + SUFFIX.length > 160 ? title : copyTitle({ title }, 'title', 160);
        next.messages = (next.messages as Row[]).map(message => ({ ...message, ...(typeof message.id === 'string' ? { id: fresh() } : {}) }));
        retained.set(id, next); copies++;
      };
      for (const [id, session] of ls) {
        const before = bs.get(id), there = rs.get(id);
        if (same(session, there) || same(session, before)) continue;
        if (!there) {
          if (!before && id !== l.sessionId) retained.set(id, clone(session));
          else copySession(session);
          continue;
        }
        const merged = before ? mergedState(before, session, there, CHAT, chat.local.version) : null;
        if (merged === null || id === activeId && id === l.sessionId && !same(session, there)) copySession(session);
        else retained.set(id, merged);
      }
      const state = { ...r, ...metadata, ...(retained.get(activeId) ?? {}), archivedSessions: [...retained].filter(([id]) => id !== activeId).map(([, session]) => session) };
      output.set(CHAT, encode({ ...chat.remote, state }));
      conflicts.delete(CHAT);
    }
    if (conflicts.size) return null;
    for (const [key, value] of output) {
      if (mergeCloudDocument(key, value, value, value) === null) return null;
      if (key === WORKSPACE) validateRelations(parse(key, value).state);
    }
    return { documents: [...output].map(([key, value]) => ({ key, value })), copies };
  } catch { return null; }
}
