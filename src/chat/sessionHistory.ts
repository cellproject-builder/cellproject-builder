/** Conversation records retain their identity when they move out of the active editor. */
export interface ChatSessionMetadata {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
}
interface SessionLike {
  sessionId: string;
  messages: { role?: string; text?: string; createdAt?: number }[];
  modelHistory: unknown[];
  id?: string; title?: string; createdAt?: number; updatedAt?: number;
  archivedAt?: number | null; deletedAt?: number | null;
  compaction?: unknown; contextUsage?: unknown; contextObservation?: unknown; pendingHistory?: unknown;
}
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function conversationTitle(session: Pick<SessionLike, 'title' | 'messages'>, fallback: string): string {
  return (session.title?.trim() || session.messages.find(message => message.role === 'user')?.text?.replace(/\s+/g, ' ').trim() || fallback).slice(0, 160);
}

/** The legacy archivedSessions collection meant inactive, not explicitly archived. */
type NormalizedSession<T extends SessionLike> = T & ChatSessionMetadata | ReturnType<typeof tombstoneConversation>;
export function normalizeChatSession<T extends SessionLike>(value: T): NormalizedSession<T> {
  if (!value || typeof value !== 'object' || typeof value.sessionId !== 'string' || !value.sessionId || !Array.isArray(value.messages) || !Array.isArray(value.modelHistory)) throw new Error('Invalid conversation');
  if (value.messages.some(message => !message || typeof message !== 'object')) throw new Error('Invalid conversation messages');
  const times = value.messages.flatMap(message => timestamp(message.createdAt) ? [message.createdAt] : []);
  const createdAt = timestamp(value.createdAt) ? value.createdAt : times[0] ?? 0;
  const updatedAt = timestamp(value.updatedAt) ? value.updatedAt : times.at(-1) ?? createdAt;
  const normalized = { ...value, id: value.sessionId, createdAt, updatedAt,
    archivedAt: timestamp(value.archivedAt) ? value.archivedAt : null,
    deletedAt: timestamp(value.deletedAt) ? value.deletedAt : null,
    ...(typeof value.title === 'string' ? { title: value.title.trim().slice(0, 160) || undefined } : {}),
  };
  // Old or duplicate payloads must never turn a deletion receipt back into content.
  return normalized.deletedAt !== null ? tombstoneConversation(normalized, normalized.deletedAt) : normalized;
}

/** Deletion keeps only a small receipt so a stale device cannot revive the payload. */
export function tombstoneConversation(value: SessionLike, deletedAt: number) {
  return { id: value.sessionId, sessionId: value.sessionId, createdAt: timestamp(value.createdAt) ? value.createdAt : value.messages[0]?.createdAt ?? deletedAt,
    updatedAt: deletedAt, archivedAt: null, deletedAt, messages: [], modelHistory: [], pendingHistory: null, compaction: null, contextUsage: null };
}

export function normalizeInactiveSessions<T extends SessionLike>(values: T[], activeSessionId?: string): Array<NormalizedSession<T>> {
  if (!Array.isArray(values)) throw new Error('Invalid conversation list');
  const result = new Map<string, NormalizedSession<T>>();
  for (const value of values) {
    const next = normalizeChatSession(value), previous = result.get(next.sessionId);
    if (next.sessionId === activeSessionId) continue;
    if (!previous || next.deletedAt !== null || previous.deletedAt === null && next.updatedAt >= previous.updatedAt) result.set(next.sessionId, next);
  }
  return [...result.values()];
}
