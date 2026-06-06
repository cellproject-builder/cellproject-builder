import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { useGraphStore, breadcrumbFor, isBlocked } from '@/store';
import { decomposeNode, explainNode } from '@/ai/service';
import { requireAI } from '@/ai/availability';
import { useKBStore } from '@/kb/store';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/i18n';
import type { NodeState, ConceptNodeData } from '@/types';
import { ExplanationContent } from './TutorMode';
import { MobileSheet } from './MobileSheet';
import {
  UserCriterionField,
  CritiqueSection,
  GroundTruthRefsList,
  FailureSection,
} from './GroundTruth';

const STATE_VALUES: NodeState[] = ['concept', 'validated', 'executing', 'done', 'problem', 'discarded'];

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
  const pickDecisionOption = useGraphStore((s) => s.pickDecisionOption);
  const setNodeExplanation = useGraphStore((s) => s.setNodeExplanation);
  const pending = useGraphStore((s) => s.pendingSuggestions);

  const [decomposing, setDecomposing] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [explaining, setExplaining] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);

  const isMobile = useIsMobile();
  const [drawerDismissed, setDrawerDismissed] = useState(false);
  useEffect(() => {
    setDrawerDismissed(false);
  }, [selectedId]);

  if (!project || !selectedId) {
    return (
      <aside className="hidden md:flex md:w-[280px] lg:w-[380px] shrink-0 border-l border-border-base bg-bg-secondary p-4 text-text-muted text-sm">
        {tr.detail.noSelection}
      </aside>
    );
  }

  const node = project.nodes[selectedId];
  if (!node) return null;

  const crumbs = breadcrumbFor(project, selectedId);
  const blocked = isBlocked(project, node.id);
  const canConfirm = (node.kind === 'recurso' || node.kind === 'passo') && !blocked;

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
        },
        kbContext,
      );
      const basePos = node.position;
      const spacing = 260;
      const start = basePos.x - ((result.nodes.length - 1) * spacing) / 2;
      const staged = result.nodes.map((n, i) => {
        const data: Omit<ConceptNodeData, 'id' | 'parentId' | 'history'> & { tempId: string } = {
          tempId: n.tempId,
          kind: n.kind,
          name: n.name,
          fx: n.fx,
          problem: n.problem,
          confidence: n.confidence,
          confidenceSource: 'ai',
          confidenceReason: n.confidenceReason,
          pros: n.pros,
          cons: n.cons,
          oQue: n.oQue,
          porQue: n.porQue,
          comoConfirmar: n.comoConfirmar,
          confirmado: false,
          order: n.order ?? i,
          decisionOptions: n.decisionOptions,
          groundTruthRefs: n.groundTruthHints?.map((h) => ({
            id: nanoid(8),
            kind: h.kind,
            label: h.label,
            value: h.value,
            verificado: false,
            addedAt: Date.now(),
            addedByAI: true,
          })),
          state: 'concept',
          notes: '',
          aiSuggested: true,
          position: { x: start + i * spacing, y: basePos.y + 260 },
        };
        return data;
      });
      stageSuggestions(node.id, staged, result.edges);
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
          {node.confirmado && (
            <span className="text-[10px] font-mono text-state-done ml-auto">{tr.detail.confirmed}</span>
          )}
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

        <UserCriterionField node={node} />
        <GroundTruthRefsList node={node} />
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

        <section className="p-3 border-b border-border-base">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
            {tr.detail.confidence}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={node.confidence}
              onChange={(e) => updateNode(node.id, { confidence: Number(e.target.value) })}
              className="flex-1 accent-ai-accent"
            />
            <span className="font-mono text-sm w-12 text-right">{node.confidence}%</span>
          </div>
          {node.confidenceReason && (
            <div className="text-[11px] text-text-muted mt-1 italic">{node.confidenceReason}</div>
          )}
        </section>

        <section className="p-3 border-b border-border-base">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
            {tr.detail.state}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
            {STATE_VALUES.map((value) => (
              <button
                key={value}
                onClick={() => updateNode(node.id, { state: value })}
                className={`text-[10px] font-mono py-1.5 rounded-sm border transition-colors ${
                  node.state === value
                    ? 'bg-bg-elevated border-text-primary text-text-primary'
                    : 'border-border-base text-text-muted hover:text-text-secondary hover:border-text-muted'
                }`}
              >
                {tr.detail.states[value]}
              </button>
            ))}
          </div>
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
        {canConfirm && !node.confirmado && (
          <button
            onClick={() => confirmNode(node.id)}
            className="w-full bg-conf-high/15 hover:bg-conf-high/30 text-conf-high text-sm py-2.5 min-h-[44px] rounded-sm border border-conf-high/40 transition-colors font-medium"
          >
            {node.kind === 'recurso' ? tr.detail.alreadyHave : tr.detail.alreadyDid}
          </button>
        )}
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

  return (
    <aside className="hidden md:flex md:w-[280px] lg:w-[380px] shrink-0 border-l border-border-base bg-bg-secondary flex-col overflow-hidden">
      {body}
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
