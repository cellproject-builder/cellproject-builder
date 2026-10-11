import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftIcon, PenIcon } from '@/components/ui/SoftIcons';
import { InkPaletteOverlayContext, type InkPaletteDock } from './InkPaletteOverlay';
import './inkPalette.css';

type Props = { label: string; children: ReactNode; preview?: ReactNode; english?: boolean; className?: string; variant?: 'panel' | 'strip'; dock?: InkPaletteDock | 'auto' };

export function InkPalette({ label, children, preview, english = false, className = '', variant = 'panel', dock = 'auto' }: Props) {
  const [pinned, setPinned] = useState(false), [hover, setHover] = useState(false), [focused, setFocused] = useState(false), [dismissed, setDismissed] = useState(false);
  const host = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), suppressFocus = useRef(false), panelId = useId();
  const pointerFocus = useRef(false);
  const [automaticDock, setAutomaticDock] = useState<InkPaletteDock>('left');
  const [overlayTarget, setOverlayTarget] = useState<HTMLDivElement | null>(null);
  const resolvedDock = dock === 'auto' ? automaticDock : dock;
  const overlay = useMemo(() => variant === 'strip' ? { target: overlayTarget, dock: resolvedDock } : null, [variant, overlayTarget, resolvedDock]);
  const open = !dismissed && (pinned || hover || focused);
  useLayoutEffect(() => {
    if (variant !== 'strip' || dock !== 'auto') return;
    const surface = host.current?.parentElement;
    if (!surface) return;
    const measure = () => {
      const bounds = surface.getBoundingClientRect();
      setAutomaticDock(bounds.width >= bounds.height ? 'left' : 'top');
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(surface);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [variant, dock]);
  const collapse = (restoreFocus = false) => {
    pointerFocus.current = false;
    setPinned(false); setHover(false); setFocused(false); setDismissed(true);
    if (restoreFocus) { suppressFocus.current = true; trigger.current?.focus(); suppressFocus.current = false; }
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) collapse(); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  return <div ref={host} data-ink-palette data-dock={variant === 'strip' ? resolvedDock : undefined} className={`ink-palette ${variant === 'strip' ? 'is-strip' : ''} ${open ? 'is-open' : ''} ${className}`} role="group" aria-label={label}
    onPointerEnter={event => { if (event.pointerType === 'pen' || event.pointerType === 'mouse') { setDismissed(false); setHover(true); } }}
    onPointerLeave={() => { pointerFocus.current = false; setHover(false); }}
    onPointerDownCapture={() => { pointerFocus.current = true; }}
    onFocusCapture={() => { if (!suppressFocus.current && !(variant === 'strip' && pointerFocus.current)) { setDismissed(false); setFocused(true); } }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }}
    onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onPointerUp={event => { pointerFocus.current = false; event.stopPropagation(); }} onPointerCancel={() => { pointerFocus.current = false; }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); collapse(true); } }}>
    <button ref={trigger} type="button" data-ink-palette-trigger className="ink-palette-trigger" aria-label={label} title={label} aria-expanded={open} aria-controls={open ? panelId : undefined} tabIndex={variant === 'strip' && open ? -1 : undefined}
      onClick={() => { if (pinned) collapse(); else { setDismissed(false); setPinned(true); } }}>{preview ?? <PenIcon width={22} height={22} />}</button>
    <InkPaletteOverlayContext.Provider value={overlay}>
    {open && <div id={panelId} data-ink-palette-controls className="ink-palette-controls">
      <div className="ink-palette-heading"><span>{label}</span><button type="button" aria-label={variant === 'strip' && !pinned ? (english ? 'Keep drawing tools open' : 'Manter ferramentas abertas') : (english ? 'Collapse drawing tools' : 'Recolher ferramentas de desenho')} title={variant === 'strip' && !pinned ? (english ? 'Keep drawing tools open' : 'Manter ferramentas abertas') : (english ? 'Collapse drawing tools' : 'Recolher ferramentas de desenho')} onClick={() => { if (variant === 'strip' && !pinned) setPinned(true); else collapse(true); }}><ArrowLeftIcon /></button></div>
      {children}
    </div>}
    {variant === 'strip' && <div ref={setOverlayTarget} className="ink-palette-overlay" />}
    </InkPaletteOverlayContext.Provider>
  </div>;
}
