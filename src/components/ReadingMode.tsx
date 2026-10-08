import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ConceptNodeData } from '@/types';
import { useAIReveal } from '@/hooks/useAIReveal';
import { useT } from '@/i18n';
import { OverflowMenu } from './ui/OverflowMenu';
import { ExplanationContent, extractHeadings, sentenceCase } from './Markdown';

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
  const { revealed: revealAI } = useAIReveal(node);
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
      className="fixed inset-0 z-[60] bg-bg-secondary flex flex-col pointer-events-auto animate-scrim-in"
      role="dialog"
      aria-modal="true"
      aria-label={`${tr.reading.kicker}: ${node.name}`}
    >
      {/* Barra de janela estilo Reader: vidro, título curto ao centro. */}
      <header className="glass shrink-0 border-b pt-[env(safe-area-inset-top)]">
        <div className="h-[52px] px-3 sm:px-4 grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <button
            ref={closeRef}
            onClick={onClose}
            title={tr.reading.close}
            aria-label={tr.reading.close}
            className="tap btn btn-ghost btn-icon"
          >
            <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <div className="min-w-0 text-center text-control font-semibold text-text-primary truncate">
            {node.name}
          </div>
          <span className="w-[30px]" aria-hidden />
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <article className="max-w-[720px] mx-auto px-5 sm:px-10 pt-8 sm:pt-14 pb-24">
          <div className="reading mx-auto">
            <div className="label mb-2">
              {tr.reading.kicker} · {tr.conceptNode[node.kind]}
            </div>
            <h1 className="text-title2 sm:text-title1 font-bold text-text-primary">{node.name}</h1>
            {breadcrumb.length > 0 && (
              <div className="text-footnote text-text-muted mt-2 truncate">{breadcrumb.join(' › ')}</div>
            )}

            <section className="mt-8 space-y-6">
              <ReadingField label={tr.detail.whatIs} value={node.oQue} />
              <ReadingField label={tr.detail.whyNeeded} value={node.porQue} />
              {node.kind !== 'root' && node.kind !== 'categoria' && (
                <div>
                  <h2 className="label mb-1.5">{tr.reading.howToConfirm}</h2>
                  {userCriterion && (
                    <p className="text-text-secondary">
                      <span className="text-footnote font-medium text-accent mr-2">
                        {tr.reading.yourCriterion}
                      </span>
                      {userCriterion}
                    </p>
                  )}
                  {revealAI ? (
                    node.comoConfirmar?.trim() && (
                      <p className="text-text-secondary mt-2">
                        <span className="text-footnote font-medium text-ai-accent mr-2">
                          {tr.reading.aiCriterion}
                        </span>
                        {node.comoConfirmar}
                      </p>
                    )
                  ) : (
                    <p className="text-control text-text-muted bg-bg-elevated/60 rounded-control px-3 py-2 mt-1">
                      {node.comoConfirmarUsuarioAt
                        ? tr.groundTruth.aiAfterUndoWindow
                        : tr.reading.writeYoursFirst}
                    </p>
                  )}
                </div>
              )}
            </section>

            <hr className="divider my-10" />

            <section>
              <h2 className="text-title3 font-semibold text-text-primary mb-4 flex items-center gap-2">
                <span className="ai-icon text-[15px]" aria-hidden>
                  ✦
                </span>
                {tr.reading.explanation}
              </h2>
              {headings.length > 1 && (
                <nav aria-label={tr.reading.contents} className="mb-6">
                  <div className="label mb-2">{tr.reading.contents}</div>
                  <ol className="flex flex-wrap gap-1.5">
                    {headings.map((h, i) => (
                      <li key={i}>
                        <button onClick={() => jumpTo(i)} className="tap btn btn-secondary btn-sm">
                          {sentenceCase(h)}
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
                  <p className="text-text-muted">{tr.reading.noExplanation}</p>
                  {onGenerate && (
                    <button onClick={onGenerate} disabled={generating} className="tap btn btn-ai">
                      <span className={`ai-icon ${generating ? 'animate-pulse-subtle' : ''}`} aria-hidden>
                        ✦
                      </span>
                      {generating ? tr.reading.generating : tr.reading.generate}
                    </button>
                  )}
                </div>
              )}
            </section>

            {research && (
              <section className="mt-12">
                <h2 className="text-title3 font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <span className="ai-icon text-[15px]" aria-hidden>
                    ✦
                  </span>
                  {tr.reading.research}
                </h2>
                <ExplanationContent text={research.findings} variant="reading" />
                {research.sources.length > 0 && (
                  <ul className="mt-5 space-y-2">
                    {research.sources.map((s) => (
                      <li key={s.url} className="text-control pl-5 relative">
                        <span aria-hidden className="absolute left-1 text-text-faint">
                          •
                        </span>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent transition-colors duration-120 break-all"
                        >
                          {s.title || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </article>
      </div>

      {actions.length > 0 && (
        <footer
          aria-label={tr.reading.actions}
          className="glass-host relative shrink-0 border-t pb-[env(safe-area-inset-bottom)]"
        >
          <div className="max-w-[720px] mx-auto px-5 sm:px-10 py-3">
            {/* Uma linha, alinhada à direita da coluna de leitura: a ação do
                momento em destaque e as demais num menu "…". */}
            <div className="max-w-read mx-auto text-body flex items-center justify-end gap-2">
              {onConfirm ? (
                <>
                  <OverflowMenu
                    label={tr.reading.actions}
                    placement="up"
                    items={[onDecompose, onKnown]
                      .filter((a): a is ReadingAction => Boolean(a))
                      .map((a) => ({ key: a.label, label: a.label, onClick: run(a), disabled: a.disabled }))}
                  />
                  <button
                    onClick={run(onConfirm)}
                    disabled={onConfirm.disabled}
                    className={`tap btn min-w-0 max-w-full ${onConfirm.tone === 'primary' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    <span className="truncate">{onConfirm.label}</span>
                  </button>
                </>
              ) : (
                actions.map((a) => (
                  <button
                    key={a.label}
                    onClick={run(a)}
                    disabled={a.disabled}
                    className="tap btn btn-secondary min-w-0"
                  >
                    <span className="truncate">{a.label}</span>
                  </button>
                ))
              )}
            </div>
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
      <h2 className="label mb-1.5">{label}</h2>
      <p className="text-text-secondary">{value}</p>
    </div>
  );
}
