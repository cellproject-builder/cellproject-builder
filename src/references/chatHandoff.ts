import { create } from 'zustand';
import type { MentionTarget } from '@/visuals/types';
import { useChatStore } from '@/chat/store';

interface ChatReferenceHandoff { id: number; projectId: string | null; references: MentionTarget[] }
export const useChatReferenceHandoff = create<{ pending: ChatReferenceHandoff | null }>(() => ({ pending: null }));
let sequence = 0;
/** Explicit UI handoff: opens the composer, never sends a request or swaps the planner. */
export function requestChatReferences(projectId: string | null, references: MentionTarget[]): void {
  if (!references.length) return;
  if (references.length > 20) throw new Error('chatReferenceLimit');
  useChatReferenceHandoff.setState({ pending: { id: ++sequence, projectId, references: references.map(target => ({ ...target })) } });
  useChatStore.getState().setOpen(true);
}
export function consumeChatReferenceHandoff(id: number) {
  if (useChatReferenceHandoff.getState().pending?.id === id) useChatReferenceHandoff.setState({ pending: null });
}
