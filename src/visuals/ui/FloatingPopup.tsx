import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { useVisualStrings } from './strings';

type Frame = { x: number; y: number; width: number; height: number };
type Edge = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const edges: Edge[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function fit(frame: Frame): Frame {
  const width = clamp(frame.width, Math.min(320, window.innerWidth - 16), window.innerWidth - 16);
  const height = clamp(frame.height, Math.min(240, window.innerHeight - 16), window.innerHeight - 16);
  return { width, height, x: clamp(frame.x, 8, window.innerWidth - width - 8), y: clamp(frame.y, 8, window.innerHeight - height - 8) };
}
function resized(frame: Frame, edge: Edge, dx: number, dy: number): Frame {
  const minWidth = Math.min(320, window.innerWidth - 16), minHeight = Math.min(240, window.innerHeight - 16);
  let { x: left, y: top } = frame, right = left + frame.width, bottom = top + frame.height;
  if (edge.includes('w')) left = clamp(left + dx, 8, right - minWidth);
  if (edge.includes('e')) right = clamp(right + dx, left + minWidth, window.innerWidth - 8);
  if (edge.includes('n')) top = clamp(top + dy, 8, bottom - minHeight);
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + minHeight, window.innerHeight - 8);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function FloatingPopup({ kind, children, onClose, onMinimize, minimized = false }: {
  kind: 'search' | 'model'; children: ReactNode; onClose: () => void; onMinimize: () => void; minimized?: boolean;
}) {
  const s = useVisualStrings();
  const title = kind === 'search' ? s.imageTitle : s.modelTitle;
  const panel = useRef<HTMLElement>(null);
  const [frame, setFrame] = useState(() => fit({ x: kind === 'search' ? 20 : window.innerWidth - 444, y: kind === 'search' ? 110 : 150, width: kind === 'search' ? 460 : 420, height: kind === 'search' ? 520 : 620 }));
  const [front, setFront] = useState(false);
  const gesture = useRef<{ id: number; x: number; y: number; frame: Frame; edge?: Edge } | null>(null);
  useEffect(() => {
    const resize = () => setFrame(current => fit(current)); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  function start(event: PointerEvent<HTMLElement>, edge?: Edge) {
    if (event.button !== 0 || (!edge && (event.target as HTMLElement).closest('button,a,input'))) return;
    panel.current?.focus({ preventScroll: true }); setFront(true);
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, frame, edge };
    event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault(); event.stopPropagation();
  }
  function move(event: PointerEvent<HTMLElement>) {
    const state = gesture.current; if (state?.id !== event.pointerId) return;
    const dx = event.clientX - state.x, dy = event.clientY - state.y;
    setFrame(state.edge ? resized(state.frame, state.edge, dx, dy) : fit({ ...state.frame, x: state.frame.x + dx, y: state.frame.y + dy }));
  }
  function end(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <section ref={panel} tabIndex={-1} hidden={minimized} className={`visual-popup visual-popup-${kind} liquid-glass nodrag nopan nowheel`} data-visual-popup={kind} role="dialog" aria-modal="false"
    aria-label={title} style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, zIndex: front ? 73 : kind === 'search' ? 71 : 72 }}
    onFocusCapture={() => setFront(true)} onPointerDown={() => setFront(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFront(false); }}
    onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); onClose(); } }}
    onDragOver={(e) => { e.stopPropagation(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}>
    <header className="visual-popup-header" onPointerDown={event => start(event)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <span className="visual-popup-emblem" aria-hidden="true">{kind === 'search' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg>}</span>
      <div className="visual-popup-heading"><h2>{title}</h2><p>{kind === 'search' ? s.imageSubtitle : s.modelSubtitle}</p></div>
      <span className="visual-header-grip" aria-hidden="true">⠿</span>
      <button type="button" className="visual-icon-button" onClick={onMinimize} aria-label={kind === 'search' ? s.minimizeSearch : s.minimizeModel} title={kind === 'search' ? s.minimizeSearch : s.minimizeModel}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 11h10" /></svg></button>
      <button type="button" className="visual-icon-button visual-close" onClick={onClose} aria-label={kind === 'search' ? s.closeSearch : s.closeModel}>×</button>
    </header>
    <div className="visual-popup-body">{children}</div>
    {edges.map(edge => <span key={edge} data-resize={edge} className={`visual-popup-resize visual-popup-resize-${edge}`}
      role={edge === 'se' ? 'button' : undefined} tabIndex={edge === 'se' ? 0 : undefined} aria-hidden={edge !== 'se' || undefined}
      aria-label={edge === 'se' ? `${s.resizePopup}: ${title}` : undefined} title={s.resizeHint}
      onPointerDown={event => start(event, edge)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onKeyDown={event => {
        if (!event.key.startsWith('Arrow')) return;
        const step = event.shiftKey ? 40 : 10;
        const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
        const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
        event.preventDefault(); event.stopPropagation(); setFrame(current => resized(current, edge, dx, dy));
      }} />)}
  </section>;
}
