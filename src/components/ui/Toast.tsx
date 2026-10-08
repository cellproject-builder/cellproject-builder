import { useEffect } from 'react';
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { useT } from '@/i18n';

// ---------------------------------------------------------------------------
// Toast mínimo: feedback curto de ações (confirmado, arquivado…) com um botão
// opcional — quase sempre "Desfazer". Uma fila pequena, não persistida.
// ---------------------------------------------------------------------------

export type ToastTone = 'ok' | 'warn' | 'info';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  // 0 = fica até ser dispensado. Padrão: 5s (7s quando há ação).
  durationMs?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, 'message' | 'tone'>> {
  id: string;
  action?: ToastOptions['action'];
  durationMs: number;
}

interface ToastState {
  toasts: ToastItem[];
  show: (opts: ToastOptions | string) => string;
  dismiss: (id: string) => void;
}

const MAX_TOASTS = 3;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (opts) => {
    const o: ToastOptions = typeof opts === 'string' ? { message: opts } : opts;
    const id = nanoid(6);
    const item: ToastItem = {
      id,
      message: o.message,
      tone: o.tone ?? 'info',
      action: o.action,
      durationMs: o.durationMs ?? (o.action ? 7000 : 5000),
    };
    set((s) => ({ toasts: [...s.toasts, item].slice(-MAX_TOASTS) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// API imperativa para qualquer lugar (componentes, handlers, store).
export const toast = {
  show: (opts: ToastOptions | string) => useToastStore.getState().show(opts),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};

const TONE_CLASS: Record<ToastTone, string> = {
  ok: 'border-state-done/50',
  warn: 'border-conf-mid/60',
  info: 'border-border-base',
};

const TONE_ICON: Record<ToastTone, string> = { ok: '✓', warn: '!', info: '·' };
const TONE_ICON_CLASS: Record<ToastTone, string> = {
  ok: 'text-state-done',
  warn: 'text-conf-mid',
  info: 'text-text-muted',
};

function ToastRow({ item }: { item: ToastItem }) {
  const tr = useT();
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    if (item.durationMs <= 0) return;
    const timer = setTimeout(() => dismiss(item.id), item.durationMs);
    return () => clearTimeout(timer);
  }, [item.id, item.durationMs, dismiss]);

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 rounded-md border bg-bg-elevated px-3 py-2 text-sm text-text-primary shadow-lg ${TONE_CLASS[item.tone]}`}
    >
      <span aria-hidden className={`font-mono ${TONE_ICON_CLASS[item.tone]}`}>
        {TONE_ICON[item.tone]}
      </span>
      <span className="min-w-0 flex-1 break-words">{item.message}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            dismiss(item.id);
          }}
          className="tap shrink-0 rounded px-2 py-1 text-xs font-medium text-ai-accent hover:bg-bg-secondary"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label={tr.common.dismiss}
        className="tap shrink-0 rounded px-1.5 py-1 text-text-muted hover:text-text-primary"
      >
        ✕
      </button>
    </div>
  );
}

// Montado uma vez no App. A região viva fica sempre no DOM para leitores de
// tela anunciarem os toasts que entram.
export function Toaster({ raised = false }: { raised?: boolean } = {}) {
  const tr = useT();
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={tr.toast.regionLabel}
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 ${
        raised
          ? 'pb-[calc(env(safe-area-inset-bottom)+7.5rem)]'
          : 'pb-[calc(env(safe-area-inset-bottom)+3rem)]'
      }`}
    >
      {toasts.map((item) => (
        <div key={item.id} className="w-full max-w-md">
          <ToastRow item={item} />
        </div>
      ))}
    </div>
  );
}
