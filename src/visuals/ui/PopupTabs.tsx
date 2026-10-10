import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocaleStore } from '@/i18n';
import type { VisualToolActivity } from './uiStore';
import './popup-tabs.css';
export interface PopupTab { id: string; label: string; kind: 'search' | 'model'; artifactKind?: 'model' | 'diagram'; activity: VisualToolActivity }
export interface PopupTabsProps { windowId: string; tabs: PopupTab[]; activeTabId: string; onSelect: (id: string) => void; onNew: () => void; onClose: (id: string) => void; onDetach: (id: string, point?: { x: number; y: number }) => void; onMove: (id: string, targetWindowId: string, beforeTabId?: string) => void }
const DRAG_THRESHOLD = 7, DETACH_MARGIN = 16;
let focusSequence = 0;
type Drag = { id: string; pointerId: number; x: number; y: number; rect: DOMRect; moved: boolean };
function ToolSymbol({ tab }: { tab: PopupTab }) {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{tab.kind === 'search' ? <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1.5" /><path d="m3 16 5-5 5 5 3-3 5 5" /></> : tab.artifactKind === 'diagram' ? <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 6h9v9M6 9v9h9" /></> : <path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10" />}</svg>;
}

/** A tab changes presentation only. Its parent owns requests, cancellation and persistence. */
export function PopupTabs(props: PopupTabsProps) {
  const english = useLocaleStore(state => state.locale) === 'en';
  const bar = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  const latest = useRef(props); latest.current = props;
  const ignoredClick = useRef<string | null>(null), resetClick = useRef<ReturnType<typeof setTimeout>>();
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const labels = english ? { list: 'Visual requests', add: 'New tab', close: 'Close tab', detach: 'Detach tab', running: 'Working', ready: 'Ready to review', error: 'Could not finish' }
    : { list: 'Pedidos visuais', add: 'Nova aba', close: 'Fechar aba', detach: 'Destacar aba', running: 'Processando', ready: 'Pronto para revisar', error: 'Não foi possível concluir' };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = drag.current; if (!current || event.pointerId !== current.pointerId) return;
      if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_THRESHOLD) return;
      current.moved = true;
      event.preventDefault(); setPreview({ id: current.id, x: event.clientX, y: event.clientY });
    };
    const finish = (event: PointerEvent) => {
      const current = drag.current; if (!current || event.pointerId !== current.pointerId) return;
      drag.current = null; setPreview(null);
      if (!current.moved) return;
      ignoredClick.current = current.id; clearTimeout(resetClick.current);
      resetClick.current = setTimeout(() => { ignoredClick.current = null; }, 0);
      event.preventDefault();
      const hit = document.elementFromPoint?.(event.clientX, event.clientY);
      const targetBar = hit?.closest<HTMLElement>('.visual-popup-tabs[data-window-id]');
      if (targetBar?.dataset.windowId) {
        const target = hit?.closest<HTMLElement>('[role="tab"][data-tab-id]') ?? hit?.closest('.visual-popup-tab')?.querySelector<HTMLElement>('[role="tab"][data-tab-id]');
        const buttons = [...targetBar.querySelectorAll<HTMLElement>('[role="tab"][data-tab-id]')];
        let before: string | undefined;
        if (target && targetBar.contains(target)) {
          const rect = target.getBoundingClientRect();
          before = event.clientX < rect.left + rect.width / 2 ? target.dataset.tabId : buttons[buttons.indexOf(target) + 1]?.dataset.tabId;
        }
        if (before !== current.id) latest.current.onMove(current.id, targetBar.dataset.windowId, before);
        return;
      }
      const rect = current.rect;
      if (event.clientX < rect.left - DETACH_MARGIN || event.clientX > rect.right + DETACH_MARGIN || event.clientY < rect.top - DETACH_MARGIN || event.clientY > rect.bottom + DETACH_MARGIN) latest.current.onDetach(current.id, { x: event.clientX, y: event.clientY });
    };
    const cancel = () => { drag.current = null; setPreview(null); };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); clearTimeout(resetClick.current); drag.current = null; };
  }, []);
  function start(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || event.isPrimary === false || !bar.current) return;
    drag.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect: bar.current.getBoundingClientRect(), moved: false };
    event.stopPropagation();
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const index = props.tabs.findIndex(tab => tab.id === id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? props.tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % props.tabs.length : event.key === 'ArrowLeft' ? (index + props.tabs.length - 1) % props.tabs.length : -1;
    if (next < 0 || !props.tabs[next]) return;
    const selectedId = props.tabs[next].id, windowId = props.windowId, previousFocus = document.activeElement;
    const sequence = ++focusSequence;
    event.preventDefault(); event.stopPropagation(); props.onSelect(selectedId);
    // Selection can move the strip to another mounted session. Resolve its new
    // DOM after commit instead of focusing the old strip that is being removed.
    // Deliberately survive this component's unmount, but never steal later focus.
    const focus = () => {
      if (sequence !== focusSequence || document.activeElement !== previousFocus && document.activeElement !== document.body) return;
      const target = document.getElementById(`visual-tab-${selectedId}`);
      if (!target || target.closest('[hidden]') || target.closest<HTMLElement>('.visual-popup-tabs')?.dataset.windowId !== windowId) return;
      target.focus({ preventScroll: true }); target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focus);
    else queueMicrotask(focus);
  }
  const ghost = preview && props.tabs.find(tab => tab.id === preview.id);
  return <div ref={bar} className="visual-popup-tabs" data-window-id={props.windowId} data-no-window-drag>
    <div className="visual-popup-tabstrip" role="tablist" aria-label={labels.list} aria-orientation="horizontal">
      {props.tabs.map(tab => {
        const active = props.activeTabId === tab.id;
        const state = tab.activity.state === 'idle' ? '' : tab.activity.label || labels[tab.activity.state];
        return <div key={tab.id} className={`visual-popup-tab${active ? ' is-active' : ''}${preview?.id === tab.id ? ' is-dragging' : ''}`}>
          <button type="button" role="tab" id={`visual-tab-${tab.id}`} data-tab-id={tab.id} aria-controls={`visual-panel-${tab.id}`} aria-selected={active} tabIndex={active ? 0 : -1}
            aria-label={`${tab.label}${state ? ` · ${state}` : ''}`} title={tab.label} onPointerDown={event => start(event, tab.id)} onKeyDown={event => navigate(event, tab.id)}
            onClick={() => { if (ignoredClick.current === tab.id) { ignoredClick.current = null; return; } props.onSelect(tab.id); }}>
            <span className={`visual-tab-status is-${tab.activity.state}`} aria-hidden="true">{tab.activity.state === 'running' ? <i /> : tab.activity.state === 'error' ? '!' : tab.activity.state === 'ready' ? '✓' : <ToolSymbol tab={tab} />}</span>
            <span className="visual-tab-label">{tab.label}</span>
          </button>
          {active && <button type="button" className="visual-tab-control visual-tab-detach" aria-label={`${labels.detach}: ${tab.label}`} title={labels.detach} onClick={() => props.onDetach(tab.id)}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M8 3h5v5M13 3 7 9M6 3H3v10h10v-3" /></svg></button>}
          <button type="button" className="visual-tab-control visual-tab-close" aria-label={`${labels.close}: ${tab.label}`} title={labels.close} onClick={() => props.onClose(tab.id)}>×</button>
        </div>;
      })}
    </div>
    <button type="button" className="visual-tab-new" aria-label={labels.add} title={labels.add} onClick={props.onNew}>+</button>
    {ghost && preview && createPortal(<div className="visual-tab-drag-preview" aria-hidden="true" style={{ left: preview.x + 12, top: preview.y + 12 }}><ToolSymbol tab={ghost} /><span>{ghost.label}</span></div>, document.body)}
  </div>;
}
