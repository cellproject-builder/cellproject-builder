import { useMemo, useRef, useState } from 'react';
import { useKBStore, type IngestProgress } from '@/kb/store';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function KnowledgeRepo({ open, onClose }: Props) {
  // Selecionamos o Record bruto (referência estável) e derivamos a lista via
  // useMemo. Chamar s.list() direto no seletor cria um array novo a cada render
  // e quebra a igualdade estrutural do Zustand → loop infinito → tela preta.
  const docsMap = useKBStore((s) => s.docs);
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
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!open) return null;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        setProgress({ phase: 'error', filename: file.name, error: 'Apenas PDF por enquanto.' });
        continue;
      }
      await addFromPdf(file, (p) => setProgress(p));
    }
    // Limpa depois de um instante, sem travar o usuário pra ver o último estado.
    setTimeout(() => setProgress(null), 2000);
    if (inputRef.current) inputRef.current.value = '';
  };

  const busy =
    progress?.phase === 'extracting' || progress?.phase === 'summarizing';

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto p-0 sm:p-6 md:p-8"
      onClick={onClose}
    >
      <div
        className="w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-3xl bg-bg-primary border-0 sm:border border-border-base rounded-none sm:rounded-sm shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border-base flex items-baseline gap-3">
          <div className="text-ai-accent font-mono text-xs uppercase tracking-widest">
            ◆ Repositório de conhecimento
          </div>
          <div className="text-text-muted text-xs">
            {docs.length} documento{docs.length === 1 ? '' : 's'}
          </div>
          <button
            onClick={onClose}
            className="ml-auto text-text-muted hover:text-text-primary text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Upload */}
        <div className="p-4 border-b border-border-base">
          <label
            className={`block border border-dashed rounded-sm p-4 text-center transition-colors cursor-pointer ${
              busy
                ? 'border-ai-accent/40 bg-ai-accent/5 cursor-wait'
                : 'border-border-base hover:border-ai-accent/40 hover:bg-ai-accent/5'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              disabled={busy}
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
            />
            {!progress && (
              <div className="text-sm text-text-secondary">
                <span className="text-ai-accent">+</span> Solte ou clique pra adicionar PDFs
                <div className="text-[11px] text-text-muted mt-1">
                  O PDF fica no seu disco. Só o texto extraído é processado.
                </div>
              </div>
            )}
            {progress && <IngestStatus p={progress} />}
          </label>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {docs.length === 0 && (
            <div className="p-8 text-center text-text-muted text-sm italic">
              Nenhum documento ainda. Adicione PDFs acima e eles viram contexto que a IA pode usar
              ao planejar.
            </div>
          )}
          {docs.map((d) => {
            const full = docsMap[d.id];
            const expanded = expandedId === d.id;
            return (
              <div key={d.id} className="border-b border-border-base">
                <div
                  className="p-3 flex items-start gap-3 hover:bg-bg-secondary/50 cursor-pointer"
                  onClick={() => setExpandedId(expanded ? null : d.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-sm text-text-primary font-medium truncate">
                        {d.titulo}
                      </span>
                      <span className="text-[10px] font-mono text-text-muted shrink-0">
                        {d.nivel}
                      </span>
                    </div>
                    <div className="text-[11px] text-text-muted flex items-center gap-2">
                      <span>{d.dominio}</span>
                      <span className="text-border-base">·</span>
                      <span className="font-mono">{d.pageCount}p</span>
                      <span className="text-border-base">·</span>
                      <span className="truncate">{d.filename}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {d.tags.slice(0, 6).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] font-mono px-1.5 py-0.5 bg-bg-elevated border border-border-base rounded-[2px] text-text-secondary"
                        >
                          {t}
                        </span>
                      ))}
                      {d.tags.length > 6 && (
                        <span className="text-[10px] font-mono text-text-muted">
                          +{d.tags.length - 6}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remover "${d.titulo}" do repositório?`)) {
                        removeDoc(d.id);
                        if (expandedId === d.id) setExpandedId(null);
                      }
                    }}
                    className="text-text-muted hover:text-state-problem text-xs px-1 py-0.5"
                  >
                    remover
                  </button>
                </div>

                {expanded && full && (
                  <div className="p-3 bg-bg-secondary/30 border-t border-border-base space-y-2 text-xs">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
                        Resumo
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
                          Fatos verificáveis
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IngestStatus({ p }: { p: IngestProgress }) {
  if (p.phase === 'error') {
    return (
      <div className="text-xs text-state-problem">
        ⚠ {p.filename}: {p.error}
      </div>
    );
  }
  if (p.phase === 'done') {
    return (
      <div className="text-xs text-state-done">
        ✓ {p.filename} pronto.
      </div>
    );
  }
  const label = p.phase === 'extracting' ? 'Extraindo texto' : 'Resumindo';
  const pageInfo =
    p.phase === 'extracting' && p.totalPages
      ? ` ${p.pagesDone ?? 0}/${p.totalPages}`
      : '';
  return (
    <div className="text-xs text-ai-accent">
      ◆ {p.filename} — {label}{pageInfo}…
    </div>
  );
}
