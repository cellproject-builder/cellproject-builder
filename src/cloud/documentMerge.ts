import { validatePersistedBoards } from '@/boards/model';
import { validatePersistedNoteCanvases } from '@/workspace/noteCanvasPersistence';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
const missing = Symbol('missing');
const conflict = Symbol('conflict');
type Value = Json | typeof missing;
type Result = Value | typeof conflict;

const envelopeKeys = new Set(['cellproject-workspace', 'cellproject-graph', 'dynamic_diary-chat', 'cellproject-kb', 'cellproject-config', 'cellproject-locale']);
const preferenceKeys = new Set(['dynamic_diary-theme', 'dynamic_diary-sidebar-collapsed', 'dynamic_diary:task-view']);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const atomicKeys = new Set(['viewport', 'camera', 'selection', 'modelHistory', 'pendingHistory', 'compaction', 'contextUsage', 'contextObservation']);
const identityKeys = ['id', 'sessionId', 'version', 'kind', 'type', 'deletedAt', 'archived'];
const selectionKeys = ['selectedNodeId', 'focusedParentId', 'lens', 'viewMode', 'detailPanelOpen', 'lastTutorNodeId'];
const conversationKeys = ['sessionId', 'messages', 'modelHistory', 'pendingHistory', 'compaction', 'contextUsage', 'contextObservation'];
const object = (value: Value): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value: JsonObject, key: string): Value => Object.hasOwn(value, key) ? value[key] : missing;

function equal(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => equal(item, b[index]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

/** Reject unsafe structure even when a whole branch would otherwise be adopted unchanged. */
function validJson(value: unknown, depth = 0): value is Json {
  if (depth > 128) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    const ids = new Set<string>();
    for (const item of value) {
      if (!validJson(item, depth + 1)) return false;
      if (object(item) && typeof item.id === 'string') {
        if (ids.has(item.id)) return false;
        ids.add(item.id);
      }
    }
    return true;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, item]) => !unsafeKeys.has(key) && validJson(item, depth + 1));
}

function stringFields(value: JsonObject, fields: string[]): void {
  if (fields.some(field => Object.hasOwn(value, field) && typeof value[field] !== 'string')) throw new Error('Invalid persisted text');
}

function rows(value: Value): [string, JsonObject][] {
  if (value === missing) return [];
  if (!object(value)) throw new Error('Invalid persisted collection');
  return Object.entries(value).map(([id, row]) => {
    if (!object(row) || Object.hasOwn(row, 'id') && row.id !== id) throw new Error('Invalid persisted record');
    return [id, row];
  });
}

/** Legacy partial records remain readable; any supplied core field must be valid. */
function validateProject(value: Value): void {
  if (value === missing || value === null) return;
  if (!object(value)) throw new Error('Invalid persisted plan');
  stringFields(value, ['id', 'name', 'objective', 'rootId']);
  const nodes = own(value, 'nodes');
  const nodeRows = rows(nodes);
  const hasNode = (id: Json): id is string => typeof id === 'string' && object(nodes) && Object.hasOwn(nodes, id);
  if (Object.hasOwn(value, 'rootId') && !hasNode(value.rootId)) throw new Error('Invalid root reference');
  for (const [, node] of nodeRows) {
    stringFields(node, ['name']);
    if (Object.hasOwn(node, 'parentId') && node.parentId !== null && !hasNode(node.parentId)) throw new Error('Invalid parent reference');
    if (Object.hasOwn(node, 'position') && (!object(node.position) || typeof node.position.x !== 'number' || typeof node.position.y !== 'number')) throw new Error('Invalid node position');
  }
  const complete = new Set<string>();
  for (const [id] of nodeRows) {
    const ancestors = new Set<string>();
    let current: string | null = id;
    while (current !== null && !complete.has(current)) {
      if (ancestors.has(current)) throw new Error('Cyclic parent references');
      ancestors.add(current);
      const node: Json = (nodes as JsonObject)[current];
      current = object(node) && typeof node.parentId === 'string' ? node.parentId : null;
    }
    for (const ancestor of ancestors) complete.add(ancestor);
  }
  for (const [, edge] of rows(own(value, 'edges'))) {
    for (const field of ['source', 'target', 'middlewareNodeId']) {
      if (Object.hasOwn(edge, field) && !hasNode(edge[field])) throw new Error('Invalid edge reference');
    }
  }
}

function validateWorkspace(state: JsonObject): void {
  for (const collection of ['projects', 'tasks', 'comments', 'sprints', 'notes', 'folders']) {
    for (const [, row] of rows(own(state, collection))) stringFields(row, ['title', 'name', 'objective']);
  }
  for (const [, note] of rows(own(state, 'notes'))) {
    if (Object.hasOwn(note, 'blocks') && (!Array.isArray(note.blocks) || note.blocks.some(block =>
      !object(block) || typeof block.id !== 'string' || !block.id || typeof block.text !== 'string'))) throw new Error('Invalid persisted note blocks');
  }
  for (const [, managed] of rows(own(state, 'projects'))) {
    if (!Object.hasOwn(managed, 'planner') || managed.planner === null) continue;
    if (!object(managed.planner)) throw new Error('Invalid persisted planner');
    validateProject(own(managed.planner, 'project'));
    validateProject(own(managed.planner, 'archivedProject'));
  }
  validatePersistedNoteCanvases(state.notes);
  validatePersistedBoards(state.boards, state.notes);
}

function validateEnvelope(key: string, value: Json): asserts value is JsonObject & { state: JsonObject; version: number } {
  if (!object(value) || !object(value.state) || !Number.isSafeInteger(value.version) || (value.version as number) < 0) throw new Error('Invalid persisted envelope');
  if (key === 'cellproject-workspace') validateWorkspace(value.state);
  if (key === 'cellproject-graph') {
    validateProject(own(value.state, 'project'));
    validateProject(own(value.state, 'archivedProject'));
  }
}

/** Add the same deterministic legacy defaults on all three sides before comparing IDs. */
function normalizeChatState(state: JsonObject): JsonObject {
  const time = (value: Value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const normalize = (value: JsonObject): JsonObject => {
    if (typeof value.sessionId !== 'string' || !value.sessionId) return value;
    const messages = Object.hasOwn(value, 'messages') ? value.messages : [];
    const modelHistory = Object.hasOwn(value, 'modelHistory') ? value.modelHistory : [];
    if (!Array.isArray(messages) || messages.some(message => !object(message)) || !Array.isArray(modelHistory)) throw new Error('Invalid persisted conversation');
    const times = messages.flatMap(message => object(message) && time(message.createdAt) ? [message.createdAt] : []);
    const createdAt = time(value.createdAt) ? value.createdAt : times[0] ?? 0;
    const updatedAt = time(value.updatedAt) ? value.updatedAt : times.at(-1) ?? createdAt;
    if (time(value.deletedAt)) return { id: value.sessionId, sessionId: value.sessionId, createdAt, updatedAt: value.deletedAt, deletedAt: value.deletedAt, archivedAt: null,
      messages: [], modelHistory: [], pendingHistory: null, compaction: null, contextUsage: null };
    return { ...value, id: value.sessionId, createdAt, updatedAt, messages, modelHistory,
      archivedAt: time(value.archivedAt) ? value.archivedAt : null, deletedAt: null,
      pendingHistory: value.pendingHistory ?? null, compaction: value.compaction ?? null, contextUsage: value.contextUsage ?? null, contextObservation: value.contextObservation ?? null };
  };
  const next = normalize(state);
  const inactive = own(state, 'archivedSessions');
  if (inactive === missing) return next;
  if (!Array.isArray(inactive) || inactive.some(session => !object(session))) throw new Error('Invalid persisted conversation list');
  return { ...next, archivedSessions: inactive.map(session => normalize(session as JsonObject)) };
}

function stableItems(items: Json[]): Map<string, JsonObject> | null {
  const result = new Map<string, JsonObject>();
  for (const item of items) {
    if (!object(item) || typeof item.id !== 'string' || !item.id || unsafeKeys.has(item.id) || result.has(item.id)) return null;
    result.set(item.id, item);
  }
  return result;
}

function sameRelations(a: Value, b: Value, fields: string[]): boolean {
  if (!object(a) || !object(b)) return equal(a, b);
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(id => {
    if (!Object.hasOwn(b, id)) return false;
    const left = a[id], right = b[id];
    return object(left) && object(right) ? fields.every(field => equal(own(left, field), own(right, field))) : equal(left, right);
  });
}

function sameTopology(a: JsonObject, b: JsonObject): boolean {
  return equal(own(a, 'rootId'), own(b, 'rootId')) &&
    sameRelations(own(a, 'nodes'), own(b, 'nodes'), ['id', 'parentId', 'kind', 'order']) &&
    sameRelations(own(a, 'edges'), own(b, 'edges'), ['id', 'source', 'target', 'kind', 'middlewareNodeId']);
}

function mergeArray(base: Json[], local: Json[], remote: Json[], path: string[], key: string): Result {
  const b = stableItems(base), l = stableItems(local), r = stableItems(remote);
  if (!b || !l || !r) return conflict;
  const values = new Map<string, Json>();
  for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const item = mergeValue(b.get(id) ?? missing, l.get(id) ?? missing, r.get(id) ?? missing, [...path, id], key);
    if (item === conflict) return conflict;
    if (item !== missing) values.set(id, item);
  }

  const baseOrder = [...b.keys()].filter(id => values.has(id));
  const localOrder = [...l.keys()].filter(id => values.has(id) && b.has(id));
  const remoteOrder = [...r.keys()].filter(id => values.has(id) && b.has(id));
  const localReordered = !equal(baseOrder, localOrder), remoteReordered = !equal(baseOrder, remoteOrder);
  if (localReordered && remoteReordered && !equal(localOrder, remoteOrder)) return conflict;
  const order = localReordered ? localOrder : remoteReordered ? remoteOrder : baseOrder;

  // Existing items follow the accepted order. Added items retain their neighbours and
  // each side's ordering; a cycle means those positions cannot coexist safely.
  const edges = new Map([...values.keys()].map(id => [id, new Set<string>()]));
  const incoming = new Map([...values.keys()].map(id => [id, 0]));
  const edge = (from: string, to: string) => {
    if (!edges.get(from)!.has(to)) { edges.get(from)!.add(to); incoming.set(to, incoming.get(to)! + 1); }
  };
  for (let index = 1; index < order.length; index++) edge(order[index - 1], order[index]);
  for (const side of [l, r]) {
    const ids = [...side.keys()].filter(id => values.has(id));
    for (let index = 1; index < ids.length; index++) {
      if (!b.has(ids[index - 1]) || !b.has(ids[index])) edge(ids[index - 1], ids[index]);
    }
  }
  const rank = new Map(order.map((id, index) => [id, index]));
  const compare = (a: string, z: string) => {
    const difference = (rank.get(a) ?? Infinity) - (rank.get(z) ?? Infinity);
    return Number.isNaN(difference) || difference === 0 ? a < z ? -1 : a > z ? 1 : 0 : difference;
  };
  const ready = [...values.keys()].filter(id => incoming.get(id) === 0).sort(compare);
  const result: Json[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    result.push(values.get(id)!);
    for (const next of edges.get(id)!) {
      incoming.set(next, incoming.get(next)! - 1);
      if (incoming.get(next) === 0) ready.push(next);
    }
    ready.sort(compare);
  }
  return result.length === values.size ? result : conflict;
}

function mergeValue(base: Value, local: Value, remote: Value, path: string[], key: string): Result {
  if (equal(local, remote)) return local;
  if (equal(local, base)) return remote;
  if (equal(remote, base)) return local;
  // A missing baseline is a concurrent creation, never an invitation to combine
  // unrelated records. Missing on one side after a baseline is delete-versus-edit.
  if (base === missing || local === missing || remote === missing) return conflict;
  const field = path.at(-1);
  if (key === 'cellproject-workspace' && path.length === 5 && path[0] === 'state' && path[1] === 'boards' && path[3] === 'document' && field === 'viewport') return local;
  if (field && atomicKeys.has(field)) return conflict;
  if ((field === 'updatedAt' || field === 'modifiedAt') && typeof base === 'number' && typeof local === 'number' && typeof remote === 'number') return Math.max(base, local, remote);
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) return mergeArray(base, local, remote, path, key);
  if (!object(base) || !object(local) || !object(remote)) return conflict;
  if (identityKeys.some(field => !equal(own(base, field), own(local, field)) || !equal(own(base, field), own(remote, field)))) return conflict;
  const graphProject = key === 'cellproject-graph' && path.length === 2 && path[0] === 'state' && field === 'project' ||
    key === 'cellproject-workspace' && path.length === 5 && path[0] === 'state' && path[1] === 'projects' && path[3] === 'planner' && field === 'project';
  // Attribute edits are independent only while both copies retain the common
  // graph relations. Combining structural edits requires a graph transaction.
  if (graphProject && (!sameTopology(base, local) || !sameTopology(base, remote))) return conflict;
  const changed = (fields: string[], a: JsonObject, b: JsonObject) => fields.some(field => !equal(own(a, field), own(b, field)));
  const planner = key === 'cellproject-graph' && path.length === 1 && path[0] === 'state' ||
    key === 'cellproject-workspace' && path.length === 4 && path[0] === 'state' && path[1] === 'projects' && path[3] === 'planner';
  const projectIdentity = (value: JsonObject): Value => object(value.project) ? own(value.project, 'id') : own(value, 'project');
  // A draft and its selection belong to the open plan. Switching that plan while
  // another device edits it needs domain coordination beyond one JSON document.
  if (planner && (!equal(projectIdentity(base), projectIdentity(local)) || !equal(projectIdentity(base), projectIdentity(remote)))) return conflict;
  if (!planner && changed(selectionKeys, base, local) && changed(selectionKeys, base, remote) && changed(selectionKeys, local, remote)) return conflict;
  // A turn can persist visible messages before its model history. Those fields
  // form one conversation even while the history is still empty or pending.
  const conversation = key === 'dynamic_diary-chat' && (path.length === 1 && path[0] === 'state' ||
    path.length === 3 && path[0] === 'state' && path[1] === 'archivedSessions');
  if (conversation &&
    changed(conversationKeys, base, local) && changed(conversationKeys, base, remote) && changed(conversationKeys, local, remote)) return conflict;
  const result: JsonObject = Object.create(null) as JsonObject;
  for (const field of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const item = planner && selectionKeys.includes(field) ? own(local, field) :
      mergeValue(own(base, field), own(local, field), own(remote, field), [...path, field], key);
    if (item === conflict) return conflict;
    if (item !== missing) result[field] = item;
  }
  return result;
}

/**
 * Three-way merge using the exact common persisted baseline. Null means unsafe;
 * it also preserves a remote document deletion rather than resurrecting it.
 * Inputs are never mutated. Raw preferences and arrays without stable IDs stay atomic.
 */
export function mergeCloudDocument(key: string, base: string | null, local: string, remote: string | null): string | null {
  if (preferenceKeys.has(key)) {
    if (local === remote || remote === base) return local;
    return local === base ? remote : null;
  }
  if (!envelopeKeys.has(key)) return null;
  try {
    const parse = (text: string): JsonObject & { state: JsonObject; version: number } => {
      const value: unknown = JSON.parse(text);
      if (!validJson(value)) throw new Error('Invalid JSON document');
      validateEnvelope(key, value);
      if (key === 'dynamic_diary-chat') {
        const normalized = { ...value, state: normalizeChatState(value.state) };
        if (!validJson(normalized)) throw new Error('Invalid normalized conversation');
        return normalized;
      }
      return value;
    };
    const l = parse(local), b = base === null ? null : parse(base), r = remote === null ? null : parse(remote);
    if (b && b.version !== l.version || r && r.version !== l.version) return null;
    if (r && equal(l, r)) return local;
    if (!r) return b === null ? local : null;
    if (!b) return null;
    if (equal(l, b)) return remote;
    if (equal(r, b)) return local;
    const merged = mergeValue(b, l, r, [], key);
    if (merged === conflict || merged === missing) return null;
    validateEnvelope(key, merged);
    return JSON.stringify(merged);
  } catch {
    return null;
  }
}
