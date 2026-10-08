import { useGraphStore, projectMetrics, pendingParent } from '@/store';
import { useT } from '@/i18n';

export function StatusBar() {
  const tr = useT();
  const project = useGraphStore((s) => s.project);
  const pending = useGraphStore((s) => s.pendingSuggestions);
  const pendingNode = useGraphStore(pendingParent);
  const parked = useGraphStore((s) => s.parkedSuggestions);
  const viewMode = useGraphStore((s) => s.viewMode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const requestCenter = useGraphStore((s) => s.requestCenter);
  const m = projectMetrics(project);
  // Sugestões fora do progresso: um selo à parte, somando os lotes estacionados.
  const parkedIds = Object.keys(parked).filter((id) => project?.nodes[id]);
  const suggestionCount =
    (pending?.nodes.length ?? 0) + parkedIds.reduce((acc, id) => acc + parked[id].nodes.length, 0);
  const reviewTarget = pendingNode?.id ?? parkedIds[0] ?? null;

  // No tutor o progresso mora no anel da toolbar (indicador único) e a barra
  // de ações do card ocupa o rodapé — a status bar só repetiria números.
  if (!m || viewMode === 'tutor') return null;

  const pct = m.progress.percent;
  const pctTone =
    pct === 100 && m.progress.doneWithoutSignal === 0
      ? 'text-state-done'
      : pct === 100
      ? 'text-conf-mid'
      : pct >= 50
      ? 'text-conf-high'
      : 'text-conf-mid';

  return (
    <div
      className={`glass min-h-[24px] shrink-0 border-t px-3 sm:px-4 flex flex-wrap items-center gap-x-4 gap-y-0.5 py-1 text-caption text-text-muted tabular-nums pb-[calc(env(safe-area-inset-bottom)+0.25rem)]`}
    >
      <span>
        {tr.statusBar.progress}{' '}
        <span className={`font-medium ${pctTone}`}>{pct}%</span>{' '}
        <span className="text-text-faint">
          {m.progress.done}/{m.progress.total}
        </span>
      </span>
      {m.progress.doneWithoutSignal > 0 && (
        <span className="text-conf-mid" title={tr.statusBar.noAnchorTitle}>
          {tr.statusBar.noAnchor(m.progress.doneWithoutSignal)}
        </span>
      )}
      <span className="hidden sm:inline">{tr.statusBar.nodes(m.nodeCount)}</span>
      {m.atRisk > 0 && (
        <span className="text-conf-low">
          {m.atRisk}
          <span className="hidden sm:inline"> {tr.statusBar.atRiskSuffix}</span>
          <span className="sm:hidden" aria-hidden>
            {' '}⚠
          </span>
        </span>
      )}
      {suggestionCount > 0 && (
        <button
          type="button"
          onClick={() => {
            if (!reviewTarget) return;
            selectNode(reviewTarget);
            if (viewMode === 'graph') requestCenter(reviewTarget);
          }}
          title={tr.statusBar.reviewPendingTitle}
          className="tap ml-auto -my-0.5 inline-flex items-center gap-1.5 rounded-chip px-1.5 py-0.5 font-medium text-ai-accent transition-colors duration-120 ease-mac hover:bg-ai-accent/12"
        >
          <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-ai-accent animate-pulse-subtle" />
          <span>{tr.statusBar.pendingSuggestions(suggestionCount)}</span>
        </button>
      )}
    </div>
  );
}
