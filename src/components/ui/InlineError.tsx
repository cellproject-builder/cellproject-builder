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
export function InlineError({ error, onRetry, onAction, className }: InlineErrorProps) {
  const tr = useT();
  const e: ClassifiedAIError =
    typeof error === 'string' ? { kind: 'unknown', title: error, hint: '' } : error;

  return (
    <div
      role="alert"
      className={`rounded border border-state-problem/40 bg-state-problem/10 px-3 py-2 text-sm ${className ?? ''}`}
    >
      <p className="font-medium text-state-problem">{e.title}</p>
      {e.hint && <p className="mt-0.5 text-text-secondary">{e.hint}</p>}
      {(onRetry || onAction) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="tap rounded border border-state-problem/50 px-2.5 py-1 text-xs text-text-primary hover:bg-state-problem/20"
            >
              ↻ {tr.common.retry}
            </button>
          )}
          {onAction && (
            <button
              type="button"
              onClick={onAction.onClick}
              className="tap rounded border border-border-base px-2.5 py-1 text-xs text-text-primary hover:bg-bg-elevated"
            >
              {onAction.label}
            </button>
          )}
        </div>
      )}
      {e.detail && (
        <details className="mt-2 text-xs text-text-muted">
          <summary className="cursor-pointer select-none hover:text-text-secondary">
            {tr.common.technicalDetails}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-faint">
            {e.detail}
          </pre>
        </details>
      )}
    </div>
  );
}
