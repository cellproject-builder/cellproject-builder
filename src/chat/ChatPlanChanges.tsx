import { useState } from 'react';
import { z } from 'zod';
import { useGraphStore } from '@/store';
import { flushWorkspacePersistence, useWorkspaceStore } from '@/workspace/store';
import { canUndoPlanStructure, undoPlanStructure } from '@/ai/planStructure';
import { markChatStructureUndone, flushChatPersistence, useChatStore, type ChatSession } from './store';
const schema = z.object({ projectId: z.string(), undoId: z.string(), undone: z.boolean().optional(), reason: z.string(), changes: z.array(z.object({ kind: z.enum(['add', 'update', 'move']), nodeId: z.string(), name: z.string() })) });
const resultSchema = z.union([schema, z.object({ applied: z.literal(true), saved: z.boolean(), result: schema })]);

function markSaved(undoId: string) {
  // Portal destinations remount receipts, so a confirmed save belongs to the transcript.
  const savedSession = <T extends ChatSession>(session: T): T => ({ ...session, messages: session.messages.map(message => ({ ...message, actions: message.actions?.map(action => {
    if (action.name !== 'planner_structure') return action;
    const parsed = resultSchema.safeParse(action.result);
    if (!parsed.success || !('result' in parsed.data) || parsed.data.result.undoId !== undoId) return action;
    return { ...action, status: 'done' as const, detail: undefined, result: { ...parsed.data, saved: true } };
  }) })) });
  useChatStore.setState(state => ({ messages: savedSession(state).messages, archivedSessions: state.archivedSessions.map(savedSession) }));
}
export function ChatPlanChanges({ result, english, disabled }: { result: unknown; english: boolean; disabled: boolean }) {
  useGraphStore(s => s.project); useWorkspaceStore(s => s.projects);
  const [undone, setUndone] = useState(false), [error, setError] = useState('');
  const [saved, setSaved] = useState(false), [saving, setSaving] = useState(false);
  const parsed = resultSchema.safeParse(result); if (!parsed.success) return null;
  const data = 'result' in parsed.data ? parsed.data.result : parsed.data;
  const unsaved = 'result' in parsed.data && !parsed.data.saved && !saved;
  const isUndone = undone || data.undone;
  let available = false; try { available = canUndoPlanStructure(data.projectId, data.undoId); } catch { /* Removed project */ }
  const undo = async () => {
    try { undoPlanStructure(data.projectId, data.undoId); setUndone(true); markChatStructureUndone(data.undoId); await Promise.all([flushWorkspacePersistence(), flushChatPersistence()]); markSaved(data.undoId); setSaved(true); await flushChatPersistence(); }
    catch { setError(english ? 'Could not undo or save. Check the current plan before repeating.' : 'Não consegui desfazer ou salvar. Confira o plano atual antes de repetir.'); }
  };
  const retrySave = async () => {
    setSaving(true); setError('');
    try { useWorkspaceStore.setState({}); await flushWorkspacePersistence(); markSaved(data.undoId); setSaved(true); await flushChatPersistence(); }
    catch { setError(english ? 'Saving still failed. Keep this session open and try again.' : 'A gravação ainda falhou. Mantenha esta sessão aberta e tente novamente.'); }
    finally { setSaving(false); }
  };
  const labels = { add: english ? 'Added' : 'Adicionado', update: english ? 'Revised' : 'Revisado', move: english ? 'Moved' : 'Reorganizado' };
  return <div className="dd-chat-plan-changes"><strong>{english ? 'Changes to the plan' : 'Alterações no plano'}</strong><p>{data.reason}</p><ul>{data.changes.map((change, i) => <li key={`${change.nodeId}:${i}`}>{labels[change.kind]} · {change.name}</li>)}</ul>
    {unsaved && <p role="status">{english ? 'Applied, but saving failed during this action.' : 'Aplicado, mas a gravação falhou durante esta ação.'} <button className="ws-button" disabled={disabled || saving} onClick={() => void retrySave()}>{english ? 'Retry saving' : 'Tentar salvar novamente'}</button></p>}
    <button className="ws-button" disabled={disabled || saving || isUndone || !available} onClick={() => void undo()} title={!available && !isUndone ? (english ? 'Undo expires after subsequent edits or reload.' : 'Desfazer fica indisponível após novas edições ou recarregar.') : undefined}>{isUndone ? (english ? 'Undone' : 'Desfeito') : (english ? 'Undo structure changes' : 'Desfazer estrutura')}</button>{error && <p role="alert">{error}</p>}</div>;
}
