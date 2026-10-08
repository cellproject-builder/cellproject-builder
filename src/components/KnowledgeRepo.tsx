import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
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
        <span className="flex items-baseline gap-3">
          <span className="text-ai-accent font-mono text-xs uppercase tracking-widest">
            {tr.kbModal.title}
          </span>
          <span className="text-text-muted text-xs font-normal">
            {tr.kbModal.docCount(docs.length)}
          </span>
        </span>
      }
    >
      <div className="space-y-3">
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
          className={`block border border-dashed rounded-sm p-4 text-center transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ai-accent ${
            dragActive
              ? 'border-ai-accent bg-ai-accent/10'
              : 'border-border-base hover:border-ai-accent/40 hover:bg-ai-accent/5'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            tabIndex={-1}
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
          {dragActive ? (
            <div className="text-sm text-ai-accent py-1">↓ {tr.kb.dropActive}</div>
          ) : (
            <div className="text-sm text-text-secondary">
              <span className="text-ai-accent">+</span> {tr.kbModal.dropOrClick}
              <div className="text-[11px] text-text-muted mt-1 max-w-xl mx-auto">
                {tr.kbModal.dropHint}
              </div>
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="space-y-1.5" aria-live="polite">
            {running && items.length > 1 && (
              <div className="text-[11px] font-mono text-text-muted">
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
                className="text-[11px] text-text-muted hover:text-text-primary underline-offset-2 hover:underline"
              >
                {tr.kb.clearFinished}
              </button>
            )}
          </div>
        )}

        {docs.length > 0 && (
          <p className="text-[11px] text-text-muted leading-relaxed">{tr.kb.howItWorks}</p>
        )}

        {docs.length >= FILTER_MIN_DOCS && (
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={tr.kb.filterPlaceholder}
            aria-label={tr.kb.filterPlaceholder}
            className="w-full bg-bg-primary border border-border-base rounded-sm px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ai-accent/60"
          />
        )}

        <div className="-mx-4 border-t border-border-base">
          {docs.length === 0 && (
            <div className="p-8 text-center text-text-muted text-sm italic">
              {tr.kbModal.emptyState}
            </div>
          )}
          {docs.length > 0 && visibleDocs.length === 0 && (
            <div className="p-6 text-center text-text-muted text-sm italic">
              {tr.kb.filterEmpty}
            </div>
          )}
          {visibleDocs.map((d) => {
            const full = docsMap[d.id];
            const expanded = expandedId === d.id;
            const confirming = confirmRemoveId === d.id;
            const used = usage[d.id];
            return (
              <div key={d.id} className="border-b border-border-base">
                <div className="px-4 py-3 flex items-start gap-3 hover:bg-bg-primary/40">
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
                    className="flex-1 min-w-0 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ai-accent rounded-sm"
                  >
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-sm text-text-primary font-medium truncate">
                        {d.titulo}
                      </span>
                      <span className="text-[10px] font-mono text-text-muted shrink-0">
                        {tr.kbModal.levelLabel(d.nivel)}
                      </span>
                    </div>
                    <div className="text-[11px] text-text-muted flex items-center gap-2 min-w-0">
                      <span className="shrink-0">{d.dominio}</span>
                      <span className="text-border-base">·</span>
                      <span className="font-mono shrink-0">{tr.kbModal.pageCount(d.pageCount)}</span>
                      <span className="text-border-base">·</span>
                      <span className="truncate">{d.filename}</span>
                    </div>
                    <div
                      className={`text-[11px] mt-0.5 ${used ? 'text-ai-accent/80' : 'text-text-muted'}`}
                      title={used ? tr.kb.lastUsedTitle(used.lastLabel) : undefined}
                    >
                      {used ? tr.kb.usedCount(used.count) : tr.kb.neverUsed}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {d.tags.slice(0, 6).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] font-mono px-1.5 py-0.5 bg-bg-elevated border border-border-base rounded-[2px] text-text-secondary"
                        >
                          {tag}
                        </span>
                      ))}
                      {d.tags.length > 6 && (
                        <span className="text-[10px] font-mono text-text-muted">
                          +{d.tags.length - 6}
                        </span>
                      )}
                    </div>
                  </div>
                  {confirming ? (
                    <div className="flex items-center gap-1.5 shrink-0 text-xs">
                      <span className="text-text-secondary">{tr.kb.removeAsk}</span>
                      <button
                        type="button"
                        onClick={() => {
                          removeDoc(d.id);
                          setConfirmRemoveId(null);
                          if (expandedId === d.id) setExpandedId(null);
                        }}
                        className="tap rounded border border-state-problem/50 px-2 py-0.5 text-state-problem hover:bg-state-problem/15"
                      >
                        {tr.kb.removeYes}
                      </button>
                      <button
                        type="button"
                        autoFocus
                        onClick={() => setConfirmRemoveId(null)}
                        className="tap rounded border border-border-base px-2 py-0.5 text-text-primary hover:bg-bg-elevated"
                      >
                        {tr.kb.removeNo}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveId(d.id)}
                      aria-label={tr.kb.removeAria(d.titulo)}
                      className="tap text-text-muted hover:text-state-problem text-xs px-1 py-0.5 shrink-0"
                    >
                      {tr.kbModal.removeBtn}
                    </button>
                  )}
                </div>

                {expanded && full && (
                  <div className="px-4 py-3 bg-bg-primary/40 border-t border-border-base space-y-2 text-xs">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
                        {tr.kbModal.summary}
                      </div>
                      <ul className="space-y-0.5 pl-3">
                        {full.summary.resumo.map((b, i) => (
                          <li key={i} className="relative text-text-secondary leading-relaxed">
                            <span className="absolute -left-3 text-text-muted">·</span>
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {full.summary.fatos.length > 0 && (
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
                          {tr.kbModal.facts}
                        </div>
                        <ul className="space-y-0.5 pl-3">
                          {full.summary.fatos.map((f, i) => (
                            <li key={i} className="relative text-text-secondary leading-relaxed">
                              <span className="absolute -left-3 text-ai-accent">◆</span>
                              {f.claim}
                              {f.valor && (
                                <span className="font-mono text-text-muted ml-1">
                                  ({f.valor})
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {full.summary.autores && (
                      <div className="text-[11px] text-text-muted italic">
                        — {full.summary.autores}
                      </div>
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
        className="text-[11px] text-text-muted hover:text-text-primary underline-offset-2 hover:underline"
      >
        {show ? '▾' : '▸'} {tr.kb.viewSentText}
      </button>
      {show && (
        <div className="mt-1">
          <div className="text-[11px] text-text-muted mb-1">{tr.kb.sentTextNote(sent.length)}</div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary bg-bg-primary border border-border-base rounded-sm p-2">
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
      <div className="text-xs text-text-muted">
        · {it.file.name} — {tr.kb.queued}
      </div>
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
        className="text-xs"
      />
    );
  }
  if (p.phase === 'done') {
    return (
      <div className={`text-xs ${p.duplicate ? 'text-text-secondary' : 'text-state-done'}`}>
        {p.duplicate ? '=' : '✓'} {p.filename} — {p.duplicate ? tr.kb.duplicate : tr.kb.added}
      </div>
    );
  }
  const label = p.phase === 'extracting' ? tr.kbModal.extracting : tr.kbModal.summarizing;
  const pageInfo =
    p.phase === 'extracting' && p.totalPages ? ` ${p.pagesDone ?? 0}/${p.totalPages}` : '';
  return (
    <div className="text-xs text-ai-accent">
      ◆ {p.filename} — {label}
      {pageInfo}…
    </div>
  );
}
