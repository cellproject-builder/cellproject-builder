import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ConceptNodeData } from '@/types';
import { canRevealAICriterion } from '@/store';
import { useT } from '@/i18n';
import { ExplanationContent, extractHeadings } from './Markdown';

// ---------------------------------------------------------------------------
// Modo leitura — overlay em tela cheia pra ler com conforto o conteúdo
// detalhado de uma célula: o que é / por que / como confirmar, a explicação
// longa do tutor e as fontes da pesquisa web. Renderiza num portal pro
// overlay escapar de containers com transform (vaul) e scroll.
// ---------------------------------------------------------------------------

export interface ReadingAction {
  label: string;
  onClick: () => void;
  tone?: 'primary' | 'muted';
  disabled?: boolean;
}

interface ReadingModeProps {
  node: ConceptNodeData;
  breadcrumb: string[];
  onClose: () => void;
  // Gera a explicação longa quando a célula ainda não tem uma.
  onGenerate?: () => void;
  generating?: boolean;
  // Texto parcial enquanto a explicação chega em streaming.
  streamingText?: string;
  // Rodapé com o fork do tutor (confirmar / quebrar / já sei). Cada ação fecha
  // o modo leitura antes de rodar — o resultado aparece no card.
  onConfirm?: ReadingAction;
  onDecompose?: ReadingAction;
  onKnown?: ReadingAction;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const HEADING_PREFIX = 'reading-expl';

export function ReadingMode({
  node,
  breadcrumb,
  onClose,
  onGenerate,
  generating,
  streamingText,
  onConfirm,
  onDecompose,
  onKnown,
}: ReadingModeProps) {
  const tr = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // ESC fecha; Tab fica preso no overlay; trava o scroll do body enquanto o
  // overlay está aberto. Captura no window (dispara antes dos handlers de
  // document do Radix/vaul) e corta a propagação — senão um ESC fecha o
  // overlay E o sheet mobile atrás, jogando o usuário no grafo em vez de volta
  // no detalhe da célula. Ao fechar, o foco volta pra quem abriu (o ⛶).
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      const dialog = dialogRef.current;
      if (e.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !dialog.contains(active);
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, []);

  const research = node.webResearch;
  const explanation = node.explicacao || streamingText || '';
  const headings = useMemo(() => extractHeadings(node.explicacao ?? ''), [node.explicacao]);

  // Critério do usuário ANTES do da IA: o da IA só aparece depois do lock.
  const revealAI = canRevealAICriterion(node);
  const userCriterion = node.comoConfirmarUsuario?.trim();

  const jumpTo = (idx: number) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`#${HEADING_PREFIX}-h-${idx}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const run = (a: ReadingAction) => () => {
    onClose();
    a.onClick();
  };

  const actions = [onConfirm, onDecompose, onKnown].filter(Boolean) as ReadingAction[];

  const overlay = (
    // pointer-events-auto é obrigatório: aberto por cima do sheet mobile
    // (vaul/Radix modal), o body fica com pointer-events:none e o overlay
    // herdaria — todos os controles ficariam mortos e o toque atravessaria
    // pro drawer invisível atrás.
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[60] bg-bg-primary flex flex-col pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`${tr.reading.kicker}: ${node.name}`}
    >
      <header className="shrink-0 border-b border-border-base bg-bg-secondary">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ai-accent mb-0.5">
              ◆ {tr.reading.kicker} · {tr.conceptNode[node.kind]}
            </div>
            <h1 className="text-lg sm:text-xl font-semibold text-text-primary leading-snug">
              {node.name}
            </h1>
            {breadcrumb.length > 0 && (
              <div className="text-xs text-text-muted mt-1 truncate">{breadcrumb.join(' › ')}</div>
            )}
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            title={tr.reading.close}
            aria-label={tr.reading.close}
            className="tap shrink-0 w-9 h-9 min-h-[36px] flex items-center justify-center rounded-sm border border-border-base text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors text-lg"
          >
            ×
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <article className="max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-10 pb-24 space-y-8">
          <section className="space-y-5">
            <ReadingField label={tr.detail.whatIs} value={node.oQue} />
            <ReadingField label={tr.detail.whyNeeded} value={node.porQue} />
            {node.kind !== 'root' && node.kind !== 'categoria' && (
              <div>
                <div className="text-[11px] font-mono uppercase tracking-widest text-text-muted mb-1.5">
                  {tr.reading.howToConfirm}
                </div>
                {userCriterion && (
                  <p className="text-[15px] sm:text-base text-text-secondary leading-relaxed">
                    <span className="text-xs font-mono uppercase tracking-wider text-ai-accent mr-2">
                      {tr.reading.yourCriterion}
                    </span>
                    {userCriterion}
                  </p>
                )}
                {revealAI ? (
                  node.comoConfirmar?.trim() && (
                    <p className="text-[15px] sm:text-base text-text-secondary leading-relaxed mt-1">
                      <span className="text-xs font-mono uppercase tracking-wider text-text-muted mr-2">
                        {tr.reading.aiCriterion}
                      </span>
                      {node.comoConfirmar}
                    </p>
                  )
                ) : (
                  <p className="text-sm text-text-muted italic border border-dashed border-border-base rounded-sm px-3 py-2">
                    {tr.reading.writeYoursFirst}
                  </p>
                )}
              </div>
            )}
          </section>

          <section>
            <div className="text-[11px] font-mono uppercase tracking-widest text-ai-accent mb-3 pb-2 border-b border-border-base">
              ◆ {tr.reading.explanation}
            </div>
            {headings.length > 1 && (
              <nav aria-label={tr.reading.contents} className="mb-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-1.5">
                  {tr.reading.contents}
                </div>
                <ol className="flex flex-wrap gap-1.5">
                  {headings.map((h, i) => (
                    <li key={i}>
                      <button
                        onClick={() => jumpTo(i)}
                        className="text-xs text-text-secondary hover:text-ai-accent border border-border-base hover:border-ai-accent/40 rounded-sm px-2 py-1 transition-colors"
                      >
                        {h}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            {explanation ? (
              <ExplanationContent text={explanation} variant="reading" idPrefix={HEADING_PREFIX} />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-text-muted italic">{tr.reading.noExplanation}</p>
                {onGenerate && (
                  <button
                    onClick={onGenerate}
                    disabled={generating}
                    className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] bg-ai-accent/10 hover:bg-ai-accent/20 border border-ai-accent/30 rounded-sm text-ai-accent text-sm transition-colors disabled:opacity-60"
                  >
                    <span>◆</span>
                    {generating ? tr.reading.generating : tr.reading.generate}
                  </button>
                )}
              </div>
            )}
          </section>

          {research && (
            <section>
              <div className="text-[11px] font-mono uppercase tracking-widest text-ai-accent mb-3 pb-2 border-b border-border-base">
                ◆ {tr.reading.research}
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

      {actions.length > 0 && (
        <footer
          aria-label={tr.reading.actions}
          className="shrink-0 border-t border-border-base bg-bg-secondary pb-[env(safe-area-inset-bottom)]"
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-8 py-2.5 flex flex-wrap gap-2">
            {actions.map((a) => (
              <button
                key={a.label}
                onClick={run(a)}
                disabled={a.disabled}
                className={`tap min-h-[40px] px-3 rounded-sm border text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  a.tone === 'primary'
                    ? 'flex-1 bg-conf-high/15 hover:bg-conf-high/30 text-conf-high border-conf-high/40 font-medium'
                    : 'bg-bg-elevated text-text-secondary hover:text-ai-accent border-border-base hover:border-ai-accent/40'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </footer>
      )}
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
