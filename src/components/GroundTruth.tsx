import { useState } from 'react';
import type { ConceptNodeData, GroundTruthKind, GroundTruthRef, Project } from '@/types';
import { useGraphStore, breadcrumbFor, hintsToRefs } from '@/store';
import { useKBStore } from '@/kb/store';
import { useT } from '@/i18n';
import {
  critiqueNode,
  replanFromFailure,
} from '@/ai/service';
import { requireAI } from '@/ai/availability';

// ---------------------------------------------------------------------------
// (a) User-written criterion — locked before seeing the AI's
// ---------------------------------------------------------------------------

export function UserCriterionField({ node }: { node: ConceptNodeData }) {
  const tr = useT();
  const setUserCriterion = useGraphStore((s) => s.setUserCriterion);
  const attestCriterion = useGraphStore((s) => s.attestCriterion);
  const [draft, setDraft] = useState('');
  const [metDraft, setMetDraft] = useState('');

  const locked = Boolean(node.comoConfirmarUsuarioAt);
  // The AI's criterion is revealed ONLY after the user locks theirs — no peek
  // before lock, so the user cannot copy it. Closes the attack-(a) bypass.
  const showAI = locked;

  if (node.kind !== 'recurso' && node.kind !== 'passo' && node.kind !== 'decisao') {
    return null;
  }

  const handleLock = () => {
    if (!draft.trim()) return;
    setUserCriterion(node.id, draft.trim());
    setDraft('');
  };

  return (
    <section className="p-3 border-b border-border-base space-y-2">
      <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted">
        {tr.groundTruth.howToConfirm}
      </label>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-ai-accent mb-1">
          {tr.groundTruth.yourCriterion}{' '}
          {locked && <span className="text-state-done">{tr.groundTruth.locked}</span>}
        </div>
        {locked ? (
          <div className="space-y-1.5">
            <div className="text-xs bg-bg-elevated border border-ai-accent/30 rounded-sm px-2 py-1.5 text-text-primary">
              {node.comoConfirmarUsuario}
            </div>
            {node.comoConfirmarAtendido ? (
              <div className="text-[11px] text-state-done bg-state-done/5 border border-state-done/20 rounded-sm px-2 py-1">
                ✓ {tr.groundTruth.criterionMet}:{' '}
                <span className="text-text-secondary">{node.comoConfirmarAtendido.observacao}</span>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-conf-mid">
                  {tr.groundTruth.criterionMetPrompt}
                </div>
                <textarea
                  value={metDraft}
                  onChange={(e) => setMetDraft(e.target.value)}
                  rows={2}
                  placeholder={tr.groundTruth.criterionMetPlaceholder}
                  className="w-full bg-bg-elevated border border-border-base rounded-sm px-2 py-1 text-xs resize-none focus:border-state-done outline-none"
                />
                <button
                  onClick={() => {
                    if (metDraft.trim()) {
                      attestCriterion(node.id, metDraft.trim());
                      setMetDraft('');
                    }
                  }}
                  disabled={!metDraft.trim()}
                  className="w-full text-[11px] bg-state-done/15 hover:bg-state-done/30 disabled:opacity-40 disabled:cursor-not-allowed text-state-done border border-state-done/40 rounded-sm py-1 transition-colors"
                >
                  {tr.groundTruth.criterionMetBtn}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder={tr.groundTruth.criterionPlaceholder}
              className="w-full bg-bg-elevated border border-border-base rounded-sm px-2 py-1 text-xs resize-none focus:border-ai-accent outline-none"
            />
            <div className="mt-1">
              <button
                onClick={handleLock}
                disabled={!draft.trim()}
                className="w-full text-[11px] bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-ai-accent border border-ai-accent/40 rounded-sm py-1 transition-colors"
              >
                {tr.groundTruth.lockBtn}
              </button>
            </div>
          </>
        )}
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
          {tr.groundTruth.aiCriterion}{' '}
          {!showAI && <span className="italic">{tr.groundTruth.hiddenUntilLock}</span>}
        </div>
        {showAI ? (
          <div className="text-xs bg-bg-elevated border border-border-base rounded-sm px-2 py-1.5 font-mono italic text-text-secondary">
            {node.comoConfirmar || <span className="text-text-muted">{tr.groundTruth.emptyAI}</span>}
          </div>
        ) : (
          <div className="text-xs bg-bg-elevated/40 border border-dashed border-border-base rounded-sm px-2 py-1.5 text-text-muted italic">
            {tr.groundTruth.writeYoursFirst}
          </div>
        )}
      </div>

      {locked && node.comoConfirmar && node.comoConfirmarUsuario && (
        <DivergenceHint
          ai={node.comoConfirmar}
          user={node.comoConfirmarUsuario}
        />
      )}
    </section>
  );
}

function DivergenceHint({ ai, user }: { ai: string; user: string }) {
  const tr = useT();
  // Light heuristic: shared tokens / total tokens.
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-zà-ú0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 3),
    );
  const a = tokens(ai);
  const b = tokens(user);
  const inter = [...a].filter((t) => b.has(t)).length;
  const uni = new Set([...a, ...b]).size;
  const overlap = uni === 0 ? 0 : inter / uni;

  // High lexical overlap = the user echoed the AI's wording → NOT an independent
  // check (the contamination attack (a) exists to prevent). Warn on it; reward
  // genuinely independent wording instead.
  if (overlap > 0.5) {
    return (
      <div className="text-[10px] font-mono text-conf-mid bg-conf-mid/5 border border-conf-mid/30 rounded-sm px-2 py-1">
        {tr.groundTruth.convergenceCopy}
      </div>
    );
  }
  return (
    <div className="text-[10px] font-mono text-state-done/80 bg-state-done/5 border border-state-done/20 rounded-sm px-2 py-1">
      {tr.groundTruth.convergenceIndependent}
    </div>
  );
}

// ---------------------------------------------------------------------------
// (b) Adversarial critique
// ---------------------------------------------------------------------------

export function CritiqueSection({
  node,
  project,
}: {
  node: ConceptNodeData;
  project: Project;
}) {
  const tr = useT();
  const setCritica = useGraphStore((s) => s.setCritica);
  const clearCritica = useGraphStore((s) => s.clearCritica);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crumbs = breadcrumbFor(project, node.id);

  const run = async () => {
    if (!requireAI()) return;
    setRunning(true);
    setError(null);
    try {
      const result = await critiqueNode({
        projectName: project.name,
        projectObjective: project.objective,
        breadcrumb: crumbs.map((c) => c.name),
        nodeName: node.name,
        nodeKind: node.kind,
        nodeFx: node.fx,
        oQue: node.oQue,
        porQue: node.porQue,
        comoConfirmar: node.comoConfirmar,
        comoConfirmarUsuario: node.comoConfirmarUsuario,
      });
      setCritica(node.id, result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="p-3 border-b border-border-base">
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          {tr.groundTruth.adversarial}
        </label>
        {node.critica && (
          <span className="text-[10px] font-mono text-conf-mid">
            {tr.groundTruth.generatedOn(new Date(node.critica.generatedAt).toLocaleDateString(tr.detail.locale))}
          </span>
        )}
      </div>

      {!node.critica && (
        <button
          onClick={run}
          disabled={running}
          className="w-full text-[11px] bg-conf-mid/10 hover:bg-conf-mid/25 text-conf-mid border border-conf-mid/30 rounded-sm py-1.5 transition-colors disabled:opacity-50"
        >
          {running ? tr.groundTruth.generatingCritique : tr.groundTruth.askSecondOpinion}
        </button>
      )}

      {node.critica && (
        <div className="space-y-2 text-xs">
          <CritiqueGroup label={tr.groundTruth.weaknesses} items={node.critica.fraquezas} />
          {node.critica.premissasOcultas.length > 0 && (
            <CritiqueGroup
              label={tr.groundTruth.hiddenPremises}
              items={node.critica.premissasOcultas}
            />
          )}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-ai-accent mb-1">
              {tr.groundTruth.altCriterion}
            </div>
            <div className="bg-bg-elevated border border-ai-accent/30 rounded-sm px-2 py-1.5 text-text-primary italic">
              {node.critica.criterioAlternativo}
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={run}
              disabled={running}
              className="flex-1 text-[10px] font-mono text-text-muted hover:text-text-secondary border border-border-base rounded-sm py-1 transition-colors disabled:opacity-50"
            >
              {running ? tr.groundTruth.regenerating : tr.groundTruth.regenerate}
            </button>
            <button
              onClick={() => clearCritica(node.id)}
              className="text-[10px] font-mono text-text-muted hover:text-state-problem border border-border-base rounded-sm px-2 py-1 transition-colors"
            >
              {tr.groundTruth.discard}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 text-[11px] text-state-problem bg-state-problem/5 border border-state-problem/30 rounded-sm px-2 py-1">
          {error}
        </div>
      )}
    </section>
  );
}

function CritiqueGroup({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
        {label}
      </div>
      <ul className="space-y-0.5 pl-3">
        {items.map((item, i) => (
          <li key={i} className="relative text-text-secondary leading-relaxed">
            <span className="absolute -left-3 text-conf-mid">·</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// (d) Verifiable anchors list
// ---------------------------------------------------------------------------

export function GroundTruthRefsList({ node }: { node: ConceptNodeData }) {
  const tr = useT();
  const addGroundTruthRef = useGraphStore((s) => s.addGroundTruthRef);
  const toggleGroundTruthVerified = useGraphStore((s) => s.toggleGroundTruthVerified);
  const removeGroundTruthRef = useGraphStore((s) => s.removeGroundTruthRef);

  const [kind, setKind] = useState<GroundTruthKind>('spec');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [adding, setAdding] = useState(false);

  const refs = node.groundTruthRefs ?? [];
  const verifiedCount = refs.filter((r) => r.verificado).length;

  const handleAdd = () => {
    if (!label.trim() || !value.trim()) return;
    addGroundTruthRef(node.id, {
      kind,
      label: label.trim(),
      value: value.trim(),
      verificado: false,
      addedByAI: false,
    });
    setLabel('');
    setValue('');
    setAdding(false);
  };

  return (
    <section className="p-3 border-b border-border-base">
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          {tr.groundTruth.anchors}
        </label>
        <span className="text-[10px] font-mono text-text-secondary ml-auto">
          <span className={verifiedCount > 0 ? 'text-state-done' : 'text-text-muted'}>
            {verifiedCount}
          </span>
          <span className="text-text-muted">/{refs.length}</span>{' '}
          {tr.groundTruth.verifiedSuffix}
        </span>
      </div>

      {refs.length === 0 && !adding && (
        <div className="text-[11px] text-text-muted italic mb-2">{tr.groundTruth.noAnchorsHint}</div>
      )}

      {refs.length > 0 && (
        <ul className="space-y-1 mb-2">
          {refs.map((r) => (
            <RefRow
              key={r.id}
              refData={r}
              onToggle={() => toggleGroundTruthVerified(node.id, r.id)}
              onRemove={() => removeGroundTruthRef(node.id, r.id)}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-1.5 border border-ai-accent/30 rounded-sm p-2 bg-bg-elevated">
          <div className="flex gap-1">
            {(['link', 'spec', 'medida'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`text-[10px] font-mono px-2 py-0.5 rounded-sm border transition-colors ${
                  kind === k
                    ? 'bg-ai-accent/20 border-ai-accent text-ai-accent'
                    : 'border-border-base text-text-muted hover:text-text-secondary'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={tr.groundTruth.anchorLabelPlaceholder}
            className="w-full bg-bg-primary border border-border-base rounded-sm px-2 py-1 text-[11px] focus:border-ai-accent outline-none"
          />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={tr.groundTruth.anchorValuePlaceholder[kind]}
            className="w-full bg-bg-primary border border-border-base rounded-sm px-2 py-1 text-[11px] font-mono focus:border-ai-accent outline-none"
          />
          <div className="flex gap-1">
            <button
              onClick={handleAdd}
              disabled={!label.trim() || !value.trim()}
              className="flex-1 text-[11px] bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 text-ai-accent border border-ai-accent/40 rounded-sm py-1 transition-colors"
            >
              {tr.groundTruth.anchorAddBtn}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setLabel('');
                setValue('');
              }}
              className="text-[11px] text-text-muted hover:text-text-secondary border border-border-base rounded-sm px-2 py-1 transition-colors"
            >
              {tr.common.cancel.toLowerCase()}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full text-[11px] text-text-muted hover:text-ai-accent border border-dashed border-border-base hover:border-ai-accent/40 rounded-sm py-1 transition-colors"
        >
          {tr.groundTruth.addAnchor}
        </button>
      )}
    </section>
  );
}

function RefRow({
  refData,
  onToggle,
  onRemove,
}: {
  refData: GroundTruthRef;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const tr = useT();
  const isLink = refData.kind === 'link';
  return (
    <li
      className={`group flex items-start gap-2 px-2 py-1.5 rounded-sm border transition-colors ${
        refData.verificado
          ? 'border-state-done/40 bg-state-done/5'
          : 'border-border-base bg-bg-elevated/40'
      }`}
    >
      <button
        onClick={onToggle}
        className={`mt-0.5 w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
          refData.verificado
            ? 'bg-state-done/20 border-state-done text-state-done'
            : 'border-border-base hover:border-text-muted'
        }`}
        title={
          refData.verificado
            ? tr.groundTruth.anchorToggleVerify.unmark
            : tr.groundTruth.anchorToggleVerify.mark
        }
      >
        {refData.verificado && <span className="text-[10px]">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted">
            {refData.kind}
          </span>
          <span className="text-[11px] text-text-primary truncate">{refData.label}</span>
          {refData.addedByAI && (
            <span className="text-[9px] font-mono text-ai-accent/70 ml-auto shrink-0">
              {tr.groundTruth.anchorAIBadge}
            </span>
          )}
        </div>
        <div className="text-[11px] font-mono text-text-secondary break-all">
          {isLink ? (
            <a
              href={refData.value}
              target="_blank"
              rel="noreferrer"
              className="text-ai-accent hover:underline"
            >
              {refData.value}
            </a>
          ) : (
            refData.value
          )}
        </div>
      </div>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-state-problem text-[11px] transition-opacity"
        title={tr.groundTruth.anchorRemoveTitle}
      >
        ×
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// (c) Reported failure + replan from failure context
// ---------------------------------------------------------------------------

export function FailureSection({
  node,
  project,
}: {
  node: ConceptNodeData;
  project: Project;
}) {
  const tr = useT();
  const reportFailure = useGraphStore((s) => s.reportFailure);
  const clearFailure = useGraphStore((s) => s.clearFailure);
  const stageSuggestions = useGraphStore((s) => s.stageSuggestions);
  const pending = useGraphStore((s) => s.pendingSuggestions);

  const [opening, setOpening] = useState(false);
  const [draft, setDraft] = useState('');
  const [replanning, setReplanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const failed = Boolean(node.failureContext);
  const crumbs = breadcrumbFor(project, node.id);

  const handleReport = () => {
    if (!draft.trim()) return;
    reportFailure(node.id, draft.trim());
    setDraft('');
    setOpening(false);
  };

  const handleReplan = async () => {
    if (!node.failureContext) return;
    if (!requireAI()) return;
    setReplanning(true);
    setError(null);
    try {
      const siblings = Object.values(project.nodes)
        .filter((n) => n.parentId === node.parentId && n.id !== node.id)
        .map((n) => ({ name: n.name, fx: n.fx }));

      const kbContext = await useKBStore.getState().getContextFor({
        label: tr.notify.failurePromptLabel(project.objective),
        extra: tr.notify.failurePromptExtra(node.name, node.failureContext),
      });

      const result = await replanFromFailure(
        {
          projectName: project.name,
          projectObjective: project.objective,
          breadcrumb: crumbs.map((c) => c.name),
          nodeName: node.name,
          nodeKind: node.kind,
          nodeFx: node.fx,
          oQue: node.oQue,
          failureContext: node.failureContext,
          siblings,
          strategy: project.constructionStrategy,
          archetype: project.archetype,
        },
        kbContext,
      );

      const basePos = node.position;
      const spacing = 260;
      const start = basePos.x - ((result.nodes.length - 1) * spacing) / 2;
      const staged = result.nodes.map((n, i) => ({
        tempId: n.tempId,
        kind: n.kind,
        name: n.name,
        fx: n.fx,
        problem: n.problem,
        confidence: n.confidence,
        confidenceSource: 'ai' as const,
        confidenceReason: n.confidenceReason,
        pros: n.pros,
        cons: n.cons,
        oQue: n.oQue,
        porQue: n.porQue,
        comoConfirmar: n.comoConfirmar,
        confirmado: false,
        order: n.order ?? i,
        decisionOptions: n.decisionOptions,
        groundTruthRefs: hintsToRefs(n.groundTruthHints),
        state: 'concept' as const,
        notes: tr.groundTruth.failureReplanNotes(node.failureContext ?? ''),
        aiSuggested: true,
        position: { x: start + i * spacing, y: basePos.y + 260 },
      }));
      stageSuggestions(node.id, staged, result.edges);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReplanning(false);
    }
  };

  return (
    <section className="p-3 border-b border-border-base">
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          {tr.groundTruth.reality}
        </label>
        {failed && (
          <span className="text-[10px] font-mono text-state-problem ml-auto">
            {tr.groundTruth.failed}
          </span>
        )}
      </div>

      {!failed && !opening && (
        <button
          onClick={() => setOpening(true)}
          className="w-full text-[11px] text-text-muted hover:text-state-problem border border-dashed border-border-base hover:border-state-problem/40 rounded-sm py-1 transition-colors"
        >
          {tr.groundTruth.failedInPractice}
        </button>
      )}

      {!failed && opening && (
        <div className="space-y-1.5 border border-state-problem/30 rounded-sm p-2 bg-state-problem/5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder={tr.groundTruth.failurePlaceholder}
            className="w-full bg-bg-primary border border-border-base rounded-sm px-2 py-1 text-xs resize-none focus:border-state-problem outline-none"
          />
          <div className="flex gap-1">
            <button
              onClick={handleReport}
              disabled={!draft.trim()}
              className="flex-1 text-[11px] bg-state-problem/15 hover:bg-state-problem/30 disabled:opacity-40 text-state-problem border border-state-problem/40 rounded-sm py-1 transition-colors"
            >
              {tr.groundTruth.recordFailure}
            </button>
            <button
              onClick={() => {
                setOpening(false);
                setDraft('');
              }}
              className="text-[11px] text-text-muted hover:text-text-secondary border border-border-base rounded-sm px-2 py-1 transition-colors"
            >
              {tr.common.cancel.toLowerCase()}
            </button>
          </div>
        </div>
      )}

      {failed && (
        <div className="space-y-2">
          <div className="text-xs bg-state-problem/5 border border-state-problem/30 rounded-sm px-2 py-1.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-state-problem mb-0.5">
              {tr.groundTruth.failureContextLabel}
            </div>
            <div className="text-text-primary">{node.failureContext}</div>
            {node.failureReportedAt && (
              <div className="text-[10px] font-mono text-text-muted mt-1">
                {new Date(node.failureReportedAt).toLocaleString(tr.detail.locale)}
              </div>
            )}
          </div>

          <button
            onClick={handleReplan}
            disabled={replanning || pending !== null}
            className="w-full text-[11px] bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-ai-accent border border-ai-accent/40 rounded-sm py-1.5 transition-colors flex items-center justify-center gap-2"
          >
            <span>◆</span>
            {replanning
              ? tr.groundTruth.replanning
              : pending !== null
              ? tr.groundTruth.pendingHint
              : tr.groundTruth.replanWithFailure}
          </button>

          <button
            onClick={() => clearFailure(node.id)}
            className="w-full text-[10px] font-mono text-text-muted hover:text-text-secondary border border-border-base rounded-sm py-1 transition-colors"
          >
            {tr.groundTruth.clearFailure}
          </button>

          {error && (
            <div className="text-[11px] text-state-problem bg-state-problem/5 border border-state-problem/30 rounded-sm px-2 py-1">
              {error}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Compact inline form for TutorMode (no surrounding section)
// ---------------------------------------------------------------------------

export function GroundTruthInlineTutor({
  node,
  project,
}: {
  node: ConceptNodeData;
  project: Project;
}) {
  const tr = useT();
  return (
    <div className="mt-6 border-t border-border-base pt-6 space-y-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
        ◆ {tr.groundTruth.sectionTitle}
      </div>
      <div className="rounded-sm border border-border-base bg-bg-secondary">
        <UserCriterionField node={node} />
        <GroundTruthRefsList node={node} />
        <CritiqueSection node={node} project={project} />
        <FailureSection node={node} project={project} />
      </div>
    </div>
  );
}
