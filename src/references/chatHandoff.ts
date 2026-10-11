import { create } from 'zustand';
import type { ChatReferenceHandoffTarget } from '@/chat/references';
import { useChatStore } from '@/chat/store';

interface ChatReferenceHandoff { id: number; sessionId: string; projectId: string | null; references: ChatReferenceHandoffTarget[]; composerText?: string }
export const useChatReferenceHandoff = create<{ pending: ChatReferenceHandoff | null }>(() => ({ pending: null }));
let sequence = 0;
/** Explicit UI handoff: opens the composer, never sends a request or swaps the planner. */
export function requestChatReferences(projectId: string | null, references: ChatReferenceHandoffTarget[], composerText?: string): void {
  if (!references.length) return;
  if (references.length > 20) throw new Error('chatReferenceLimit');
  useChatReferenceHandoff.setState({ pending: { id: ++sequence, sessionId: useChatStore.getState().sessionId, projectId, references: references.map(target => ({ ...target, ...(target.noteSelection ? { noteSelection: { ...target.noteSelection } } : {}) })), ...(composerText ? { composerText } : {}) } });
  useChatStore.getState().setOpen(true);
}
export function consumeChatReferenceHandoff(id: number) {
  const pending = useChatReferenceHandoff.getState().pending;
  if (pending?.id !== id) return null;
  useChatReferenceHandoff.setState({ pending: null });
  return pending;
}
