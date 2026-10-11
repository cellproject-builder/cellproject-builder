import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Native disclosure semantics, with focus returned to the passage being edited. */
export function NoteActionMenu({ label, className = '', children, returnFocus }: {
  label: string; className?: string; children: ReactNode; returnFocus?: () => HTMLElement | null | undefined;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <details ref={ref} open={open} className={`ws-note-action-menu ${className}`} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault(); event.stopPropagation(); setOpen(false);
    (returnFocus?.() ?? ref.current?.querySelector('summary'))?.focus({ preventScroll: true });
  }}>
    <summary aria-label={label} title={label} aria-expanded={open} onMouseDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); setOpen(value => !value); }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
    </summary>
    {children}
  </details>;
}
