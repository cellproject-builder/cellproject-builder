import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react';
import { useKBStore, type IngestProgress } from '@/kb/store';
import { textSentToModel } from '@/kb/service';
import { useT } from '@/i18n';
import type { Messages } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { InlineError } from '@/components/ui/InlineError';
import type { ClassifiedAIError } from '@/hooks/useAIAction';

interface Props {
  open: boolean;
  onClose: () => void;
}

// Um arquivo na fila de ingestão. progress null = ainda na fila.
interface QueueItem {
  key: string;
  file: File;
  progress: IngestProgress | null;
}

// Acima disso aparece o campo de filtro.
const FILTER_MIN_DOCS = 6;
// Sucessos somem sozinhos depois que a fila esvazia; erros ficam até dispensar.
const CLEAR_SUCCESS_MS = 6_000;

let queueSeq = 0;

function isFinished(it: QueueItem): boolean {
  return it.progress?.phase === 'done' || it.progress?.phase === 'error';
}

function hasFiles(e: DragEvent | ReactDragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

export function KnowledgeRepo({ open, onClose }: Props) {
  const tr = useT();
  // We subscribe to the raw Record (stable reference) and derive the list via
  // useMemo. Calling s.list() directly inside the selector creates a new array
  // every render and breaks Zustand's structural equality → infinite loop.
  const docsMap = useKBStore((s) => s.docs);
  const usage = useKBStore((s) => s.usage);
  const addFromPdf = useKBStore((s) => s.addFromPdf);
  const removeDoc = useKBStore((s) => s.removeDoc);

  const docs = useMemo(
    () =>
      Object.values(docsMap)
        .map((d) => ({
          id: d.id,
          filename: d.filename,
          titulo: d.summary.titulo,
          dominio: d.summary.dominio,
          tags: d.summary.tags,
          nivel: d.summary.nivel,
          pageCount: d.pageCount,
          extractedAt: d.extractedAt,
        }))
        .sort((a, b) => b.extractedAt - a.extractedAt),
    [docsMap],
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // Fila sequencial: um PDF por vez (extração pesa e o resumo custa uma chamada).
  const pendingRef = useRef<QueueItem[]>([]);
  const runningRef = useRef(false);
  const clearTimerRef = useRef<number | null>(null);

  const updateItem = useCallback((key: string, progress: IngestProgress | null) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, progress } : it)));
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    try {
      while (pendingRef.current.length > 0) {
        const it = pendingRef.current.shift()!;
        await addFromPdf(it.file, (p) => updateItem(it.key, p));
      }
    } finally {
      runningRef.current = false;
    }
    clearTimerRef.current = window.setTimeout(() => {
      if (runningRef.current) return;
      setItems((prev) => prev.filter((it) => it.progress?.phase !== 'done'));
    }, CLEAR_SUCCESS_MS);
  }, [addFromPdf, updateItem]);

  const handleFiles = useCallback(
    (files: FileList | File[] | null) => {
      const list = files ? Array.from(files) : [];
      if (list.length === 0) return;
      const fresh = list.map((file) => ({ key: `q${++queueSeq}`, file, progress: null }));
      setItems((prev) => [...prev, ...fresh]);
      pendingRef.current.push(...fresh);
      void run();
      if (inputRef.current) inputRef.current.value = '';
    },
    [run],
  );

  const retry = (it: QueueItem) => {
    updateItem(it.key, null);
    pendingRef.current.push(it);
    void run();
  };

  const dismiss = (key: string) => setItems((prev) => prev.filter((it) => it.key !== key));

  useEffect(
    () => () => {
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    },
    [],
  );

  // Com o modal aberto, soltar um arquivo em qualquer lugar nunca abre o PDF
  // no navegador (saindo do app): o drop vira "adicionar".
  const handleFilesRef = useRef(handleFiles);
  handleFilesRef.current = handleFiles;
  useEffect(() => {
    if (!open) return;
    let leaveTimer: number | null = null;
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
      // dragleave pisca entre filhos; desligamos quando o dragover para.
      if (leaveTimer) window.clearTimeout(leaveTimer);
      leaveTimer = window.setTimeout(() => setDragActive(false), 150);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      setDragActive(false);
      // O dropzone já tratou (React chama preventDefault antes de chegar aqui).
      if (e.defaultPrevented) return;
      e.preventDefault();
      handleFilesRef.current(e.dataTransfer?.files ?? null);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      if (leaveTimer) window.clearTimeout(leaveTimer);
      setDragActive(false);
    };
  }, [open]);

  const visibleDocs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q || docs.length < FILTER_MIN_DOCS) return docs;
    return docs.filter((d) =>
      [d.titulo, d.dominio, d.filename, ...d.tags].some((s) => s.toLowerCase().includes(q)),
    );
  }, [docs, filter]);

  const running = items.some((it) => !isFinished(it));
  const finishedCount = items.filter(isFinished).length;
  const hasFinishedOk = items.some((it) => it.progress?.phase === 'done');

  return (
    <Modal
      open={open}
      onClose={onClose}
      initialFocusRef={dropzoneRef}
      className="max-w-3xl sm:h-auto"
      title={
        <span className="flex items-baseline gap-2">
          <span>{tr.kbModal.title}</span>
          <span className="text-footnote font-normal tabular-nums text-text-muted">
            {tr.kbModal.docCount(docs.length)}
          </span>
        </span>
      }
    >
      <div className="space-y-4">
        <div
          ref={dropzoneRef}
          role="button"
          tabIndex={0}
          aria-label={tr.kb.dropzoneAria}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            setDragActive(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center rounded-card border-[1.5px] border-dashed px-6 py-7 text-center transition-colors duration-180 ease-mac ${
            dragActive
              ? 'border-accent bg-accent/8'
              : 'border-text-faint/45 bg-bg-elevated/40 hover:border-text-faint/70 hover:bg-bg-elevated/60'
          }`}
        >
          <input name="pdf-files"
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            tabIndex={-1}
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
          <DocGlyph
            className={`mb-2.5 h-8 w-8 transition-colors duration-180 ease-mac ${
              dragActive ? 'text-accent' : 'text-text-faint'
            }`}
          />
          {dragActive ? (
            <div className="text-control font-medium text-accent">{tr.kb.dropActive}</div>
          ) : (
            <>
              <div className="text-control font-medium text-text-primary">{tr.kbModal.dropOrClick}</div>
              <div className="mt-1 max-w-md text-footnote text-text-muted">{tr.kbModal.dropHint}</div>
            </>
          )}
        </div>

        {items.length > 0 && (
          <div className="space-y-1.5" aria-live="polite">
            {running && items.length > 1 && (
              <div className="label tabular-nums">
                {tr.kb.queueProgress(Math.min(finishedCount + 1, items.length), items.length)}
              </div>
            )}
            {items.map((it) => (
              <IngestRow
                key={it.key}
                it={it}
                tr={tr}
                onRetry={() => retry(it)}
                onDismiss={() => dismiss(it.key)}
              />
            ))}
            {!running && hasFinishedOk && (
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((i) => i.progress?.phase !== 'done'))}
                className="tap btn btn-tertiary btn-sm -ml-2"
              >
                {tr.kb.clearFinished}
              </button>
            )}
          </div>
        )}

        {docs.length > 0 && (
          <p className="text-footnote text-text-muted">{tr.kb.howItWorks}</p>
        )}

        {docs.length >= FILTER_MIN_DOCS && (
          <input name="pdf-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={tr.kb.filterPlaceholder}
            aria-label={tr.kb.filterPlaceholder}
            className="field"
          />
        )}

        <div className="-mx-5 divide-y divide-border-base/70 border-t border-border-base/70">
          {docs.length === 0 && (
            <div className="px-5 py-10 text-center text-control text-text-muted">
              {tr.kbModal.emptyState}
            </div>
          )}
          {docs.length > 0 && visibleDocs.length === 0 && (
            <div className="px-5 py-8 text-center text-control text-text-muted">
              {tr.kb.filterEmpty}
            </div>
          )}
          {visibleDocs.map((d) => {
            const full = docsMap[d.id];
            const expanded = expandedId === d.id;
            const confirming = confirmRemoveId === d.id;
            const used = usage[d.id];
            return (
              <div key={d.id}>
                <div
                  className={`flex items-start gap-3 px-5 py-3 transition-colors duration-120 ease-mac ${
                    expanded ? 'bg-bg-elevated/50' : 'hover:bg-bg-elevated/40'
                  }`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : d.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedId(expanded ? null : d.id);
                      }
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-control"
                  >
                    <Chevron
                      className={`mt-[3px] text-text-faint transition-transform duration-180 ease-mac ${
                        expanded ? 'rotate-90' : ''
                      }`}
                    />
                    <DocGlyph className="mt-px h-5 w-5 shrink-0 text-text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="min-w-0 break-words text-control font-medium text-text-primary">
                          {d.titulo}
                        </span>
                        <span className="chip h-[18px] shrink-0 px-1.5">{tr.kbModal.levelLabel(d.nivel)}</span>
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-x-3 text-footnote text-text-muted">
                        <span className="shrink-0">{d.dominio}</span>
                        <span className="shrink-0 tabular-nums">{tr.kbModal.pageCount(d.pageCount)}</span>
                        <span className="truncate">{d.filename}</span>
                      </div>
                      <div
                        className={`mt-0.5 inline-flex items-center gap-1 text-footnote ${used ? 'text-ai-accent' : 'text-text-faint'}`}
                        title={used ? tr.kb.lastUsedTitle(used.lastLabel) : undefined}
                      >
                        {used && <span aria-hidden>✦</span>}
                        {used ? tr.kb.usedCount(used.count) : tr.kb.neverUsed}
                      </div>
                      {d.tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {d.tags.slice(0, 6).map((tag) => (
                            <span key={tag} className="chip h-[18px] px-1.5">
                              {tag}
                            </span>
                          ))}
                          {d.tags.length > 6 && (
                            <span className="chip h-[18px] bg-transparent px-1 text-text-muted">
                              +{d.tags.length - 6}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {confirming ? (
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <span className="text-footnote text-text-secondary">{tr.kb.removeAsk}</span>
                      <button
                        type="button"
                        onClick={() => {
                          removeDoc(d.id);
                          setConfirmRemoveId(null);
                          if (expandedId === d.id) setExpandedId(null);
                        }}
                        className="tap btn btn-danger btn-sm"
                      >
                        {tr.kb.removeYes}
                      </button>
                      <button
                        type="button"
                        autoFocus
                        onClick={() => setConfirmRemoveId(null)}
                        className="tap btn btn-secondary btn-sm"
                      >
                        {tr.kb.removeNo}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveId(d.id)}
                      aria-label={tr.kb.removeAria(d.titulo)}
                      className="tap btn btn-ghost btn-sm -mr-2 shrink-0 hover:!text-state-problem"
                    >
                      {tr.kbModal.removeBtn}
                    </button>
                  )}
                </div>

                {expanded && full && (
                  <div className="space-y-3 bg-bg-elevated/50 pb-4 pl-[68px] pr-5 text-control">
                    <div className="space-y-1">
                      <div className="label">{tr.kbModal.summary}</div>
                      <ul className="list-disc space-y-0.5 pl-4 text-text-secondary marker:text-text-faint">
                        {full.summary.resumo.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    </div>
                    {full.summary.fatos.length > 0 && (
                      <div className="space-y-1">
                        <div className="label">{tr.kbModal.facts}</div>
                        <ul className="list-disc space-y-0.5 pl-4 text-text-secondary marker:text-text-faint">
                          {full.summary.fatos.map((f, i) => (
                            <li key={i}>
                              {f.claim}
                              {f.valor && (
                                <span className="ml-1 font-mono text-footnote text-text-muted">
                                  ({f.valor})
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {full.summary.autores && (
                      <div className="text-footnote text-text-muted">{full.summary.autores}</div>
                    )}
                    <SentText text={full.extractedText} tr={tr} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className={`h-3 w-3 shrink-0 ${className ?? ''}`}>
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Folha com canto dobrado (ícone de documento estilo Finder).
function DocGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 2.5h6.5L15.5 6.5v11H5z" />
      <path d="M11.5 2.5v4h4M7.5 10.5h5.5M7.5 13.5h5.5" />
    </svg>
  );
}

// "Ver texto enviado": o trecho exato que foi pro modelo no resumo. Só
// calcula/renderiza quando aberto (pode ter ~40k caracteres).
function SentText({ text, tr }: { text: string; tr: Messages }) {
  const [show, setShow] = useState(false);
  const sent = useMemo(() => (show ? textSentToModel(text) : ''), [show, text]);
  return (
    <div>
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-expanded={show}
        className="tap -ml-1 inline-flex items-center gap-1.5 rounded-chip px-1 py-0.5 text-footnote text-text-muted transition-colors duration-120 ease-mac hover:text-text-primary"
      >
        <Chevron
          className={`text-text-faint transition-transform duration-180 ease-mac ${show ? 'rotate-90' : ''}`}
        />
        {tr.kb.viewSentText}
      </button>
      {show && (
        <div className="mt-1.5 space-y-1.5">
          <div className="text-footnote tabular-nums text-text-muted">{tr.kb.sentTextNote(sent.length)}</div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-control bg-bg-secondary p-3 font-mono text-footnote text-text-secondary shadow-[inset_0_0_0_1px_rgb(var(--border-base)/0.7)]">
            {sent}
          </pre>
        </div>
      )}
    </div>
  );
}

function errorFor(p: IngestProgress, tr: Messages): ClassifiedAIError {
  switch (p.errorKind) {
    case 'notPdf':
      return { kind: 'unknown', title: `${p.filename}: ${tr.kb.errNotPdf}`, hint: tr.kb.errNotPdfHint };
    case 'noText':
      return { kind: 'unknown', title: `${p.filename}: ${tr.kb.errNoText}`, hint: tr.kb.errNoTextHint };
    case 'summary':
      return {
        ...(p.errorInfo ?? { kind: 'unknown', hint: '' }),
        title: `${tr.kb.errSummaryPrefix(p.filename)} — ${p.errorInfo?.title ?? p.error ?? ''}`,
      };
    default:
      return {
        kind: 'unknown',
        title: `${p.filename}: ${tr.kb.errExtract}`,
        hint: tr.kb.errExtractHint,
        detail: p.error,
      };
  }
}

// Linha da fila: ícone de estado + nome do arquivo + fase.
function QueueLine({
  icon,
  name,
  status,
  tone = 'muted',
}: {
  icon: ReactNode;
  name: string;
  status: string;
  tone?: 'muted' | 'ok' | 'ai';
}) {
  const statusColor =
    tone === 'ok' ? 'text-state-done' : tone === 'ai' ? 'text-ai-accent' : 'text-text-muted';
  return (
    <div className="flex min-h-[28px] items-center gap-2.5 rounded-control bg-bg-elevated/50 px-3 py-1.5 text-footnote">
      <span className="grid h-4 w-4 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-text-primary">{name}</span>
      <span className={`shrink-0 tabular-nums ${statusColor}`}>{status}</span>
    </div>
  );
}

function IngestRow({
  it,
  tr,
  onRetry,
  onDismiss,
}: {
  it: QueueItem;
  tr: Messages;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const p = it.progress;
  if (!p) {
    return (
      <QueueLine
        icon={<span className="h-1.5 w-1.5 rounded-full bg-text-faint" />}
        name={it.file.name}
        status={tr.kb.queued}
      />
    );
  }
  if (p.phase === 'error') {
    // Só a falha do resumo (IA) vale repetir; as outras são do próprio arquivo.
    const canRetry = p.errorKind === 'summary';
    return (
      <InlineError
        error={errorFor(p, tr)}
        onRetry={canRetry ? onRetry : undefined}
        onAction={{ label: tr.kb.dismiss, onClick: onDismiss }}
        className="text-footnote"
      />
    );
  }
  if (p.phase === 'done') {
    return (
      <QueueLine
        icon={
          p.duplicate ? (
            <span className="text-text-muted">=</span>
          ) : (
            <span className="grid h-4 w-4 place-items-center rounded-full bg-state-done text-accent-fg">
              <svg viewBox="0 0 12 12" aria-hidden className="h-3 w-3">
                <path
                  d="M2.5 6.3l2.3 2.3 4.7-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray="1"
                  className="animate-check-draw"
                />
              </svg>
            </span>
          )
        }
        name={p.filename}
        status={p.duplicate ? tr.kb.duplicate : tr.kb.added}
        tone={p.duplicate ? 'muted' : 'ok'}
      />
    );
  }
  const label = p.phase === 'extracting' ? tr.kbModal.extracting : tr.kbModal.summarizing;
  const pageInfo =
    p.phase === 'extracting' && p.totalPages ? ` ${p.pagesDone ?? 0}/${p.totalPages}` : '';
  return (
    <QueueLine
      icon={
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ai-accent/25 border-t-ai-accent" />
      }
      name={p.filename}
      status={`${label}${pageInfo}…`}
      tone="ai"
    />
  );
}
