import { useEffect, useMemo, useState } from 'react';
import {
  useGraphStore,
  nextPendingForTutor,
  projectProgress,
  breadcrumbFor,
  buildStagedNodes,
  canConcludeNode,
  childrenByParent,
  effectiveLeavesUnder,
  isActionableKind,
  isBlocked,
} from '@/store';
import { explainNode, decomposeNode } from '@/ai/service';
import { useKBStore } from '@/kb/store';
import { requireAI } from '@/ai/availability';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/i18n';
import type { Messages } from '@/i18n';
import type { ConceptNodeData, Project } from '@/types';
import { GroundTruthInlineTutor } from './GroundTruth';
import { ExplanationContent } from './Markdown';
import { MobileSheet } from './MobileSheet';
import { ReadingMode } from './ReadingMode';

// The tutor is the concept's core loop made into a screen: look at ONE part of
// the decomposition — if you can confirm it against reality, confirm; if you
// can't yet, break it into smaller parts; if you already know it, mark the
// floor. The sidebar is the decomposition tree itself, not a flat checklist.
export function TutorMode() {
  const tr = useT();
  const project = useGraphStore((s) => s.project);
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const setViewMode = useGraphStore((s) => s.setViewMode);

  const next = useMemo(() => nextPendingForTutor(project), [project]);
  const progress = projectProgress(project);
  const byParent = useMemo(() => (project ? childrenByParent(project) : null), [project]);

  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isMobile && sidebarOpen) setSidebarOpen(false);
  }, [isMobile, sidebarOpen]);

  if (!project || !byParent) return null;

  // Dive into ONE node: the leaf the user picked in the tree, or the next
  // pending one in decomposition order.
  const selected = selectedId ? project.nodes[selectedId] : null;
  const selectedLeaf =
    selected && isActionableKind(selected.kind) && (byParent.get(selected.id) ?? []).length === 0
      ? selected
      : null;
  const current = selectedLeaf ?? next;

  const resourceLeaves = effectiveLeavesUnder(project, project.rootId, byParent).filter(
    (n) => n.kind === 'recurso',
  );
  const resourcesConfirmed = resourceLeaves.filter((r) => r.confirmado || r.takenAsKnown).length;
  const allResourcesDone =
    resourceLeaves.length > 0 && resourcesConfirmed === resourceLeaves.length;

  const sidebarBody = (
    <div className="py-1">
      <TreeRows
        project={project}
        byParent={byParent}
        parentId={project.rootId}
        depth={0}
        currentId={current?.id ?? null}
        onPick={(id) => {
          selectNode(id);
          setSidebarOpen(false);
        }}
        tr={tr}
      />
      {progress.total === 0 && (
        <div className="text-xs text-text-muted italic px-3 py-2">{tr.tutor.emptyTree}</div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden bg-bg-primary">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="border-b border-border-base bg-bg-secondary px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <div className="text-[10px] font-mono uppercase tracking-widest text-ai-accent">
              {tr.tutor.modeKicker}
            </div>
            <div className="hidden md:block text-text-muted text-xs">{tr.tutor.focusHint}</div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden text-xs text-text-secondary hover:text-text-primary border border-border-base rounded-sm px-2.5 py-1 transition-colors min-h-[32px] font-mono"
              >
                {tr.tutor.mobileStepsBtn(progress.done, progress.total)}
              </button>
              <button
                onClick={() => setViewMode('graph')}
                className="text-xs text-text-muted hover:text-text-primary transition-colors"
              >
                {tr.tutor.viewGraphShort}
              </button>
            </div>
          </div>
          {project.rules && project.rules.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted">
                {tr.tutor.rulesLabel}
              </span>
              {project.rules.map((r) => (
                <span
                  key={r}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded-[2px] bg-ai-accent/5 text-text-secondary border border-ai-accent/30"
                  title={tr.tutor.rulesTitle}
                >
                  <span className="text-ai-accent mr-1">⛓</span>
                  {r}
                </span>
              ))}
            </div>
          )}
          <ProgressBar
            percent={progress.percent}
            done={progress.done}
            total={progress.total}
            doneWithoutSignal={progress.doneWithoutSignal}
            tr={tr}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          {current ? (
            <TutorCard
              key={current.id}
              node={current}
              project={project}
              isNext={current.id === next?.id}
              next={next}
              tr={tr}
            />
          ) : progress.total === 0 ? (
            <EmptyCard tr={tr} onViewGraph={() => setViewMode('graph')} />
          ) : (
            <DoneCard
              projectName={project.name}
              doneWithoutSignal={progress.doneWithoutSignal}
              tr={tr}
            />
          )}

          {current && current.kind === 'passo' && !allResourcesDone && (
            <div className="max-w-2xl mx-auto mt-6 p-4 bg-conf-mid/5 border border-conf-mid/30 rounded-sm">
              <div className="text-conf-mid text-xs font-mono uppercase tracking-wider mb-1">
                {tr.tutor.resourcesLeftWarning}
              </div>
              <div className="text-sm text-text-secondary">
                {tr.tutor.resourcesLeftBody(resourceLeaves.length - resourcesConfirmed)}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="hidden md:flex md:w-[260px] lg:w-[340px] shrink-0 border-l border-border-base bg-bg-secondary overflow-y-auto flex-col">
        {sidebarBody}
      </aside>

      {isMobile && (
        <MobileSheet open={sidebarOpen} onOpenChange={setSidebarOpen} title={tr.tutor.sheetTitle}>
          {sidebarBody}
        </MobileSheet>
      )}
    </div>
  );
}

function ProgressBar({
  percent,
  done,
  total,
  doneWithoutSignal,
  tr,
}: {
  percent: number;
  done: number;
  total: number;
  doneWithoutSignal: number;
  tr: Messages;
}) {
  // 100% is only "done green" when every leaf is anchored. If some were
  // confirmed without signal, the headline goes amber — an unanchored tree is
  // visibly NOT the same as one earned against reality.
  const fullyAnchored = percent === 100 && doneWithoutSignal === 0;
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-text-secondary text-xs font-mono">{tr.tutor.confirmedOf(done, total)}</span>
        <span className="ml-auto font-mono text-lg font-semibold">
          <span
            className={
              fullyAnchored ? 'text-state-done' : percent === 100 ? 'text-conf-mid' : 'text-text-primary'
            }
          >
            {percent}%
          </span>
        </span>
      </div>
      <div className="h-1.5 bg-bg-primary rounded-sm overflow-hidden border border-border-base">
        <div
          className="h-full bg-gradient-to-r from-ai-accent to-conf-high transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      {doneWithoutSignal > 0 && (
        <div className="mt-1 text-[10px] font-mono text-conf-mid">
          {tr.tutor.confirmedNoAnchor(doneWithoutSignal)}
        </div>
      )}
    </div>
  );
}

interface TutorCardProps {
  node: ConceptNodeData;
  project: Project;
  isNext: boolean;
  next: ConceptNodeData | null;
  tr: Messages;
}

function TutorCard({ node, project, isNext, next, tr }: TutorCardProps) {
  const confirmNode = useGraphStore((s) => s.confirmNode);
  const unconfirmNode = useGraphStore((s) => s.unconfirmNode);
  const toggleTakenAsKnown = useGraphStore((s) => s.toggleTakenAsKnown);
  const pickDecisionOption = useGraphStore((s) => s.pickDecisionOption);
  const selectNode = useGraphStore((s) => s.selectNode);
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const setNodeExplanation = useGraphStore((s) => s.setNodeExplanation);
  const stageSuggestions = useGraphStore((s) => s.stageSuggestions);
  const acceptSuggestion = useGraphStore((s) => s.acceptSuggestion);
  const rejectSuggestion = useGraphStore((s) => s.rejectSuggestion);
  const acceptAllSuggestions = useGraphStore((s) => s.acceptAllSuggestions);
  const pending = useGraphStore((s) => s.pendingSuggestions);

  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [decomposing, setDecomposing] = useState(false);
  const [confirmingNoSignal, setConfirmingNoSignal] = useState(false);

  // O card é reaproveitado quando o foco do tutor muda de nó — fecha o modo
  // leitura pra não "teleportar" o leitor pra outra célula sem aviso.
  useEffect(() => setReading(false), [node.id]);

  const crumbs = breadcrumbFor(project, node.id);
  const { ready } = canConcludeNode(project, node.id);
  const blocked = isBlocked(project, node.id);
  const pendingHere = !!pending && pending.parentId === node.id;
  const resolved = node.confirmado || !!node.takenAsKnown;
  // A decision with options resolves by picking — no separate confirm button.
  const isDecision = node.kind === 'decisao' && (node.decisionOptions?.length ?? 0) > 0;

  const kindLabel = tr.conceptNode[node.kind];
  const confirmLabel =
    node.kind === 'recurso'
      ? tr.detail.alreadyHave
      : node.kind === 'concept'
      ? tr.detail.understood
      : tr.detail.alreadyDid;
  const decomposeLabel =
    node.kind === 'concept' ? tr.tutor.decomposeForkConcept : tr.tutor.decomposeFork;

  // Step number = position among passo siblings (orders from the AI may start
  // at 1 or 0 — the sequence shown to the user is positional).
  const stepSeq = useMemo(() => {
    if (node.kind !== 'passo' || !node.parentId) return 0;
    const sibs = Object.values(project.nodes)
      .filter((n) => n.parentId === node.parentId && n.kind === 'passo')
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return sibs.findIndex((s) => s.id === node.id) + 1;
  }, [node, project]);

  const handleExplain = async () => {
    if (node.explicacao) {
      setOpen((o) => !o);
      return;
    }
    if (!requireAI()) return;
    setLoading(true);
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
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  // Recursive decompose, right in the guided flow — break the current node into
  // sub-nodes (staged for accept/reject inline). After accepting, this node
  // gains children, so the tutor advances to a child and the user can keep
  // decomposing "down to the atom" without leaving the flow.
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

  // Acting resumes the flow: clear the explicit selection so the card follows
  // the next pending part again.
  const confirmAndAdvance = () => {
    confirmNode(node.id);
    setConfirmingNoSignal(false);
    selectNode(null);
  };
  const markKnownAndAdvance = () => {
    toggleTakenAsKnown(node.id);
    selectNode(null);
  };
  const pickAndAdvance = (optionId: string) => {
    pickDecisionOption(node.id, optionId);
    selectNode(null);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-1">
        {crumbs
          .slice(0, -1)
          .map((c) => c.name)
          .join(' › ')}
      </div>
      <div className="flex items-baseline gap-3 mb-4 sm:mb-6 flex-wrap">
        <span className="text-[11px] font-mono uppercase tracking-wider text-ai-accent">
          ◆ {kindLabel}
        </span>
        {stepSeq > 0 && (
          <span className="text-text-muted text-xs font-mono">{tr.tutor.stepNumber(stepSeq)}</span>
        )}
        {isNext && (
          <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-[2px] bg-ai-accent/10 text-ai-accent border border-ai-accent/30">
            {tr.tutor.nextBadge}
          </span>
        )}
        {!isNext && next && (
          <button
            onClick={() => selectNode(next.id)}
            className="ml-auto text-[11px] text-text-muted hover:text-ai-accent transition-colors truncate max-w-[60%]"
          >
            {tr.tutor.jumpToNext(next.name)}
          </button>
        )}
      </div>
      <h1 className="text-2xl sm:text-3xl font-semibold text-text-primary leading-tight mb-4 sm:mb-6">
        {node.name}
      </h1>

      {resolved && (
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          {node.state === 'done' ? (
            <span className="text-[11px] font-mono text-state-done bg-state-done/10 border border-state-done/30 rounded-sm px-2 py-1">
              {tr.detail.confirmed}
            </span>
          ) : node.takenAsKnown ? (
            <span className="text-[11px] font-mono text-ai-accent bg-ai-accent/10 border border-ai-accent/30 rounded-sm px-2 py-1">
              {tr.detail.axiomBadge}
            </span>
          ) : (
            <span className="text-[11px] font-mono text-conf-mid bg-conf-mid/10 border border-conf-mid/30 rounded-sm px-2 py-1">
              {tr.detail.confirmedNoSignal}
            </span>
          )}
          {node.confirmado ? (
            <button
              onClick={() => unconfirmNode(node.id)}
              className="text-[11px] text-text-muted hover:text-state-problem border border-border-base rounded-sm px-2 py-1 transition-colors"
            >
              {tr.detail.undoConfirm}
            </button>
          ) : (
            <button
              onClick={() => toggleTakenAsKnown(node.id)}
              className="text-[11px] text-text-muted hover:text-text-secondary border border-border-base rounded-sm px-2 py-1 transition-colors"
            >
              {tr.detail.knownUndo}
            </button>
          )}
        </div>
      )}

      {node.oQue && (
        <TutorBlock label={tr.tutor.whatIs}>
          <p className="text-text-secondary leading-relaxed">{node.oQue}</p>
        </TutorBlock>
      )}
      {node.porQue && (
        <TutorBlock label={tr.tutor.whyNeeded}>
          <p className="text-text-secondary leading-relaxed">{node.porQue}</p>
        </TutorBlock>
      )}

      {/* A decision is resolved by PICKING a path — that is its confirm. */}
      {node.kind === 'decisao' && node.decisionOptions && node.decisionOptions.length > 0 && (
        <TutorBlock label={tr.tutor.decisionLabel}>
          <div className="space-y-2">
            {node.decisionOptions.map((opt) => {
              const picked = node.decisionPickedId === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => pickAndAdvance(opt.id)}
                  className={`w-full text-left p-3 rounded-sm border transition-colors ${
                    picked
                      ? 'bg-ai-accent/15 border-ai-accent text-ai-accent'
                      : 'bg-bg-secondary border-border-base hover:border-ai-accent/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{opt.label}</span>
                    {picked && (
                      <span className="ml-auto text-[10px] font-mono uppercase tracking-wider">
                        {tr.tutor.decisionPickedBadge}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-text-secondary mt-1 leading-snug">{opt.pitch}</div>
                  {opt.consequences && (
                    <div className="text-[11px] text-text-muted mt-1 leading-snug italic">
                      {tr.tutor.consequencesPrefix} {opt.consequences}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </TutorBlock>
      )}

      <div className="mt-4">
        <div className="flex gap-2">
          <button
            onClick={handleExplain}
            disabled={loading}
            className="flex-1 min-w-0 flex items-center justify-between gap-3 px-4 py-2.5 min-h-[44px] bg-ai-accent/10 hover:bg-ai-accent/20 border border-ai-accent/30 rounded-sm text-ai-accent text-sm transition-colors disabled:opacity-60"
          >
            <span className="flex items-center gap-2 text-left">
              <span>◆</span>
              {loading
                ? tr.tutor.generatingExplain
                : node.explicacao
                ? open
                  ? tr.tutor.closeExplain
                  : tr.tutor.viewExplain
                : tr.tutor.explain}
            </span>
            {node.explicacao && <span className="text-xs">{open ? '▲' : '▼'}</span>}
          </button>
          <button
            onClick={() => setReading(true)}
            title={tr.detail.readingMode}
            aria-label={tr.detail.readingMode}
            className="shrink-0 w-11 min-h-[44px] flex items-center justify-center bg-bg-elevated hover:bg-ai-accent/10 border border-border-base hover:border-ai-accent/40 rounded-sm text-text-muted hover:text-ai-accent transition-colors"
          >
            ⛶
          </button>
        </div>
        {open && node.explicacao && (
          <div className="mt-3 p-4 sm:p-5 bg-bg-secondary border border-border-base rounded-sm">
            <ExplanationContent text={node.explicacao} />
          </div>
        )}
        {reading && (
          <ReadingMode
            node={node}
            breadcrumb={crumbs.map((c) => c.name)}
            onClose={() => setReading(false)}
            onGenerate={handleExplain}
            generating={loading}
          />
        )}
      </div>

      <GroundTruthInlineTutor node={node} project={project} />

      {pendingHere && (
        <div className="mt-4 space-y-2 p-3 border border-ai-accent/30 rounded-sm bg-ai-accent/5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ai-accent">
            {tr.tutor.decomposeReview}
          </div>
          {pending!.nodes.map((s) => (
            <div key={s.tempId} className="p-2 bg-bg-secondary border border-border-base rounded-sm">
              <div className="text-sm font-medium text-text-primary leading-tight">{s.data.name}</div>
              <div className="text-[11px] text-text-secondary leading-snug mb-1.5">
                {s.data.oQue || s.data.fx}
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => acceptSuggestion(s.tempId)}
                  className="flex-1 text-[11px] bg-conf-high/15 hover:bg-conf-high/30 text-conf-high border border-conf-high/40 rounded-sm py-1 transition-colors"
                >
                  {tr.tutor.acceptOne}
                </button>
                <button
                  onClick={() => rejectSuggestion(s.tempId)}
                  className="text-[11px] text-text-muted hover:text-state-problem border border-border-base rounded-sm px-2.5 py-1 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={acceptAllSuggestions}
            className="w-full text-[11px] bg-ai-accent/15 hover:bg-ai-accent/30 text-ai-accent border border-ai-accent/40 rounded-sm py-1.5 transition-colors"
          >
            {tr.tutor.acceptAll}
          </button>
        </div>
      )}

      {/* The fork at the heart of the concept: confirm against reality, or
          break it down further, or declare the floor ("I already know this"). */}
      {!resolved && (
        <div className="mt-6 sm:mt-8 space-y-2">
          {!isDecision &&
            (blocked ? (
              <div className="text-[11px] text-text-muted text-center italic py-2 border border-border-base rounded-sm">
                {tr.detail.blockedHint}
              </div>
            ) : ready ? (
              <button
                onClick={confirmAndAdvance}
                className="w-full bg-conf-high/15 hover:bg-conf-high/30 text-conf-high text-base py-3 min-h-[48px] rounded-sm border-2 border-conf-high/40 transition-colors font-medium"
              >
                {confirmLabel}
              </button>
            ) : confirmingNoSignal ? (
              <div className="space-y-1.5">
                <div className="text-[11px] text-conf-mid text-center leading-snug">
                  {tr.detail.confirmHintNoSignal}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={confirmAndAdvance}
                    className="flex-1 bg-conf-mid/15 hover:bg-conf-mid/30 text-conf-mid text-sm py-2.5 min-h-[44px] rounded-sm border border-conf-mid/40 transition-colors"
                  >
                    {tr.detail.confirmAnyway}
                  </button>
                  <button
                    onClick={() => setConfirmingNoSignal(false)}
                    className="px-4 text-xs text-text-muted hover:text-text-secondary border border-border-base rounded-sm transition-colors"
                  >
                    {tr.detail.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingNoSignal(true)}
                className="w-full bg-bg-elevated hover:bg-conf-mid/10 text-text-secondary hover:text-conf-mid text-base py-3 min-h-[48px] rounded-sm border-2 border-border-base hover:border-conf-mid/40 transition-colors font-medium"
              >
                {confirmLabel}
              </button>
            ))}

          {!pendingHere && (
            <button
              onClick={handleDecompose}
              disabled={decomposing || (!!pending && !pendingHere)}
              className="w-full px-4 py-2.5 min-h-[44px] bg-bg-secondary hover:bg-bg-elevated border border-border-base hover:border-ai-accent/40 rounded-sm text-text-secondary hover:text-ai-accent text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <span>◆</span>
              {decomposing ? tr.tutor.decomposing : decomposeLabel}
            </button>
          )}

          <div className="flex items-center gap-2">
            {!isDecision && (
              <button
                onClick={markKnownAndAdvance}
                className="flex-1 text-xs py-2 min-h-[36px] rounded-sm border border-border-base bg-bg-elevated text-text-muted hover:text-ai-accent hover:border-ai-accent/40 transition-colors"
              >
                {tr.tutor.alreadyKnow}
              </button>
            )}
            <button
              onClick={() => {
                selectNode(node.id);
                setViewMode('graph');
              }}
              className="px-4 py-2 min-h-[36px] text-xs text-text-muted hover:text-text-primary border border-border-base rounded-sm transition-colors"
            >
              {tr.tutor.viewInGraph}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TutorBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-2">
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function EmptyCard({ tr, onViewGraph }: { tr: Messages; onViewGraph: () => void }) {
  return (
    <div className="max-w-xl mx-auto text-center py-12 sm:py-20">
      <div className="text-5xl sm:text-6xl mb-4 text-text-muted">◌</div>
      <p className="text-text-secondary mb-6">{tr.tutor.emptyTree}</p>
      <button
        onClick={onViewGraph}
        className="text-xs text-text-muted hover:text-text-primary border border-border-base rounded-sm px-4 py-2 transition-colors"
      >
        {tr.tutor.viewGraphShort}
      </button>
    </div>
  );
}

function DoneCard({
  projectName,
  doneWithoutSignal,
  tr,
}: {
  projectName: string;
  doneWithoutSignal: number;
  tr: Messages;
}) {
  // Only celebrate when every leaf was anchored against reality. If some were
  // confirmed without signal, temper the message instead of throwing a party.
  const anchored = doneWithoutSignal === 0;
  return (
    <div className="max-w-xl mx-auto text-center py-12 sm:py-20">
      <div className={`text-5xl sm:text-6xl mb-4 ${anchored ? 'text-state-done' : 'text-conf-mid'}`}>
        {anchored ? '✓' : '◓'}
      </div>
      <h1 className="text-2xl sm:text-3xl font-semibold text-text-primary mb-3">
        {anchored ? tr.tutor.projectDoneTitle : tr.tutor.projectWalkedTitle}
      </h1>
      <p className="text-text-secondary">
        {anchored
          ? tr.tutor.projectDoneBody(projectName)
          : tr.tutor.projectWalkedBody(doneWithoutSignal)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — the decomposition tree. Containers (decomposed nodes, categories)
// are structure: they show progress but are not confirmable; leaves carry the
// checkbox. A takenAsKnown node closes its subtree (floor).
// ---------------------------------------------------------------------------

interface TreeRowsProps {
  project: Project;
  byParent: Map<string, ConceptNodeData[]>;
  parentId: string;
  depth: number;
  currentId: string | null;
  onPick: (id: string) => void;
  tr: Messages;
}

function TreeRows({ project, byParent, parentId, depth, currentId, onPick, tr }: TreeRowsProps) {
  const kids = byParent.get(parentId) ?? [];
  let passoSeq = 0;
  return (
    <>
      {kids.map((node) => {
        const seq = node.kind === 'passo' ? ++passoSeq : 0;
        const children = byParent.get(node.id) ?? [];

        if (node.takenAsKnown) {
          // Floor: subtree closed. Render the node itself as a known leaf.
          return (
            <LeafRow
              key={node.id}
              node={node}
              project={project}
              depth={depth}
              seq={seq}
              isCurrent={node.id === currentId}
              onPick={onPick}
              tr={tr}
            />
          );
        }

        if (children.length > 0 || node.kind === 'categoria') {
          const leaves = effectiveLeavesUnder(project, node.id, byParent);
          const done = leaves.filter((l) => l.confirmado || l.takenAsKnown).length;
          return (
            <div key={node.id}>
              <GroupRow node={node} depth={depth} done={done} total={leaves.length} />
              <TreeRows
                project={project}
                byParent={byParent}
                parentId={node.id}
                depth={depth + 1}
                currentId={currentId}
                onPick={onPick}
                tr={tr}
              />
            </div>
          );
        }

        if (!isActionableKind(node.kind)) return null;
        return (
          <LeafRow
            key={node.id}
            node={node}
            project={project}
            depth={depth}
            seq={seq}
            isCurrent={node.id === currentId}
            onPick={onPick}
            tr={tr}
          />
        );
      })}
    </>
  );
}

function GroupRow({
  node,
  depth,
  done,
  total,
}: {
  node: ConceptNodeData;
  depth: number;
  done: number;
  total: number;
}) {
  const complete = total > 0 && done === total;
  return (
    <div
      className={`flex items-baseline gap-2 pr-3 py-1.5 ${depth === 0 ? 'bg-bg-primary/50 border-y border-border-base mt-1' : ''}`}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
    >
      <span
        className={`text-[10px] font-mono uppercase tracking-wider truncate ${
          depth === 0 ? 'text-text-muted' : 'text-text-muted/80'
        }`}
      >
        {node.name}
      </span>
      <span className="ml-auto text-[11px] font-mono shrink-0">
        <span className={complete ? 'text-state-done' : 'text-text-secondary'}>{done}</span>
        <span className="text-text-muted">/{total}</span>
      </span>
    </div>
  );
}

const KIND_GLYPH: Partial<Record<ConceptNodeData['kind'], string>> = {
  recurso: '▪',
  decisao: '⑂',
  concept: '◇',
};

interface LeafRowProps {
  node: ConceptNodeData;
  project: Project;
  depth: number;
  seq: number;
  isCurrent: boolean;
  onPick: (id: string) => void;
  tr: Messages;
}

function LeafRow({ node, project, depth, seq, isCurrent, onPick, tr }: LeafRowProps) {
  const confirmNode = useGraphStore((s) => s.confirmNode);
  const unconfirmNode = useGraphStore((s) => s.unconfirmNode);
  const toggleTakenAsKnown = useGraphStore((s) => s.toggleTakenAsKnown);

  const blocked = !node.confirmado && !node.takenAsKnown && isBlocked(project, node.id);
  const resolvedDone = node.state === 'done';
  const known = !!node.takenAsKnown;
  const hunch = node.confirmado && !resolvedDone && !known;

  // The checkbox only closes a node that EARNED it (signal present) or undoes
  // a previous resolution. Without signal it routes to the card, where
  // confirming without an anchor is a deliberate two-step — the unfaithful
  // path is never the easiest click.
  const handleToggle = () => {
    if (blocked) return;
    if (node.confirmado) {
      unconfirmNode(node.id);
      return;
    }
    if (known) {
      toggleTakenAsKnown(node.id);
      return;
    }
    if (canConcludeNode(project, node.id).ready) {
      confirmNode(node.id);
      return;
    }
    onPick(node.id);
  };

  return (
    <div
      className={`group flex items-center gap-2 pr-3 py-2 text-xs transition-colors cursor-pointer min-h-[36px] ${
        isCurrent
          ? 'bg-ai-accent/10 border-l-2 border-ai-accent'
          : 'hover:bg-bg-elevated/50 border-l-2 border-transparent'
      } ${blocked ? 'opacity-40' : ''}`}
      style={{ paddingLeft: `${10 + depth * 14}px` }}
      onClick={() => onPick(node.id)}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleToggle();
        }}
        disabled={blocked}
        aria-label={
          node.confirmado || known
            ? tr.tutor.ariaUnconfirm
            : canConcludeNode(project, node.id).ready
            ? tr.tutor.ariaConfirm
            : tr.tutor.ariaFocus
        }
        className={`w-5 h-5 rounded-sm border flex items-center justify-center transition-colors shrink-0 ${
          resolvedDone
            ? 'bg-state-done/20 border-state-done text-state-done'
            : known
            ? 'bg-ai-accent/15 border-ai-accent/50 text-ai-accent'
            : hunch
            ? 'bg-conf-mid/15 border-conf-mid text-conf-mid'
            : 'border-border-base group-hover:border-text-muted'
        }`}
      >
        {resolvedDone && <span className="text-[10px]">✓</span>}
        {!resolvedDone && known && <span className="text-[10px]">⊢</span>}
        {!resolvedDone && !known && node.confirmado && <span className="text-[10px]">✓</span>}
      </button>
      <span
        className={`truncate flex-1 ${
          node.confirmado || known ? 'text-text-muted line-through' : 'text-text-secondary'
        }`}
      >
        {seq > 0 ? (
          <span className="text-text-muted font-mono mr-1">{seq}.</span>
        ) : KIND_GLYPH[node.kind] ? (
          <span className="text-text-muted font-mono mr-1">{KIND_GLYPH[node.kind]}</span>
        ) : null}
        {node.name}
      </span>
    </div>
  );
}
