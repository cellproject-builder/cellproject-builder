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
  // Fecha todos (ex.: ao começar uma geração, o painel de progresso ocupa o
  // rodapé e um toast antigo esconderia as etapas).
  clear: () => useToastStore.setState({ toasts: [] }),
};

// Ícone em um disco pequeno da cor do tom; o vidro do toast fica neutro.
const TONE_ICON: Record<ToastTone, string> = { ok: '✓', warn: '!', info: 'i' };
const TONE_ICON_CLASS: Record<ToastTone, string> = {
  ok: 'bg-state-done/15 text-state-done',
  warn: 'bg-conf-mid/15 text-conf-mid',
  info: 'bg-accent/12 text-accent',
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
      className="glass pointer-events-auto flex min-h-[40px] animate-toast-in items-center gap-2.5 rounded-[20px] border py-1.5 pl-2 pr-1.5 text-control text-text-primary shadow-mac-lg"
    >
      <span
        aria-hidden
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-caption font-semibold ${TONE_ICON_CLASS[item.tone]}`}
      >
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
          className="tap btn btn-tertiary btn-sm shrink-0"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label={tr.common.dismiss}
        className="tap btn btn-ghost btn-icon btn-sm shrink-0 rounded-full text-caption"
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
        // No tutor, no desktop, o toast mora no pé da sidebar (à direita):
        // centralizado na coluna, cobria a linha de baixo do card seguinte.
        // No mobile, sobe acima da barra de ações sticky — o card publica a
        // altura real dela em --tutor-bar-h.
        raised
          ? 'pb-[max(calc(var(--tutor-bar-h,0px)+1rem),calc(env(safe-area-inset-bottom)+1rem))] md:left-auto md:w-[260px] lg:w-[300px] md:px-3 md:pb-3'
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
