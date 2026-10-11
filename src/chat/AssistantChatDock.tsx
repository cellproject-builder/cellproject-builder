import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useChatStore } from './store';
import { useChatPresentation } from './presentation';

const ChatDockContext = createContext<{
  target: HTMLDivElement | null;
  setTarget: (target: HTMLDivElement | null) => void;
  fullTarget: HTMLDivElement | null;
  setFullTarget: (target: HTMLDivElement | null) => void;
} | null>(null);

export function AssistantChatDockProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [fullTarget, setFullTarget] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ target, setTarget, fullTarget, setFullTarget }), [target, fullTarget]);
  return <ChatDockContext.Provider value={value}>{children}</ChatDockContext.Provider>;
}

export function PlannerChatDock() {
  const dock = useContext(ChatDockContext);
  const open = useChatStore((s) => s.open);
  const expanded = useChatPresentation(s => s.expanded);
  return <div ref={dock?.setTarget} className={`dd-chat-dock ${open && !expanded ? 'is-open' : ''}`} />;
}

export function useChatDockTarget() { return useContext(ChatDockContext)?.target ?? null; }
export function FullChatDock() {
  const dock = useContext(ChatDockContext);
  const expanded = useChatPresentation(s => s.expanded);
  return <div ref={dock?.setFullTarget} className={`dd-chat-full-host ${expanded ? 'is-open' : ''}`} />;
}
export function useFullChatDockTarget() { return useContext(ChatDockContext)?.fullTarget ?? null; }
