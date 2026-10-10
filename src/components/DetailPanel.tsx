import { AudioTextarea, AudioTextInput } from '@/audio/AudioField';
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
  planOverviewFor,
} from '@/store';
import { decomposeNode, explainNode } from '@/ai/service';
import { requireAI } from '@/ai/availability';
import { useKBStore } from '@/kb/store';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useAIAction } from '@/hooks/useAIAction';
import { InlineError } from '@/components/ui/InlineError';
import { toast } from '@/components/ui/Toast';
import { useT } from '@/i18n';
import { useReviewingParents } from '@/hooks/useReviewingParents';
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
import './DetailPanel.css';
import { NodeFileSources } from '@/attachments/NodeFileSources';
import { normalizePlanningIntent } from '@/planningIntent';

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

export function DetailPanel({ suspended = false }: { suspended?: boolean }) {
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
  const criterionRef = useRef<HTMLDivElement>(null);
  const [ruleDraft, setRuleDraft] = useState('');
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isMobile = useIsMobile();
  const selectionVersion = useGraphStore((s) => s.selectionVersion);
  // Chegar no grafo (vindo do tutor) com uma seleção herdada não abre o
  // sheet no mobile: o nó fica destacado e o sheet só abre com um toque.
  const [drawerDismissed, setDrawerDismissed] = useState(
    () =>
      Boolean(useGraphStore.getState().selectedNodeId) &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(max-width: 767px)').matches === true,
  );
  const initialSelection = useRef({ selectedId, selectionVersion });
  const [confirmingNoSignal, setConfirmingNoSignal] = useState(false);
  const [readingOpen, setReadingOpen] = useState(false);
  // selectionVersion bumps on every selectNode — so tapping the SAME node
  // again on mobile re-opens a sheet the user had swiped away.
  // Célula que já tem explicação detalhada abre mostrando ela — sem clique
  // extra; o estado só é recalculado na troca de seleção, então fechar
  // manualmente continua respeitado enquanto o nó está selecionado.
  useEffect(() => {
    const init = initialSelection.current;
    if (init.selectedId !== selectedId || init.selectionVersion !== selectionVersion) setDrawerDismissed(false);
    setConfirmingNoSignal(false);
    setReadingOpen(false);
    setMenuOpen(false);
    setConfirmingDelete(false);
    const current = selectedId ? useGraphStore.getState().project?.nodes[selectedId] : null;
    setExplanationOpen(Boolean(current?.explicacao));
  }, [selectedId, selectionVersion]);

  const node = project && selectedId ? project.nodes[selectedId] ?? null : null;

  // O grafo precisa saber se o sheet cobre a metade de baixo (enquadramento).
  const setMobileSheetOpen = useGraphStore((s) => s.setMobileSheetOpen);
  const sheetOpen = isMobile && !!node && !drawerDismissed && !suspended;
  useEffect(() => {
    setMobileSheetOpen(sheetOpen);
  }, [sheetOpen, setMobileSheetOpen]);
  useEffect(() => () => setMobileSheetOpen(false), [setMobileSheetOpen]);

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
          ...normalizePlanningIntent(p),
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
          ...normalizePlanningIntent(p),
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
          planOverview: planOverviewFor(p, n.id),
        },
        kbContext,
        { signal },
      );
      const latest = useGraphStore.getState();
      const parent = latest.project?.nodes[n.id];
      // Outra rodada de sugestões DESTE nó apareceu no meio: não sobrescreve.
      // Lote de outro nó em revisão estaciona (stageSuggestions).
      if (!parent || latest.pendingSuggestions?.parentId === n.id) return false;
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
      <aside className="planner-detail-panel hidden md:flex shrink-0 border-l border-border-base/70 bg-bg-secondary flex-col">
        <PanelTopBar onCollapse={() => setPanelOpen(false)} label={tr.detail.collapsePanel} />
        <div className="planner-detail-content planner-detail-scroll flex-1 min-h-0 overflow-y-auto scroll-stable">
          {project ? (
            <ProjectSummary project={project} tr={tr} />
          ) : (
            <div className="px-4 py-3 text-text-muted text-control">{tr.detail.noSelection}</div>
          )}
        </div>
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

  // Caminho com prova: rola até o critério (ou a aferição) e foca o campo.
  const goToCriterion = () => {
    const el = criterionRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.querySelector<HTMLElement>('textarea:not([disabled])')?.focus({ preventScroll: true });
  };

  const recordNote = () => {
    if (!noteDraft.trim()) return;
    addManualHistory(node.id, noteDraft.trim());
    setNoteDraft('');
  };

  // Só as sugestões DESTE nó seguram o decompor — as de outro nó estacionam.
  const decomposeDisabled = decompose.running || pendingHere;
  const decomposeButton = (primary: boolean) => (
    <button
      onClick={handleDecompose}
      disabled={decomposeDisabled}
      title={
        decomposeBusyOn
          ? tr.detail.busyElsewhere(decomposeBusyOn.name)
          : pendingHere && !decomposing
          ? tr.detail.pendingHint
          : undefined
      }
      className={`tap btn btn-ai ${primary ? 'flex-1 !h-8' : 'w-full'}`}
    >
      <span className="ai-icon" aria-hidden>
        ✦
      </span>
      {decomposing
        ? tr.detail.decomposingElapsed(Math.round(decompose.elapsedMs / 1000))
        : pendingHere && !decomposing
        ? tr.detail.pendingHint
        : tr.detail.decompose}
    </button>
  );

  const decomposeExtras = (
    <>
      {decomposing && (
        <button
          onClick={decompose.cancel}
          className="tap btn btn-ghost btn-sm mt-1.5 w-full hover:!text-state-problem"
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
    <div className="planner-detail-header shrink-0 px-4 pt-3 pb-3.5 border-b border-border-base/70">
      <div className="flex flex-wrap items-center gap-2 mb-1.5 min-h-[24px]">
        <span className="inline-flex items-center gap-1.5 text-footnote text-text-muted">
          <span aria-hidden className="text-text-faint">
            {KIND_ICON[node.kind]}
          </span>
          {tr.conceptNode[node.kind]}
        </span>
        {stepNo !== null && <span className="text-footnote tabular-nums text-text-faint">#{stepNo}</span>}
        <span className="planner-detail-status ml-auto flex min-w-0 flex-wrap justify-end items-center gap-1.5">
          {blocked && !node.confirmado && <span className="chip">{tr.detail.blocked}</span>}
          {node.state === 'done' ? (
            <span className="chip bg-state-done/12 text-state-done">{tr.detail.confirmed}</span>
          ) : node.state === 'problem' || node.failureContext ? (
            <span className="chip bg-state-problem/12 text-state-problem">{tr.detail.problemBadge}</span>
          ) : node.confirmado ? (
            <span className="chip bg-conf-mid/12 text-conf-mid">{tr.detail.confirmedNoSignal}</span>
          ) : node.takenAsKnown ? (
            <span className="chip bg-ai-accent/12 text-ai-accent">{tr.detail.axiomBadge}</span>
          ) : null}
          <NodeMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            tr={tr}
            items={[
              // "Confirmar sem prova…" mora no "…", como no tutor: o rodapé
              // leva ao critério (o caminho com prova).
              primaryIsConfirm && !ready && !confirmGate
                ? {
                    key: 'noProof',
                    label: tr.tutor.confirmNoProof,
                    onClick: () => {
                      setMenuOpen(false);
                      setConfirmingNoSignal(true);
                    },
                  }
                : null,
              !node.confirmado && node.parentId
                ? {
                    key: 'known',
                    label: node.takenAsKnown ? tr.detail.knownUndo : tr.detail.markKnown,
                    onClick: doToggleKnown,
                  }
                : null,
              // Desfazer mora no menu do nó: não compete com a ação principal.
              node.confirmado
                ? {
                    key: 'unconfirm',
                    label: tr.detail.undoConfirm,
                    onClick: () => {
                      setMenuOpen(false);
                      unconfirmNode(node.id);
                    },
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
        audioScope={`node:${node.id}:name`}
        key={node.id}
        value={node.name}
        ariaLabel={tr.detail.nameAria}
        onCommit={(name) => updateNode(node.id, { name }, { commit: true })}
      />
      {confirmingDelete && node.parentId && (
        <div
          role="alertdialog"
          aria-label={tr.detail.deleteNode}
          className="mt-3 p-3 rounded-control bg-state-problem/8 space-y-2.5"
        >
          <p className="text-control text-text-primary">
            {tr.detail.deleteInline(node.name, countDescendants(project, node.id))}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setConfirmingDelete(false);
                deleteNode(node.id);
              }}
              className="tap btn btn-danger flex-1"
            >
              {tr.detail.deleteYes}
            </button>
            <button
              autoFocus
              onClick={() => setConfirmingDelete(false)}
              className="tap btn btn-secondary"
            >
              {tr.detail.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const actionSection = (
    <section className="px-4 py-3.5 border-b border-border-base/70 space-y-2.5 empty:hidden">
      {node.ruleConflict && (
        <div className="text-footnote p-2.5 rounded-control bg-state-problem/8">
          <span className="font-medium text-state-problem">{tr.detail.ruleConflict}</span>
          <div className="text-text-secondary mt-0.5">{node.ruleConflict}</div>
        </div>
      )}
      {blocked && !node.confirmado && blocker && (
        <div className="text-footnote text-text-muted flex items-start gap-1.5">
          <span>
            {tr.detail.blockedBy}{' '}
            <button
              onClick={() => selectNode(blocker.id)}
              className="text-accent hover:underline"
            >
              {blocker.name}
            </button>
          </span>
        </div>
      )}

      {node.kind === 'decisao' && node.decisionOptions && (
        <div>
          <div className="label mb-1.5">{tr.detail.options}</div>
          <div className="space-y-1.5">
            {node.decisionOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => pickDecisionOption(node.id, opt.id)}
                aria-pressed={node.decisionPickedId === opt.id}
                className={`w-full text-left px-3 py-2.5 rounded-control transition-colors duration-120 ease-mac ${
                  node.decisionPickedId === opt.id
                    ? 'bg-accent/12 ring-1 ring-inset ring-accent text-accent'
                    : 'bg-bg-secondary shadow-mac-sm hover:bg-bg-elevated/60 text-text-primary'
                }`}
              >
                <div className="text-control font-semibold">{opt.label}</div>
                <div className="text-footnote text-text-secondary mt-0.5">{opt.pitch}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {primaryIsConfirm && confirmGate === 'pending' && (
        <div className="text-footnote text-ai-accent">{tr.detail.pendingHereHint}</div>
      )}
      {primaryIsConfirm && confirmGate !== 'pending' && (
        <div className={`text-footnote ${ready ? 'text-state-done' : 'text-text-muted'}`}>
          {ready ? (
            tr.detail.readyToConclude
          ) : (
            <ul className="space-y-1 list-disc pl-4 marker:text-text-faint">
              {missingHints.map((k) => (
                <li key={k}>{tr.detail.missing[k]}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Concluído não oferece quebrar: a parte já se resolveu. */}
      {!primaryIsDecompose && !node.takenAsKnown && !node.confirmado && (
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

      <section className="px-4 py-3.5 border-b border-border-base/70 space-y-3.5">
        {node.planReplacedAt && (
          <p className="text-footnote text-conf-mid bg-conf-mid/8 rounded-control px-3 py-2">
            {tr.tutor.planReplaced}
          </p>
        )}
        <EduField
          audioScope={`node:${node.id}:what`}
          key={`${node.id}:oQue`}
          label={tr.detail.whatIs}
          value={node.oQue}
          tr={tr}
          onCommit={(v) => updateNode(node.id, { oQue: v }, { commit: true })}
        />
        <EduField
          audioScope={`node:${node.id}:why`}
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
        <section className="px-4 py-3.5 border-b border-border-base/70">
          <div className="label mb-1.5">{tr.detail.rulesLabel}</div>
          {(project.rules ?? []).length === 0 && (
            <div className="text-footnote text-text-muted mb-2.5">{tr.detail.rulesEmpty}</div>
          )}
          {(project.rules ?? []).length > 0 && (
            <div className="flex gap-1.5 flex-wrap mb-2">
              {project.rules!.map((r) => (
                <span
                  key={r}
                  className="planner-detail-rule chip !pr-0.5 !text-footnote !font-normal"
                >
                  <span className="planner-detail-rule-text">{r}</span>
                  <button
                    onClick={() => removeRule(r)}
                    className="tap w-5 h-5 shrink-0 inline-flex items-center justify-center rounded-[4px] text-text-faint hover:text-state-problem hover:bg-bg-secondary transition-colors duration-120 ease-mac"
                    aria-label={tr.common.remove}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <AudioTextInput audioScope={`node:${node.id}:rule`} audioWrapperClassName="flex-1 min-w-0" name="rule"
              value={ruleDraft}
              onChange={(e) => setRuleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ruleDraft.trim()) {
                  addRule(ruleDraft);
                  setRuleDraft('');
                }
              }}
              placeholder={tr.detail.rulesAddPlaceholder}
              className="field flex-1 min-w-0"
            />
            <button
              onClick={() => {
                if (ruleDraft.trim()) {
                  addRule(ruleDraft);
                  setRuleDraft('');
                }
              }}
              disabled={!ruleDraft.trim()}
              aria-label={tr.detail.rulesAddPlaceholder}
              className="tap btn btn-secondary btn-icon shrink-0"
            >
              +
            </button>
          </div>
        </section>
      )}

      <div ref={criterionRef}>
        <UserCriterionField node={node} />
      </div>
      <GroundTruthRefsList node={node} project={project} />
      <CritiqueSection node={node} project={project} />
      <div ref={failureRef}>
        <FailureSection node={node} project={project} />
      </div>

      <section className="px-4 py-3.5 border-b border-border-base/70">
        <div className="flex gap-1.5">
          <button
            onClick={handleExplain}
            disabled={explain.running && !explaining && !node.explicacao}
            aria-expanded={node.explicacao ? explanationOpen : undefined}
            className="tap btn btn-ai flex-1 min-w-0 !justify-between"
          >
            <span className="flex items-center gap-1.5 min-w-0 truncate">
              <span className="ai-icon" aria-hidden>
                ✦
              </span>
              {explaining
                ? tr.detail.generatingExplainElapsed(Math.round(explain.elapsedMs / 1000))
                : node.explicacao
                ? explanationOpen
                  ? tr.detail.closeExplain
                  : tr.detail.viewExplain
                : tr.detail.explainBtn}
            </span>
            {node.explicacao && !explaining && <Chevron open={explanationOpen} down />}
          </button>
          <button
            onClick={() => setReadingOpen(true)}
            title={tr.detail.readingMode}
            aria-label={tr.detail.readingMode}
            className="tap btn btn-secondary btn-icon shrink-0 text-text-muted"
          >
            <ExpandIcon />
          </button>
        </div>
        {explaining && (
          <button
            onClick={explain.cancel}
            className="tap btn btn-ghost btn-sm mt-1.5 w-full hover:!text-state-problem"
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
          <div className="mt-2.5 p-3.5 bg-bg-primary rounded-control" aria-live="polite">
            <ExplanationContent text={streamingText} />
          </div>
        )}
        {!explaining && explanationOpen && node.explicacao && (
          <div className="mt-2.5 p-3.5 bg-bg-primary rounded-control">
            <ExplanationContent text={node.explicacao} />
          </div>
        )}
      </section>

      {/* Confidence is the AI's signal (value + source + reason), shown, not
          edited. Raiz/categoria têm 100 fixo — não mostramos. */}
      {!structural && (
        <section className="px-4 py-3.5 border-b border-border-base/70">
          <div className="flex flex-wrap items-baseline gap-2 mb-1.5">
            <span className="label">{tr.detail.confidence}</span>
            {node.confidenceSource && (
              <span className="chip !h-[18px]">{tr.detail.confidenceSourceLabel[node.confidenceSource]}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1 bg-bg-elevated rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  confidenceBand(node.confidence) === 'high'
                    ? 'bg-conf-high'
                    : confidenceBand(node.confidence) === 'mid'
                    ? 'bg-conf-mid'
                    : 'bg-conf-low'
                }`}
                style={{ width: `${node.confidence}%` }}
              />
            </div>
            <span className="text-control font-medium tabular-nums w-10 text-right">{node.confidence}%</span>
          </div>
          {node.confidenceReason && (
            <div className="text-footnote text-text-muted mt-1.5">{node.confidenceReason}</div>
          )}
        </section>
      )}

      <details className="border-b border-border-base/70 group">
        <summary className="tap px-4 py-3 cursor-pointer select-none label hover:text-text-secondary list-none flex items-center gap-1.5 transition-colors duration-120 ease-mac [&::-webkit-details-marker]:hidden">
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden
            className="text-text-faint group-open:rotate-90 transition-transform duration-180 ease-mac"
          >
            <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {tr.detail.notesAndHistory(node.history.length)}
        </summary>
        <div className="px-4 pb-4 space-y-4">
          <div>
            <div className="label mb-1.5">{tr.detail.notes}</div>
            <NodeFileSources ids={node.sourceAttachmentIds} />
            <NotesField
              audioScope={`node:${node.id}:notes`}
              key={node.id}
              value={node.notes}
              placeholder={tr.detail.notesPlaceholder}
              onCommit={(notes) => updateNode(node.id, { notes }, { commit: true })}
            />
          </div>
          <div>
            <div className="label mb-1.5">{tr.detail.historyLabel(node.history.length)}</div>
            <ul className="space-y-1.5 max-h-40 overflow-y-auto text-footnote">
              {[...node.history].reverse().map((h) => (
                <li key={h.id} className="text-text-secondary flex gap-2">
                  <span className="text-text-faint tabular-nums shrink-0">
                    {new Date(h.timestamp).toLocaleString(tr.detail.locale, {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="min-w-0">{h.message}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-1.5 mt-2.5">
              <AudioTextInput audioScope={`node:${node.id}:decision-note`} audioWrapperClassName="flex-1 min-w-0" name="decision-note"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && recordNote()}
                placeholder={tr.detail.recordDecision}
                className="field flex-1 min-w-0"
              />
              <button
                onClick={recordNote}
                aria-label={tr.detail.recordDecision}
                className="tap btn btn-secondary btn-icon shrink-0"
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
          streamingText={explaining ? streamingText : undefined}
          generatingLabel={
            explaining ? tr.detail.generatingExplainElapsed(Math.round(explain.elapsedMs / 1000)) : undefined
          }
          onCancelGenerate={explaining ? explain.cancel : undefined}
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
      className={`tap btn btn-secondary !h-8 ${primaryIsConfirm || primaryIsDecompose ? 'shrink-0' : 'flex-1'}`}
      title={tr.detail.workInTutor}
    >
      {tr.detail.workInTutorShort}
    </button>
  );

  const footer = (
    <div className="space-y-2">
      {primaryIsConfirm && !ready && !confirmGate && confirmingNoSignal ? (
        // Friction-ful acknowledgement: confirming without an anchor is a
        // deliberate two-step, and it lands amber (not green), never 'done'.
        <div className="space-y-1.5">
          <div className="text-footnote text-conf-mid text-center">
            {tr.detail.confirmHintNoSignal}
          </div>
          <div className="planner-detail-actions">
            <button
              onClick={doConfirm}
              className="tap btn btn-secondary !h-8 flex-1 !text-conf-mid"
            >
              {tr.detail.confirmAnyway}
            </button>
            <button
              onClick={() => setConfirmingNoSignal(false)}
              className="tap btn btn-ghost !h-8"
            >
              {tr.detail.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="planner-detail-actions">
          {primaryIsConfirm && confirmGate === 'failure' ? (
            <button
              onClick={goToFailure}
              className="tap btn btn-danger !h-8 flex-1"
            >
              {tr.tutor.resolveFailureFirst}
            </button>
          ) : primaryIsConfirm && confirmGate === 'pending' ? (
            <button
              disabled
              className="tap btn btn-secondary !h-8 flex-1"
            >
              {confirmLabel}
            </button>
          ) : primaryIsConfirm &&
            (ready ? (
              // Faithful fast path: real signal present → one click earns 'done'.
              <button
                onClick={doConfirm}
                className="tap btn btn-primary !h-8 flex-1"
              >
                {confirmLabel}
              </button>
            ) : (
              // Mesmo rótulo do tutor: sem prova, o rodapé leva ao critério;
              // "Confirmar sem prova…" fica no menu "…" do painel.
              <button onClick={goToCriterion} className="tap btn btn-secondary !h-8 flex-1 min-w-0">
                <span>
                  {conclude.missingKeys.includes('criterionNotLocked')
                    ? tr.tutor.writeCriterionBtn
                    : tr.tutor.attestBtn}
                </span>
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
        open={sheetOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDrawerDismissed(true);
            // Sem o sheet, o canvas inteiro fica livre: reenquadra o nó nele
            // depois da animação de fechar.
            const id = node.id;
            window.setTimeout(() => useGraphStore.getState().requestCenter(id), 360);
          }
        }}
        title={node.name || tr.detail.sheetFallbackTitle}
        footer={<div className="planner-detail-footer">{footer}</div>}
        titleHidden
      >
        <div className="planner-detail-content planner-detail-sheet">
          {header}
          {body}
        </div>
      </MobileSheet>
    );
  }

  // Versatile panel: collapse to a thin rail so the graph takes the room;
  // the preference persists across reloads.
  if (!panelOpen) {
    return <CollapsedRail onExpand={() => setPanelOpen(true)} label={tr.detail.expandPanel} />;
  }

  return (
    <aside className="planner-detail-panel hidden md:flex shrink-0 border-l border-border-base/70 bg-bg-secondary flex-col">
      <PanelTopBar onCollapse={() => setPanelOpen(false)} label={tr.detail.collapsePanel} />
      {header}
      <div className="planner-detail-content planner-detail-scroll flex-1 min-h-0 overflow-y-auto scroll-stable">{body}</div>
      <div className="planner-detail-footer shrink-0 px-4 py-3 border-t border-border-base/70 bg-bg-secondary">{footer}</div>
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
  const reviewing = useReviewingParents();
  const progress = projectProgress(project, reviewing);
  const next = nextPendingForTutor(project, pending, reviewing);
  return (
    <div className="px-4 py-4 space-y-5 text-control">
      <div>
        <div className="label mb-1">{tr.conceptNode.root}</div>
        <div className="text-title3 text-text-primary font-semibold">{project.name}</div>
        {project.objective && project.objective !== project.name && (
          <p className="text-control text-text-secondary mt-1.5 leading-[1.5]">{project.objective}</p>
        )}
      </div>
      <div>
        {/* O anel da toolbar é o indicador de progresso; aqui só a contagem. */}
        <div className="text-footnote text-text-muted">
          {tr.detail.summaryProgress(progress.done, progress.total)}
        </div>
        {progress.doneWithoutSignal > 0 && (
          <div className="text-footnote text-conf-mid mt-1.5">
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
          className="w-full text-left px-3 py-2.5 rounded-control bg-accent/8 hover:bg-accent/12 transition-colors duration-120 ease-mac"
        >
          <div className="text-footnote font-medium text-accent mb-0.5">{tr.detail.summaryNext}</div>
          <div className="text-control text-text-primary">{next.name}</div>
        </button>
      ) : (
        <p className="text-control text-text-muted">{tr.detail.summaryNothingPending}</p>
      )}
      <p className="text-footnote text-text-muted">{tr.detail.summaryHint}</p>
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
  // Só o teclado leva o foco ao primeiro item; com o ponteiro, nada abre realçado.
  const byKeyboard = useRef(false);
  const list = items.filter((i): i is NodeMenuItem => i !== null);

  useEffect(() => {
    if (!open) return;
    if (byKeyboard.current) ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
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
        onClick={(e) => {
          byKeyboard.current = e.detail === 0;
          onOpenChange(!open);
        }}
        aria-label={tr.detail.moreActions}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`tap btn btn-ghost btn-icon btn-sm text-[15px] ${open ? '!bg-bg-elevated !text-text-primary' : ''}`}
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={tr.detail.moreActions}
          className="glass bg-glass/90 border absolute right-0 top-full mt-1.5 w-60 rounded-card shadow-mac-lg z-30 p-1 origin-top-right animate-sheet-in"
        >
          {list.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              onClick={item.onClick}
              className={`tap w-full text-left px-2.5 py-1 min-h-[28px] [@media(pointer:coarse)]:min-h-[44px] text-control rounded-chip outline-none transition-colors duration-120 ease-mac hover:bg-accent-solid hover:text-accent-fg focus-visible:bg-accent-solid focus-visible:text-accent-fg focus-visible:outline-none ${
                item.danger ? 'text-state-problem' : 'text-text-primary'
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
  audioScope,
  value,
  onCommit,
  ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  ariaLabel: string;
  audioScope: string;
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
    <AudioTextInput audioScope={audioScope}
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
      name="node-name"
      className="w-full [@media(pointer:coarse)]:min-h-[44px] bg-transparent text-title3 font-semibold text-text-primary outline-none px-1.5 -mx-1.5 py-0.5 rounded-chip hover:bg-bg-elevated/50 focus:bg-bg-secondary focus:shadow-[inset_0_0_0_1px_rgb(var(--accent)/.8),0_0_0_3px_rgb(var(--accent)/.4)] transition-shadow duration-120 ease-mac"
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
  audioScope,
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  audioScope: string;
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
    <AudioTextarea audioScope={audioScope} name="node-text"
      ref={ref}
      value={draft}
      onFocus={() => (focusedRef.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focusedRef.current = false;
        if (draft !== value) onCommit(draft);
      }}
      rows={2}
      className="field resize-none"
      placeholder={placeholder}
    />
  );
}

interface EduFieldProps {
  audioScope: string;
  label: string;
  value: string;
  onCommit: (v: string) => void;
  tr: Messages;
}

// Texto lido por padrão; ✎ abre a edição (textarea que cresce com o texto,
// salva no blur, Esc desfaz).
function EduField({ label, value, onCommit, tr, audioScope }: EduFieldProps) {
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
      <AudioTextarea audioScope={audioScope} name="node-field"
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
        className="field !resize-none overflow-hidden"
      />
    );
  } else {
    content = value ? (
      <p className="text-control text-text-secondary leading-[1.5] whitespace-pre-wrap">{value}</p>
    ) : (
      <p className="text-control text-text-faint">{tr.detail.emptyField}</p>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1 mb-1 min-h-[24px]">
        <span className="label">{label}</span>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            aria-label={tr.detail.editField(label)}
            title={tr.detail.editField(label)}
            className="tap btn btn-ghost btn-icon btn-sm ml-auto"
          >
            <PencilIcon />
          </button>
        )}
      </div>
      {content}
    </div>
  );
}

function PanelTopBar({ onCollapse, label }: { onCollapse: () => void; label: string }) {
  return (
    <div className="shrink-0 flex items-center justify-end px-2 pt-1.5">
      <button onClick={onCollapse} title={label} aria-label={label} className="tap btn btn-ghost btn-icon btn-sm">
        <SidebarIcon />
      </button>
    </div>
  );
}

function CollapsedRail({ onExpand, label }: { onExpand: () => void; label: string }) {
  const tr = useT();
  return (
    <aside className="planner-detail-rail hidden md:flex w-10 shrink-0 border-l border-border-base/70 bg-bg-secondary flex-col items-center py-1.5">
      <button onClick={onExpand} title={label} aria-label={label} className="tap btn btn-ghost btn-icon btn-sm">
        <SidebarIcon />
      </button>
      <span className="mt-3 text-footnote text-text-muted [writing-mode:vertical-rl]">
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
    <div className="mt-1.5 text-footnote text-text-muted">
      {tr.detail.busyElsewhere(node.name)}{' '}
      <button onClick={() => onGo(node.id)} className="text-accent font-medium hover:underline">
        {tr.tutor.goThere}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ícones finos do inspector (herdam a cor do botão).
// ---------------------------------------------------------------------------

function Chevron({ open, down }: { open: boolean; down?: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden
      className={`shrink-0 text-text-faint transition-transform duration-180 ease-mac ${
        down ? (open ? '-rotate-90' : 'rotate-90') : open ? 'rotate-90' : ''
      }`}
    >
      <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M8.2 1.8l2 2L4 10H2v-2l6.2-6.2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M8.5 1.5h4v4M5.5 12.5h-4v-4M12.5 1.5L8 6M1.5 12.5L6 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SidebarIcon() {
  return (
    <svg width="15" height="13" viewBox="0 0 15 13" fill="none" aria-hidden>
      <rect x="0.75" y="0.75" width="13.5" height="11.5" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.5 1v11" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
