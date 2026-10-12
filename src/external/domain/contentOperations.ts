import { z } from 'zod';
import { nanoid } from 'nanoid';
import { conversationTitle, normalizeChatSession, normalizeInactiveSessions, tombstoneConversation } from '@/chat/sessionHistory';
import { KBFatoSchema, KBSummarySchema } from '@/kb/schemas';
import { fingerprintText, MAX_CHARS } from '@/kb/content';
import type { KBDocument } from '@/kb/types';
import { listChatReferences, resolveChatReferenceTarget, resolveChatReferences, CHAT_REFERENCE_LIMIT, type ChatReferenceTarget } from '@/chat/references';
import { planFileSchema, planFilesContext, sourceFingerprint, mergePlanFiles, PLAN_FILE_LIMIT } from '@/attachments/files';
import { addProjectFiles } from '@/attachments/projectFiles';
import { useWorkspaceStore } from '@/workspace/store';
import { currentLocale } from '@/i18n';
import { chatSubmissionText, chatReferenceHistoryContent, chatFileHistorySuffix } from '@/chat/messageSources';
import { readPreference, writePreference } from './memoryStorage';
import { id, noInput, pageInput, recordTarget } from './schemas';

export const CONTENT_DOCUMENT_KEYS = ['dynamic_diary-chat', 'cellproject-kb'] as const;
const DOCUMENT_BYTE_LIMIT = 32 * 1024 * 1024;
type Input = Record<string, any>;
interface ContentDefinition {
  name: string; kind: 'query' | 'action'; description: string; schema: z.ZodType;
  permission: 'read' | 'write'; projectRequired: false; scope: 'account';
  execute(input: Input, projectId: string | null): unknown;
}
export const contentOperationDefinitions: ContentDefinition[] = [];
function define(name: string, kind: ContentDefinition['kind'], schema: z.ZodType, description: string, execute: (input: Input) => unknown) {
  contentOperationDefinitions.push({ name, kind, schema, description, permission: kind === 'query' ? 'read' : 'write', projectRequired: false, scope: 'account', execute(input, projectId) {
    if (projectId !== null) throw new Error('account_scope');
    return execute(input);
  } });
}
interface Envelope { state: Input; version: number; [key: string]: unknown }
function envelope(key: typeof CONTENT_DOCUMENT_KEYS[number], version: number, initial: Input): Envelope {
  const raw = readPreference(key);
  if (raw === null) return { state: initial, version };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    const value = parsed as Envelope;
    if (!Number.isInteger(value.version) || value.version < 0 || value.version > version || !value.state || typeof value.state !== 'object' || Array.isArray(value.state)) throw new Error();
    return value;
  } catch { throw new Error(key === 'dynamic_diary-chat' ? 'conversation_invalid' : 'knowledge_invalid'); }
}
function save(key: typeof CONTENT_DOCUMENT_KEYS[number], value: Envelope) {
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > DOCUMENT_BYTE_LIMIT || serialized.includes('\0')) throw new Error('content_budget');
  writePreference(key, serialized);
}
const sessionSchema = z.object({
  sessionId: id, messages: z.array(z.object({ id: z.string().min(1), role: z.enum(['user', 'assistant']), text: z.string(), createdAt: z.number().finite().nonnegative() }).passthrough()),
  modelHistory: z.array(z.unknown()), pendingHistory: z.array(z.unknown()).nullable().optional(),
}).passthrough();
type Session = z.infer<typeof sessionSchema> & { id?: string; title?: string; createdAt?: number; updatedAt?: number; archivedAt?: number | null; deletedAt?: number | null; compaction?: unknown; contextUsage?: unknown; contextObservation?: unknown };
function normalize(value: unknown): Session {
  const parsed = sessionSchema.safeParse(value);
  if (!parsed.success) throw new Error('conversation_invalid');
  const state = parsed.data as Session;
  // Match the UI session projection: global history/preferences never become
  // content inside an inactive session, including copies of deleted records.
  return normalizeChatSession({ sessionId: state.sessionId, messages: state.messages, modelHistory: state.modelHistory,
    ...(typeof state.title === 'string' ? { title: state.title } : {}), createdAt: state.createdAt, updatedAt: state.updatedAt, archivedAt: state.archivedAt, deletedAt: state.deletedAt,
    compaction: state.compaction ?? null, contextUsage: state.contextUsage ?? null, contextObservation: state.contextObservation ?? null, pendingHistory: state.pendingHistory ?? null }) as Session;
}
function emptySession(title?: string): Session {
  const sessionId = nanoid(10), now = Date.now();
  return { id: sessionId, sessionId, ...(title ? { title } : {}), createdAt: now, updatedAt: now, archivedAt: null, deletedAt: null,
    messages: [], modelHistory: [], pendingHistory: null, compaction: null, contextUsage: null, contextObservation: null };
}
function chat() {
  const value = envelope('dynamic_diary-chat', 1, { archivedSessions: [], rateLimits: {} });
  const state = value.state;
  if (state.archivedSessions !== undefined && !Array.isArray(state.archivedSessions)) throw new Error('conversation_invalid');
  const inactive = normalizeInactiveSessions((state.archivedSessions ?? []).map(normalize)) as Session[];
  const current = state.sessionId !== undefined ? normalize(state) : null;
  // A deletion receipt always wins, including an old active copy of the same ID.
  const deletedActive = inactive.some(item => item.sessionId === current?.sessionId && item.deletedAt != null);
  const active = current && !deletedActive && current.deletedAt == null ? current : null;
  const archivedSessions = normalizeInactiveSessions([...inactive, ...(current?.deletedAt != null ? [current] : [])], active?.sessionId) as Session[];
  return { envelope: value, state, active, archivedSessions };
}
type Chat = ReturnType<typeof chat>;
const keep = (value: Session) => value.messages.length > 0 || !!value.title || value.archivedAt != null || value.deletedAt != null;
function sessions(value: Chat) { return [...(value.active ? [value.active] : []), ...value.archivedSessions]; }
function target(value: Chat, sessionId: string) {
  const result = sessions(value).find(item => item.sessionId === sessionId);
  if (!result) throw new Error('conversation_missing');
  if (result.deletedAt != null) throw new Error('conversation_deleted');
  return result;
}
function mutable(value: Chat, selected?: Session) {
  if (value.active?.pendingHistory != null || selected?.pendingHistory != null) throw new Error('conversation_busy');
}
function writeChat(value: Chat, active: Session, archivedSessions: Session[]) {
  // Strip the previous session fields before replacement; unrelated persisted preferences survive.
  const { sessionId: _sessionId, id: _id, title: _title, createdAt: _createdAt, updatedAt: _updatedAt, archivedAt: _archivedAt, deletedAt: _deletedAt,
    messages: _messages, modelHistory: _modelHistory, pendingHistory: _pendingHistory, compaction: _compaction, contextUsage: _contextUsage, contextObservation: _contextObservation, ...preferences } = value.state;
  save('dynamic_diary-chat', { ...value.envelope, state: { ...preferences, ...active, archivedSessions: normalizeInactiveSessions(archivedSessions, active.sessionId), rateLimits: value.state.rateLimits ?? {} } });
}
function updateSession(value: Chat, selected: Session, next: Session) {
  writeChat(value, value.active?.sessionId === selected.sessionId ? next : value.active ?? emptySession(), value.archivedSessions.map(item => item.sessionId === selected.sessionId ? next : item));
}
function page<T>(items: T[], input: Input) {
  const offset = input.offset ?? 0, values = items.slice(offset, offset + (input.limit ?? 50));
  return { items: values, total: items.length, offset, nextOffset: offset + values.length < items.length ? offset + values.length : null };
}

define('conversations', 'query', pageInput.extend({ status: z.enum(['active', 'archived', 'deleted', 'all']).optional() }), 'List account conversation metadata with pagination. Full content requires conversation; project credentials cannot access this collection.', input => {
  const value = chat(), status = input.status ?? 'active';
  const items = sessions(value).filter(item => {
    if (status === 'all') return true;
    if (status === 'deleted') return item.deletedAt != null;
    return item.deletedAt == null && (status === 'archived' ? item.archivedAt != null : item.archivedAt == null);
  })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).map(item => ({ id: item.sessionId, title: conversationTitle(item, 'Conversation'), createdAt: item.createdAt, updatedAt: item.updatedAt, archivedAt: item.archivedAt, deletedAt: item.deletedAt, messageCount: item.messages.length, isActive: value.active?.sessionId === item.sessionId }));
  return page(items, input);
});
define('conversation', 'query', recordTarget, 'Read account conversation transcript, reference snapshots and stored history without running any model.', input => target(chat(), input.id));
function contextProject(value: string | null | undefined) {
  if (value !== undefined && value !== null && !Object.hasOwn(useWorkspaceStore.getState().projects, value)) throw new Error('projectMissing');
  return value ?? null;
}
define('conversation.references', 'query', pageInput.extend({ query: z.string().max(240).optional(), referenceProjectId: id.nullable().optional() }), 'List current reference identities/fingerprints from the same source picker as the UI, without source bodies. Requires account-wide access.', input => page(listChatReferences(input.query ?? '', contextProject(input.referenceProjectId)), input));
define('conversation.new', 'action', z.object({ title: z.string().trim().min(1).max(160).optional() }).strict(), 'Create a new active conversation, preserving the previous nonempty session with its stable identity.', input => {
  const value = chat(); mutable(value);
  const next = emptySession(input.title);
  writeChat(value, next, [...value.archivedSessions, ...(value.active && keep(value.active) ? [value.active] : [])]);
  return { id: next.sessionId };
});
define('conversation.rename', 'action', z.object({ id, title: z.string().trim().min(1).max(1000) }).strict(), 'Rename an existing account conversation using the UI whitespace and title limit.', input => {
  const value = chat(), selected = target(value, input.id); mutable(value, selected);
  const title = input.title.trim().replace(/\s+/g, ' ').slice(0, 160);
  updateSession(value, selected, { ...selected, title, updatedAt: Date.now() });
  return { id: selected.sessionId, title };
});
define('conversation.archive', 'action', recordTarget, 'Archive a conversation. Archiving the active session opens a fresh empty one, as in the UI.', input => {
  const value = chat(), selected = target(value, input.id); mutable(value, selected);
  const now = Date.now(), next = { ...selected, archivedAt: now, updatedAt: now };
  if (value.active?.sessionId === selected.sessionId) writeChat(value, emptySession(), [...value.archivedSessions, next]);
  else updateSession(value, selected, next);
  return { id: selected.sessionId, archivedAt: now };
});
define('conversation.restore', 'action', recordTarget, 'Restore an archived conversation without changing the active editor.', input => {
  const value = chat(), selected = target(value, input.id); mutable(value, selected);
  updateSession(value, selected, { ...selected, archivedAt: null, updatedAt: Date.now() });
  return { id: selected.sessionId, archivedAt: null };
});
define('conversation.delete', 'action', recordTarget, 'Delete all content-bearing conversation fields and retain a tombstone so stale devices cannot revive them.', input => {
  const value = chat(), selected = target(value, input.id); mutable(value, selected);
  const deleted = tombstoneConversation(selected, Date.now()) as Session;
  writeChat(value, value.active?.sessionId === selected.sessionId ? emptySession() : value.active ?? emptySession(), [...value.archivedSessions.filter(item => item.sessionId !== selected.sessionId), deleted]);
  return { id: selected.sessionId, deleted: true };
});
const referenceInput = z.object({ id: z.string().min(1).max(180), kind: z.enum(['node', 'note', 'image', 'file', 'project', 'board', 'diagram', 'model']), projectId: id.nullable(),
  planId: z.string().min(1).max(180).nullable().optional(), fingerprint: z.string().min(1).max(100),
  noteSelection: z.object({ blockId: id, start: z.number().int().min(0), end: z.number().int().min(1), original: z.string().max(100_000) }).strict().optional() }).strict();
const extractedFileInput = planFileSchema.omit({ id: true, fingerprint: true, addedAt: true }).extend({
  // Preserve the original UI fingerprint over extracted text before its 24k archive excerpt.
  text: z.string().min(1).max(4 * 1024 * 1024).refine(value => !!value.trim() && !value.includes('\0')),
  pages: z.number().int().min(1).max(100).optional(),
}).refine(value => value.kind !== 'text' || value.size <= 1024 * 1024);
const appendInput = z.object({ id, role: z.enum(['user', 'assistant']), text: z.string().trim().max(100_000).default(''),
  references: z.array(referenceInput).max(CHAT_REFERENCE_LIMIT).optional(), files: z.array(extractedFileInput).max(PLAN_FILE_LIMIT).optional(), referenceProjectId: id.nullable().optional(),
}).strict().refine(value => value.role === 'user' || !(value.references?.length || value.files?.length || value.referenceProjectId))
  .refine(value => !!value.text || value.role === 'user' && !!(value.references?.length || value.files?.length));
define('conversation.message.append', 'action', appendInput, 'Append externally supplied user/assistant text with aligned history. User messages may include current server-resolved references and externally extracted files; all IDs/times and attachment fingerprints are server-derived. No model or tool is invoked.', input => {
  const value = chat(), selected = target(value, input.id); mutable(value, selected);
  if (selected.archivedAt != null) throw new Error('conversation_archived');
  const projectId = contextProject(input.referenceProjectId);
  const references = resolveChatReferences((input.references ?? []).map((reference: z.infer<typeof referenceInput>) => {
    const current = resolveChatReferenceTarget(reference);
    // Use current server metadata while retaining the caller's expected revision.
    return { ...current, fingerprint: reference.fingerprint } as ChatReferenceTarget;
  }), projectId);
  let files = mergePlanFiles([], (input.files ?? []).map((file: z.infer<typeof extractedFileInput>) => planFileSchema.parse({ ...file, id: nanoid(12), addedAt: Date.now(), fingerprint: sourceFingerprint(file.text), text: file.text.slice(0, 24_000), truncated: file.truncated || file.text.length > 24_000 })));
  if (files.length && projectId) { const saved = addProjectFiles(projectId, files); files = files.map(file => saved.find(item => item.fingerprint === file.fingerprint)!); }
  const message = { id: nanoid(10), role: input.role, text: chatSubmissionText(input.text, !!files.length, !!references.length, currentLocale() === 'en'), createdAt: Date.now(), ...(references.length ? { references } : {}), ...(files.length ? { files } : {}), ...(references.length || files.length ? { referenceProjectId: projectId } : {}) };
  const content = chatReferenceHistoryContent(message.text, projectId, references) + chatFileHistorySuffix(projectId, planFilesContext(files));
  const next = { ...selected, messages: [...selected.messages, message], modelHistory: [...selected.modelHistory, { role: message.role, content }], updatedAt: message.createdAt, pendingHistory: null, contextUsage: null, contextObservation: null };
  updateSession(value, selected, next);
  return { id: selected.sessionId, message };
});

const summarySchema = KBSummarySchema.extend({ titulo: z.string().trim().min(1).max(512), autores: z.string().max(1000).nullable(), dominio: z.string().trim().min(1).max(240),
  tags: z.array(z.string().max(160)).max(15), resumo: z.array(z.string().max(2000)).min(1).max(6),
  fatos: z.array(KBFatoSchema.extend({ claim: z.string().max(2000), valor: z.string().max(1000).nullable() }).strict()).max(10) }).strict();
const knowledgeInput = z.object({ filename: z.string().trim().min(1).max(512).refine(value => !/[\0\r\n]/.test(value)), sizeBytes: z.number().int().min(0).max(8 * 1024 * 1024), pageCount: z.number().int().min(1).max(100),
  extractedText: z.string().min(1).max(MAX_CHARS).refine(value => !!value.trim() && !value.includes('\0')), summary: summarySchema }).strict();
function knowledge() {
  const value = envelope('cellproject-kb', 2, { docs: {}, pickCache: {}, usage: {} });
  const state = value.state;
  if (!state.docs || typeof state.docs !== 'object' || Array.isArray(state.docs) || Object.values(state.docs).some(item => !item || typeof item !== 'object' || typeof (item as KBDocument).id !== 'string' || typeof (item as KBDocument).extractedText !== 'string' || typeof (item as KBDocument).fingerprint !== 'string')) throw new Error('knowledge_invalid');
  if (state.usage !== undefined && (!state.usage || typeof state.usage !== 'object' || Array.isArray(state.usage))) throw new Error('knowledge_invalid');
  return { envelope: value, state, docs: state.docs as Record<string, KBDocument> };
}
define('knowledge', 'query', pageInput, 'Read the account knowledge library including stored full extracted text and summaries. No relevance judge or model is called.', input => page(Object.values(knowledge().docs).sort((a, b) => b.extractedAt - a.extractedAt), input));
define('knowledge.add', 'action', knowledgeInput, 'Add externally extracted text and a supplied structured summary using the shared UI 40,000 character reading limit and fingerprint deduplication. No PDF extraction or internal summarization.', input => {
  const value = knowledge(), fingerprint = fingerprintText(input.extractedText);
  const duplicate = Object.values(value.docs).find(doc => doc.fingerprint === fingerprint);
  if (duplicate) return { id: duplicate.id, duplicate: true };
  const raw = input.summary as z.infer<typeof summarySchema>;
  const summary = { titulo: raw.titulo, ...(raw.autores?.trim() ? { autores: raw.autores.trim() } : {}), dominio: raw.dominio, tags: raw.tags, resumo: raw.resumo,
    fatos: raw.fatos.map(fact => ({ claim: fact.claim, tipo: fact.tipo, ...(fact.valor?.trim() ? { valor: fact.valor.trim() } : {}) })), nivel: raw.nivel };
  const doc: KBDocument = { id: nanoid(10), filename: input.filename, sizeBytes: input.sizeBytes, pageCount: input.pageCount, extractedAt: Date.now(), extractedText: input.extractedText, fingerprint, summary };
  save('cellproject-kb', { ...value.envelope, version: 2, state: { ...value.state, docs: { ...value.docs, [doc.id]: doc }, pickCache: {} } });
  return { id: doc.id, duplicate: false };
});
define('knowledge.delete', 'action', recordTarget, 'Delete a knowledge document, remove its usage and invalidate relevance picks using the same persistent UI behavior.', input => {
  const value = knowledge();
  if (!Object.hasOwn(value.docs, input.id)) throw new Error('knowledge_missing');
  const { [input.id]: _doc, ...docs } = value.docs, { [input.id]: _usage, ...usage } = value.state.usage ?? {};
  save('cellproject-kb', { ...value.envelope, version: 2, state: { ...value.state, docs, usage, pickCache: {} } });
  return { id: input.id, deleted: true };
});
define('knowledge.clear', 'action', noInput, 'Clear knowledge documents, usage and relevance picks without invoking AI.', () => {
  const value = knowledge();
  save('cellproject-kb', { ...value.envelope, version: 2, state: { ...value.state, docs: {}, usage: {}, pickCache: {}, lastContext: null } });
  return { cleared: true };
});
