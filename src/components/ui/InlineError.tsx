import { useT } from '@/i18n';
import type { ClassifiedAIError } from '@/hooks/useAIAction';

interface InlineErrorProps {
  error: ClassifiedAIError | string;
  onRetry?: () => void;
  onAction?: { label: string; onClick: () => void };
  className?: string;
}

// Erro no lugar onde a ação falhou: título curto + dica acionável. O texto cru
// do provider fica atrás de "detalhes técnicos" — nunca JSON na cara do usuário.
// Superfície neutra (sem borda colorida): a cor fica só no ícone de alerta.
export function InlineError({ error, onRetry, onAction, className }: InlineErrorProps) {
  const tr = useT();
  const e: ClassifiedAIError =
    typeof error === 'string' ? { kind: 'unknown', title: error, hint: '' } : error;

  return (
    <div
      role="alert"
      className={`flex gap-2.5 rounded-control bg-bg-elevated/60 px-3 py-2.5 text-control ${className ?? ''}`}
    >
      <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-px shrink-0 text-state-problem">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 4.6v4.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r=".9" fill="currentColor" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text-primary">{e.title}</p>
        {e.hint && <p className="mt-0.5 text-text-secondary">{e.hint}</p>}
        {(onRetry || onAction) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {onRetry && (
              <button type="button" onClick={onRetry} className="tap btn btn-secondary btn-sm">
                {tr.common.retry}
              </button>
            )}
            {onAction && (
              <button type="button" onClick={onAction.onClick} className="tap btn btn-secondary btn-sm">
                {onAction.label}
              </button>
            )}
          </div>
        )}
        {e.detail && (
          <details className="group mt-2 text-footnote text-text-muted">
            <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1 rounded-chip hover:text-text-secondary [&::-webkit-details-marker]:hidden">
              <svg
                aria-hidden
                width="8"
                height="8"
                viewBox="0 0 8 8"
                fill="none"
                className="shrink-0 transition-transform duration-120 ease-mac group-open:rotate-90"
              >
                <path d="M2.5 1.5L5.5 4l-3 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {tr.common.technicalDetails}
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-chip bg-bg-secondary/60 p-2 font-mono text-caption text-text-muted">
              {e.detail}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
