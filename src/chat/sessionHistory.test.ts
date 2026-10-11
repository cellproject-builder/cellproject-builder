import { expect, it } from 'vitest';
import { conversationTitle, normalizeChatSession, normalizeInactiveSessions, tombstoneConversation } from './sessionHistory';

const session = (id = 'one') => ({ sessionId: id, messages: [{ id: `${id}-u`, role: 'user' as const, text: '  Planejar\n meu robô  ', createdAt: 10 }], modelHistory: [{ role: 'user' as const, content: 'Full source' }] });

it('migrates inactive legacy sessions without treating them as deliberately archived', () => {
  expect(normalizeChatSession(session())).toMatchObject({ id: 'one', sessionId: 'one', createdAt: 10, updatedAt: 10, archivedAt: null, deletedAt: null });
  expect(conversationTitle(session(), 'Nova conversa')).toBe('Planejar meu robô');
});

it('preserves explicit metadata and checkpoints in snapshots', () => {
  const value = { ...session(), title: 'Bancada', createdAt: 2, updatedAt: 30, archivedAt: 22, compaction: { summary: 'Keep' }, contextUsage: { inputTokens: 3 } };
  expect(normalizeChatSession(value)).toMatchObject(value);
  expect(conversationTitle(value, 'Nova conversa')).toBe('Bancada');
});

it('keeps one stable inactive identity and makes deletion win over duplicated stale content', () => {
  const deleted = tombstoneConversation(normalizeChatSession(session()), 40);
  const result = normalizeInactiveSessions([session(), deleted, { ...session(), updatedAt: 50 }], 'other');
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ id: 'one', deletedAt: 40, messages: [], modelHistory: [] });
  expect(JSON.stringify(result)).not.toContain('Full source');
});

it('clears every content-bearing checkpoint and title when a conversation is deleted', () => {
  const result = tombstoneConversation({ ...normalizeChatSession(session()), title: 'Private title', compaction: { summary: 'Private summary' }, contextUsage: { inputTokens: 10 }, pendingHistory: [{ role: 'user', content: 'Pending private' }] }, 99);
  expect(result).toEqual({ id: 'one', sessionId: 'one', createdAt: 10, updatedAt: 99, deletedAt: 99, archivedAt: null, messages: [], modelHistory: [], pendingHistory: null, compaction: null, contextUsage: null });
});

it('excludes the active conversation and rejects invalid session bodies instead of overwriting them', () => {
  expect(normalizeInactiveSessions([session(), session('two')], 'one').map(item => item.sessionId)).toEqual(['two']);
  expect(() => normalizeChatSession({ sessionId: 'bad', messages: 'lost', modelHistory: [] } as never)).toThrow();
});
