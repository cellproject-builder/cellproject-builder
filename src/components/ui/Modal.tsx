import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  // Elemento que recebe o foco ao abrir (padrão: primeiro focável do diálogo).
  initialFocusRef?: RefObject<HTMLElement>;
  // Classes do painel (largura, altura). Padrão: max-w-lg.
  className?: string;
  closeOnBackdrop?: boolean;
  hideCloseButton?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Diálogo acessível: role=dialog + aria-modal + aria-labelledby, Esc fecha,
// foco inicial dentro, Tab preso no diálogo e foco devolvido ao gatilho.
export function Modal({
  open,
  onClose,
  title,
  children,
  initialFocusRef,
  className,
  closeOnBackdrop = true,
  hideCloseButton = false,
}: ModalProps) {
  const tr = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Foco inicial no conteúdo (não no ✕ do cabeçalho), senão no próprio painel.
    const first =
      initialFocusRef?.current ??
      bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Devolve o foco a quem abriu, se ainda estiver na página.
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-lg border border-border-base bg-bg-secondary shadow-2xl outline-none sm:rounded-lg ${className ?? 'max-w-lg'}`}
      >
        <div className="flex items-center gap-2 border-b border-border-base px-4 py-3">
          <h2 id={titleId} className="min-w-0 flex-1 text-sm font-medium text-text-primary">
            {title}
          </h2>
          {!hideCloseButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label={tr.common.close}
              className="tap rounded px-2 py-1 text-text-muted hover:bg-bg-elevated hover:text-text-primary"
            >
              ✕
            </button>
          )}
        </div>
        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
