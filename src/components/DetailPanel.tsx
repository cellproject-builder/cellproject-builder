import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  useGraphStore,
  breadcrumbFor,
  buildStagedNodes,
  confidenceBand,
  canConcludeNode,
  firstBlockerOf,
  stepSequence,
  isActionableKind,
  effectiveLeavesUnder,
  nextPendingForTutor,
  projectProgress,
  type ConcludeMissingKey,
  canRevealAICriterionNow,
  relatedPartsFor,
} from '@/store';
import { decomposeNode, explainNode } from '@/ai/service';
import { requireAI } from '@/ai/availability';
import { useKBStore } from '@/kb/store';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useAIAction } from '@/hooks/useAIAction';
import { InlineError } from '@/components/ui/InlineError';
import { toast } from '@/components/ui/Toast';
import { useT } from '@/i18n';
import type { Messages } from '@/i18n';
import type { ConceptNodeData, Project } from '@/types';
import { ExplanationContent } from './Markdown';
import { MobileSheet } from './MobileSheet';
import { ReadingMode } from './ReadingMode';
import { KIND_ICON } from './ConceptNode';
import {
  UserCriterionField,
  CritiqueSection,
  GroundTruthRefsList,
  FailureSection,
} from './GroundTruth';

// Até 15 nomes que o usuário já sabe/fez — a IA não repete esses passos.
const knownElsewhereFor = (project: Project, nodeId: string): string[] =>
  Object.values(project.nodes)
    .filter((n) => n.id !== nodeId && n.parentId && (n.takenAsKnown || n.state === 'done'))
    .map((n) => n.name)
    .slice(0, 15);

const countDescendants = (project: Project, id: string): number => {
  let total = 0;
  const walk = (pid: string) => {
    for (const n of Object.values(project.nodes)) {
      if (n.parentId === pid) {
        total++;
        walk(n.id);
      }
    }
  };
  walk(id);
  return total;
};

// Undo das ações rápidas do painel (confirmar, já sei) via toast.
const undoToast = (message: string, tr: Messages) =>
  toast.show({
    message,
    tone: 'ok',
    action: {
      label: tr.common.undo,
      onClick: () => {
        const ok = useGraphStore.getState().undoLastAction();
        toast.show({ message: ok ? tr.toast.undone : tr.toast.nothingToUndo, tone: ok ? 'ok' : 'warn' });
      },
    },
  });

export function DetailPanel() {
  const tr = useT();
  const project = useGraphStore((s) => s.project);
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const updateNode = useGraphStore((s) => s.updateNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const addManualHistory = useGraphStore((s) => s.addManualHistory);
  const confirmNode = useGraphStore((s) => s.confirmNode);
  const unconfirmNode = useGraphStore((s) => s.unconfirmNode);
  const toggleTakenAsKnown = useGraphStore((s) => s.toggleTakenAsKnown);
  const pickDecisionOption = useGraphStore((s) => s.pickDecisionOption);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusNode = useGraphStore((s) => s.focusNode);
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const pending = useGraphStore((s) => s.pendingSuggestions);

  const addRule = useGraphStore((s) => s.addRule);
  const removeRule = useGraphStore((s) => s.removeRule);
  const panelOpen = useGraphStore((s) => s.detailPanelOpen);
  const setPanelOpen = useGraphStore((s) => s.setDetailPanelOpen);

  const [noteDraft, setNoteDraft] = useState('');
  const failureRef = useRef<HTMLDivElement>(null);
  const [ruleDraft, setRuleDraft] = useState('');
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isMobile = useIsMobile();
  const selectionVersion = useGraphStore((s) => s.selectionVersion);
  const [drawerDismissed, setDrawerDismissed] = useState(false);
  const [confirmingNoSignal, setConfirmingNoSignal] = useState(false);
  const [readingOpen, setReadingOpen] = useState(false);
  // selectionVersion bumps on every selectNode — so tapping the SAME node
  // again on mobile re-opens a sheet the user had swiped away.
  // Célula que já tem explicação detalhada abre mostrando ela — sem clique
  // extra; o estado só é recalculado na troca de seleção, então fechar
  // manualmente continua respeitado enquanto o nó está selecionado.
  useEffect(() => {
    setDrawerDismissed(false);
    setConfirmingNoSignal(false);
    setReadingOpen(false);
    setMenuOpen(false);
    setConfirmingDelete(false);
    const current = selectedId ? useGraphStore.getState().project?.nodes[selectedId] : null;
    setExplanationOpen(Boolean(current?.explicacao));
  }, [selectedId, selectionVersion]);

  const node = project && selectedId ? project.nodes[selectedId] ?? null : null;

  // -------------------------------------------------------------------------
  // IA — explicar e quebrar em partes. O hook vive no painel (que não remonta
  // ao trocar de nó), então guardamos para qual nó cada chamada foi feita.
  // -------------------------------------------------------------------------

  const [explainFor, setExplainFor] = useState<string | null>(null);
  const [streamed, setStreamed] = useState<{ nodeId: string; text: string } | null>(null);
  const explain = useAIAction(
    async (signal, n: ConceptNodeData) => {
      const p = useGraphStore.getState().project;
      if (!p) return null;
      const text = await explainNode(
        {
          projectName: p.name,
          projectObjective: p.objective,
          breadcrumb: breadcrumbFor(p, n.id).map((c) => c.name),
          nodeName: n.name,
          nodeKind: n.kind,
          oQue: n.oQue,
          porQue: n.porQue,
          comoConfirmar: n.comoConfirmar,
          // Sem lock (ou na janela de desfazer), sem o critério da IA.
          criterionLocked: canRevealAICriterionNow(n),
          comoConfirmarUsuario: n.comoConfirmarUsuario,
          rules: p.rules,
          research: n.webResearch,
          relatedParts: relatedPartsFor(p, n.id),
        },
        { signal, onDelta: (soFar) => setStreamed({ nodeId: n.id, text: soFar }) },
      );
      useGraphStore.getState().setNodeExplanation(n.id, text);
      return text;
    },
    { job: node ? { nodeId: node.id, kind: 'explain' } : null },
  );

  const [decomposeFor, setDecomposeFor] = useState<string | null>(null);
  const decompose = useAIAction(
    async (signal, n: ConceptNodeData) => {
      const p = useGraphStore.getState().project;
      if (!p) return false;
      const siblings = Object.values(p.nodes)
        .filter((x) => x.parentId === n.parentId && x.id !== n.id)
        .map((x) => ({ name: x.name, fx: x.fx }));
      const kbContext = await useKBStore.getState().getContextFor({
        label: tr.notify.objectivePromptLabel(p.objective),
        extra: tr.notify.objectivePromptExtra(n.name, n.kind, n.fx),
      });
      if (signal.aborted) return false;
      const result = await decomposeNode(
        {
          projectName: p.name,
          projectObjective: p.objective,
          breadcrumb: breadcrumbFor(p, n.id).map((c) => c.name),
          nodeName: n.name,
          nodeKind: n.kind,
          nodeFx: n.fx,
          siblings,
          strategy: p.constructionStrategy,
          archetype: p.archetype,
          rules: p.rules,
          research: n.webResearch,
          oQue: n.oQue,
          porQue: n.porQue,
          comoConfirmar: n.comoConfirmar,
          comoConfirmarUsuario: n.comoConfirmarUsuario,
          knownElsewhere: knownElsewhereFor(p, n.id),
        },
        kbContext,
        { signal },
      );
      const latest = useGraphStore.getState();
      const parent = latest.project?.nodes[n.id];
      // Outra rodada de sugestões apareceu no meio: não sobrescreve.
      if (!parent || latest.pendingSuggestions) return false;
      latest.stageSuggestions(n.id, buildStagedNodes(parent, result.nodes), result.edges);
      return true;
    },
    { job: node ? { nodeId: node.id, kind: 'decompose' } : null },
  );

  if (!project || !selectedId || !node) {
    if (isMobile) return null;
    if (!panelOpen) {
      return <CollapsedRail onExpand={() => setPanelOpen(true)} label={tr.detail.expandPanel} />;
    }
    return (
      <aside className="hidden md:flex md:w-[280px] lg:w-[380px] shrink-0 border-l border-border-base bg-bg-secondary flex-col">
        <PanelTopBar onCollapse={() => setPanelOpen(false)} label={tr.detail.collapsePanel} />
        {project ? (
          <ProjectSummary project={project} tr={tr} />
        ) : (
          <div className="p-4 text-text-muted text-sm">{tr.detail.noSelection}</div>
        )}
      </aside>
    );
  }

  const crumbs = breadcrumbFor(project, selectedId);
  const blocker = firstBlockerOf(project, node.id);
  const blocked = blocker !== null;
  const structural = node.kind === 'root' || node.kind === 'categoria';
  const hasChildren = Object.values(project.nodes).some((n) => n.parentId === node.id);
  const canConfirm =
    (node.kind === 'recurso' || node.kind === 'passo' || node.kind === 'concept') && !blocked;
  // Mesmos gates do tutor: falha em aberto ou sugestões da IA ainda em revisão
  // neste nó impedem confirmar (o store recusaria — sem toast enganoso).
  const openFailure = Boolean(node.failureContext);
  const pendingHere = pending?.parentId === node.id;
  const confirmGate: 'failure' | 'pending' | null = openFailure
    ? 'failure'
    : pendingHere
    ? 'pending'
    : null;
  const conclude = canConcludeNode(project, node.id);
  const ready = conclude.ready;
  const stepNo = stepSequence(project, node.id);
  const confirmLabel =
    node.kind === 'recurso'
      ? tr.detail.alreadyHave
      : node.kind === 'concept'
      ? tr.detail.understood
      : tr.detail.alreadyDid;

  const explainHere = explainFor === node.id;
  const explaining = explain.running && explainHere;
  const decomposeHere = decomposeFor === node.id;
  const decomposing = decompose.running && decomposeHere;
  // Uma instância de cada ação para o painel inteiro: rodar em outro nó
  // abortaria a chamada em andamento — bloqueia com o motivo e um atalho.
  const explainBusyOn = explain.running && !explainHere && explainFor ? project.nodes[explainFor] : null;
  const decomposeBusyOn =
    decompose.running && !decomposeHere && decomposeFor ? project.nodes[decomposeFor] : null;
  const streamingText = explaining && streamed?.nodeId === node.id ? streamed.text : '';

  const generateExplanation = async () => {
    if (explain.running) return;
    if (!requireAI()) return;
    const id = node.id;
    setExplainFor(id);
    setStreamed(null);
    const text = await explain.run(node);
    setStreamed(null);
    if (text && useGraphStore.getState().selectedNodeId === id) setExplanationOpen(true);
  };

  const handleExplain = async () => {
    if (node.explicacao) {
      setExplanationOpen((o) => !o);
      return;
    }
    await generateExplanation();
  };

  const handleDecompose = async () => {
    if (decompose.running) return;
    if (!requireAI()) return;
    const id = node.id;
    setDecomposeFor(id);
    const staged = await decompose.run(node);
    // No mobile o sheet sai da frente para as sugestões aparecerem no grafo
    // (o GraphCanvas enquadra pai + sugestões sozinho).
    if (staged && isMobile && useGraphStore.getState().selectedNodeId === id) {
      setDrawerDismissed(true);
    }
  };

  const doConfirm = () => {
    if (confirmGate) return;
    const before = useGraphStore.getState().project?.nodes[node.id];
    confirmNode(node.id);
    setConfirmingNoSignal(false);
    const after = useGraphStore.getState().project?.nodes[node.id];
    // Toast só quando o store de fato confirmou o nó.
    if (!after || after === before || !after.confirmado) return;
    undoToast(
      after?.state === 'done' ? tr.detail.confirmedToast(node.name) : tr.detail.confirmedNoProofToast(node.name),
      tr,
    );
  };

  const doToggleKnown = () => {
    const wasKnown = Boolean(node.takenAsKnown);
    toggleTakenAsKnown(node.id);
    setMenuOpen(false);
    if (!wasKnown) undoToast(tr.detail.markedKnownToast(node.name), tr);
  };

  // Trabalhar no tutor: o tutor abre folhas; para um nó com filhos, vai para
  // a primeira parte pendente da subárvore.
  const workInTutor = () => {
    let target = node.id;
    if (hasChildren || !isActionableKind(node.kind)) {
      const leaf = effectiveLeavesUnder(project, node.id).find((n) => !n.confirmado && !n.takenAsKnown);
      if (leaf) target = leaf.id;
    }
    selectNode(target);
    setViewMode('tutor');
  };

  const goToFailure = () => {
    const el = failureRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Sem formulário aberto, foca o primeiro controle da seção de falha.
    el.querySelector<HTMLElement>('textarea:not([disabled]), button:not([disabled])')?.focus({
      preventScroll: true,
    });
  };

  const recordNote = () => {
    if (!noteDraft.trim()) return;
    addManualHistory(node.id, noteDraft.trim());
    setNoteDraft('');
  };

  const decomposeDisabled = decompose.running || pending !== null;
  const decomposeButton = (primary: boolean) => (
    <button
      onClick={handleDecompose}
      disabled={decomposeDisabled}
      title={
        decomposeBusyOn
          ? tr.detail.busyElsewhere(decomposeBusyOn.name)
          : pending && !decomposing
          ? tr.detail.pendingHint
          : undefined
      }
      className={`${
        primary ? 'flex-1 min-h-[44px] text-sm' : 'w-full min-h-[36px] text-xs'
      } bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-ai-accent py-2 rounded-sm border border-ai-accent/40 transition-colors font-medium flex items-center justify-center gap-2`}
    >
      <span aria-hidden>◆</span>
      {decomposing
        ? tr.detail.decomposingElapsed(Math.round(decompose.elapsedMs / 1000))
        : pending && !decomposing
        ? tr.detail.pendingHint
        : tr.detail.decompose}
    </button>
  );

  const decomposeExtras = (
    <>
      {decomposing && (
        <button
          onClick={decompose.cancel}
          className="mt-1.5 w-full text-[11px] text-text-muted hover:text-state-problem transition-colors"
        >
          {tr.common.cancelRunning}
        </button>
      )}
      {decomposeHere && decompose.error && !decompose.running && (
        <InlineError className="mt-2" error={decompose.error} onRetry={() => void decompose.retry()} />
      )}
      {decomposeBusyOn && <BusyElsewhere node={decomposeBusyOn} tr={tr} onGo={selectNode} />}
    </>
  );

  // Ação principal do rodapé: confirmar (folha confirmável) ou quebrar em
  // partes (raiz/categoria). Decisão se resolve pelas opções no corpo.
  const primaryIsConfirm = canConfirm && !node.confirmado;
  const primaryIsDecompose = !primaryIsConfirm && structural;

  const missingHints = conclude.missingKeys.filter(
    (k): k is Exclude<ConcludeMissingKey, 'noSignal' | 'blocked'> => k !== 'noSignal' && k !== 'blocked',
  );

  // -------------------------------------------------------------------------
  // Corpo
  // -------------------------------------------------------------------------

  const header = (
    <div className="p-3 border-b border-border-base">
      <div className="flex items-center gap-2 mb-1 min-h-[24px]">
        <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">
          <span aria-hidden>{KIND_ICON[node.kind]}</span>
          {tr.conceptNode[node.kind]}
        </span>
        {stepNo !== null && (
          <span className="text-[10px] font-mono text-text-muted">#{stepNo}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {blocked && !node.confirmado && (
            <span className="text-[10px] font-mono text-text-muted">{tr.detail.blocked}</span>
          )}
          {node.state === 'done' ? (
            <span className="text-[10px] font-mono text-state-done">{tr.detail.confirmed}</span>
          ) : node.state === 'problem' || node.failureContext ? (
            <span className="text-[10px] font-mono text-state-problem">{tr.detail.problemBadge}</span>
          ) : node.confirmado ? (
            <span className="text-[10px] font-mono text-conf-mid">{tr.detail.confirmedNoSignal}</span>
          ) : node.takenAsKnown ? (
            <span className="text-[10px] font-mono text-ai-accent">{tr.detail.axiomBadge}</span>
          ) : null}
          <NodeMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            tr={tr}
            items={[
              !node.confirmado && node.parentId
                ? {
                    key: 'known',
                    label: node.takenAsKnown ? tr.detail.knownUndo : tr.detail.markKnown,
                    onClick: doToggleKnown,
                  }
                : null,
              {
                key: 'frame',
                label: tr.detail.frameInGraph,
                onClick: () => {
                  setMenuOpen(false);
                  focusNode(node.id);
                  if (isMobile) setDrawerDismissed(true);
                },
              },
              node.parentId
                ? {
                    key: 'delete',
                    label: tr.detail.deleteNode,
                    danger: true,
                    onClick: () => {
                      setMenuOpen(false);
                      setConfirmingDelete(true);
                    },
                  }
                : null,
            ]}
          />
        </span>
      </div>
      <NameInput
        key={node.id}
        value={node.name}
        ariaLabel={tr.detail.nameAria}
        onCommit={(name) => updateNode(node.id, { name }, { commit: true })}
      />
      {confirmingDelete && node.parentId && (
        <div
          role="alertdialog"
          aria-label={tr.detail.deleteNode}
          className="mt-2 p-2.5 rounded-sm border border-state-problem/40 bg-state-problem/10 space-y-2"
        >
          <p className="text-xs text-text-primary leading-snug">
            {tr.detail.deleteInline(node.name, countDescendants(project, node.id))}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setConfirmingDelete(false);
                deleteNode(node.id);
              }}
              className="tap flex-1 min-h-[36px] text-xs rounded-sm border border-state-problem/50 bg-state-problem/20 text-state-problem hover:bg-state-problem/30 transition-colors"
            >
              {tr.detail.deleteYes}
            </button>
            <button
              autoFocus
              onClick={() => setConfirmingDelete(false)}
              className="tap px-3 min-h-[36px] text-xs rounded-sm border border-border-base text-text-secondary hover:text-text-primary transition-colors"
            >
              {tr.detail.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const actionSection = (
    <section className="p-3 border-b border-border-base space-y-2 empty:hidden">
      {node.ruleConflict && (
        <div className="text-[11px] leading-snug p-2 rounded-sm border border-state-problem/40 bg-state-problem/10 text-state-problem">
          <span className="font-mono uppercase text-[10px] tracking-wider">⛓ {tr.detail.ruleConflict}</span>
          <div className="text-text-secondary mt-0.5">{node.ruleConflict}</div>
        </div>
      )}
      {blocked && !node.confirmado && blocker && (
        <div className="text-[11px] text-text-muted leading-snug flex items-start gap-1.5">
          <span aria-hidden>🔒</span>
          <span>
            {tr.detail.blockedBy}{' '}
            <button
              onClick={() => selectNode(blocker.id)}
              className="underline decoration-dotted text-text-secondary hover:text-text-primary"
            >
              {blocker.name}
            </button>
          </span>
        </div>
      )}

      {node.kind === 'decisao' && node.decisionOptions && (
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-2">
            {tr.detail.options}
          </label>
          <div className="space-y-1.5">
            {node.decisionOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => pickDecisionOption(node.id, opt.id)}
                aria-pressed={node.decisionPickedId === opt.id}
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
        </div>
      )}

      {primaryIsConfirm && confirmGate === 'pending' && (
        <div className="text-[11px] leading-snug text-ai-accent">{tr.detail.pendingHereHint}</div>
      )}
      {primaryIsConfirm && confirmGate !== 'pending' && (
        <div className={`text-[11px] leading-snug ${ready ? 'text-state-done' : 'text-text-muted'}`}>
          {ready ? (
            tr.detail.readyToConclude
          ) : (
            <ul className="space-y-0.5">
              {missingHints.map((k) => (
                <li key={k}>· {tr.detail.missing[k]}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {node.confirmado && (
        <button
          onClick={() => unconfirmNode(node.id)}
          className="w-full bg-bg-elevated hover:bg-state-problem/10 text-text-muted hover:text-state-problem text-xs py-1.5 min-h-[32px] rounded-sm border border-border-base transition-colors"
        >
          {tr.detail.undoConfirm}
        </button>
      )}

      {!primaryIsDecompose && !node.takenAsKnown && (
        <div>
          {decomposeButton(false)}
          {decomposeExtras}
        </div>
      )}
    </section>
  );

  const body = (
    <>
      {actionSection}

      <section className="p-3 border-b border-border-base space-y-3">
        <EduField
          key={`${node.id}:oQue`}
          label={tr.detail.whatIs}
          value={node.oQue}
          tr={tr}
          onCommit={(v) => updateNode(node.id, { oQue: v }, { commit: true })}
        />
        <EduField
          key={`${node.id}:porQue`}
          label={tr.detail.whyNeeded}
          value={node.porQue}
          tr={tr}
          onCommit={(v) => updateNode(node.id, { porQue: v }, { commit: true })}
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
                  className="inline-flex items-center gap-1 text-[11px] font-mono pl-2 rounded-sm bg-ai-accent/5 text-text-secondary border border-ai-accent/30"
                >
                  {r}
                  <button
                    onClick={() => removeRule(r)}
                    className="tap px-1.5 py-1 text-text-muted hover:text-state-problem transition-colors"
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
      <div ref={failureRef}>
        <FailureSection node={node} project={project} />
      </div>

      <section className="p-3 border-b border-border-base">
        <div className="flex gap-1.5">
          <button
            onClick={handleExplain}
            disabled={explain.running && !explaining && !node.explicacao}
            className="flex-1 min-w-0 min-h-[36px] flex items-center justify-between gap-2 px-2 py-1.5 bg-ai-accent/10 hover:bg-ai-accent/20 border border-ai-accent/30 rounded-sm text-ai-accent text-xs transition-colors disabled:opacity-60"
          >
            <span className="flex items-center gap-1.5">
              <span aria-hidden>◆</span>
              {explaining
                ? tr.detail.generatingExplainElapsed(Math.round(explain.elapsedMs / 1000))
                : node.explicacao
                ? explanationOpen
                  ? tr.detail.closeExplain
                  : tr.detail.viewExplain
                : tr.detail.explainBtn}
            </span>
            {node.explicacao && !explaining && (
              <span className="text-[10px]">{explanationOpen ? '▲' : '▼'}</span>
            )}
          </button>
          <button
            onClick={() => setReadingOpen(true)}
            title={tr.detail.readingMode}
            aria-label={tr.detail.readingMode}
            className="tap shrink-0 w-9 flex items-center justify-center bg-bg-elevated hover:bg-ai-accent/10 border border-border-base hover:border-ai-accent/40 rounded-sm text-text-muted hover:text-ai-accent transition-colors text-sm"
          >
            ⛶
          </button>
        </div>
        {explaining && (
          <button
            onClick={explain.cancel}
            className="mt-1.5 w-full text-[11px] text-text-muted hover:text-state-problem transition-colors"
          >
            {tr.common.cancelRunning}
          </button>
        )}
        {explainHere && explain.error && !explain.running && (
          <InlineError className="mt-2" error={explain.error} onRetry={() => void generateExplanation()} />
        )}
        {explainBusyOn && !node.explicacao && (
          <BusyElsewhere node={explainBusyOn} tr={tr} onGo={selectNode} />
        )}
        {streamingText && (
          <div className="mt-2 p-3 bg-bg-elevated/50 border border-border-base rounded-sm" aria-live="polite">
            <ExplanationContent text={streamingText} />
          </div>
        )}
        {!explaining && explanationOpen && node.explicacao && (
          <div className="mt-2 p-3 bg-bg-elevated/50 border border-border-base rounded-sm">
            <ExplanationContent text={node.explicacao} />
          </div>
        )}
      </section>

      {/* Confidence is the AI's signal (value + source + reason), shown, not
          edited. Raiz/categoria têm 100 fixo — não mostramos. */}
      {!structural && (
        <section className="p-3 border-b border-border-base">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
            {tr.detail.confidence}
            {node.confidenceSource && (
              <span className="ml-2 normal-case tracking-normal text-text-muted">
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
      )}

      <details className="border-b border-border-base group">
        <summary className="p-3 cursor-pointer select-none text-[10px] font-mono uppercase tracking-wider text-text-muted hover:text-text-secondary list-none flex items-center gap-1.5">
          <span className="group-open:rotate-90 transition-transform" aria-hidden>
            ▸
          </span>
          {tr.detail.notesAndHistory(node.history.length)}
        </summary>
        <div className="px-3 pb-3 space-y-3">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
              {tr.detail.notes}
            </label>
            <NotesField
              key={node.id}
              value={node.notes}
              placeholder={tr.detail.notesPlaceholder}
              onCommit={(notes) => updateNode(node.id, { notes }, { commit: true })}
            />
          </div>
          <div>
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
                aria-label={tr.detail.recordDecision}
                className="px-2 bg-bg-elevated border border-border-base rounded-sm text-[11px] hover:border-text-muted"
              >
                {tr.detail.addNote}
              </button>
            </div>
          </div>
        </div>
      </details>

      {readingOpen && (
        <ReadingMode
          node={node}
          breadcrumb={crumbs.map((c) => c.name)}
          onClose={() => setReadingOpen(false)}
          onGenerate={() => void generateExplanation()}
          generating={explaining}
        />
      )}
    </>
  );

  // -------------------------------------------------------------------------
  // Rodapé — no máximo 2 botões: a ação principal e "trabalhar no tutor".
  // -------------------------------------------------------------------------

  const tutorButton = (
    <button
      onClick={workInTutor}
      className={`${
        primaryIsConfirm || primaryIsDecompose ? 'shrink-0 px-3' : 'flex-1'
      } min-h-[44px] text-xs rounded-sm border border-border-base bg-bg-elevated text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors`}
      title={tr.detail.workInTutor}
    >
      {primaryIsConfirm || primaryIsDecompose ? tr.detail.workInTutorShort : tr.detail.workInTutor}
    </button>
  );

  const footer = (
    <div className="space-y-2">
      {primaryIsConfirm && !ready && !confirmGate && confirmingNoSignal ? (
        // Friction-ful acknowledgement: confirming without an anchor is a
        // deliberate two-step, and it lands amber (not green), never 'done'.
        <div className="space-y-1.5">
          <div className="text-[11px] text-conf-mid text-center leading-snug">
            {tr.detail.confirmHintNoSignal}
          </div>
          <div className="flex gap-2">
            <button
              onClick={doConfirm}
              className="flex-1 bg-conf-mid/15 hover:bg-conf-mid/30 text-conf-mid text-xs py-2 min-h-[44px] rounded-sm border border-conf-mid/40 transition-colors"
            >
              {tr.detail.confirmAnyway}
            </button>
            <button
              onClick={() => setConfirmingNoSignal(false)}
              className="px-3 min-h-[44px] text-xs text-text-muted hover:text-text-secondary border border-border-base rounded-sm transition-colors"
            >
              {tr.detail.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {primaryIsConfirm && confirmGate === 'failure' ? (
            <button
              onClick={goToFailure}
              className="flex-1 bg-state-problem/10 hover:bg-state-problem/20 text-state-problem text-sm py-2.5 min-h-[44px] rounded-sm border border-state-problem/40 transition-colors font-medium"
            >
              {tr.tutor.resolveFailureFirst}
            </button>
          ) : primaryIsConfirm && confirmGate === 'pending' ? (
            <button
              disabled
              className="flex-1 bg-bg-elevated text-text-muted text-sm py-2.5 min-h-[44px] rounded-sm border border-border-base font-medium opacity-60 cursor-not-allowed"
            >
              {confirmLabel}
            </button>
          ) : primaryIsConfirm &&
            (ready ? (
              // Faithful fast path: real signal present → one click earns 'done'.
              <button
                onClick={doConfirm}
                className="flex-1 bg-conf-high/15 hover:bg-conf-high/30 text-conf-high text-sm py-2.5 min-h-[44px] rounded-sm border border-conf-high/40 transition-colors font-medium"
              >
                {confirmLabel}
              </button>
            ) : (
              <button
                onClick={() => setConfirmingNoSignal(true)}
                className="flex-1 bg-bg-elevated hover:bg-conf-mid/10 text-text-secondary hover:text-conf-mid text-sm py-2.5 min-h-[44px] rounded-sm border border-border-base hover:border-conf-mid/40 transition-colors font-medium"
              >
                {confirmLabel}
              </button>
            ))}
          {primaryIsDecompose && decomposeButton(true)}
          {tutorButton}
        </div>
      )}
      {primaryIsDecompose && decomposeExtras}
    </div>
  );

  if (isMobile) {
    return (
      <MobileSheet
        open={!drawerDismissed}
        onOpenChange={(o) => {
          if (!o) setDrawerDismissed(true);
        }}
        title={node.name || tr.detail.sheetFallbackTitle}
        footer={footer}
        titleHidden
      >
        {header}
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
      {header}
      <div className="flex-1 min-h-0 overflow-y-auto">{body}</div>
      <div className="shrink-0 p-3 border-t border-border-base bg-bg-secondary">{footer}</div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Resumo do projeto — o painel sem seleção (Esc) mostra onde o projeto está e
// leva ao próximo pendente.
// ---------------------------------------------------------------------------

function ProjectSummary({ project, tr }: { project: Project; tr: Messages }) {
  const selectNode = useGraphStore((s) => s.selectNode);
  const requestCenter = useGraphStore((s) => s.requestCenter);
  const pending = useGraphStore((s) => s.pendingSuggestions);
  const progress = projectProgress(project, pending);
  const next = nextPendingForTutor(project, pending);
  return (
    <div className="p-4 space-y-4 text-sm">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
          {tr.conceptNode.root}
        </div>
        <div className="text-text-primary font-semibold leading-snug">{project.name}</div>
        {project.objective && project.objective !== project.name && (
          <p className="text-xs text-text-secondary mt-1 leading-snug">{project.objective}</p>
        )}
      </div>
      <div>
        <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
          <span>{tr.detail.summaryProgress(progress.done, progress.total)}</span>
          <span className="font-mono">{progress.percent}%</span>
        </div>
        <div className="h-1.5 bg-bg-elevated rounded-sm overflow-hidden border border-border-base">
          <div className="h-full bg-state-done" style={{ width: `${progress.percent}%` }} />
        </div>
        {progress.doneWithoutSignal > 0 && (
          <div className="text-[11px] text-conf-mid mt-1">
            {tr.detail.summaryNoProof(progress.doneWithoutSignal)}
          </div>
        )}
      </div>
      {next ? (
        <button
          onClick={() => {
            selectNode(next.id);
            requestCenter(next.id);
          }}
          className="w-full text-left p-2.5 rounded-sm border border-ai-accent/40 bg-ai-accent/10 hover:bg-ai-accent/20 transition-colors"
        >
          <div className="text-[10px] font-mono uppercase tracking-wider text-ai-accent mb-0.5">
            {tr.detail.summaryNext}
          </div>
          <div className="text-xs text-text-primary">{next.name}</div>
        </button>
      ) : (
        <p className="text-xs text-text-muted">{tr.detail.summaryNothingPending}</p>
      )}
      <p className="text-[11px] text-text-muted">{tr.detail.summaryHint}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu ⋯ do nó — ações raras ou destrutivas saem do caminho principal.
// ---------------------------------------------------------------------------

interface NodeMenuItem {
  key: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

function NodeMenu({
  open,
  onOpenChange,
  items,
  tr,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: Array<NodeMenuItem | null>;
  tr: Messages;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const list = items.filter((i): i is NodeMenuItem => i !== null);

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Não deixa o Esc fechar o sheet nem limpar a seleção do grafo.
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onOpenChange]);

  if (list.length === 0) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        onClick={() => onOpenChange(!open)}
        aria-label={tr.detail.moreActions}
        aria-haspopup="menu"
        aria-expanded={open}
        className="tap w-7 h-7 flex items-center justify-center rounded-sm text-text-muted hover:text-text-primary hover:bg-bg-elevated border border-transparent hover:border-border-base transition-colors"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          aria-label={tr.detail.moreActions}
          className="absolute right-0 top-full mt-1 w-60 bg-bg-secondary border border-border-base rounded-sm shadow-lg z-30 py-1"
        >
          {list.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              onClick={item.onClick}
              className={`w-full text-left px-3 py-2.5 min-h-[40px] text-xs outline-none transition-colors hover:bg-bg-elevated focus:bg-bg-elevated ${
                item.danger ? 'text-state-problem' : 'text-text-secondary'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campos com rascunho local: o store só recebe o valor no commit (blur/Enter),
// então renomear ou editar gera UMA entrada de histórico, não uma por tecla.
// ---------------------------------------------------------------------------

function NameInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const revertRef = useRef(false);
  // Mudança externa (desfazer, IA) enquanto não está editando: acompanha.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const commit = () => {
    focusedRef.current = false;
    if (revertRef.current) {
      revertRef.current = false;
      setDraft(value);
      return;
    }
    const next = draft.trim();
    if (!next) {
      setDraft(value);
      return;
    }
    if (next !== value) onCommit(next);
    setDraft(next);
  };

  return (
    <input
      value={draft}
      aria-label={ariaLabel}
      onFocus={() => (focusedRef.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          revertRef.current = true;
          e.currentTarget.blur();
        }
      }}
      className="w-full bg-transparent text-base font-semibold outline-none focus:bg-bg-elevated/50 px-1 -mx-1 rounded-sm"
    />
  );
}

function useAutosize(ref: RefObject<HTMLTextAreaElement>, value: string, active: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [ref, value, active]);
}

function NotesField({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, draft, true);
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={draft}
      onFocus={() => (focusedRef.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focusedRef.current = false;
        if (draft !== value) onCommit(draft);
      }}
      rows={2}
      className="w-full bg-bg-elevated border border-border-base rounded-sm px-2 py-1 text-xs resize-none focus:border-ai-accent outline-none"
      placeholder={placeholder}
    />
  );
}

interface EduFieldProps {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  tr: Messages;
}

// Texto lido por padrão; ✎ abre a edição (textarea que cresce com o texto,
// salva no blur, Esc desfaz).
function EduField({ label, value, onCommit, tr }: EduFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const revertRef = useRef(false);
  useAutosize(ref, draft, editing);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const finish = () => {
    setEditing(false);
    if (revertRef.current) {
      revertRef.current = false;
      setDraft(value);
      return;
    }
    const next = draft.trim();
    if (next !== value.trim()) onCommit(next);
  };

  let content: ReactNode;
  if (editing) {
    content = (
      <textarea
        ref={ref}
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            revertRef.current = true;
            e.currentTarget.blur();
          }
        }}
        rows={2}
        className="w-full bg-bg-elevated border border-ai-accent/60 rounded-sm px-2 py-1 text-xs leading-relaxed resize-none outline-none overflow-hidden"
      />
    );
  } else {
    content = value ? (
      <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{value}</p>
    ) : (
      <p className="text-xs text-text-muted italic">{tr.detail.emptyField}</p>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{label}</span>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            aria-label={tr.detail.editField(label)}
            title={tr.detail.editField(label)}
            className="tap ml-auto w-6 h-6 flex items-center justify-center rounded-sm text-text-muted hover:text-ai-accent hover:bg-bg-elevated transition-colors text-xs"
          >
            ✎
          </button>
        )}
      </div>
      {content}
    </div>
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

// IA ocupada em outro nó (uma instância por painel): o motivo e um atalho até lá.
function BusyElsewhere({
  node,
  tr,
  onGo,
}: {
  node: ConceptNodeData;
  tr: Messages;
  onGo: (id: string) => void;
}) {
  return (
    <div className="mt-1.5 text-[11px] text-text-muted leading-snug">
      {tr.detail.busyElsewhere(node.name)}{' '}
      <button onClick={() => onGo(node.id)} className="text-ai-accent hover:underline">
        {tr.tutor.goThere}
      </button>
    </div>
  );
}
