import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftIcon, PenIcon } from '@/components/ui/SoftIcons';
import './inkPalette.css';

export function InkPalette({ label, children, preview, english = false, className = '' }: { label: string; children: ReactNode; preview?: ReactNode; english?: boolean; className?: string }) {
  const [pinned, setPinned] = useState(false), [hover, setHover] = useState(false), [focused, setFocused] = useState(false), [dismissed, setDismissed] = useState(false);
  const host = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), suppressFocus = useRef(false), panelId = useId();
  const open = !dismissed && (pinned || hover || focused);
  const collapse = (restoreFocus = false) => {
    setPinned(false); setHover(false); setFocused(false); setDismissed(true);
    if (restoreFocus) { suppressFocus.current = true; trigger.current?.focus(); suppressFocus.current = false; }
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) collapse(); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  return <div ref={host} data-ink-palette className={`ink-palette ${className}`} role="group" aria-label={label}
    onPointerEnter={event => { if (event.pointerType === 'pen' || event.pointerType === 'mouse') { setDismissed(false); setHover(true); } }}
    onPointerLeave={() => setHover(false)}
    onFocusCapture={() => { if (!suppressFocus.current) { setDismissed(false); setFocused(true); } }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }}
    onPointerDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); collapse(true); } }}>
    <button ref={trigger} type="button" data-ink-palette-trigger className="ink-palette-trigger" aria-label={label} title={label} aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => { if (pinned) collapse(); else { setDismissed(false); setPinned(true); } }}>{preview ?? <PenIcon width={22} height={22} />}</button>
    {open && <div id={panelId} data-ink-palette-controls className="ink-palette-controls">
      <div className="ink-palette-heading"><span>{label}</span><button type="button" aria-label={english ? 'Collapse drawing tools' : 'Recolher ferramentas de desenho'} title={english ? 'Collapse drawing tools' : 'Recolher ferramentas de desenho'} onClick={() => collapse(true)}><ArrowLeftIcon /></button></div>
      {children}
    </div>}
  </div>;
}
