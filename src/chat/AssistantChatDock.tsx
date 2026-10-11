import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useChatStore } from './store';
import { useChatPresentation } from './presentation';

const ChatDockContext = createContext<{
  target: HTMLDivElement | null;
  setTarget: (target: HTMLDivElement | null) => void;
  fullTarget: HTMLDivElement | null;
  setFullTarget: (target: HTMLDivElement | null) => void;
  canvasTarget: HTMLDivElement | null;
  setCanvasTarget: (target: HTMLDivElement | null) => void;
  canvasMaximized: boolean;
  setCanvasMaximized: (maximized: boolean) => void;
} | null>(null);

export function AssistantChatDockProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [fullTarget, setFullTarget] = useState<HTMLDivElement | null>(null);
  const [canvasTarget, setCanvasTarget] = useState<HTMLDivElement | null>(null);
  const [canvasMaximized, setCanvasMaximized] = useState(false);
  const value = useMemo(() => ({ target, setTarget, fullTarget, setFullTarget, canvasTarget, setCanvasTarget, canvasMaximized, setCanvasMaximized }), [target, fullTarget, canvasTarget, canvasMaximized]);
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

/** Outside the transformed node layer: anchored to the visible canvas, never a graph node. */
export function CanvasChatDock({ maximized = false }: { maximized?: boolean }) {
  const dock = useContext(ChatDockContext);
  const host = useRef<HTMLDivElement | null>(null);
  const setCanvasTarget = dock?.setCanvasTarget;
  const setCanvasMaximized = dock?.setCanvasMaximized;
  useEffect(() => { setCanvasMaximized?.(maximized); return () => setCanvasMaximized?.(false); }, [maximized, setCanvasMaximized]);
  const registerTarget = useCallback((target: HTMLDivElement | null) => { host.current = target; setCanvasTarget?.(target); }, [setCanvasTarget]);
  const [viewport, setViewport] = useState({ inset: 0, height: 0 });
  useEffect(() => {
    const visual = window.visualViewport, parent = host.current?.parentElement;
    const measure = () => {
      const inset = Math.max(0, window.innerHeight - (visual?.height ?? window.innerHeight) - (visual?.offsetTop ?? 0));
      const height = Math.max(180, Math.min(parent?.clientHeight || window.innerHeight, (visual?.height ?? window.innerHeight) - 80));
      setViewport(current => current.inset === inset && current.height === height ? current : { inset, height });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (parent) observer?.observe(parent);
    window.addEventListener('resize', measure); visual?.addEventListener('resize', measure); visual?.addEventListener('scroll', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); visual?.removeEventListener('resize', measure); visual?.removeEventListener('scroll', measure); };
  }, []);
  const style = { '--dd-chat-keyboard-inset': `${viewport.inset}px`, '--dd-chat-available-height': `${viewport.height || 600}px` } as CSSProperties;
  return <div ref={registerTarget} className="dd-chat-canvas-host" data-keyboard-open={viewport.inset > 100 || undefined} style={style} />;
}
export function useCanvasChatDockTarget() { return useContext(ChatDockContext)?.canvasTarget ?? null; }
export function useCanvasChatMaximized() { return useContext(ChatDockContext)?.canvasMaximized ?? false; }
