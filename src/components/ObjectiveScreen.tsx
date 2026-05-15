import { useRef, useState } from 'react';
import { generatePlans, type PlanProgressEvent } from '@/ai/service';
import { useGraphStore } from '@/store';
import { useKBStore } from '@/kb/store';
import { useT } from '@/i18n';
import type { AIPlan } from '@/types';
import type { Messages } from '@/i18n';
import { KnowledgeRepo } from './KnowledgeRepo';

export function ObjectiveScreen() {
  const tr = useT();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [plans, setPlans] = useState<AIPlan[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [progress, setProgress] = useState<PlanProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const [kbUsed, setKbUsed] = useState<{ titulo: string; docId: string }[]>([]);
  const progressRef = useRef<HTMLDivElement | null>(null);

  const createProjectFromPlan = useGraphStore((s) => s.createProjectFromPlan);
  const kbCount = useKBStore((s) => Object.keys(s.docs).length);
  const getContextFor = useKBStore((s) => s.getContextFor);

  const handleGenerate = async () => {
    if (!objective.trim()) return;
    setLoading(true);
    setError(null);
    setKbUsed([]);
    setProgress({ phase: 'connecting', chunkCount: 0, elapsedMs: 0 });
    try {
      const kbContext = await getContextFor({
        label: tr.notify.objectivePromptLabel(objective.trim()),
      });
      if (kbContext.length > 0) {
        setKbUsed(kbContext.map((c) => ({ titulo: c.titulo, docId: c.docId })));
      }
      const generated = await generatePlans(
        objective.trim(),
        (ev) => setProgress(ev),
        kbContext,
      );
      setPlans(generated);
      setSelectedId(generated[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!plans || !selectedId) return;
    const plan = plans.find((p) => p.id === selectedId);
    if (!plan) return;
    createProjectFromPlan(objective.trim(), name.trim() || 'Project', plan);
  };

  return (
    <div className="fixed inset-0 bg-bg-primary flex items-start justify-center overflow-y-auto">
      <div className="w-full max-w-5xl p-4 sm:p-8">
        <div className="mb-8 sm:mb-10 flex items-start gap-3">
          <div className="flex-1">
            <div className="text-ai-accent text-xs font-mono uppercase tracking-widest mb-2">
              {tr.objective.kicker}
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-text-primary mb-2">
              {tr.objective.title}
            </h1>
            <p className="text-text-secondary text-sm">{tr.objective.lead}</p>
          </div>
          <button
            onClick={() => setKbOpen(true)}
            className="px-3 py-1.5 text-xs border border-border-base rounded-sm text-text-secondary hover:text-ai-accent hover:border-ai-accent/40 transition-colors flex items-center gap-2"
            title={tr.objective.kbTitle}
          >
            <span>{tr.objective.kbBadge}</span>
            {kbCount > 0 && (
              <span className="font-mono text-[10px] text-ai-accent bg-ai-accent/10 px-1.5 py-0.5 rounded-[2px]">
                {kbCount}
              </span>
            )}
          </button>
        </div>

        {kbUsed.length > 0 && (
          <div className="mb-4 max-w-2xl text-[11px] bg-ai-accent/5 border border-ai-accent/30 rounded-sm px-3 py-2">
            <span className="font-mono uppercase tracking-wider text-ai-accent">
              {tr.objective.baseUsed}
            </span>{' '}
            <span className="text-text-secondary">
              {kbUsed.map((k) => k.titulo).join(' · ')}
            </span>
          </div>
        )}

        <KnowledgeRepo open={kbOpen} onClose={() => setKbOpen(false)} />

        {!plans && (
          <div className="space-y-4 max-w-2xl">
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1.5">
                {tr.objective.projectNameLabel}
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                placeholder={tr.objective.projectNamePlaceholder}
                className="w-full bg-bg-secondary border border-border-base rounded-sm px-3 py-2 text-sm focus:border-ai-accent outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1.5">
                {tr.objective.objectiveLabel}
              </label>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                disabled={loading}
                placeholder={tr.objective.objectivePlaceholder}
                rows={3}
                className="w-full bg-bg-secondary border border-border-base rounded-sm px-3 py-2 text-sm focus:border-ai-accent outline-none resize-none disabled:opacity-50"
              />
              <div className="mt-2 flex gap-2 flex-wrap">
                <button
                  onClick={() => {
                    setName(tr.objective.examplePipaName);
                    setObjective(tr.objective.examplePipaObjective);
                  }}
                  disabled={loading}
                  className="text-[11px] font-mono text-text-muted hover:text-text-primary border border-border-base rounded-sm px-2 py-0.5 transition-colors disabled:opacity-50"
                >
                  {tr.objective.examplePipa}
                </button>
                <button
                  onClick={() => {
                    setName(tr.objective.exampleSpeakerName);
                    setObjective(tr.objective.exampleSpeakerObjective);
                  }}
                  disabled={loading}
                  className="text-[11px] font-mono text-text-muted hover:text-text-primary border border-border-base rounded-sm px-2 py-0.5 transition-colors disabled:opacity-50"
                >
                  {tr.objective.exampleSpeaker}
                </button>
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || !objective.trim()}
              className="w-full bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-ai-accent text-sm py-3 rounded-sm border border-ai-accent/40 transition-colors font-medium"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner />
                  {tr.objective.generating(
                    phaseLabel(progress?.phase, tr),
                    formatElapsed(progress?.elapsedMs, tr),
                  )}
                </span>
              ) : (
                tr.objective.generate
              )}
            </button>

            {loading && progress && (
              <div
                ref={progressRef}
                className="border border-ai-accent/30 bg-ai-accent/5 rounded-sm p-4 space-y-3 font-mono text-[11px]"
              >
                <ProgressHeader progress={progress} tr={tr} />
                <PartialPlansPreview progress={progress} tr={tr} />
                {progress.reasoning && (
                  <ReasoningPanel
                    reasoning={progress.reasoning}
                    open={showReasoning}
                    onToggle={() => setShowReasoning((v) => !v)}
                    tr={tr}
                  />
                )}
              </div>
            )}

            {error && (
              <div className="border border-red-500/40 bg-red-500/10 text-red-300 rounded-sm p-3 text-xs">
                <div className="font-mono uppercase tracking-wider text-[10px] mb-1">
                  {tr.objective.errorLabel}
                </div>
                {error}
              </div>
            )}
          </div>
        )}

        {plans && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-text-secondary text-sm">{tr.objective.pickPlanHint}</div>
              <button
                onClick={() => {
                  setPlans(null);
                  setProgress(null);
                }}
                className="text-text-muted hover:text-text-secondary text-xs"
              >
                ← {tr.common.back}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {plans.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`text-left p-4 rounded-sm border-2 transition-all flex flex-col ${
                    selectedId === p.id
                      ? 'border-ai-accent bg-ai-accent/5'
                      : 'border-border-base bg-bg-secondary hover:border-text-muted'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-ai-accent text-xs font-mono">◆</span>
                    <span className="text-sm font-semibold">{p.title}</span>
                  </div>
                  <div className="text-[11px] text-text-secondary mb-3 leading-snug">
                    {p.pitch}
                  </div>

                  {p.tree.categorias.map((cat) => (
                    <div key={cat.tempId} className="mt-2 border-t border-border-base pt-2">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
                        {cat.name} · {cat.children.length}
                      </div>
                      <div className="space-y-0.5">
                        {cat.children.slice(0, 4).map((n) => (
                          <div key={n.tempId} className="text-[11px] text-text-secondary leading-snug">
                            <span className="text-text-muted font-mono">·</span> {n.name}
                          </div>
                        ))}
                        {cat.children.length > 4 && (
                          <div className="text-[10px] text-text-muted italic">
                            +{cat.children.length - 4}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </button>
              ))}
            </div>

            {progress?.reasoning && (
              <ReasoningPanel
                reasoning={progress.reasoning}
                open={showReasoning}
                onToggle={() => setShowReasoning((v) => !v)}
                tr={tr}
              />
            )}

            <button
              onClick={handleConfirm}
              disabled={!selectedId}
              className="w-full bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 text-ai-accent text-sm py-3 rounded-sm border border-ai-accent/40 transition-colors font-medium"
            >
              {tr.objective.startWithThisPlan}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-3 h-3 border-2 border-ai-accent/40 border-t-ai-accent rounded-full animate-spin"
      aria-hidden
    />
  );
}

function phaseLabel(phase: PlanProgressEvent['phase'] | undefined, tr: Messages): string {
  switch (phase) {
    case 'connecting':
      return tr.objective.phaseConnecting;
    case 'streaming':
      return tr.objective.phaseStreaming;
    case 'finalizing':
      return tr.objective.phaseFinalizing;
    case 'done':
      return tr.objective.phaseDone;
    case 'error':
      return tr.objective.phaseError;
    default:
      return '';
  }
}

function formatElapsed(ms: number | undefined, tr: Messages): string {
  if (ms == null) return '';
  return `(${tr.objective.elapsedSecs(ms / 1000)})`;
}

function ProgressHeader({ progress, tr }: { progress: PlanProgressEvent; tr: Messages }) {
  return (
    <div className="flex items-center justify-between text-ai-accent/80">
      <span>
        {tr.objective.phaseLabel}{' '}
        <span className="text-ai-accent font-semibold">{phaseLabel(progress.phase, tr)}</span>
      </span>
      <span className="text-text-muted">
        {tr.objective.chunks(progress.chunkCount)} · {tr.objective.elapsedSecs(progress.elapsedMs / 1000)}
      </span>
    </div>
  );
}

function PartialPlansPreview({ progress, tr }: { progress: PlanProgressEvent; tr: Messages }) {
  const plans = progress.partial?.plans;
  if (!plans || plans.length === 0) {
    return (
      <div className="text-text-muted italic">
        {progress.phase === 'connecting'
          ? tr.objective.awaitingFirstToken
          : tr.objective.startingDraft}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {plans.map((p, i) => (
        <div key={i} className="border-l-2 border-ai-accent/40 pl-3">
          <div className="text-text-primary">
            <span className="text-ai-accent">◆</span>{' '}
            <span className="font-semibold">{p?.title ?? '…'}</span>
          </div>
          {p?.pitch && (
            <div className="text-text-secondary text-[10px] leading-snug mt-0.5">{p.pitch}</div>
          )}
          {p?.tree?.categorias && p.tree.categorias.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {p.tree.categorias.map((cat, j) => (
                <div key={j} className="text-text-muted text-[10px]">
                  <span className="text-ai-accent/60">›</span> {cat?.name ?? '…'}
                  {cat?.children && cat.children.length > 0 && (
                    <span className="text-text-muted/70">
                      {' '}
                      · {cat.children.length}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ReasoningPanel({
  reasoning,
  open,
  onToggle,
  tr,
}: {
  reasoning: string;
  open: boolean;
  onToggle: () => void;
  tr: Messages;
}) {
  return (
    <div className="border border-border-base bg-bg-secondary rounded-sm">
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-text-muted hover:text-text-primary flex items-center justify-between"
      >
        <span>{tr.objective.reasoningHeader}</span>
        <span className="text-text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border-t border-border-base px-3 py-2 text-[11px] text-text-secondary whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
          {reasoning}
        </div>
      )}
    </div>
  );
}
