import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEventHandler, type ReactNode } from 'react';
import { CursorArrowIcon, PenIcon, RedoIcon, ResetIcon } from '@/components/ui/SoftIcons';
import { InkPaletteOverlayContext, type InkPaletteDock } from './InkPaletteOverlay';
import './inkPalette.css';

export interface InkPaletteProps {
  label: string;
  children: ReactNode;
  preview?: ReactNode;
  english?: boolean;
  className?: string;
  variant?: 'panel' | 'strip';
  dock?: InkPaletteDock | 'auto';
  onUndo?: () => void;
  canUndo?: boolean;
  onRedo?: () => void;
  canRedo?: boolean;
  onExit?: () => void;
  exitLabel?: string;
  disabled?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

/** History stays on the rail; tool choices mount only after explicit activation. */
export function InkPalette({ label, children, preview, english = false, className = '', variant = 'panel', dock = 'auto',
  onUndo, canUndo = false, onRedo, canRedo = false, onExit, exitLabel, disabled = false, onKeyDown }: InkPaletteProps) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panelId = useId();
  const [automaticDock, setAutomaticDock] = useState<InkPaletteDock>('left');
  const [overlayTarget, setOverlayTarget] = useState<HTMLDivElement | null>(null);
  const resolvedDock = dock === 'auto' ? automaticDock : dock;
  const overlay = useMemo(() => ({ target: overlayTarget, dock: resolvedDock }), [overlayTarget, resolvedDock]);
  useLayoutEffect(() => {
    if (dock !== 'auto') return;
    const surface = host.current?.parentElement;
    if (!surface) return;
    const measure = () => {
      const bounds = surface.getBoundingClientRect();
      const hasSideRoom = bounds.height === 0 || bounds.height >= 340;
      setAutomaticDock(bounds.width >= bounds.height && hasSideRoom ? 'left' : 'top');
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(surface);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [dock]);
  const collapse = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) collapse(); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const exit = exitLabel ?? (english ? 'Exit drawing' : 'Sair do desenho');
  return <div ref={host} data-ink-palette data-dock={resolvedDock} className={`ink-palette ${variant === 'strip' ? 'is-strip' : ''} ${open ? 'is-open' : ''} ${className}`} role="group" aria-label={label}
    onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); collapse(true); } else onKeyDown?.(event); }}>
    <InkPaletteOverlayContext.Provider value={overlay}>
      <div className="ink-palette-rail">
        <div className="ink-palette-primary" data-ink-palette-primary>
          <button ref={trigger} type="button" data-ink-palette-trigger className="ink-palette-trigger" aria-label={label}
            title={open ? (english ? 'Collapse drawing tools' : 'Recolher ferramentas de desenho') : label} disabled={disabled}
            aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => open ? collapse(true) : setOpen(true)}>{preview ?? <PenIcon size={19} />}</button>
          {onUndo && <button type="button" className="ink-palette-undo" aria-label={english ? 'Undo' : 'Desfazer'} title={english ? 'Undo' : 'Desfazer'} disabled={disabled || !canUndo} onClick={onUndo}><ResetIcon size={18} /></button>}
          {onRedo && canRedo && <button type="button" className="ink-palette-redo" aria-label={english ? 'Redo' : 'Refazer'} title={english ? 'Redo' : 'Refazer'} disabled={disabled} onClick={onRedo}><RedoIcon size={18} /></button>}
          {onExit && <button type="button" className="ink-palette-exit" aria-label={exit} title={exit} disabled={disabled} onClick={onExit}><CursorArrowIcon size={18} /></button>}
        </div>
        {open && <div id={panelId} data-ink-palette-controls className="ink-palette-controls">{children}</div>}
      </div>
      <div ref={setOverlayTarget} className="ink-palette-overlay" />
    </InkPaletteOverlayContext.Provider>
  </div>;
}
