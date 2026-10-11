import { create } from 'zustand';

// Expanding preserves the route, editor and the AssistantChat draft.
export const useChatPresentation = create<{
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
}>((set) => ({ expanded: false, setExpanded: (expanded) => set({ expanded }) }));
