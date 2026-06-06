import { useGraphStore, projectMetrics } from '@/store';
import { useT } from '@/i18n';

export function StatusBar() {
  const tr = useT();
  const project = useGraphStore((s) => s.project);
  const pending = useGraphStore((s) => s.pendingSuggestions);
  const m = projectMetrics(project);

  if (!m) return null;

  return (
    <div className="min-h-7 shrink-0 border-t border-border-base bg-bg-secondary px-2 sm:px-3 flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-0.5 py-1 text-[11px] font-mono text-text-secondary pb-[calc(env(safe-area-inset-bottom)+0.25rem)]">
      <span>
        {tr.statusBar.progress}:{' '}
        <span
          className={
            m.progress.percent === 100 && m.progress.doneWithoutSignal === 0
              ? 'text-state-done'
              : m.progress.percent === 100
              ? 'text-conf-mid'
              : m.progress.percent >= 50
              ? 'text-conf-high'
              : 'text-conf-mid'
          }
        >
          {m.progress.percent}%
        </span>{' '}
        <span className="text-text-muted">
          ({m.progress.done}/{m.progress.total})
        </span>
      </span>
      {m.progress.doneWithoutSignal > 0 && (
        <span className="text-conf-mid" title={tr.statusBar.noAnchorTitle}>
          {tr.statusBar.noAnchor(m.progress.doneWithoutSignal)}
        </span>
      )}
      <span className="hidden sm:inline text-text-muted">|</span>
      <span>{tr.statusBar.nodes(m.nodeCount)}</span>
      <span className="hidden md:inline text-text-muted">|</span>
      <span className="hidden md:inline">{tr.statusBar.edges(m.edgeCount)}</span>
      <span className="hidden md:inline text-text-muted">|</span>
      <span className="hidden md:inline">
        {tr.statusBar.confidence}:{' '}
        <span
          className={
            m.avgConfidence >= 70
              ? 'text-conf-high'
              : m.avgConfidence >= 40
              ? 'text-conf-mid'
              : 'text-conf-low'
          }
        >
          {m.avgConfidence}%
        </span>
      </span>
      {m.atRisk > 0 && (
        <>
          <span className="hidden sm:inline text-text-muted">|</span>
          <span className="text-conf-low">
            {m.atRisk}
            <span className="hidden sm:inline"> {tr.statusBar.atRiskSuffix}</span>
            <span className="sm:hidden">⚠</span>
          </span>
        </>
      )}
      {pending && (
        <span className="ml-auto text-ai-accent flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-ai-accent animate-pulse-subtle" />
          <span>{tr.statusBar.pendingSuggestions(pending.nodes.length)}</span>
        </span>
      )}
    </div>
  );
}
