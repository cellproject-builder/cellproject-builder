import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { useVisualStrings } from './strings';

export type PopupFrame = { x: number; y: number; width: number; height: number };
type PopupViewport = { x: number; y: number; width: number; height: number };
type Edge = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const edges: Edge[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function layoutViewport(): PopupViewport {
  return { x:0, y:0, width:window.innerWidth, height:window.innerHeight };
}
function visibleViewport(): PopupViewport {
  const viewport = window.visualViewport;
  return viewport ? { x:viewport.offsetLeft, y:viewport.offsetTop, width:viewport.width, height:viewport.height } : layoutViewport();
}
function fit(frame: PopupFrame, viewport = layoutViewport()): PopupFrame {
  const maxWidth = Math.max(1, viewport.width - 16), maxHeight = Math.max(1, viewport.height - 16);
  const width = clamp(frame.width, Math.min(320, maxWidth), maxWidth);
  const height = clamp(frame.height, Math.min(240, maxHeight), maxHeight);
  return { width, height, x: clamp(frame.x, viewport.x + 8, viewport.x + viewport.width - width - 8), y: clamp(frame.y, viewport.y + 8, viewport.y + viewport.height - height - 8) };
}
function resized(frame: PopupFrame, edge: Edge, dx: number, dy: number, viewport = layoutViewport()): PopupFrame {
  const minWidth = Math.min(320, Math.max(1, viewport.width - 16)), minHeight = Math.min(240, Math.max(1, viewport.height - 16));
  let { x: left, y: top } = frame, right = left + frame.width, bottom = top + frame.height;
  if (edge.includes('w')) left = clamp(left + dx, viewport.x + 8, right - minWidth);
  if (edge.includes('e')) right = clamp(right + dx, left + minWidth, viewport.x + viewport.width - 8);
  if (edge.includes('n')) top = clamp(top + dy, viewport.y + 8, bottom - minHeight);
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + minHeight, viewport.y + viewport.height - 8);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function FloatingPopup({ kind, children, onClose, onMinimize, minimized = false, title: customTitle, subtitle, frame: ownedFrame, onFrameChange, zIndex, onFocus, tabs, windowId, tabId, actionLabels }: {
  kind: 'search' | 'model'; children: ReactNode; onClose: () => void; onMinimize: () => void; minimized?: boolean; title?: string; subtitle?: string;
  frame?: PopupFrame; onFrameChange?: (frame: PopupFrame) => void; zIndex?: number; onFocus?: () => void; tabs?: ReactNode; windowId?: string; tabId?: string;
  actionLabels?: { minimize: string; close: string };
}) {
  const s = useVisualStrings();
  const title = customTitle ?? (kind === 'search' ? s.imageTitle : s.modelTitle);
  const panel = useRef<HTMLElement>(null);
  const [localFrame, setLocalFrame] = useState(() => fit({ x: kind === 'search' ? 20 : window.innerWidth - 444, y: kind === 'search' ? 110 : 150, width: kind === 'search' ? 460 : 420, height: kind === 'search' ? 520 : 620 }));
  const [viewport, setViewport] = useState(visibleViewport);
  // The keyboard only changes presentation. Keep the user's preferred frame
  // so dismissing it restores the window and never persists a temporary size.
  const preferredFrame = fit(ownedFrame ?? localFrame);
  const frame = fit(preferredFrame, viewport);
  const state = useRef({ frame:preferredFrame, ownedFrame, onFrameChange }); state.current = { frame:preferredFrame, ownedFrame, onFrameChange };
  function changeFrame(next: PopupFrame) {
    const bounded = fit(next);
    if (!state.current.ownedFrame) setLocalFrame(bounded);
    state.current.onFrameChange?.(bounded);
  }
  const [front, setFront] = useState(false);
  const gesture = useRef<{ id: number; x: number; y: number; frame: PopupFrame; preferred:PopupFrame; edge?: Edge } | null>(null);
  useEffect(() => {
    const visibleResize = () => setViewport(visibleViewport());
    const resize = () => {
      const current = state.current.ownedFrame ?? state.current.frame, next = fit(current);
      if (next.x !== current.x || next.y !== current.y || next.width !== current.width || next.height !== current.height) changeFrame(next);
      visibleResize();
    };
    resize(); window.addEventListener('resize', resize);
    const visual = window.visualViewport;
    visual?.addEventListener('resize', visibleResize);
    visual?.addEventListener('scroll', visibleResize);
    return () => {
      window.removeEventListener('resize', resize);
      visual?.removeEventListener('resize', visibleResize);
      visual?.removeEventListener('scroll', visibleResize);
    };
  }, []);
  useEffect(() => {
    if (ownedFrame && (ownedFrame.x !== preferredFrame.x || ownedFrame.y !== preferredFrame.y || ownedFrame.width !== preferredFrame.width || ownedFrame.height !== preferredFrame.height)) onFrameChange?.(preferredFrame);
  }, [ownedFrame?.x, ownedFrame?.y, ownedFrame?.width, ownedFrame?.height]);
  function start(event: PointerEvent<HTMLElement>, edge?: Edge) {
    if (event.button !== 0 || (!edge && (event.target as HTMLElement).closest('button,a,input,select,textarea,[role="tab"],[data-no-window-drag]'))) return;
    panel.current?.focus({ preventScroll: true }); setFront(true);
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, frame, preferred:preferredFrame, edge };
    event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault(); event.stopPropagation();
  }
  function move(event: PointerEvent<HTMLElement>) {
    const state = gesture.current; if (state?.id !== event.pointerId) return;
    const dx = event.clientX - state.x, dy = event.clientY - state.y;
    changeFrame(state.edge ? resized(state.frame, state.edge, dx, dy, viewport) : { ...state.preferred, x: state.frame.x + dx, y: state.frame.y + dy });
  }
  function end(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <section ref={panel} tabIndex={-1} hidden={minimized} className={`visual-popup visual-popup-${kind}${tabs ? ' has-tabs' : ''} liquid-glass nodrag nopan nowheel`} data-visual-popup={kind} data-visual-window={windowId} data-visual-tab={tabId} role="dialog" aria-modal="false"
    aria-label={title} style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, zIndex: zIndex ?? (front ? 73 : kind === 'search' ? 71 : 72) }}
    onFocusCapture={() => { setFront(true); onFocus?.(); }} onPointerDown={() => { setFront(true); onFocus?.(); }} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFront(false); }}
    onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); onClose(); } }}
    onDragOver={(e) => { e.stopPropagation(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}>
    <header className="visual-popup-header" onPointerDown={event => start(event)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <span className="visual-popup-emblem" aria-hidden="true">{kind === 'search' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg>}</span>
      <div className="visual-popup-heading"><h2>{title}</h2><p>{subtitle ?? (kind === 'search' ? s.imageSubtitle : s.modelSubtitle)}</p></div>
      <span className="visual-header-grip" aria-hidden="true">⠿</span>
      <button type="button" className="visual-icon-button" onClick={onMinimize} aria-label={actionLabels?.minimize ?? (kind === 'search' ? s.minimizeSearch : s.minimizeModel)} title={actionLabels?.minimize ?? (kind === 'search' ? s.minimizeSearch : s.minimizeModel)}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 11h10" /></svg></button>
      <button type="button" className="visual-icon-button visual-close" onClick={onClose} aria-label={actionLabels?.close ?? (kind === 'search' ? s.closeSearch : s.closeModel)}>×</button>
    </header>
    {tabs}
    <div className="visual-popup-body" id={tabId ? `visual-panel-${tabId}` : undefined} role={tabId ? 'tabpanel' : undefined} aria-labelledby={tabId ? `visual-tab-${tabId}` : undefined}>{children}</div>
    {edges.map(edge => <span key={edge} data-resize={edge} className={`visual-popup-resize visual-popup-resize-${edge}`}
      role={edge === 'se' ? 'button' : undefined} tabIndex={edge === 'se' ? 0 : undefined} aria-hidden={edge !== 'se' || undefined}
      aria-label={edge === 'se' ? `${s.resizePopup}: ${title}` : undefined} title={s.resizeHint}
      onPointerDown={event => start(event, edge)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={event => {
        if (!event.key.startsWith('Arrow')) return;
        const step = event.shiftKey ? 40 : 10;
        const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
        const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
        event.preventDefault(); event.stopPropagation(); changeFrame(resized(frame, edge, dx, dy, viewport));
      }} />)}
  </section>;
}
