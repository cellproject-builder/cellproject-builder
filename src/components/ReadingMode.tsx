import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ConceptNodeData } from '@/types';
import { useT } from '@/i18n';
import { ExplanationContent } from './Markdown';

// ---------------------------------------------------------------------------
// Modo leitura — overlay em tela cheia pra ler com conforto o conteúdo
// detalhado de uma célula: o que é / por que / como confirmar, a explicação
// longa do tutor e as fontes da pesquisa web. Renderiza num portal pro
// overlay escapar de containers com transform (vaul) e scroll.
// ---------------------------------------------------------------------------

interface ReadingModeProps {
  node: ConceptNodeData;
  breadcrumb: string[];
  onClose: () => void;
  // Gera a explicação longa quando a célula ainda não tem uma.
  onGenerate?: () => void;
  generating?: boolean;
}

export function ReadingMode({ node, breadcrumb, onClose, onGenerate, generating }: ReadingModeProps) {
  const tr = useT();

  // ESC fecha; trava o scroll do body enquanto o overlay está aberto.
  // Captura no window (dispara antes dos handlers de document do Radix/vaul) e
  // corta a propagação — senão um ESC fecha o overlay E o sheet mobile atrás,
  // jogando o usuário no grafo em vez de volta no detalhe da célula.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const research = node.webResearch;

  const overlay = (
    // pointer-events-auto é obrigatório: aberto por cima do sheet mobile
    // (vaul/Radix modal), o body fica com pointer-events:none e o overlay
    // herdaria — todos os controles ficariam mortos e o toque atravessaria
    // pro drawer invisível atrás.
    <div
      className="fixed inset-0 z-[60] bg-bg-primary flex flex-col pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-label={tr.detail.readingKicker}
    >
      <header className="shrink-0 border-b border-border-base bg-bg-secondary">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ai-accent mb-0.5">
              ◆ {tr.detail.readingKicker} · {node.kind}
            </div>
            <h1 className="text-lg sm:text-xl font-semibold text-text-primary leading-snug">
              {node.name}
            </h1>
            {breadcrumb.length > 0 && (
              <div className="text-[11px] font-mono text-text-muted mt-1 truncate">
                {breadcrumb.join(' › ')}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            title={tr.detail.readingClose}
            aria-label={tr.detail.readingClose}
            className="shrink-0 w-9 h-9 min-h-[36px] flex items-center justify-center rounded-sm border border-border-base text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors text-lg"
          >
            ×
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <article className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-10 pb-24 space-y-8">
          <section className="space-y-5">
            <ReadingField label={tr.detail.whatIs} value={node.oQue} />
            <ReadingField label={tr.detail.whyNeeded} value={node.porQue} />
            <ReadingField label={tr.detail.readingHowToConfirm} value={node.comoConfirmar} />
          </section>

          <section>
            <div className="text-[11px] font-mono uppercase tracking-widest text-ai-accent mb-3 pb-2 border-b border-border-base">
              ◆ {tr.detail.readingExplanation}
            </div>
            {node.explicacao ? (
              <ExplanationContent text={node.explicacao} variant="reading" />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-text-muted italic">{tr.detail.readingNoExplanation}</p>
                {onGenerate && (
                  <button
                    onClick={onGenerate}
                    disabled={generating}
                    className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] bg-ai-accent/10 hover:bg-ai-accent/20 border border-ai-accent/30 rounded-sm text-ai-accent text-sm transition-colors disabled:opacity-60"
                  >
                    <span>◆</span>
                    {generating ? tr.detail.generatingExplain : tr.detail.explainBtn}
                  </button>
                )}
              </div>
            )}
          </section>

          {research && (
            <section>
              <div className="text-[11px] font-mono uppercase tracking-widest text-ai-accent mb-3 pb-2 border-b border-border-base">
                ◆ {tr.detail.readingResearch}
              </div>
              <ExplanationContent text={research.findings} variant="reading" />
              {research.sources.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {research.sources.map((s) => (
                    <li key={s.url} className="text-sm pl-4 relative">
                      <span className="absolute left-0 text-text-muted">•</span>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ai-accent underline decoration-ai-accent/40 hover:decoration-ai-accent transition-colors break-all"
                      >
                        {s.title || s.url}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </article>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

function ReadingField({ label, value }: { label: string; value: string }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <div className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-1.5">
        {label}
      </div>
      <p className="text-[15px] sm:text-base text-text-secondary leading-relaxed">{value}</p>
    </div>
  );
}
