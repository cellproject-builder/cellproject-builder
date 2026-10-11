import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './ExpandedChrome.css';

/** Keep controls mounted while removing their layout space in expanded surfaces. */
export function ExpandedChrome({ expanded, label, english = false, onRestore, children }: {
  expanded: boolean;
  label: string;
  english?: boolean;
  onRestore: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null), suppressFocus = useRef(false);
  const panelId = useId();
  const focusTrigger = () => {
    suppressFocus.current = true;
    trigger.current?.focus({ preventScroll: true });
    suppressFocus.current = false;
  };
  useLayoutEffect(() => {
    setOpen(false);
    setPinned(false);
    if (expanded && panel.current?.contains(document.activeElement)) {
      previousFocus.current = document.activeElement as HTMLElement;
      focusTrigger();
    } else if (!expanded && document.activeElement === trigger.current && previousFocus.current?.isConnected) {
      previousFocus.current.focus({ preventScroll: true });
    }
  }, [expanded]);
  useEffect(() => {
    if (!expanded || !open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
        setPinned(false);
        if (panel.current?.contains(document.activeElement)) focusTrigger();
      }
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [expanded, open]);
  return <div ref={root} className={`expanded-chrome${expanded ? ' is-expanded' : ''}${expanded && open ? ' is-open' : ''}`}
    onPointerEnter={event => { if (expanded && event.pointerType !== 'touch') setOpen(true); }}
    onPointerLeave={() => { if (!pinned && !panel.current?.contains(document.activeElement)) setOpen(false); }}
    onFocusCapture={event => {
      // Portals bubble through React; only our actual controls reveal this panel.
      if (expanded && !suppressFocus.current && root.current?.contains(event.target)) setOpen(true);
    }}
    onBlurCapture={event => { if (!pinned && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    onKeyDown={event => {
      if (!expanded || event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing ||
        !root.current?.contains(event.target as Node)) return;
      const visibleDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]'))
        .some(dialog => !dialog.closest('[hidden]') && getComputedStyle(dialog).display !== 'none' && getComputedStyle(dialog).visibility !== 'hidden');
      if (visibleDialog) return;
      event.preventDefault(); event.stopPropagation();
      if (open) { setOpen(false); setPinned(false); focusTrigger(); } else onRestore();
    }}>
    <button ref={trigger} type="button" className="expanded-chrome-trigger" hidden={!expanded}
      aria-label={english ? 'Show controls' : 'Mostrar controles'} aria-expanded={expanded && open}
      aria-controls={panelId} title={`${label} · ${english ? 'Show controls' : 'Mostrar controles'}`}
      onClick={() => {
        if (pinned) { setOpen(false); setPinned(false); focusTrigger(); }
        else { setOpen(true); setPinned(true); }
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 4v4m8 2v4M10 16v4"/>
      </svg>
    </button>
    <div id={panelId} ref={panel} className="expanded-chrome-panel" hidden={expanded && !open}>
      <p className="expanded-chrome-title" hidden={!expanded}>{label}</p>
      {children}
    </div>
  </div>;
}
