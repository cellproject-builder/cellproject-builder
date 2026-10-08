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
  type PendingSuggestions,
  canRevealAICriterionNow,
  relatedPartsFor,
} from '@/store';
import { explainNode, decomposeNode } from '@/ai/service';
import { useKBStore } from '@/kb/store';
import { requireAI } from '@/ai/availability';
import { useAIAction } from '@/hooks/useAIAction';
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

  // Sugestões em revisão contam como partes abertas do pai (progresso e
  // "próximo pendente" não pulam um pai com sugestões esperando).
  const next = useMemo(() => nextPendingForTutor(project, pending), [project, pending]);
  const progress = projectProgress(project, pending);
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

  useEffect(() => {
    if (currentId) setLastTutorNode(currentId);
  }, [currentId, setLastTutorNode]);

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

  const reviewPending = () => {
    if (!pendingNode) return;
    if (isActionableKind(pendingNode.kind)) {
      selectNode(pendingNode.id);
      setSidebarOpen(false);
      return;
    }
    // Pai estrutural (categoria/objetivo): a revisão acontece no grafo — e é
    // ele (não o card atual) que o grafo deve abrir.
    selectNode(pendingNode.id);
    setLastTutorNode(pendingNode.id);
    setViewMode('graph');
    requestCenter(pendingNode.id);
  };

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
        currentId={currentId}
        pending={pending}
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

  const showBanner = !!pending && !!pendingNode && pendingNode.id !== currentId;

  return (
    <div className="flex-1 flex overflow-hidden bg-bg-primary">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="border-b border-border-base bg-bg-secondary px-4 sm:px-6 py-2 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:block text-[10px] font-mono uppercase tracking-widest text-ai-accent">
              {tr.tutor.modeKicker}
            </div>
            <div className="hidden md:block text-text-muted text-xs truncate">{tr.tutor.focusHint}</div>
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden tap text-xs text-text-secondary hover:text-text-primary border border-border-base rounded-sm px-2.5 py-1 transition-colors min-h-[32px] font-mono"
            >
              {tr.tutor.mobileStepsBtn(progress.done, progress.total)}
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className="ml-auto tap text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              {tr.tutor.viewGraphShort}
            </button>
          </div>
          {project.rules && project.rules.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 overflow-x-auto sm:flex-wrap">
              <span className="shrink-0 text-[9px] font-mono uppercase tracking-wider text-text-muted">
                {tr.tutor.rulesLabel}
              </span>
              {project.rules.map((r) => (
                <span
                  key={r}
                  className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded-[2px] bg-ai-accent/5 text-text-secondary border border-ai-accent/30"
                  title={tr.tutor.rulesTitle}
                >
                  <span className="text-ai-accent mr-1">⛓</span>
                  {r}
                </span>
              ))}
            </div>
          )}
          <div className="hidden md:block">
            <ProgressBar
              percent={progress.percent}
              done={progress.done}
              total={progress.total}
              doneWithoutSignal={progress.doneWithoutSignal}
              tr={tr}
            />
          </div>
          {/* Mobile: só uma linha fina — o número já está no botão da árvore. */}
          <div
            className="md:hidden mt-2 h-[2px] bg-bg-primary overflow-hidden"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={tr.tutor.confirmedOf(progress.done, progress.total)}
          >
            <div
              className={`h-full transition-all duration-500 ${
                progress.doneWithoutSignal > 0 ? 'bg-conf-mid' : 'bg-ai-accent'
              }`}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>

        <div data-tutor-scroll className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 pt-4 sm:pt-6 md:pt-8">
          {showBanner && (
            <div className="max-w-2xl mx-auto mb-4 flex items-center gap-2 px-3 py-2 border border-ai-accent/30 bg-ai-accent/5 rounded-sm text-xs text-text-secondary">
              <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-ai-accent animate-pulse-subtle" />
              <span className="flex-1 min-w-0">
                {tr.tutor.pendingBanner(pending!.nodes.length, pendingNode!.name)}
              </span>
              <button
                onClick={reviewPending}
                className="tap shrink-0 text-ai-accent hover:underline font-medium"
              >
                {tr.tutor.reviewPending} →
              </button>
            </div>
          )}

          {current ? (
            <TutorCard
              key={current.id}
              node={current}
              project={project}
              byParent={byParent}
              isNext={current.id === next?.id}
              next={next}
              onReviewPending={reviewPending}
              tr={tr}
              notice={
                current.kind === 'passo' && resourceLeaves.length > 0 && !allResourcesDone ? (
                  <div className="mt-6 p-4 bg-conf-mid/5 border border-conf-mid/30 rounded-sm">
                    <div className="text-conf-mid text-xs font-mono uppercase tracking-wider mb-1">
                      {tr.tutor.resourcesLeftWarning}
                    </div>
                    <div className="text-sm text-text-secondary">
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
  onReviewPending: () => void;
  notice?: React.ReactNode;
  tr: Messages;
}

function TutorCard({ node, project, byParent, isNext, next, onReviewPending, notice, tr }: TutorCardProps) {
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
  const rejectAllSuggestions = useGraphStore((s) => s.rejectAllSuggestions);
  const pending = useGraphStore((s) => s.pendingSuggestions);
  const pendingNode = useGraphStore(pendingParent);
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
    const apply = () => {
      scroller.style.scrollPaddingBottom = `${bar.offsetHeight + 12}px`;
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      scroller.style.scrollPaddingBottom = '';
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

  const job = aiJobs[node.id];
  const elapsed = useElapsedSeconds(job?.startedAt);
  const explainRunning = job?.kind === 'explain';
  const decomposeRunning = job?.kind === 'decompose';

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

  // Só uma quebra por vez: outra em andamento ou sugestões esperando revisão
  // em outro nó desabilitam o decompor — com o motivo e um atalho até lá.
  const otherDecomposeId = Object.entries(aiJobs).find(
    ([id, j]) => id !== node.id && (j.kind === 'decompose' || j.kind === 'replan'),
  )?.[0];
  const decomposeBlocked: { reason: string; go: () => void } | null =
    pending && !pendingHere && pendingNode
      ? { reason: tr.tutor.decomposeBlockedPending(pendingNode.name), go: onReviewPending }
      : otherDecomposeId && project.nodes[otherDecomposeId]
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

  return (
    <div ref={rootRef} className="max-w-2xl mx-auto scroll-mt-4">
      {crumbs.length > 1 && (
        <div className="text-xs text-text-muted mb-1 truncate">
          {crumbs
            .slice(0, -1)
            .map((c) => c.name)
            .join(' › ')}
        </div>
      )}
      <div className="flex items-baseline gap-3 mb-3 sm:mb-5 flex-wrap">
        <span className="text-[11px] font-mono uppercase tracking-wider text-ai-accent">
          ◆ {kindLabel}
        </span>
        {stepSeq !== null && (
          <span className="text-text-muted text-xs font-mono">{tr.tutor.stepNumber(stepSeq)}</span>
        )}
        {isNext && (
          <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-[2px] bg-ai-accent/10 text-ai-accent border border-ai-accent/30">
            {tr.tutor.nextBadge}
          </span>
        )}
        {!isNext && next && !resolved && (
          <button
            onClick={() => selectNode(next.id)}
            className="ml-auto text-[11px] text-text-muted hover:text-ai-accent transition-colors truncate max-w-[60%]"
          >
            {tr.tutor.jumpToNext(next.name)}
          </button>
        )}
      </div>
      <h1
        ref={titleRef}
        tabIndex={-1}
        className="text-2xl sm:text-3xl font-semibold text-text-primary leading-tight mb-4 sm:mb-6 outline-none focus-visible:ring-1 focus-visible:ring-ai-accent/50 rounded-sm"
      >
        {node.name}
      </h1>

      {resolved && (
        <div className="mb-5 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {node.state === 'done' ? (
              <span className="text-[11px] font-mono text-state-done bg-state-done/10 border border-state-done/30 rounded-sm px-2 py-1">
                {tr.tutor.statusDone}
              </span>
            ) : node.takenAsKnown ? (
              <span className="text-[11px] font-mono text-ai-accent bg-ai-accent/10 border border-ai-accent/30 rounded-sm px-2 py-1">
                ✓ {tr.tutor.knownBadge}
              </span>
            ) : (
              <span className="text-[11px] font-mono text-conf-mid bg-conf-mid/10 border border-conf-mid/30 rounded-sm px-2 py-1">
                {tr.tutor.statusNoProof}
              </span>
            )}
          </div>
          {/* Só o confirmado no palpite vira "concluído" ao comprovar (o store
              promove) — um "já sei" em projeto de construir segue sem prova. */}
          {resolvedNoProof && node.confirmado && node.state !== 'done' && (
            <div className="text-xs text-conf-mid bg-conf-mid/5 border border-conf-mid/30 rounded-sm px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="flex-1 min-w-[12rem]">{tr.tutor.missingOneThing}</span>
              <button
                onClick={() => goToGT(proofTarget)}
                className="tap shrink-0 font-medium text-conf-mid hover:underline"
              >
                {tr.tutor.proveNow}
              </button>
            </div>
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

      {/* A decision is resolved by PICKING a path: click selects, the bar commits. */}
      {isDecision && (
        <TutorBlock label={tr.tutor.decisionLabel}>
          <div className="space-y-2" role="radiogroup" aria-label={tr.tutor.decisionLabel}>
            {node.decisionOptions!.map((opt) => {
              const picked = node.decisionPickedId === opt.id;
              const isSel = selectedOpt === opt.id;
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
                  className={`w-full text-left p-3 rounded-sm border transition-colors disabled:cursor-default ${
                    isSel || picked
                      ? 'bg-ai-accent/15 border-ai-accent text-ai-accent'
                      : 'bg-bg-secondary border-border-base hover:border-ai-accent/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{opt.label}</span>
                    {(picked || isSel) && (
                      <span className="ml-auto text-[10px] font-mono uppercase tracking-wider">
                        {picked ? tr.tutor.decisionPickedBadge : tr.tutor.decisionSelectedBadge}
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

      {pendingHere && (
        <div className="mt-2 mb-4 space-y-2 p-3 border border-ai-accent/30 rounded-sm bg-ai-accent/5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ai-accent">
            {tr.tutor.decomposeReview}
          </div>
          {pending!.nodes.map((s) => (
            <div key={s.tempId} className="p-2 bg-bg-secondary border border-border-base rounded-sm">
              <div className="text-sm font-medium text-text-primary leading-tight">{s.data.name}</div>
              <div className="text-[11px] text-text-secondary leading-snug mb-1.5">
                {s.data.oQue || s.data.fx}
              </div>
              {s.data.ruleConflict && (
                <div className="text-[11px] text-conf-low leading-snug mb-1.5">⛓ {s.data.ruleConflict}</div>
              )}
              <div className="flex gap-1.5">
                <button
                  onClick={() => acceptSuggestion(s.tempId)}
                  className="tap flex-1 text-[11px] bg-conf-high/15 hover:bg-conf-high/30 text-conf-high border border-conf-high/40 rounded-sm py-1 transition-colors"
                >
                  {tr.tutor.acceptOne}
                </button>
                <button
                  onClick={() => rejectSuggestion(s.tempId)}
                  aria-label={tr.conceptNode.reject}
                  className="tap text-[11px] text-text-muted hover:text-state-problem border border-border-base rounded-sm px-2.5 py-1 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="flex gap-2">
          <button
            onClick={handleExplain}
            disabled={explainRunning || (!!job && !node.explicacao)}
            className="flex-1 min-w-0 flex items-center justify-between gap-3 px-4 py-2.5 min-h-[44px] bg-ai-accent/10 hover:bg-ai-accent/20 border border-ai-accent/30 rounded-sm text-ai-accent text-sm transition-colors disabled:opacity-60"
          >
            <span className="flex items-center gap-2 text-left">
              <span className={explainRunning ? 'animate-pulse-subtle' : ''}>◆</span>
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
            {node.explicacao && !explainRunning && <span className="text-xs">{open ? '▲' : '▼'}</span>}
          </button>
          {explainRunning && (
            <button
              onClick={cancelJob}
              className="tap shrink-0 px-3 min-h-[44px] text-xs text-text-muted hover:text-state-problem border border-border-base rounded-sm transition-colors"
            >
              {tr.common.cancelRunning}
            </button>
          )}
          <button
            onClick={() => setReading(true)}
            title={tr.tutor.readingMode}
            aria-label={tr.tutor.readingMode}
            className="shrink-0 w-11 min-h-[44px] flex items-center justify-center bg-bg-elevated hover:bg-ai-accent/10 border border-border-base hover:border-ai-accent/40 rounded-sm text-text-muted hover:text-ai-accent transition-colors"
          >
            ⛶
          </button>
        </div>
        {explainAI.error && (
          <InlineError error={explainAI.error} onRetry={() => void explainAI.retry()} className="mt-2" />
        )}
        {((open && node.explicacao) || (explainRunning && streamText)) && (
          <div className="mt-3 p-4 sm:p-5 bg-bg-secondary border border-border-base rounded-sm" aria-busy={explainRunning}>
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

      {/* The fork at the heart of the concept — always visible: confirm
          against reality, break it down further, or declare the floor. */}
      <div ref={barRef} className="sticky bottom-0 z-10 mt-6 border-t border-border-base bg-bg-primary pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] space-y-2">
        {decomposeAI.error && (
          <InlineError
            error={decomposeAI.error}
            onRetry={() => void decomposeAI.retry()}
            onAction={{ label: tr.common.dismiss, onClick: decomposeAI.reset }}
          />
        )}

        {/* Linha de orientação: o que falta, específico pro estado do gate. */}
        {!resolved && !pendingHere && !hasKids && !blocker && (
          <>
            {openFailure ? (
              <div className="text-[11px] text-state-problem leading-snug">{tr.tutor.failureOpenHint}</div>
            ) : confirmingNoSignal ? (
              <div className="text-[11px] text-conf-mid leading-snug">{tr.tutor.confirmNoProofWarning}</div>
            ) : !ready ? (
              <div className="text-[11px] text-text-muted leading-snug">
                {tr.tutor.gateLead}{' '}
                <button
                  onClick={() => goToGT(proofTarget)}
                  className="text-ai-accent hover:underline text-left"
                >
                  {proofTarget === 'criterion' ? tr.tutor.gateHintNotLocked : tr.tutor.gateHintNotAttested}
                </button>
              </div>
            ) : null}
          </>
        )}
        {canDecompose && decomposeBlocked && !job && (
          <div className="text-[11px] text-text-muted leading-snug">
            {decomposeBlocked.reason}{' '}
            <button onClick={decomposeBlocked.go} className="text-ai-accent hover:underline">
              {tr.tutor.goThere}
            </button>
          </div>
        )}

        {/* Linha 1 — ação primária. */}
        {pendingHere ? (
          <div className="flex gap-2">
            <button
              onClick={acceptAllSuggestions}
              className="flex-1 bg-ai-accent/15 hover:bg-ai-accent/30 text-ai-accent text-sm sm:text-base py-2.5 min-h-[44px] rounded-sm border-2 border-ai-accent/40 transition-colors font-medium"
            >
              {tr.tutor.acceptAllCount(pending!.nodes.length)}
            </button>
            <button
              onClick={rejectAllSuggestions}
              className="tap px-3 text-xs text-text-muted hover:text-state-problem border border-border-base rounded-sm transition-colors"
            >
              {tr.tutor.rejectAll}
            </button>
          </div>
        ) : resolved ? (
          <div className="flex gap-2">
            {next && next.id !== node.id ? (
              <button
                onClick={() => {
                  focusTitleOnMount = true;
                  selectNode(next.id);
                }}
                className="flex-1 bg-ai-accent/10 hover:bg-ai-accent/20 text-ai-accent text-sm sm:text-base py-2.5 min-h-[44px] rounded-sm border-2 border-ai-accent/40 transition-colors font-medium"
              >
                {tr.tutor.nextPendingBtn}
              </button>
            ) : (
              <div className="flex-1" />
            )}
            <button
              onClick={() => (node.confirmado ? unconfirmNode(node.id) : toggleTakenAsKnown(node.id))}
              className="tap px-3 text-xs text-text-muted hover:text-text-secondary border border-border-base rounded-sm transition-colors"
            >
              {node.confirmado ? tr.tutor.undoConfirm : tr.tutor.reopenKnown}
            </button>
          </div>
        ) : hasKids ? null : blocker ? (
          <button
            onClick={goToBlocker}
            className="w-full bg-bg-elevated hover:bg-ai-accent/10 text-text-secondary hover:text-ai-accent text-sm sm:text-base py-2.5 min-h-[44px] rounded-sm border-2 border-border-base hover:border-ai-accent/40 transition-colors font-medium truncate px-3"
          >
            {tr.tutor.blockedBefore(blocker.name)}
          </button>
        ) : openFailure ? (
          <button
            onClick={() => goToGT('failure')}
            className="w-full bg-state-problem/10 hover:bg-state-problem/20 text-state-problem text-sm sm:text-base py-2.5 min-h-[44px] rounded-sm border-2 border-state-problem/40 transition-colors font-medium"
          >
            {tr.tutor.resolveFailureFirst}
          </button>
        ) : isDecision && !pickedOpt ? (
          <button
            disabled
            className="w-full bg-bg-elevated text-text-muted text-sm sm:text-base py-2.5 min-h-[44px] rounded-sm border-2 border-border-base font-medium cursor-not-allowed"
          >
            {tr.tutor.pickFirst}
          </button>
        ) : ready ? (
          <button
            onClick={isDecision ? pickAndAdvance : confirmAndAdvance}
            className="w-full bg-conf-high/15 hover:bg-conf-high/30 text-conf-high text-sm sm:text-base py-2.5 min-h-[44px] rounded-sm border-2 border-conf-high/40 transition-colors font-medium truncate px-3"
          >
            {isDecision && pickedOpt ? tr.tutor.pickOption(pickedOpt.label) : confirmLabel}
          </button>
        ) : confirmingNoSignal ? (
          <div className="flex gap-2">
            <button
              onClick={isDecision ? pickAndAdvance : confirmAndAdvance}
              className="flex-1 bg-conf-mid/15 hover:bg-conf-mid/30 text-conf-mid text-sm py-2.5 min-h-[44px] rounded-sm border border-conf-mid/40 transition-colors font-medium truncate px-3"
            >
              {isDecision && pickedOpt ? tr.tutor.pickOption(pickedOpt.label) : tr.tutor.confirmNoProofConfirm}
            </button>
            <button
              onClick={() => setConfirmingNoSignal(false)}
              className="tap px-3 text-xs text-text-muted hover:text-text-secondary border border-border-base rounded-sm transition-colors"
            >
              {tr.common.cancel}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingNoSignal(true)}
            className="w-full bg-bg-elevated hover:bg-conf-mid/10 text-text-secondary hover:text-conf-mid text-sm sm:text-base py-2.5 min-h-[44px] rounded-sm border-2 border-border-base hover:border-conf-mid/40 transition-colors font-medium truncate px-3"
          >
            {isDecision && pickedOpt ? tr.tutor.pickOptionNoProof(pickedOpt.label) : tr.tutor.confirmNoProof}
          </button>
        )}

        {/* Linha 2 — secundárias compactas. */}
        {!pendingHere && (
          <div className="flex items-stretch gap-1.5">
            {canDecompose &&
              (decomposeRunning ? (
                <div className="flex-1 flex gap-1.5 min-w-0">
                  <div
                    className="flex-1 min-w-0 flex items-center justify-center gap-1.5 px-2 min-h-[36px] text-xs text-ai-accent border border-ai-accent/40 bg-ai-accent/5 rounded-sm"
                    aria-live="polite"
                  >
                    <span className="animate-pulse-subtle">◆</span>
                    <span className="truncate">{tr.tutor.decomposingFor(elapsed)}</span>
                  </div>
                  <button
                    onClick={cancelJob}
                    className="tap shrink-0 px-2.5 text-xs text-text-muted hover:text-state-problem border border-border-base rounded-sm transition-colors"
                  >
                    {tr.common.cancelRunning}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleDecompose}
                  disabled={!!job || !!decomposeBlocked}
                  title={decomposeBlocked?.reason ?? decomposeTitle}
                  className="tap flex-1 min-w-0 px-2 min-h-[36px] text-xs bg-bg-secondary hover:bg-bg-elevated border border-border-base hover:border-ai-accent/40 rounded-sm text-text-secondary hover:text-ai-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <span>◆</span>
                  <span className="truncate">{tr.tutor.decomposeShort}</span>
                </button>
              ))}
            {!resolved && !isDecision && !hasKids && (
              <button
                onClick={markKnownAndAdvance}
                title={understand ? knownLabel : `${knownLabel} — ${tr.tutor.knownNoProofSub}`}
                className="tap flex-1 min-w-0 px-2 min-h-[36px] text-xs rounded-sm border border-border-base bg-bg-elevated text-text-muted hover:text-ai-accent hover:border-ai-accent/40 transition-colors"
              >
                <span className="line-clamp-2">{knownLabel}</span>
              </button>
            )}
            {resolved && (
              <button
                onClick={() => goToGT('failure')}
                className="tap flex-1 min-w-0 px-2 min-h-[36px] text-xs rounded-sm border border-border-base text-text-muted hover:text-state-problem hover:border-state-problem/40 transition-colors"
              >
                {tr.tutor.failedInPractice}
              </button>
            )}
            <button
              onClick={() => {
                selectNode(node.id);
                setViewMode('graph');
              }}
              // No mobile o header já tem "Ver grafo" — sobra espaço pros rótulos.
              className="tap hidden sm:block shrink-0 px-2.5 min-h-[36px] text-xs text-text-muted hover:text-text-primary border border-border-base rounded-sm transition-colors"
            >
              {tr.tutor.viewInGraph}
            </button>
          </div>
        )}
        {!resolved && !isDecision && !hasKids && !pendingHere && !understand && (
          <div className="hidden sm:block text-[10px] text-text-muted leading-snug">
            {tr.tutor.knownNoProofSub}
          </div>
        )}
      </div>
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
    <div className="max-w-xl mx-auto text-center py-12 sm:py-20">
      <div className={`text-5xl sm:text-6xl mb-4 ${anchored ? 'text-state-done' : 'text-conf-mid'}`}>
        {anchored ? '✓' : '◓'}
      </div>
      <h1 className="text-2xl sm:text-3xl font-semibold text-text-primary mb-3">
        {anchored ? tr.tutor.projectDoneTitle : tr.tutor.projectWalkedTitle}
      </h1>
      <p className="text-text-secondary">
        {anchored
          ? tr.tutor.projectDoneBody(project.name)
          : tr.tutor.projectWalkedBody(doneWithoutSignal)}
      </p>
      {withoutProof.length > 0 && (
        <div className="mt-6 text-left">
          <div className="text-[10px] font-mono uppercase tracking-wider text-conf-mid mb-2">
            {tr.tutor.withoutProofTitle}
          </div>
          <ul className="space-y-1.5">
            {withoutProof.map((id) => {
              const n = project.nodes[id];
              if (!n) return null;
              return (
                <li key={id}>
                  <button
                    onClick={() => onPick(id)}
                    className="tap w-full text-left text-sm px-3 py-2 rounded-sm border border-conf-mid/30 bg-conf-mid/5 hover:bg-conf-mid/10 text-text-secondary hover:text-text-primary transition-colors flex items-center gap-2"
                  >
                    <span className="text-[10px] font-mono text-conf-mid shrink-0">
                      {tr.conceptNode[n.kind]}
                    </span>
                    <span className="truncate flex-1">{n.name}</span>
                    <span className="text-conf-mid shrink-0">→</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <button
        onClick={onViewGraph}
        className="mt-6 tap text-xs text-text-muted hover:text-text-primary border border-border-base rounded-sm px-4 py-2 transition-colors"
      >
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
  pending: PendingSuggestions | null;
  onPick: (id: string) => void;
  tr: Messages;
}

function TreeRows({ project, byParent, parentId, depth, currentId, pending, onPick, tr }: TreeRowsProps) {
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
          const leaves = effectiveLeavesUnder(project, node.id, byParent, pending);
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
                pending={pending}
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
  isCurrent: boolean;
  onPick: (id: string) => void;
  tr: Messages;
}

function LeafRow({ node, project, depth, isCurrent, onPick, tr }: LeafRowProps) {
  const confirmNode = useGraphStore((s) => s.confirmNode);
  const busy = useGraphStore((s) => Boolean(s.aiJobs[node.id]));
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

  const box = (
    <>
      {resolvedDone && <span className="text-[10px]">✓</span>}
      {!resolvedDone && known && <span className="text-[10px]">✓</span>}
      {!resolvedDone && !known && node.confirmado && <span className="text-[10px]">✓</span>}
    </>
  );
  const boxCls = `w-5 h-5 rounded-sm border flex items-center justify-center transition-colors shrink-0 ${
    resolvedDone
      ? 'bg-state-done/20 border-state-done text-state-done'
      : known
      ? 'bg-ai-accent/15 border-ai-accent/50 text-ai-accent'
      : hunch
      ? 'bg-conf-mid/15 border-conf-mid text-conf-mid'
      : quickConfirm
      ? 'border-conf-high/60 hover:bg-conf-high/15'
      : 'border-border-base'
  }`;

  return (
    <div
      className={`flex items-center gap-2 pr-2 text-xs transition-colors ${
        isCurrent
          ? 'bg-ai-accent/10 border-l-2 border-ai-accent'
          : 'hover:bg-bg-elevated/50 border-l-2 border-transparent'
      } ${blocked ? 'opacity-60' : ''}`}
      style={{ paddingLeft: `${10 + depth * 14}px` }}
    >
      {quickConfirm ? (
        <button
          onClick={() => {
            confirmNode(node.id);
            feedbackToast(tr.tutor.toastDone(node.name), true, tr);
          }}
          aria-label={`${tr.tutor.ariaConfirm}: ${node.name}`}
          className={`tap ${boxCls}`}
        >
          {box}
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
        className={`flex-1 min-w-0 text-left truncate py-2 min-h-[44px] md:min-h-[32px] ${
          resolved ? 'text-text-muted line-through' : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        {seq !== null ? (
          <span className="text-text-muted font-mono mr-1">{seq}.</span>
        ) : KIND_GLYPH[node.kind] ? (
          <span className="text-text-muted font-mono mr-1">{KIND_GLYPH[node.kind]}</span>
        ) : null}
        {node.name}
      </button>
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
