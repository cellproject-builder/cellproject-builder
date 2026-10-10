import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useChatStore } from './store';

const ChatDockContext = createContext<{
  target: HTMLDivElement | null;
  setTarget: (target: HTMLDivElement | null) => void;
} | null>(null);

export function AssistantChatDockProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ target, setTarget }), [target]);
  return <ChatDockContext.Provider value={value}>{children}</ChatDockContext.Provider>;
}

export function PlannerChatDock() {
  const dock = useContext(ChatDockContext);
  const open = useChatStore((s) => s.open);
  return <div ref={dock?.setTarget} className={`dd-chat-dock ${open ? 'is-open' : ''}`} />;
}

export function useChatDockTarget() { return useContext(ChatDockContext)?.target ?? null; }
