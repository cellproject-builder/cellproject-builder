import { forwardRef, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { useChatPresentation } from './presentation';

/** Only the launcher moves; the conversation and its draft keep the same canvas portal. */
export const CanvasChatEntry = forwardRef<HTMLButtonElement, {
  host: HTMLDivElement; maximized: boolean; hidden: boolean; working: boolean;
  label: string; text: string; title: string; open: boolean; controls?: string;
  onActivate: () => void; children: ReactNode;
}>(function CanvasChatEntry({ host, maximized, hidden, working, label, text, title, open, controls, onActivate, children }, ref) {
  const position = useChatPresentation(s => s.canvasLauncher);
  const setPosition = useChatPresentation(s => s.setCanvasLauncher);
  const setPanel = useChatPresentation(s => s.setCanvasPanel);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean; button: HTMLButtonElement } | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{ x: number; y: number; edge: boolean } | null>(null);
  const cancel = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    if (active?.moved) suppressClick.current = true;
    setPreview(null);
    if (active?.button.hasPointerCapture?.(active.id)) active.button.releasePointerCapture(active.id);
  }, []);
  useEffect(() => {
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('blur', cancel); drag.current = null; };
  }, [cancel]);
  useEffect(cancel, [hidden, maximized, host, cancel]);

  const locate = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = host.getBoundingClientRect();
    return {
      x: Math.max(48, Math.min(bounds.width - 48, event.clientX - bounds.left)),
      y: Math.max(Math.min(160, bounds.height / 2), Math.min(Math.max(bounds.height / 2, bounds.height - 64), event.clientY - bounds.top)),
      edge: event.clientX >= bounds.right - 64,
      height: bounds.height,
    };
  };
  const edge = !preview && (maximized || !!position);
  const style = {
    ...(edge ? { '--dd-entry-y': `${(position?.y ?? .65) * 100}%` } : {}),
    ...(preview ? { left: `${preview.x}px`, top: `${preview.y}px`, right: 'auto', bottom: 'auto' } : {}),
  } as CSSProperties;
  return <button ref={ref} type="button"
    className={`dd-chat-trigger is-canvas-entry ${edge ? 'is-edge-entry' : ''} ${preview ? 'is-dragging' : ''} ${working ? 'is-working' : ''} ${hidden ? 'is-hidden' : ''}`}
    data-placement={edge ? 'edge' : 'center'} data-dock-preview={preview?.edge || undefined}
    style={style} aria-label={label} aria-expanded={open} aria-controls={controls} title={title}
    onPointerDown={event => {
      if (drag.current || event.button !== 0 || event.isPrimary === false) return;
      event.stopPropagation(); suppressClick.current = false;
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, button: event.currentTarget };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 8) return;
      active.moved = true; event.preventDefault(); event.stopPropagation();
      const { x, y, edge } = locate(event); setPreview({ x, y, edge });
    }}
    onPointerUp={event => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      drag.current = null;
      if (active.moved) {
        event.preventDefault(); event.stopPropagation(); suppressClick.current = true;
        const point = locate(event);
        setPosition(point.edge ? { y: point.height > 0 ? point.y / point.height : .65 } : null);
      }
      setPreview(null);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={event => { if (drag.current?.id === event.pointerId) cancel(); }}
    onLostPointerCapture={event => { if (drag.current?.id === event.pointerId) cancel(); }}
    onClick={event => {
      event.stopPropagation();
      if (suppressClick.current && event.detail !== 0) { event.preventDefault(); suppressClick.current = false; return; }
      if (position) setPanel('right');
      onActivate();
    }}
  >{children}<span>{text}</span>{working && <i />}</button>;
});
