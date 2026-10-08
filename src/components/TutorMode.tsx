import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  useGraphStore,
  nextPendingForTutor,
  projectProgress,
  breadcrumbFor,
  buildStagedNodes,
  canConcludeNode,
  childrenByParent,
  effectiveLeavesUnder,
  firstBlockerOf,
  isActionableKind,
  nodesWithoutSignal,
  pendingParent,
  stepSequence,
  canRevealAICriterionNow,
  relatedPartsFor,
  planOverviewFor,
} from '@/store';
import { explainNode, decomposeNode } from '@/ai/service';
import { useKBStore } from '@/kb/store';
import { requireAI } from '@/ai/availability';
import { useAIAction } from '@/hooks/useAIAction';
import { useReviewingParents } from '@/hooks/useReviewingParents';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/i18n';
import type { Messages } from '@/i18n';
import type { ConceptNodeData, Project } from '@/types';
import { GroundTruthInlineTutor } from './GroundTruth';
import { ExplanationContent } from './Markdown';
import { MobileSheet } from './MobileSheet';
import { ReadingMode, type ReadingAction } from './ReadingMode';
import { InlineError } from './ui/InlineError';
import { toast } from './ui/Toast';
import { OverflowMenu, type OverflowMenuItem } from './ui/OverflowMenu';

// The tutor is the concept's core loop made into a screen: look at ONE part of
// the decomposition — if you can confirm it against reality, confirm; if you
// can't yet, break it into smaller parts; if you already know it, mark the
// floor. The sidebar is the decomposition tree itself, not a flat checklist.

// ---------------------------------------------------------------------------
// Estado que precisa sobreviver à remontagem do card (key = id do nó): o
// texto parcial da explicação em streaming e o controlador de cada chamada —
// trocar de nó no meio não perde o spinner nem impede o cancelar.
// ---------------------------------------------------------------------------

const useExplainStream = create<{
  texts: Record<string, string>;
  put: (nodeId: string, text: string | null) => void;
}>()((set) => ({
  texts: {},
  put: (nodeId, text) =>
    set((s) => {
      const texts = { ...s.texts };
      if (text === null) delete texts[nodeId];
      else texts[nodeId] = text;
      return { texts };
    }),
}));

const inflight = new Map<string, AbortController>();

// Controlador local ligado ao signal do useAIAction e registrado por nó.
function linkSignal(nodeId: string, signal: AbortSignal): AbortController {
  const local = new AbortController();
  if (signal.aborted) local.abort();
  else signal.addEventListener('abort', () => local.abort(), { once: true });
  inflight.set(nodeId, local);
  return local;
}

function releaseSignal(nodeId: string, local: AbortController) {
  if (inflight.get(nodeId) === local) inflight.delete(nodeId);
}

// Cancela a chamada de IA do nó mesmo que o card que a disparou já tenha saído.
function cancelInflight(nodeId: string) {
  inflight.get(nodeId)?.abort();
  inflight.delete(nodeId);
  useGraphStore.getState().endAIJob(nodeId);
  useExplainStream.getState().put(nodeId, null);
}

// Depois de avançar (confirmar / já sei / escolher), o próximo card recebe o
// foco no título — o Tab não recomeça do topo da página.
let focusTitleOnMount = false;

const abortError = () => {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
};

// Primeira folha acionável pendente sob `id`, na ordem da decomposição.
function firstPendingUnder(
  project: Project,
  byParent: Map<string, ConceptNodeData[]>,
  id: string,
): ConceptNodeData | null {
  for (const child of byParent.get(id) ?? []) {
    if (child.takenAsKnown) continue;
    if ((byParent.get(child.id) ?? []).length > 0) {
      const found = firstPendingUnder(project, byParent, child.id);
      if (found) return found;
      continue;
    }
    if (isActionableKind(child.kind) && !child.confirmado) return child;
  }
  return null;
}

function useElapsedSeconds(startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

// Âncoras do GroundTruth (ids definidos pelo GroundTruth.tsx). Sem elas, cai
// no bloco inteiro de verificação — que já começa pelo campo de critério.
type GTTarget = 'criterion' | 'attest' | 'failure';
const GT_WRAPPER_ID = 'tutor-gt';
const GT_ANCHORS: Record<GTTarget, string[]> = {
  criterion: ['gt-criterion'],
  attest: ['gt-attest', 'gt-criterion'],
  failure: ['gt-failure'],
};
const TEXT_FIELD = 'textarea:not([disabled]), input:not([disabled])';
const FIELD = `${TEXT_FIELD}, button:not([disabled])`;

function scrollToGroundTruth(root: HTMLElement | null, target: GTTarget, openFailure: boolean) {
  if (!root) return;
  let el: HTMLElement | null = null;
  for (const id of GT_ANCHORS[target]) {
    el = root.querySelector<HTMLElement>(`[id="${id}"], [data-anchor="${id}"]`);
    if (el) break;
  }
  const wrapper = root.querySelector<HTMLElement>(`#${GT_WRAPPER_ID}`);
  // Fallback da falha: a seção de falha é a última do bloco de verificação.
  if (!el && target === 'failure' && wrapper) {
    const sections = wrapper.querySelectorAll<HTMLElement>('section');
    el = sections[sections.length - 1] ?? null;
  }
  el = el ?? wrapper;
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (el.matches(FIELD)) {
    el.focus({ preventScroll: true });
    return;
  }
  const text = el.querySelector<HTMLElement>(TEXT_FIELD);
  // "Deu errado na prática?" — sem formulário aberto, abre direto.
  if (target === 'failure' && !openFailure && !text) {
    const opener = el.querySelector<HTMLElement>('button:not([disabled])');
    if (opener) {
      opener.click();
      requestAnimationFrame(() => el?.querySelector<HTMLElement>(TEXT_FIELD)?.focus({ preventScroll: true }));
      return;
    }
  }
  (text ?? el.querySelector<HTMLElement>(FIELD))?.focus({ preventScroll: true });
}

export function TutorMode() {
  const tr = useT();
  const project = useGraphStore((s) => s.project);
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const requestCenter = useGraphStore((s) => s.requestCenter);
  const setLastTutorNode = useGraphStore((s) => s.setLastTutorNode);
  const pending = useGraphStore((s) => s.pendingSuggestions);
  const pendingNode = useGraphStore(pendingParent);
  const parked = useGraphStore((s) => s.parkedSuggestions);
  const resumeSuggestions = useGraphStore((s) => s.resumeSuggestions);

  // Sugestões em revisão seguram o "próximo pendente" (não pula um pai com
  // sugestões esperando), mas não entram no progresso: só conta o aceito.
  // Um pai com sugestões em revisão (ativas ou estacionadas) conta como parte
  // aberta no progresso — o mesmo predicado que segura o "próximo pendente".
  const reviewing = useReviewingParents();
  const next = useMemo(
    () => nextPendingForTutor(project, pending, reviewing),
    [project, pending, reviewing],
  );
  const progress = projectProgress(project, reviewing);
  const byParent = useMemo(() => (project ? childrenByParent(project) : null), [project]);

  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isMobile && sidebarOpen) setSidebarOpen(false);
  }, [isMobile, sidebarOpen]);

  // Dive into ONE node: the leaf the user picked in the tree, the node whose
  // suggestions are under review (pinned until staging empties), or the next
  // pending one in decomposition order.
  const selected = project && selectedId ? project.nodes[selectedId] : null;
  const selectedLeaf =
    selected && byParent && isActionableKind(selected.kind) && (byParent.get(selected.id) ?? []).length === 0
      ? selected
      : null;
  const pinned = pendingNode && isActionableKind(pendingNode.kind) ? pendingNode : null;
  const current = selectedLeaf ?? pinned ?? next;
  const currentId = current?.id ?? null;

  // Trocar de nó abre o card novo do topo (título e breadcrumb visíveis).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [currentId]);

  useEffect(() => {
    if (currentId) setLastTutorNode(currentId);
  }, [currentId, setLastTutorNode]);

  // Chegou (pelo "próximo") num nó com lote estacionado: as sugestões voltam.
  useEffect(() => {
    if (currentId && useGraphStore.getState().parkedSuggestions[currentId]) resumeSuggestions(currentId);
  }, [currentId, resumeSuggestions]);

  // Staging esvaziou (aceitou/descartou tudo): desce para o primeiro filho do
  // pai revisado — o loop continua "até o átomo" sem o usuário procurar.
  const pendingParentId = pending?.parentId ?? null;
  const prevPendingRef = useRef(pendingParentId);
  useEffect(() => {
    const prev = prevPendingRef.current;
    prevPendingRef.current = pendingParentId;
    if (!prev || pendingParentId) return;
    const st = useGraphStore.getState();
    const proj = st.project;
    if (!proj || !proj.nodes[prev]) return;
    const map = childrenByParent(proj);
    const first = firstPendingUnder(proj, map, prev);
    if (first) {
      focusTitleOnMount = true;
      st.selectNode(first.id);
    } else if ((map.get(prev) ?? []).length === 0 && isActionableKind(proj.nodes[prev].kind)) {
      st.selectNode(prev); // descartou tudo: continua no mesmo nó
    }
  }, [pendingParentId]);

  if (!project || !byParent) return null;

  const reviewAt = (target: ConceptNodeData) => {
    // selectNode traz de volta um lote estacionado deste pai.
    if (isActionableKind(target.kind)) {
      selectNode(target.id);
      setSidebarOpen(false);
      return;
    }
    // Pai estrutural (categoria/objetivo): a revisão acontece no grafo — e é
    // ele (não o card atual) que o grafo deve abrir.
    selectNode(target.id);
    setLastTutorNode(target.id);
    setViewMode('graph');
    requestCenter(target.id);
  };
  const reviewPending = () => {
    if (pendingNode) reviewAt(pendingNode);
  };

  // Lotes estacionados (de outros pais) — selo na árvore e um aviso discreto.
  const parkedNodes = Object.keys(parked)
    .map((id) => project.nodes[id])
    .filter((n): n is ConceptNodeData => Boolean(n));
  const suggestionCounts: Record<string, number> = {};
  for (const n of parkedNodes) suggestionCounts[n.id] = parked[n.id].nodes.length;
  if (pending && pending.nodes.length > 0) suggestionCounts[pending.parentId] = pending.nodes.length;

  const resourceLeaves = effectiveLeavesUnder(project, project.rootId, byParent, undefined, reviewing).filter(
    (n) => n.kind === 'recurso',
  );
  const resourcesConfirmed = resourceLeaves.filter((r) => r.confirmado || r.takenAsKnown).length;
  const allResourcesDone =
    resourceLeaves.length > 0 && resourcesConfirmed === resourceLeaves.length;

  const sidebarBody = (
    <div className="px-2 py-2">
      <TreeRows
        project={project}
        byParent={byParent}
        parentId={project.rootId}
        depth={0}
        currentId={currentId}
        suggestionCounts={suggestionCounts}
        onPick={(id) => {
          selectNode(id);
          setSidebarOpen(false);
        }}
        tr={tr}
      />
      {progress.total === 0 && (
        <div className="text-footnote text-text-muted px-2 py-2">{tr.tutor.emptyTree}</div>
      )}
    </div>
  );

  const showBanner = !!pending && !!pendingNode && pendingNode.id !== currentId;

  return (
    <div className="flex-1 flex overflow-hidden bg-bg-primary">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="shrink-0 border-b border-border-base/70 px-4 sm:px-6 py-2 sm:py-3">
          <div className="flex items-center gap-2 sm:gap-3 min-h-[30px]">
            {/* Tutor/Grafo já está no segmented da toolbar: aqui só a dica. */}
            <div className="hidden md:block text-text-muted text-footnote truncate">{tr.tutor.focusHint}</div>
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden tap btn btn-secondary btn-sm tabular-nums"
            >
              <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-text-muted">
                <path
                  d="M2 3h10M4.5 7H12M7 11h5M2 3v4h2.5M4.5 7v4H7"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {tr.tutor.mobileStepsBtn(progress.done, progress.total)}
            </button>
          </div>
          {project.rules && project.rules.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 overflow-x-auto sm:flex-wrap">
              <span className="label shrink-0 mr-0.5">{tr.tutor.rulesLabel}</span>
              {project.rules.map((r) => (
                <span key={r} className="chip shrink-0" title={tr.tutor.rulesTitle}>
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>

        <div
          data-tutor-scroll
          ref={scrollRef}
          className="flex-1 overflow-y-auto scroll-stable px-4 sm:px-6 md:px-8 pt-3 sm:pt-6 md:pt-8 pb-6 sm:pb-10"
        >
          {showBanner && (
            <div className="max-w-[720px] mx-auto mb-3 flex items-center gap-2.5 pl-3 pr-1.5 py-1.5 rounded-control bg-ai-accent/8 text-footnote text-text-secondary">
              <span className="ai-icon shrink-0 animate-pulse-subtle" aria-hidden>
                ✦
              </span>
              <span className="flex-1 min-w-0">
                {tr.tutor.pendingBanner(pending!.nodes.length, pendingNode!.name)}
              </span>
              <button onClick={reviewPending} className="tap shrink-0 btn btn-sm btn-tertiary text-ai-accent hover:bg-ai-accent/12">
                {tr.tutor.reviewPending}
              </button>
            </div>
          )}
          {parkedNodes
            .filter((n) => n.id !== currentId)
            .map((n) => (
              <div
                key={n.id}
                className="max-w-[720px] mx-auto mb-3 flex items-center gap-2.5 pl-3 pr-1.5 py-1.5 rounded-control bg-bg-elevated/60 text-footnote text-text-secondary"
              >
                <span className="ai-icon shrink-0 opacity-70" aria-hidden>
                  ✦
                </span>
                <span className="flex-1 min-w-0">{tr.tutor.parkedBanner(parked[n.id].nodes.length, n.name)}</span>
                <button
                  onClick={() => reviewAt(n)}
                  className="tap shrink-0 btn btn-sm btn-tertiary text-ai-accent hover:bg-ai-accent/12"
                >
                  {tr.tutor.reviewPending}
                </button>
              </div>
            ))}

          {current ? (
            <TutorCard
              key={current.id}
              node={current}
              project={project}
              byParent={byParent}
              isNext={current.id === next?.id}
              next={next}
              tr={tr}
              notice={
                current.kind === 'passo' && resourceLeaves.length > 0 && !allResourcesDone ? (
                  <div className="mt-6 pl-3.5 pr-4 py-3 rounded-control bg-bg-elevated/60 border-l-2 border-conf-mid">
                    <div className="text-footnote font-semibold text-text-primary mb-0.5 flex items-center gap-2">
                      <span aria-hidden className="w-2 h-2 rounded-full bg-conf-mid shrink-0" />
                      {tr.tutor.resourcesLeftWarning}
                    </div>
                    <div className="text-control text-text-secondary">
                      {tr.tutor.resourcesLeftBody(resourceLeaves.length - resourcesConfirmed)}
                    </div>
                  </div>
                ) : null
              }
            />
          ) : progress.total === 0 ? (
            <EmptyCard tr={tr} onViewGraph={() => setViewMode('graph')} />
          ) : (
            <DoneCard
              project={project}
              doneWithoutSignal={progress.doneWithoutSignal}
              onPick={(id) => selectNode(id)}
              onViewGraph={() => setViewMode('graph')}
              tr={tr}
            />
          )}
        </div>
      </div>

      {/* Sidebar estilo Finder: vidro, linhas de 28px, seleção accent/12. */}
      <aside className="glass hidden md:flex md:w-[260px] lg:w-[300px] shrink-0 border-l overflow-y-auto flex-col">
        <div className="label px-4 pt-4 pb-1">{tr.tutor.sheetTitle}</div>
        {sidebarBody}
      </aside>

      {isMobile && (
        <MobileSheet open={sidebarOpen} onOpenChange={setSidebarOpen} title={tr.tutor.sheetTitle} alwaysModal>
          {sidebarBody}
        </MobileSheet>
      )}
    </div>
  );
}

// Toast com "Desfazer" depois de confirmar / já sei / escolher.
function feedbackToast(message: string, withProof: boolean, tr: Messages) {
  toast.show({
    message,
    tone: withProof ? 'ok' : 'warn',
    action: {
      label: tr.common.undo,
      onClick: () => {
        const ok = useGraphStore.getState().undoLastAction();
        toast.show(
          ok ? { message: tr.toast.undone, tone: 'info' } : { message: tr.toast.nothingToUndo, tone: 'warn' },
        );
      },
    },
  });
}

interface TutorCardProps {
  node: ConceptNodeData;
  project: Project;
  byParent: Map<string, ConceptNodeData[]>;
  isNext: boolean;
  next: ConceptNodeData | null;
  notice?: React.ReactNode;
  tr: Messages;
}

function TutorCard({ node, project, byParent, isNext, next, notice, tr }: TutorCardProps) {
  const confirmNode = useGraphStore((s) => s.confirmNode);
  const unconfirmNode = useGraphStore((s) => s.unconfirmNode);
  const toggleTakenAsKnown = useGraphStore((s) => s.toggleTakenAsKnown);
  const pickDecisionOption = useGraphStore((s) => s.pickDecisionOption);
  const selectNode = useGraphStore((s) => s.selectNode);
  const setNodeExplanation = useGraphStore((s) => s.setNodeExplanation);
  const stageSuggestions = useGraphStore((s) => s.stageSuggestions);
  const acceptSuggestion = useGraphStore((s) => s.acceptSuggestion);
  const rejectSuggestion = useGraphStore((s) => s.rejectSuggestion);
  const acceptAllSuggestions = useGraphStore((s) => s.acceptAllSuggestions);
  const rejectAllSuggestions = useGraphStore((s) => s.rejectAllSuggestions);
  const pending = useGraphStore((s) => s.pendingSuggestions);
  const aiJobs = useGraphStore((s) => s.aiJobs);
  const putStream = useExplainStream((s) => s.put);
  const streamText = useExplainStream((s) => s.texts[node.id]);

  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // A barra de ações é sticky no rodapé: o scroll-padding do container (com a
  // altura real da barra) impede que foco/scrollIntoView deixem um campo
  // escondido atrás dela — clicar ali acertava a barra.
  useEffect(() => {
    const bar = barRef.current;
    const scroller = bar?.closest<HTMLElement>('[data-tutor-scroll]');
    if (!bar || !scroller) return;
    const root = document.documentElement;
    const apply = () => {
      scroller.style.scrollPaddingBottom = `${bar.offsetHeight + 12}px`;
      // O Toaster (no tutor) sobe acima da barra sticky.
      root.style.setProperty('--tutor-bar-h', `${bar.offsetHeight}px`);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      scroller.style.scrollPaddingBottom = '';
      root.style.removeProperty('--tutor-bar-h');
    };
  }, []);

  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [confirmingNoSignal, setConfirmingNoSignal] = useState(false);
  // Decisão: clicar na opção só seleciona; o commit é o botão da barra.
  const [selectedOpt, setSelectedOpt] = useState<string | null>(node.decisionPickedId ?? null);

  useEffect(() => {
    if (!focusTitleOnMount) return;
    focusTitleOnMount = false;
    rootRef.current?.scrollIntoView({ block: 'start' });
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  const jobs = aiJobs[node.id];
  // Qualquer job de IA neste nó (explicar, quebrar, pesquisar, criticar…).
  const job = jobs ? Object.values(jobs)[0] : undefined;
  const explainRunning = Boolean(jobs?.explain);
  const decomposeRunning = Boolean(jobs?.decompose);
  const elapsed = useElapsedSeconds((jobs?.decompose ?? jobs?.explain)?.startedAt);

  const crumbs = breadcrumbFor(project, node.id);
  const { ready, missingKeys } = canConcludeNode(project, node.id);
  const blocker = firstBlockerOf(project, node.id);
  const openFailure = missingKeys.includes('openFailure');
  const hasKids = (byParent.get(node.id) ?? []).length > 0;
  const pendingHere = !!pending && pending.parentId === node.id;
  const resolved = node.confirmado || !!node.takenAsKnown;
  const understand = project.archetype === 'entender';
  const resolvedNoProof =
    resolved && (Boolean(node.confirmedWithoutSignal) || (Boolean(node.takenAsKnown) && !understand));
  // A decision with options resolves by picking — no separate confirm button.
  const isDecision = node.kind === 'decisao' && (node.decisionOptions?.length ?? 0) > 0;
  const stepSeq = stepSequence(project, node.id);
  const proofTarget: GTTarget = missingKeys.includes('criterionNotLocked') ? 'criterion' : 'attest';

  const kindLabel = tr.conceptNode[node.kind];
  const confirmLabel =
    node.kind === 'recurso'
      ? tr.detail.alreadyHave
      : node.kind === 'concept'
      ? tr.detail.understood
      : tr.detail.alreadyDid;
  const decomposeTitle =
    node.kind === 'concept' ? tr.tutor.decomposeForkConcept : tr.tutor.decomposeFork;
  const knownLabel =
    node.kind === 'concept'
      ? tr.tutor.knownConcept
      : node.kind === 'recurso'
      ? tr.tutor.knownResource
      : tr.tutor.knownStep;
  const pickedOpt = node.decisionOptions?.find((o) => o.id === selectedOpt) ?? null;

  // Só uma quebra por vez: outra em andamento desabilita o decompor — com o
  // motivo e um atalho até lá. Sugestões em revisão em OUTRO nó não bloqueiam:
  // o lote de lá estaciona e volta quando o usuário reabrir aquele pai.
  const otherDecomposeId = Object.entries(aiJobs).find(
    ([id, j]) => id !== node.id && Boolean(j.decompose || j.replan),
  )?.[0];
  const decomposeBlocked: { reason: string; go: () => void } | null =
    otherDecomposeId && project.nodes[otherDecomposeId]
      ? {
          reason: tr.tutor.decomposeBlockedRunning(project.nodes[otherDecomposeId].name),
          go: () => selectNode(otherDecomposeId),
        }
      : null;

  const explainAI = useAIAction(
    async (signal: AbortSignal) => {
      const local = linkSignal(node.id, signal);
      try {
        const text = await explainNode(
          {
            projectName: project.name,
            projectObjective: project.objective,
            breadcrumb: crumbs.map((c) => c.name),
            nodeName: node.name,
            nodeKind: node.kind,
            oQue: node.oQue,
            porQue: node.porQue,
            comoConfirmar: node.comoConfirmar,
            // Sem lock (ou na janela de desfazer), o critério da IA não entra.
            criterionLocked: canRevealAICriterionNow(node),
            comoConfirmarUsuario: node.comoConfirmarUsuario,
            rules: project.rules,
            research: node.webResearch,
            relatedParts: relatedPartsFor(project, node.id),
          },
          { signal: local.signal, onDelta: (soFar) => putStream(node.id, soFar) },
        );
        if (local.signal.aborted) throw abortError();
        setNodeExplanation(node.id, text);
        return text;
      } finally {
        releaseSignal(node.id, local);
        putStream(node.id, null);
      }
    },
    { job: { nodeId: node.id, kind: 'explain' } },
  );

  // Recursive decompose, right in the guided flow — break the current node into
  // sub-nodes (staged for accept/reject inline). The card stays pinned to this
  // node while suggestions are under review; once staging empties the tutor
  // descends into the first child.
  const decomposeAI = useAIAction(
    async (signal: AbortSignal) => {
      const local = linkSignal(node.id, signal);
      try {
        const siblings = Object.values(project.nodes)
          .filter((n) => n.parentId === node.parentId && n.id !== node.id)
          .map((n) => ({ name: n.name, fx: n.fx }));
        const knownElsewhere = Object.values(project.nodes)
          .filter(
            (n) =>
              n.id !== node.id &&
              isActionableKind(n.kind) &&
              (n.takenAsKnown || n.state === 'done'),
          )
          .map((n) => n.name)
          .slice(0, 15);
        const kbContext = await useKBStore.getState().getContextFor({
          label: tr.notify.objectivePromptLabel(project.objective),
          extra: tr.notify.objectivePromptExtra(node.name, node.kind, node.fx),
        });
        if (local.signal.aborted) throw abortError();
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
            oQue: node.oQue,
            porQue: node.porQue,
            comoConfirmar: node.comoConfirmar,
            comoConfirmarUsuario: node.comoConfirmarUsuario,
            knownElsewhere,
            planOverview: planOverviewFor(project, node.id),
          },
          kbContext,
          { signal: local.signal },
        );
        if (local.signal.aborted) throw abortError();
        stageSuggestions(node.id, buildStagedNodes(node, result.nodes), result.edges);
        return true;
      } finally {
        releaseSignal(node.id, local);
      }
    },
    { job: { nodeId: node.id, kind: 'decompose' } },
  );

  const handleExplain = () => {
    if (node.explicacao) {
      setOpen((o) => !o);
      return;
    }
    if (job) return; // já tem IA rodando neste nó (talvez de outra visita ao card)
    if (!requireAI()) return;
    setOpen(true);
    void explainAI.run();
  };

  const handleDecompose = () => {
    if (job || decomposeBlocked) return;
    if (!requireAI()) return;
    void decomposeAI.run();
  };

  const cancelJob = () => {
    if (explainAI.running) explainAI.cancel();
    if (decomposeAI.running) decomposeAI.cancel();
    cancelInflight(node.id);
  };

  const goToGT = (target: GTTarget) => scrollToGroundTruth(rootRef.current, target, Boolean(node.failureContext));

  // Acting resumes the flow: clear the explicit selection so the card follows
  // the next pending part again — with a toast that can undo it.
  const advance = () => {
    focusTitleOnMount = true;
    selectNode(null);
  };
  const confirmAndAdvance = () => {
    const withProof = canConcludeNode(project, node.id).ready;
    confirmNode(node.id);
    setConfirmingNoSignal(false);
    feedbackToast(withProof ? tr.tutor.toastDone(node.name) : tr.tutor.toastNoProof(node.name), withProof, tr);
    advance();
  };
  const markKnownAndAdvance = () => {
    toggleTakenAsKnown(node.id);
    feedbackToast(
      understand ? tr.tutor.toastKnown(node.name) : tr.tutor.toastKnownNoProof(node.name),
      understand,
      tr,
    );
    advance();
  };
  const pickAndAdvance = () => {
    if (!pickedOpt) return;
    const withProof = canConcludeNode(project, node.id).ready;
    pickDecisionOption(node.id, pickedOpt.id);
    setConfirmingNoSignal(false);
    feedbackToast(
      withProof ? tr.tutor.toastPicked(pickedOpt.label) : tr.tutor.toastPickedNoProof(pickedOpt.label),
      withProof,
      tr,
    );
    advance();
  };
  const goToBlocker = () => {
    if (!blocker) return;
    const target =
      (byParent.get(blocker.id) ?? []).length > 0 ? firstPendingUnder(project, byParent, blocker.id) : blocker;
    selectNode((target ?? blocker).id);
  };

  // Ação primária do momento — a mesma na barra e no rodapé do modo leitura.
  const primaryForReading: ReadingAction | undefined = (() => {
    if (resolved || pendingHere || hasKids) return undefined;
    if (blocker) return { label: tr.tutor.blockedBefore(blocker.name), onClick: goToBlocker, tone: 'muted' };
    if (openFailure) return { label: tr.tutor.resolveFailureFirst, onClick: () => goToGT('failure'), tone: 'muted' };
    if (isDecision) {
      if (!pickedOpt) return { label: tr.tutor.pickFirst, onClick: () => {}, tone: 'muted', disabled: true };
      return ready
        ? { label: tr.tutor.pickOption(pickedOpt.label), onClick: pickAndAdvance, tone: 'primary' }
        : { label: tr.tutor.pickOptionNoProof(pickedOpt.label), onClick: () => setConfirmingNoSignal(true), tone: 'muted' };
    }
    return ready
      ? { label: confirmLabel, onClick: confirmAndAdvance, tone: 'primary' }
      : { label: tr.tutor.confirmNoProof, onClick: () => setConfirmingNoSignal(true), tone: 'muted' };
  })();

  const canDecompose = !resolved && !hasKids && !pendingHere;
  const canMarkKnown = !resolved && !isDecision && !hasKids && !pendingHere;
  // Barra vazia (nó já decomposto): some, e o card fecha com um respiro.
  const barEmpty = hasKids && !pendingHere && !resolved;
  // "…" da barra: o que não é primário nem secundário. No mobile o decompor
  // também mora aqui (no máximo 2 botões de 44px).
  const moreItems: OverflowMenuItem[] = [
    ...(canDecompose && !decomposeRunning
      ? [
          {
            key: 'decompose',
            label: tr.tutor.decomposeShort,
            title: decomposeBlocked?.reason ?? decomposeTitle,
            icon: '✦',
            iconClassName: 'text-ai-accent',
            onClick: handleDecompose,
            disabled: !!job || !!decomposeBlocked,
            mobileOnly: true,
          },
        ]
      : []),
    ...(canMarkKnown
      ? [
          {
            key: 'known',
            label: understand ? (
              knownLabel
            ) : (
              <span className="block">
                <span className="block">{knownLabel}</span>
                <span className="block text-caption opacity-75">{tr.tutor.knownNoProofSub}</span>
              </span>
            ),
            title: understand ? knownLabel : `${knownLabel} — ${tr.tutor.knownNoProofSub}`,
            onClick: markKnownAndAdvance,
          },
        ]
      : []),
  ];

  return (
    // Folha central: card de conteúdo; a troca de nó remonta (key) e repete o card-swap.
    <div
      ref={rootRef}
      className="card max-w-[720px] mx-auto scroll-mt-4 animate-card-swap px-4 sm:px-8 pt-5 sm:pt-7"
    >
      {crumbs.length > 1 && (
        <div className="text-footnote text-text-muted mb-2 truncate">
          {crumbs
            .slice(0, -1)
            .map((c) => c.name)
            .join(' › ')}
        </div>
      )}
      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <span className="chip">{kindLabel}</span>
        {stepSeq !== null && (
          <span className="text-text-muted text-footnote tabular-nums">{tr.tutor.stepNumber(stepSeq)}</span>
        )}
        {node.failureContext && (
          <span className="chip bg-state-problem/12 text-state-problem">{tr.detail.problemBadge}</span>
        )}
        {isNext && <span className="chip bg-accent/12 text-accent">{tr.tutor.nextBadge}</span>}
        {!isNext && next && !resolved && (
          <button
            onClick={() => selectNode(next.id)}
            className="ml-auto btn btn-tertiary btn-sm min-w-0 max-w-[60%]"
          >
            <span className="truncate">{tr.tutor.jumpToNext(next.name)}</span>
          </button>
        )}
      </div>
      <h1
        ref={titleRef}
        tabIndex={-1}
        // Alvo de foco programático: sem anel (o foco segue para leitores de tela).
        className="text-title2 sm:text-[26px] sm:leading-[32px] font-semibold text-text-primary mb-5 sm:mb-6 rounded-chip focus:outline-none focus-visible:outline-none"
      >
        {node.name}
      </h1>

      {resolved && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {node.state === 'done' ? (
              <span className="chip bg-state-done/12 text-state-done">{tr.tutor.statusDone}</span>
            ) : node.takenAsKnown ? (
              <span className="chip">✓ {tr.tutor.knownBadge}</span>
            ) : (
              <span className="chip bg-conf-mid/12 text-conf-mid">{tr.tutor.statusNoProof}</span>
            )}
          </div>
          {/* Só o confirmado no palpite vira "concluído" ao comprovar (o store
              promove) — um "já sei" em projeto de construir segue sem prova. */}
          {resolvedNoProof && node.confirmado && node.state !== 'done' && (
            <div className="text-footnote text-conf-mid bg-conf-mid/8 rounded-control pl-3 pr-1.5 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="flex-1 min-w-[12rem]">{tr.tutor.missingOneThing}</span>
              <button
                onClick={() => goToGT(proofTarget)}
                className="tap shrink-0 btn btn-sm btn-tertiary text-conf-mid hover:bg-conf-mid/12"
              >
                {tr.tutor.proveNow}
              </button>
            </div>
          )}
        </div>
      )}

      {node.oQue && (
        <TutorBlock label={tr.tutor.whatIs}>
          <p>{node.oQue}</p>
        </TutorBlock>
      )}
      {node.porQue && (
        <TutorBlock label={tr.tutor.whyNeeded}>
          <p>{node.porQue}</p>
        </TutorBlock>
      )}

      {/* A decision is resolved by PICKING a path: click selects, the bar commits. */}
      {isDecision && (
        <TutorBlock label={tr.tutor.decisionLabel}>
          <div className="space-y-2" role="radiogroup" aria-label={tr.tutor.decisionLabel}>
            {node.decisionOptions!.map((opt) => {
              const picked = node.decisionPickedId === opt.id;
              const isSel = selectedOpt === opt.id;
              const on = isSel || picked;
              return (
                <button
                  key={opt.id}
                  role="radio"
                  aria-checked={isSel}
                  disabled={resolved}
                  onClick={() => {
                    setSelectedOpt(opt.id);
                    setConfirmingNoSignal(false);
                  }}
                  className={`w-full text-left px-3.5 py-3 rounded-control flex items-start gap-3 transition-[background-color,box-shadow] duration-120 ease-mac disabled:cursor-default ${
                    on
                      ? 'bg-accent/8 ring-2 ring-inset ring-accent'
                      : 'bg-bg-secondary ring-1 ring-inset ring-border-base hover:bg-bg-elevated/50'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-px w-4 h-4 shrink-0 rounded-full flex items-center justify-center transition-colors duration-120 ${
                      on ? 'bg-accent-solid' : 'ring-1 ring-inset ring-text-faint/55'
                    }`}
                  >
                    {on && <span className="w-1.5 h-1.5 rounded-full bg-accent-fg" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-control font-semibold text-text-primary">{opt.label}</span>
                      {on && (
                        <span className="ml-auto chip bg-accent/12 text-accent">
                          {picked ? tr.tutor.decisionPickedBadge : tr.tutor.decisionSelectedBadge}
                        </span>
                      )}
                    </span>
                    <span className="block text-control text-text-secondary mt-1">{opt.pitch}</span>
                    {opt.consequences && (
                      <span className="block text-footnote text-text-muted mt-1">
                        {tr.tutor.consequencesPrefix} {opt.consequences}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </TutorBlock>
      )}

      {pendingHere && (
        <div className="mt-2 mb-5 space-y-2 p-3 rounded-card bg-ai-accent/8">
          <div className="label text-ai-accent flex items-center gap-1.5 px-0.5">
            <span className="ai-icon" aria-hidden>
              ✦
            </span>
            {tr.tutor.decomposeReview}
          </div>
          {pending!.nodes.map((s) => (
            <div key={s.tempId} className="p-3 bg-bg-secondary rounded-control shadow-mac-sm">
              <div className="text-control font-semibold text-text-primary">{s.data.name}</div>
              <div className="text-footnote text-text-secondary mt-0.5 mb-2">{s.data.oQue || s.data.fx}</div>
              {s.data.ruleConflict && (
                <div className="text-footnote text-conf-low mb-2">{s.data.ruleConflict}</div>
              )}
              <div className="flex gap-1.5">
                <button
                  onClick={() => acceptSuggestion(s.tempId)}
                  className="tap flex-1 btn btn-secondary btn-sm text-state-done"
                >
                  {tr.tutor.acceptOne}
                </button>
                <button
                  onClick={() => rejectSuggestion(s.tempId)}
                  aria-label={tr.conceptNode.reject}
                  className="tap btn btn-ghost btn-sm btn-icon hover:text-state-problem"
                >
                  <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5">
        <div className="flex gap-2">
          <button
            onClick={handleExplain}
            disabled={explainRunning || (!!job && !node.explicacao)}
            className="tap btn btn-ai flex-1 min-w-0 justify-between"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className={`ai-icon ${explainRunning ? 'animate-pulse-subtle' : ''}`} aria-hidden>
                ✦
              </span>
              <span className="truncate">
                {explainRunning
                  ? streamText
                    ? tr.tutor.writingExplain(elapsed)
                    : tr.common.thinking(elapsed)
                  : node.explicacao
                  ? open
                    ? tr.tutor.closeExplain
                    : tr.tutor.viewExplain
                  : tr.tutor.explain}
              </span>
            </span>
            {node.explicacao && !explainRunning && (
              <svg
                aria-hidden
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                className={`shrink-0 text-text-muted transition-transform duration-180 ease-mac ${open ? 'rotate-180' : ''}`}
              >
                <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          {explainRunning && (
            <button onClick={cancelJob} className="tap shrink-0 btn btn-ghost">
              {tr.common.cancelRunning}
            </button>
          )}
          <button
            onClick={() => setReading(true)}
            title={tr.tutor.readingMode}
            aria-label={tr.tutor.readingMode}
            className="tap shrink-0 btn btn-secondary btn-icon text-text-muted"
          >
            <svg aria-hidden width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 3.5h4.2c.9 0 1.8.7 1.8 1.6V13c0-.8-.7-1.4-1.5-1.4H2V3.5ZM14 3.5H9.8c-.9 0-1.8.7-1.8 1.6V13c0-.8.7-1.4 1.5-1.4H14V3.5Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        {explainAI.error && (
          <InlineError error={explainAI.error} onRetry={() => void explainAI.retry()} className="mt-2" />
        )}
        {((open && node.explicacao) || (explainRunning && streamText)) && (
          <div className="mt-3 px-4 py-4 sm:px-5 rounded-control bg-bg-primary" aria-busy={explainRunning}>
            <ExplanationContent text={node.explicacao || streamText || ''} />
          </div>
        )}
        {reading && (
          <ReadingMode
            node={node}
            breadcrumb={crumbs.map((c) => c.name)}
            onClose={() => setReading(false)}
            onGenerate={handleExplain}
            generating={explainRunning}
            streamingText={explainRunning ? streamText : undefined}
            onConfirm={primaryForReading}
            onDecompose={
              canDecompose && !job && !decomposeBlocked
                ? { label: tr.tutor.decomposeShort, onClick: handleDecompose }
                : undefined
            }
            onKnown={
              !resolved && !isDecision && !hasKids && !pendingHere
                ? { label: knownLabel, onClick: markKnownAndAdvance }
                : undefined
            }
          />
        )}
      </div>

      <div id={GT_WRAPPER_ID}>
        <GroundTruthInlineTutor node={node} project={project} />
      </div>

      {notice}

      {/* O que falta para concluir — dentro do card, perto da barra (a barra
          fica só com ações). */}
      {(decomposeAI.error ||
        (!resolved && !pendingHere && !hasKids && !blocker && (openFailure || (!ready && !confirmingNoSignal))) ||
        (canDecompose && decomposeBlocked && !job)) && (
        <div className="mt-6 space-y-2">
          {decomposeAI.error && (
            <InlineError
              error={decomposeAI.error}
              onRetry={() => void decomposeAI.retry()}
              onAction={{ label: tr.common.dismiss, onClick: decomposeAI.reset }}
            />
          )}
          {!resolved && !pendingHere && !hasKids && !blocker && (
            <>
              {openFailure ? (
                <div className="flex items-center gap-2 text-footnote text-text-secondary">
                  <span aria-hidden className="w-2 h-2 rounded-full bg-state-problem shrink-0" />
                  <span>{tr.tutor.failureOpenHint}</span>
                </div>
              ) : !ready && !confirmingNoSignal ? (
                <div className="text-footnote text-text-muted">
                  {tr.tutor.gateLead}{' '}
                  <button
                    onClick={() => goToGT(proofTarget)}
                    className="text-accent font-medium hover:underline underline-offset-2 text-left rounded-chip"
                  >
                    {proofTarget === 'criterion' ? tr.tutor.gateHintNotLocked : tr.tutor.gateHintNotAttested}
                  </button>
                </div>
              ) : null}
            </>
          )}
          {canDecompose && decomposeBlocked && !job && (
            <div className="text-footnote text-text-muted">
              {decomposeBlocked.reason}{' '}
              <button
                onClick={decomposeBlocked.go}
                className="text-accent font-medium hover:underline underline-offset-2 rounded-chip"
              >
                {tr.tutor.goThere}
              </button>
            </div>
          )}
        </div>
      )}

      {/* The fork at the heart of the concept — always visible: confirm
          against reality, break it down further, or declare the floor.
          Uma linha só: primária + secundária + "…". Material sólido (o vidro
          saturado borrava os botões que rolam por baixo). O bottom negativo
          compensa o padding inferior do scroller: a barra encosta no rodapé. */}
      {barEmpty && <div className="h-6" aria-hidden />}
      <div
        ref={barRef}
        className={`bar-solid sticky -bottom-6 sm:-bottom-10 z-10 mt-6 -mx-4 sm:-mx-8 px-4 sm:px-8 border-t rounded-b-card pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] space-y-2 ${
          barEmpty ? 'hidden' : ''
        }`}
      >
        {confirmingNoSignal && !resolved && !pendingHere && !hasKids && !blocker && !openFailure && (
          <div className="text-footnote text-conf-mid">{tr.tutor.confirmNoProofWarning}</div>
        )}
        {decomposeRunning && canDecompose && (
          <div
            className="flex items-center gap-1.5 pl-2.5 pr-1 min-h-[30px] text-footnote font-medium text-ai-accent bg-ai-accent/8 rounded-control"
            aria-live="polite"
          >
            <span className="animate-pulse-subtle" aria-hidden>
              ✦
            </span>
            <span className="flex-1 min-w-0 truncate tabular-nums">{tr.tutor.decomposingFor(elapsed)}</span>
            <button onClick={cancelJob} className="tap shrink-0 btn btn-ghost btn-sm">
              {tr.common.cancelRunning}
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          {pendingHere ? (
            <>
              <button onClick={acceptAllSuggestions} className="tap btn btn-primary h-8 flex-1 min-w-0">
                <span className="truncate">{tr.tutor.acceptAllCount(pending!.nodes.length)}</span>
              </button>
              <button onClick={rejectAllSuggestions} className="tap btn btn-secondary h-8 shrink-0">
                {tr.tutor.rejectAll}
              </button>
            </>
          ) : resolved ? (
            <>
              {next && next.id !== node.id ? (
                <button
                  onClick={() => {
                    focusTitleOnMount = true;
                    selectNode(next.id);
                  }}
                  className="tap btn btn-primary h-8 flex-1 min-w-0"
                >
                  <span className="truncate">{tr.tutor.nextPendingBtn}</span>
                </button>
              ) : (
                <div className="flex-1" />
              )}
              <button
                onClick={() => (node.confirmado ? unconfirmNode(node.id) : toggleTakenAsKnown(node.id))}
                className="tap btn btn-secondary h-8 shrink-0"
              >
                {node.confirmado ? tr.tutor.undoConfirm : tr.tutor.reopenKnown}
              </button>
            </>
          ) : hasKids ? null : (
            <>
              {blocker ? (
                <button onClick={goToBlocker} className="tap btn btn-secondary h-8 flex-1 min-w-0">
                  <span className="truncate">{tr.tutor.blockedBefore(blocker.name)}</span>
                </button>
              ) : openFailure ? (
                <button onClick={() => goToGT('failure')} className="tap btn btn-secondary h-8 flex-1 min-w-0">
                  <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-state-problem shrink-0" />
                  <span className="truncate">{tr.tutor.resolveFailureFirst}</span>
                </button>
              ) : isDecision && !pickedOpt ? (
                <button disabled className="btn btn-primary h-8 flex-1 min-w-0">
                  <span className="truncate">{tr.tutor.pickFirst}</span>
                </button>
              ) : ready ? (
                <button
                  onClick={isDecision ? pickAndAdvance : confirmAndAdvance}
                  className="tap btn btn-primary h-8 flex-1 min-w-0"
                >
                  <span className="truncate">
                    {isDecision && pickedOpt ? tr.tutor.pickOption(pickedOpt.label) : confirmLabel}
                  </span>
                </button>
              ) : confirmingNoSignal ? (
                <>
                  <button
                    onClick={isDecision ? pickAndAdvance : confirmAndAdvance}
                    className="tap btn btn-secondary h-8 flex-1 min-w-0 text-conf-mid"
                  >
                    <span className="truncate">
                      {isDecision && pickedOpt ? tr.tutor.pickOption(pickedOpt.label) : tr.tutor.confirmNoProofConfirm}
                    </span>
                  </button>
                  <button onClick={() => setConfirmingNoSignal(false)} className="tap btn btn-ghost h-8 shrink-0">
                    {tr.common.cancel}
                  </button>
                </>
              ) : (
                <button onClick={() => setConfirmingNoSignal(true)} className="tap btn btn-secondary h-8 flex-1 min-w-0">
                  <span className="truncate">
                    {isDecision && pickedOpt ? tr.tutor.pickOptionNoProof(pickedOpt.label) : tr.tutor.confirmNoProof}
                  </span>
                </button>
              )}
              {!confirmingNoSignal && canDecompose && !decomposeRunning && (
                <button
                  onClick={handleDecompose}
                  disabled={!!job || !!decomposeBlocked}
                  title={decomposeBlocked?.reason ?? decomposeTitle}
                  className="tap btn btn-ai h-8 shrink-0 hidden sm:inline-flex"
                >
                  <span className="ai-icon" aria-hidden>
                    ✦
                  </span>
                  {tr.tutor.decomposeShort}
                </button>
              )}
              {!confirmingNoSignal && (
                <OverflowMenu
                  label={tr.topBar.moreActions}
                  placement="up"
                  buttonClassName="btn-secondary h-8 w-8"
                  items={moreItems}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TutorBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="label mb-1.5">{label}</h2>
      <div className="reading text-text-secondary">{children}</div>
    </div>
  );
}

function EmptyCard({ tr, onViewGraph }: { tr: Messages; onViewGraph: () => void }) {
  return (
    <div className="max-w-md mx-auto text-center py-16 sm:py-24">
      <p className="text-body text-text-secondary mb-5">{tr.tutor.emptyTree}</p>
      <button onClick={onViewGraph} className="tap btn btn-secondary">
        {tr.tutor.viewGraphShort}
      </button>
    </div>
  );
}

function DoneCard({
  project,
  doneWithoutSignal,
  onPick,
  onViewGraph,
  tr,
}: {
  project: Project;
  doneWithoutSignal: number;
  onPick: (id: string) => void;
  onViewGraph: () => void;
  tr: Messages;
}) {
  // Only celebrate when every leaf was anchored against reality. If some were
  // confirmed without signal, temper the message and list them to revisit.
  const anchored = doneWithoutSignal === 0;
  const withoutProof = anchored ? [] : nodesWithoutSignal(project);
  return (
    <div className="max-w-xl mx-auto text-center py-12 sm:py-20 animate-card-swap">
      <svg
        aria-hidden
        width="56"
        height="56"
        viewBox="0 0 56 56"
        fill="none"
        className={`mx-auto mb-5 ${anchored ? 'text-state-done' : 'text-conf-mid'}`}
      >
        <circle cx="28" cy="28" r="26" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.5" />
        {anchored ? (
          <path
            d="M18 29l7 7 13-15"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1"
            className="animate-check-draw"
          />
        ) : (
          <path d="M28 2a26 26 0 0 1 0 52Z" fill="currentColor" fillOpacity=".85" />
        )}
      </svg>
      <h1 className="text-title1 font-bold text-text-primary mb-2">
        {anchored ? tr.tutor.projectDoneTitle : tr.tutor.projectWalkedTitle}
      </h1>
      <p className="text-body text-text-secondary max-w-read mx-auto">
        {anchored
          ? tr.tutor.projectDoneBody(project.name)
          : tr.tutor.projectWalkedBody(doneWithoutSignal)}
      </p>
      {withoutProof.length > 0 && (
        <div className="mt-8 text-left">
          <div className="label mb-2 px-1">{tr.tutor.withoutProofTitle}</div>
          <ul className="card overflow-hidden divide-y divide-border-base/60">
            {withoutProof.map((id) => {
              const n = project.nodes[id];
              if (!n) return null;
              return (
                <li key={id}>
                  <button
                    onClick={() => onPick(id)}
                    className="tap w-full text-left text-control px-3.5 py-2.5 text-text-primary hover:bg-bg-elevated/60 transition-colors duration-120 ease-mac flex items-center gap-2.5"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0 border border-dashed border-conf-mid" aria-hidden />
                    <span className="truncate flex-1">{n.name}</span>
                    <span className="chip shrink-0">{tr.conceptNode[n.kind]}</span>
                    <svg aria-hidden width="8" height="12" viewBox="0 0 8 12" fill="none" className="shrink-0 text-text-faint">
                      <path d="M2 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <button onClick={onViewGraph} className="mt-8 tap btn btn-secondary">
        {tr.tutor.viewInGraph}
      </button>
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
  // Sugestões ainda não aceitas por pai: selo à parte, fora do done/total.
  suggestionCounts: Record<string, number>;
  onPick: (id: string) => void;
  tr: Messages;
}

function TreeRows({ project, byParent, parentId, depth, currentId, suggestionCounts, onPick, tr }: TreeRowsProps) {
  const kids = byParent.get(parentId) ?? [];
  return (
    <>
      {kids.map((node) => {
        const children = byParent.get(node.id) ?? [];

        if (node.takenAsKnown) {
          // Floor: subtree closed. Render the node itself as a known leaf.
          return (
            <LeafRow
              key={node.id}
              node={node}
              project={project}
              depth={depth}
              isCurrent={node.id === currentId}
              onPick={onPick}
              tr={tr}
            />
          );
        }

        if (children.length > 0 || node.kind === 'categoria') {
          const leaves = effectiveLeavesUnder(
            project,
            node.id,
            byParent,
            undefined,
            new Set(Object.keys(suggestionCounts)),
          );
          const done = leaves.filter((l) => l.confirmado || l.takenAsKnown).length;
          return (
            <div key={node.id}>
              <GroupRow
                node={node}
                depth={depth}
                done={done}
                total={leaves.length}
                suggestions={suggestionCounts[node.id] ?? 0}
                tr={tr}
              />
              <TreeRows
                project={project}
                byParent={byParent}
                parentId={node.id}
                depth={depth + 1}
                currentId={currentId}
                suggestionCounts={suggestionCounts}
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
  suggestions,
  tr,
}: {
  node: ConceptNodeData;
  depth: number;
  done: number;
  total: number;
  suggestions: number;
  tr: Messages;
}) {
  // Nível 0 = cabeçalho de seção da sidebar (como no Finder); abaixo, grupo.
  return (
    <div
      className={`flex items-center gap-2 pr-2 min-h-[28px] ${depth === 0 ? 'mt-3 first:mt-0' : ''}`}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
    >
      <span
        className={`truncate ${
          depth === 0 ? 'text-footnote font-semibold text-text-muted' : 'text-control font-medium text-text-secondary'
        }`}
      >
        {node.name}
      </span>
      {suggestions > 0 && (
        <span className="ml-auto chip shrink-0 bg-ai-accent/12 text-ai-accent" title={tr.tutor.suggestionsBadgeTitle}>
          {tr.tutor.suggestionsBadge(suggestions)}
        </span>
      )}
      <span
        className={`${suggestions > 0 ? '' : 'ml-auto '}text-caption tabular-nums shrink-0 ${
          'text-text-muted'
        }`}
      >
        {done}/{total}
      </span>
    </div>
  );
}

interface LeafRowProps {
  node: ConceptNodeData;
  project: Project;
  depth: number;
  isCurrent: boolean;
  onPick: (id: string) => void;
  tr: Messages;
}

function LeafRow({ node, project, depth, isCurrent, onPick, tr }: LeafRowProps) {
  const confirmNode = useGraphStore((s) => s.confirmNode);
  const busy = useGraphStore((s) => Object.keys(s.aiJobs[node.id] ?? {}).length > 0);
  const rowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isCurrent) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isCurrent]);

  const known = !!node.takenAsKnown;
  const resolved = node.confirmado || known;
  const blocked = !resolved && firstBlockerOf(project, node.id) !== null;
  const resolvedDone = node.state === 'done';
  const hunch = node.confirmado && !resolvedDone && !known;
  const seq = stepSequence(project, node.id);
  const isDecision = node.kind === 'decisao' && (node.decisionOptions?.length ?? 0) > 0;
  // O checkbox só fecha um nó que JÁ ganhou o direito (sinal real). Resolvido
  // ou sem sinal, só navega até o card — desfazer mora no card/toast, e o
  // caminho sem prova nunca é o clique mais fácil.
  const quickConfirm = !resolved && !isDecision && canConcludeNode(project, node.id).ready;

  // Checkbox 16px estilo macOS: verde cheio = com prova; tracejado âmbar = palpite.
  const box = resolved ? (
    <svg aria-hidden width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M2.5 6.3l2.3 2.3 4.7-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : null;
  const boxCls = `w-4 h-4 rounded-check flex items-center justify-center shrink-0 transition-colors duration-120 ease-mac ${
    resolvedDone
      ? 'bg-state-done/15 text-state-done'
      : known
      ? 'bg-text-faint/25 text-text-secondary'
      : hunch
      ? 'border border-dashed border-conf-mid text-conf-mid'
      : quickConfirm
      ? 'ring-1 ring-inset ring-state-done/70 bg-bg-secondary'
      : 'ring-1 ring-inset ring-text-faint/55 bg-bg-secondary'
  }`;

  return (
    <div
      className={`flex items-center gap-2 pr-1.5 rounded-chip transition-colors duration-120 ease-mac ${
        isCurrent ? 'bg-accent/12' : 'hover:bg-text-faint/10'
      } ${blocked ? 'opacity-55' : ''}`}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
    >
      {quickConfirm ? (
        <button
          onClick={() => {
            confirmNode(node.id);
            feedbackToast(tr.tutor.toastDone(node.name), true, tr);
          }}
          aria-label={`${tr.tutor.ariaConfirm}: ${node.name}`}
          className="tap -m-1 p-1 flex items-center justify-center rounded-check shrink-0 hover:[&>span]:bg-state-done/12"
        >
          <span className={boxCls}>{box}</span>
        </button>
      ) : (
        <span aria-hidden className={boxCls}>
          {box}
        </span>
      )}
      <button
        ref={rowRef}
        onClick={() => onPick(node.id)}
        aria-current={isCurrent ? 'true' : undefined}
        title={blocked ? `${node.name} (${tr.tutor.blockedRow})` : node.name}
        className={`tap flex-1 min-w-0 text-left text-control truncate py-1 min-h-[36px] md:min-h-[28px] rounded-chip ${
          isCurrent
            ? 'text-accent font-medium'
            : resolved
            ? 'text-text-muted'
            : 'text-text-primary'
        }`}
      >
        {/* A linha já tem checkbox: só o número do passo, sem marcador de tipo. */}
        {seq !== null && (
          <span className={`tabular-nums mr-1.5 ${isCurrent ? 'text-accent/80' : 'text-text-muted'}`}>{seq}.</span>
        )}
        {node.name}
      </button>
      {node.failureContext && (
        <span
          className="shrink-0 w-2 h-2 rounded-full bg-state-problem"
          role="img"
          aria-label={tr.detail.problemBadge}
          title={tr.detail.problemBadge}
        />
      )}
      {busy && (
        <span
          className="shrink-0 w-3 h-3 rounded-full border-2 border-ai-accent/30 border-t-ai-accent animate-spin"
          role="status"
          aria-label={tr.tutor.aiBusy}
        />
      )}
    </div>
  );
}
