import { useEffect, useState } from 'react';
import {
  useGraphStore,
  breadcrumbFor,
  buildStagedNodes,
  confidenceBand,
  isBlocked,
  canConcludeNode,
} from '@/store';
import { decomposeNode, explainNode } from '@/ai/service';
import { requireAI } from '@/ai/availability';
import { useKBStore } from '@/kb/store';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/i18n';
import { ExplanationContent } from './Markdown';
import { MobileSheet } from './MobileSheet';
import {
  UserCriterionField,
  CritiqueSection,
  GroundTruthRefsList,
  FailureSection,
} from './GroundTruth';

export function DetailPanel() {
  const tr = useT();
  const project = useGraphStore((s) => s.project);
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const addManualHistory = useGraphStore((s) => s.addManualHistory);
  const stageSuggestions = useGraphStore((s) => s.stageSuggestions);
  const confirmNode = useGraphStore((s) => s.confirmNode);
  const unconfirmNode = useGraphStore((s) => s.unconfirmNode);
  const toggleTakenAsKnown = useGraphStore((s) => s.toggleTakenAsKnown);
  const pickDecisionOption = useGraphStore((s) => s.pickDecisionOption);
  const setNodeExplanation = useGraphStore((s) => s.setNodeExplanation);
  const pending = useGraphStore((s) => s.pendingSuggestions);

  const addRule = useGraphStore((s) => s.addRule);
  const removeRule = useGraphStore((s) => s.removeRule);
  const panelOpen = useGraphStore((s) => s.detailPanelOpen);
  const setPanelOpen = useGraphStore((s) => s.setDetailPanelOpen);

  const [decomposing, setDecomposing] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [ruleDraft, setRuleDraft] = useState('');
  const [explaining, setExplaining] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);

  const isMobile = useIsMobile();
  const selectionVersion = useGraphStore((s) => s.selectionVersion);
  const [drawerDismissed, setDrawerDismissed] = useState(false);
  const [confirmingNoSignal, setConfirmingNoSignal] = useState(false);
  // selectionVersion bumps on every selectNode — so tapping the SAME node
  // again on mobile re-opens a sheet the user had swiped away.
  useEffect(() => {
    setDrawerDismissed(false);
    setConfirmingNoSignal(false);
  }, [selectedId, selectionVersion]);

  if (!project || !selectedId) {
    if (!panelOpen) {
      return <CollapsedRail onExpand={() => setPanelOpen(true)} label={tr.detail.expandPanel} />;
    }
    return (
      <aside className="hidden md:flex md:w-[280px] lg:w-[380px] shrink-0 border-l border-border-base bg-bg-secondary flex-col">
        <PanelTopBar onCollapse={() => setPanelOpen(false)} label={tr.detail.collapsePanel} />
        <div className="p-4 text-text-muted text-sm">{tr.detail.noSelection}</div>
      </aside>
    );
  }

  const node = project.nodes[selectedId];
  if (!node) return null;

  const crumbs = breadcrumbFor(project, selectedId);
  const blocked = isBlocked(project, node.id);
  const canConfirm =
    (node.kind === 'recurso' || node.kind === 'passo' || node.kind === 'concept') && !blocked;
  const ready = canConcludeNode(project, node.id).ready;
  const confirmLabel =
    node.kind === 'recurso'
      ? tr.detail.alreadyHave
      : node.kind === 'concept'
      ? tr.detail.understood
      : tr.detail.alreadyDid;

  const handleDecompose = async () => {
    if (!requireAI()) return;
    setDecomposing(true);
    try {
      const siblings = Object.values(project.nodes)
        .filter((n) => n.parentId === node.parentId && n.id !== node.id)
        .map((n) => ({ name: n.name, fx: n.fx }));
      const kbContext = await useKBStore.getState().getContextFor({
        label: tr.notify.objectivePromptLabel(project.objective),
        extra: tr.notify.objectivePromptExtra(node.name, node.kind, node.fx),
      });
      const result = await decomposeNode(
        {
          projectName: project.name,
          projectObjective: project.objective,
          breadcrumb: crumbs.map((c) => c.name),
          nodeName: node.name,
          nodeKind: node.kind,
          nodeFx: node.fx,
          siblings,
          strategy: project.constructionStrategy,
          archetype: project.archetype,
          rules: project.rules,
          research: node.webResearch,
        },
        kbContext,
      );
      stageSuggestions(node.id, buildStagedNodes(node, result.nodes), result.edges);
    } finally {
      setDecomposing(false);
    }
  };

  const handleExplain = async () => {
    if (node.explicacao) {
      setExplanationOpen((o) => !o);
      return;
    }
    if (!requireAI()) return;
    setExplaining(true);
    try {
      const text = await explainNode({
        projectName: project.name,
        projectObjective: project.objective,
        breadcrumb: crumbs.map((c) => c.name),
        nodeName: node.name,
        nodeKind: node.kind,
        oQue: node.oQue,
        porQue: node.porQue,
        comoConfirmar: node.comoConfirmar,
        rules: project.rules,
        research: node.webResearch,
      });
      setNodeExplanation(node.id, text);
      setExplanationOpen(true);
    } finally {
      setExplaining(false);
    }
  };

  const recordNote = () => {
    if (!noteDraft.trim()) return;
    addManualHistory(node.id, noteDraft.trim());
    setNoteDraft('');
  };

  const body = (
    <>
      <div className="p-3 border-b border-border-base">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
            {node.kind}
          </span>
          {node.kind === 'passo' && (
            <span className="text-[10px] font-mono text-text-muted">{tr.detail.stepNumber(node.order + 1)}</span>
          )}
          {blocked && (
            <span className="text-[10px] font-mono text-text-muted ml-auto">{tr.detail.blocked}</span>
          )}
          {node.state === 'done' ? (
            <span className="text-[10px] font-mono text-state-done ml-auto">{tr.detail.confirmed}</span>
          ) : node.state === 'problem' ? (
            <span className="text-[10px] font-mono text-state-problem ml-auto">{tr.detail.problemBadge}</span>
          ) : node.confirmado ? (
            <span className="text-[10px] font-mono text-conf-mid ml-auto">{tr.detail.confirmedNoSignal}</span>
          ) : node.takenAsKnown ? (
            <span className="text-[10px] font-mono text-ai-accent ml-auto">{tr.detail.axiomBadge}</span>
          ) : null}
        </div>
        <input
          value={node.name}
          onChange={(e) => updateNode(node.id, { name: e.target.value })}
          className="w-full bg-transparent text-base font-semibold outline-none focus:bg-bg-elevated/50 px-1 -mx-1 rounded-sm"
        />
      </div>

      <div className="flex-1 md:overflow-y-auto">
        <section className="p-3 border-b border-border-base space-y-2">
          <EduField
            label={tr.detail.whatIs}
            value={node.oQue}
            onChange={(v) => updateNode(node.id, { oQue: v })}
          />
          <EduField
            label={tr.detail.whyNeeded}
            value={node.porQue}
            onChange={(v) => updateNode(node.id, { porQue: v })}
          />
        </section>

        {/* Rules live on the project (the root) — hard boundaries the AI
            treats as the challenge in every plan/decompose/replan/critique. */}
        {node.kind === 'root' && (
          <section className="p-3 border-b border-border-base">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-2">
              ⛓ {tr.detail.rulesLabel}
            </label>
            {(project.rules ?? []).length === 0 && (
              <div className="text-[11px] text-text-muted italic mb-2">{tr.detail.rulesEmpty}</div>
            )}
            {(project.rules ?? []).length > 0 && (
              <div className="flex gap-1.5 flex-wrap mb-2">
                {project.rules!.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-sm bg-ai-accent/5 text-text-secondary border border-ai-accent/30"
                  >
                    {r}
                    <button
                      onClick={() => removeRule(r)}
                      className="text-text-muted hover:text-state-problem transition-colors"
                      aria-label={tr.common.remove}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <input
                value={ruleDraft}
                onChange={(e) => setRuleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ruleDraft.trim()) {
                    addRule(ruleDraft);
                    setRuleDraft('');
                  }
                }}
                placeholder={tr.detail.rulesAddPlaceholder}
                className="flex-1 bg-bg-elevated border border-border-base rounded-sm px-2 py-1 text-[11px] focus:border-ai-accent outline-none"
              />
              <button
                onClick={() => {
                  if (ruleDraft.trim()) {
                    addRule(ruleDraft);
                    setRuleDraft('');
                  }
                }}
                disabled={!ruleDraft.trim()}
                className="px-2 bg-bg-elevated border border-border-base rounded-sm text-[11px] hover:border-text-muted disabled:opacity-40"
              >
                +
              </button>
            </div>
          </section>
        )}

        <UserCriterionField node={node} />
        <GroundTruthRefsList node={node} project={project} />
        <CritiqueSection node={node} project={project} />
        <FailureSection node={node} project={project} />

        <section className="p-3 border-b border-border-base">
          <button
            onClick={handleExplain}
            disabled={explaining}
            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 bg-ai-accent/10 hover:bg-ai-accent/20 border border-ai-accent/30 rounded-sm text-ai-accent text-xs transition-colors disabled:opacity-60"
          >
            <span className="flex items-center gap-1.5">
              <span>◆</span>
              {explaining
                ? tr.detail.generatingExplain
                : node.explicacao
                ? explanationOpen
                  ? tr.detail.closeExplain
                  : tr.detail.viewExplain
                : tr.detail.explainBtn}
            </span>
            {node.explicacao && (
              <span className="text-[10px]">{explanationOpen ? '▲' : '▼'}</span>
            )}
          </button>
          {explanationOpen && node.explicacao && (
            <div className="mt-2 p-3 bg-bg-elevated/50 border border-border-base rounded-sm">
              <ExplanationContent text={node.explicacao} />
            </div>
          )}
        </section>

        {node.kind === 'decisao' && node.decisionOptions && (
          <section className="p-3 border-b border-border-base">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-2">
              {tr.detail.options}
            </label>
            <div className="space-y-1.5">
              {node.decisionOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => pickDecisionOption(node.id, opt.id)}
                  className={`w-full text-left p-2 rounded-sm border transition-colors ${
                    node.decisionPickedId === opt.id
                      ? 'bg-ai-accent/15 border-ai-accent text-ai-accent'
                      : 'bg-bg-elevated border-border-base hover:border-text-muted'
                  }`}
                >
                  <div className="text-xs font-semibold">{opt.label}</div>
                  <div className="text-[11px] text-text-secondary mt-0.5">{opt.pitch}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Confidence is the AI's signal (value + source + reason), shown, not
            edited — the user's truth enters through the four ground-truth
            mechanisms, never by dragging a number. State is earned through the
            confirm gate / failure report, never painted by hand. */}
        <section className="p-3 border-b border-border-base">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
            {tr.detail.confidence}
            {node.confidenceSource && (
              <span className="ml-2 normal-case tracking-normal text-text-muted/80">
                · {tr.detail.confidenceSourceLabel[node.confidenceSource]}
              </span>
            )}
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-bg-elevated rounded-sm overflow-hidden border border-border-base">
              <div
                className={`h-full ${
                  confidenceBand(node.confidence) === 'high'
                    ? 'bg-conf-high'
                    : confidenceBand(node.confidence) === 'mid'
                    ? 'bg-conf-mid'
                    : 'bg-conf-low'
                }`}
                style={{ width: `${node.confidence}%` }}
              />
            </div>
            <span className="font-mono text-sm w-12 text-right">{node.confidence}%</span>
          </div>
          {node.confidenceReason && (
            <div className="text-[11px] text-text-muted mt-1 italic">{node.confidenceReason}</div>
          )}
        </section>

        <section className="p-3 border-b border-border-base">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
            {tr.detail.notes}
          </label>
          <textarea
            value={node.notes}
            onChange={(e) => updateNode(node.id, { notes: e.target.value })}
            rows={3}
            className="w-full bg-bg-elevated border border-border-base rounded-sm px-2 py-1 text-xs resize-none focus:border-ai-accent outline-none"
            placeholder={tr.detail.notesPlaceholder}
          />
        </section>

        <section className="p-3 border-b border-border-base">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-2">
            {tr.detail.historyLabel(node.history.length)}
          </label>
          <ul className="space-y-1 max-h-40 overflow-y-auto font-mono text-[10px] leading-snug">
            {[...node.history].reverse().map((h) => (
              <li key={h.id} className="text-text-secondary">
                <span className="text-text-muted">
                  [
                  {new Date(h.timestamp).toLocaleString(tr.detail.locale, {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  ]
                </span>{' '}
                {h.message}
              </li>
            ))}
          </ul>
          <div className="flex gap-1 mt-2">
            <input
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && recordNote()}
              placeholder={tr.detail.recordDecision}
              className="flex-1 bg-bg-elevated border border-border-base rounded-sm px-2 py-1 text-[11px] focus:border-ai-accent outline-none"
            />
            <button
              onClick={recordNote}
              className="px-2 bg-bg-elevated border border-border-base rounded-sm text-[11px] hover:border-text-muted"
            >
              {tr.detail.addNote}
            </button>
          </div>
        </section>
      </div>

      <div className="p-3 border-t border-border-base bg-bg-secondary space-y-2">
        {canConfirm &&
          !node.confirmado &&
          (ready ? (
            // Faithful fast path: real signal present → one click earns 'done'.
            <button
              onClick={() => confirmNode(node.id)}
              className="w-full bg-conf-high/15 hover:bg-conf-high/30 text-conf-high text-sm py-2.5 min-h-[44px] rounded-sm border border-conf-high/40 transition-colors font-medium"
            >
              {confirmLabel}
            </button>
          ) : confirmingNoSignal ? (
            // Friction-ful acknowledgement: confirming without an anchor is a
            // deliberate two-step, and it lands amber (not green), never 'done'.
            <div className="space-y-1.5">
              <div className="text-[11px] text-conf-mid text-center leading-snug">
                {tr.detail.confirmHintNoSignal}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    confirmNode(node.id);
                    setConfirmingNoSignal(false);
                  }}
                  className="flex-1 bg-conf-mid/15 hover:bg-conf-mid/30 text-conf-mid text-xs py-2 min-h-[40px] rounded-sm border border-conf-mid/40 transition-colors"
                >
                  {tr.detail.confirmAnyway}
                </button>
                <button
                  onClick={() => setConfirmingNoSignal(false)}
                  className="px-3 text-xs text-text-muted hover:text-text-secondary border border-border-base rounded-sm transition-colors"
                >
                  {tr.detail.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingNoSignal(true)}
              className="w-full bg-bg-elevated hover:bg-conf-mid/10 text-text-secondary hover:text-conf-mid text-sm py-2.5 min-h-[44px] rounded-sm border border-border-base hover:border-conf-mid/40 transition-colors font-medium"
            >
              {confirmLabel}
            </button>
          ))}
        {node.confirmado && (
          <button
            onClick={() => unconfirmNode(node.id)}
            className="w-full bg-bg-elevated hover:bg-state-problem/10 text-text-muted hover:text-state-problem text-xs py-1.5 rounded-sm border border-border-base transition-colors"
          >
            {tr.detail.undoConfirm}
          </button>
        )}
        {blocked && (
          <div className="text-[11px] text-text-muted text-center italic">{tr.detail.blockedHint}</div>
        )}
        <button
          onClick={handleDecompose}
          disabled={decomposing || pending !== null}
          className="w-full bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-ai-accent text-sm py-2.5 min-h-[44px] rounded-sm border border-ai-accent/40 transition-colors font-medium flex items-center justify-center gap-2"
        >
          <span>◆</span>
          {decomposing
            ? tr.detail.decomposing
            : pending
            ? tr.detail.pendingHint
            : tr.detail.decompose}
        </button>
        {!node.confirmado && node.parentId && (
          <button
            onClick={() => toggleTakenAsKnown(node.id)}
            className={`w-full text-xs py-1.5 rounded-sm border transition-colors ${
              node.takenAsKnown
                ? 'bg-ai-accent/10 text-ai-accent border-ai-accent/40'
                : 'bg-bg-elevated text-text-muted hover:text-text-secondary border-border-base'
            }`}
          >
            {node.takenAsKnown ? tr.detail.knownUndo : tr.detail.markKnown}
          </button>
        )}
        {node.parentId && (
          <button
            onClick={() => {
              if (confirm(tr.detail.deleteConfirm(node.name))) {
                deleteNode(node.id);
              }
            }}
            className="w-full text-text-muted hover:text-state-problem text-xs py-1 transition-colors"
          >
            {tr.detail.deleteNode}
          </button>
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <MobileSheet
        open={!drawerDismissed}
        onOpenChange={(o) => {
          if (!o) setDrawerDismissed(true);
        }}
        title={node.name || tr.detail.sheetFallbackTitle}
      >
        {body}
      </MobileSheet>
    );
  }

  // Versatile panel: collapse to a thin rail so the graph takes the room;
  // the preference persists across reloads.
  if (!panelOpen) {
    return <CollapsedRail onExpand={() => setPanelOpen(true)} label={tr.detail.expandPanel} />;
  }

  return (
    <aside className="hidden md:flex md:w-[280px] lg:w-[380px] shrink-0 border-l border-border-base bg-bg-secondary flex-col overflow-hidden">
      <PanelTopBar onCollapse={() => setPanelOpen(false)} label={tr.detail.collapsePanel} />
      {body}
    </aside>
  );
}

function PanelTopBar({ onCollapse, label }: { onCollapse: () => void; label: string }) {
  return (
    <div className="shrink-0 flex items-center justify-end border-b border-border-base px-1.5 py-1">
      <button
        onClick={onCollapse}
        title={label}
        aria-label={label}
        className="w-6 h-6 flex items-center justify-center rounded-sm text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
      >
        »
      </button>
    </div>
  );
}

function CollapsedRail({ onExpand, label }: { onExpand: () => void; label: string }) {
  const tr = useT();
  return (
    <aside className="hidden md:flex w-9 shrink-0 border-l border-border-base bg-bg-secondary flex-col items-center py-2">
      <button
        onClick={onExpand}
        title={label}
        aria-label={label}
        className="w-7 h-7 flex items-center justify-center rounded-sm border border-border-base text-text-muted hover:text-ai-accent hover:border-ai-accent/40 transition-colors"
      >
        «
      </button>
      <span className="mt-3 text-[9px] font-mono uppercase tracking-widest text-text-muted [writing-mode:vertical-rl]">
        {tr.detail.railLabel}
      </span>
    </aside>
  );
}

interface EduFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}

function EduField({ label, value, onChange, mono }: EduFieldProps) {
  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className={`w-full bg-bg-elevated border border-border-base rounded-sm px-2 py-1 text-xs resize-none focus:border-ai-accent outline-none ${
          mono ? 'font-mono italic' : ''
        }`}
      />
    </div>
  );
}
