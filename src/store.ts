import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { nanoid } from 'nanoid';
import type {
  Project,
  ConceptNodeData,
  ConceptEdgeData,
  AIPlan,
  NodeState,
  NodeKind,
  HistoryEntry,
  AdversarialCritique,
  GroundTruthRef,
} from '@/types';

type Lens = 'structure' | 'flow' | 'risk' | 'state' | 'connections';
type ViewMode = 'graph' | 'tutor';

interface GraphState {
  project: Project | null;
  selectedNodeId: string | null;
  focusedParentId: string | null;
  lens: Lens;
  viewMode: ViewMode;
  pendingSuggestions: {
    parentId: string;
    nodes: Array<{
      tempId: string;
      data: Omit<ConceptNodeData, 'id' | 'parentId' | 'history'> & { tempId: string };
    }>;
    edges: Array<{ sourceTempId: string; targetTempId: string; kind: ConceptEdgeData['kind'] }>;
    // tempId → realId dos nós já aceitos neste batch. Necessário para
    // materializar uma edge entre dois nós aceitos um a um — só dá pra criar
    // a edge real quando ambos os endpoints já têm id real.
    acceptedMap?: Record<string, string>;
  } | null;

  createProjectFromPlan: (objective: string, name: string, plan: AIPlan) => void;
  selectNode: (id: string | null) => void;
  focusNode: (id: string | null) => void;
  setLens: (lens: Lens) => void;
  setViewMode: (mode: ViewMode) => void;
  updateNode: (id: string, patch: Partial<ConceptNodeData>) => void;
  updateNodePosition: (id: string, pos: { x: number; y: number }) => void;
  deleteNode: (id: string) => void;
  addManualHistory: (id: string, message: string) => void;

  confirmNode: (id: string) => void;
  unconfirmNode: (id: string) => void;
  pickDecisionOption: (nodeId: string, optionId: string) => void;
  setNodeExplanation: (id: string, text: string) => void;

  // Ground truth — rompe o loop IA→IA
  setUserCriterion: (id: string, text: string) => void; // attack (a) — trava após setar
  setCritica: (id: string, critica: AdversarialCritique) => void; // attack (b)
  clearCritica: (id: string) => void;
  addGroundTruthRef: (
    id: string,
    ref: Omit<GroundTruthRef, 'id' | 'addedAt'>,
  ) => void; // attack (d)
  toggleGroundTruthVerified: (id: string, refId: string) => void;
  removeGroundTruthRef: (id: string, refId: string) => void;
  reportFailure: (id: string, context: string) => void; // attack (c)
  clearFailure: (id: string) => void;

  stageSuggestions: (
    parentId: string,
    nodes: Array<Omit<ConceptNodeData, 'id' | 'parentId' | 'history'> & { tempId: string }>,
    edges: Array<{ sourceTempId: string; targetTempId: string; kind: ConceptEdgeData['kind'] }>,
  ) => void;
  acceptSuggestion: (tempId: string) => void;
  acceptAllSuggestions: () => void;
  rejectSuggestion: (tempId: string) => void;
  rejectAllSuggestions: () => void;

  resetProject: () => void;
}

const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet(name)) ?? null,
  setItem: async (name, value) => {
    await idbSet(name, value);
  },
  removeItem: async (name) => {
    await idbDel(name);
  },
};

const now = () => Date.now();

const historyEntry = (kind: HistoryEntry['kind'], message: string): HistoryEntry => ({
  id: nanoid(8),
  timestamp: now(),
  kind,
  message,
});

const addHistory = (
  node: ConceptNodeData,
  kind: HistoryEntry['kind'],
  message: string,
): ConceptNodeData => ({
  ...node,
  history: [...node.history, historyEntry(kind, message)],
});

// Converte hints da IA em refs verificáveis (addedByAI=true, verificado=false).
// O usuário passa cada uma para `verificado=true` manualmente via toggle.
function hintsToRefs(
  hints: { kind: GroundTruthRef['kind']; label: string; value: string }[] | undefined,
): GroundTruthRef[] | undefined {
  if (!hints || hints.length === 0) return undefined;
  return hints.map((h) => ({
    id: nanoid(8),
    kind: h.kind,
    label: h.label,
    value: h.value,
    verificado: false,
    addedAt: now(),
    addedByAI: true,
  }));
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

const ROOT_POS = { x: 0, y: 0 };
const CATEGORY_Y = 220;
const LEAF_Y = 440;
const COL_W = 280;

function layoutFromPlan(plan: AIPlan, rootId: string) {
  // Positions for categorias + leaves.
  // Categorias distribuídas horizontalmente abaixo do root.
  // Leaves de cada categoria distribuídas em coluna vertical abaixo da própria categoria.
  const categoriaCount = plan.tree.categorias.length;
  const totalW = (categoriaCount - 1) * 480;

  const categoriaPositions: Record<string, { x: number; y: number }> = {};
  const leafPositions: Record<string, { x: number; y: number }> = {};

  plan.tree.categorias.forEach((cat, i) => {
    const cx = -totalW / 2 + i * 480;
    categoriaPositions[cat.tempId] = { x: cx, y: CATEGORY_Y };

    const leafCount = cat.children.length;
    cat.children.forEach((child, j) => {
      const offset = (j - (leafCount - 1) / 2) * COL_W;
      leafPositions[child.tempId] = { x: cx + offset, y: LEAF_Y };
    });
  });

  void rootId;
  return { categoriaPositions, leafPositions };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGraphStore = create<GraphState>()(
  persist(
    (set, get) => ({
      project: null,
      selectedNodeId: null,
      focusedParentId: null,
      lens: 'structure',
      viewMode: 'tutor',
      pendingSuggestions: null,

      createProjectFromPlan: (objective, name, plan) => {
        const rootId = nanoid(10);
        const root: ConceptNodeData = {
          id: rootId,
          parentId: null,
          kind: 'root',
          name: name || 'Projeto',
          fx: objective,
          problem: 'Objetivo global do projeto',
          confidence: 100,
          confidenceSource: 'ai',
          confidenceReason: 'Dado pelo usuário',
          pros: [],
          cons: [],
          oQue: objective,
          porQue: plan.pitch,
          comoConfirmar: 'Todas as etapas de recursos e execução confirmadas.',
          confirmado: false,
          order: 0,
          state: 'validated',
          notes: plan.approach,
          history: [historyEntry('created', `Projeto criado a partir de "${plan.title}"`)],
          aiSuggested: false,
          position: ROOT_POS,
        };

        const nodes: Record<string, ConceptNodeData> = { [rootId]: root };
        const edges: Record<string, ConceptEdgeData> = {};
        const { categoriaPositions, leafPositions } = layoutFromPlan(plan, rootId);

        plan.tree.categorias.forEach((cat, catIdx) => {
          const catId = nanoid(10);
          nodes[catId] = {
            id: catId,
            parentId: rootId,
            kind: 'categoria',
            name: cat.name,
            fx: `categoria: ${cat.name.toLowerCase()}`,
            problem: cat.porQue,
            confidence: 100,
            confidenceSource: 'ai',
            confidenceReason: 'Eixo estrutural',
            pros: [],
            cons: [],
            oQue: cat.oQue,
            porQue: cat.porQue,
            comoConfirmar: 'Todos os itens desta categoria confirmados.',
            confirmado: false,
            order: catIdx,
            state: 'validated',
            notes: '',
            history: [historyEntry('created', `Categoria criada: ${cat.name}`)],
            aiSuggested: false,
            position: categoriaPositions[cat.tempId] ?? { x: 0, y: CATEGORY_Y },
          };

          const rootToCatEdgeId = nanoid(10);
          edges[rootToCatEdgeId] = {
            id: rootToCatEdgeId,
            source: rootId,
            target: catId,
            kind: 'direct',
          };

          cat.children.forEach((child, childIdx) => {
            const leafId = nanoid(10);
            nodes[leafId] = {
              id: leafId,
              parentId: catId,
              kind: child.kind,
              name: child.name,
              fx: child.fx,
              problem: child.problem,
              confidence: child.confidence,
              confidenceSource: 'ai',
              confidenceReason: child.confidenceReason,
              pros: child.pros,
              cons: child.cons,
              oQue: child.oQue,
              porQue: child.porQue,
              comoConfirmar: child.comoConfirmar,
              confirmado: false,
              order: child.order ?? childIdx,
              decisionOptions: child.decisionOptions,
              groundTruthRefs: hintsToRefs(child.groundTruthHints),
              state: 'concept',
              notes: '',
              history: [historyEntry('created', `Gerado no plano "${plan.title}"`)],
              aiSuggested: false,
              position: leafPositions[child.tempId] ?? { x: 0, y: LEAF_Y },
            };

            const catToLeafEdgeId = nanoid(10);
            edges[catToLeafEdgeId] = {
              id: catToLeafEdgeId,
              source: catId,
              target: leafId,
              kind: 'direct',
            };
          });
        });

        const project: Project = {
          id: nanoid(10),
          name: name || 'Projeto',
          objective,
          createdAt: now(),
          updatedAt: now(),
          nodes,
          edges,
          rootId,
        };

        set({
          project,
          selectedNodeId: rootId,
          focusedParentId: rootId,
          pendingSuggestions: null,
          viewMode: 'tutor',
        });
      },

      selectNode: (id) => set({ selectedNodeId: id }),
      focusNode: (id) => set({ focusedParentId: id }),
      setLens: (lens) => set({ lens }),
      setViewMode: (mode) => set({ viewMode: mode }),

      updateNode: (id, patch) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          let next = { ...prev, ...patch } as ConceptNodeData;
          if (patch.confidence !== undefined && patch.confidence !== prev.confidence) {
            next = addHistory(
              next,
              'confidence',
              `Confiança: ${prev.confidence}% → ${patch.confidence}%`,
            );
          }
          if (patch.state !== undefined && patch.state !== prev.state) {
            next = addHistory(next, 'state', `Estado: ${prev.state} → ${patch.state}`);
          }
          if (patch.name !== undefined && patch.name !== prev.name) {
            next = addHistory(next, 'rename', `Nome: "${prev.name}" → "${patch.name}"`);
          }
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      updateNodePosition: (id, pos) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          return {
            project: {
              ...state.project,
              nodes: { ...state.project.nodes, [id]: { ...prev, position: pos } },
            },
          };
        }),

      deleteNode: (id) =>
        set((state) => {
          if (!state.project || id === state.project.rootId) return state;
          const toRemove = new Set<string>();
          const collect = (nid: string) => {
            toRemove.add(nid);
            Object.values(state.project!.nodes)
              .filter((n) => n.parentId === nid)
              .forEach((c) => collect(c.id));
          };
          collect(id);
          const nodes = Object.fromEntries(
            Object.entries(state.project.nodes).filter(([k]) => !toRemove.has(k)),
          );
          const edges = Object.fromEntries(
            Object.entries(state.project.edges).filter(
              ([, e]) => !toRemove.has(e.source) && !toRemove.has(e.target),
            ),
          );
          return {
            project: { ...state.project, updatedAt: now(), nodes, edges },
            selectedNodeId:
              toRemove.has(state.selectedNodeId ?? '') ? state.project.rootId : state.selectedNodeId,
          };
        }),

      addManualHistory: (id, message) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          const next = addHistory(prev, 'manual', message);
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      confirmNode: (id) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          let next = {
            ...prev,
            confirmado: true,
            state: 'done' as NodeState,
          };
          next = addHistory(next, 'confirmed', `Confirmado: "${prev.name}"`);
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      unconfirmNode: (id) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          let next = {
            ...prev,
            confirmado: false,
            state: 'concept' as NodeState,
          };
          next = addHistory(next, 'unconfirmed', `Desconfirmado: "${prev.name}"`);
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      pickDecisionOption: (nodeId, optionId) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[nodeId];
          if (!prev) return state;
          const opt = prev.decisionOptions?.find((o) => o.id === optionId);
          if (!opt) return state;
          const next: ConceptNodeData = addHistory(
            {
              ...prev,
              decisionPickedId: optionId,
              confirmado: true,
              state: 'done',
            },
            'decision',
            `Escolha: "${opt.label}"`,
          );
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [nodeId]: next },
            },
          };
        }),

      setNodeExplanation: (id, text) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          const next: ConceptNodeData = { ...prev, explicacao: text };
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      setUserCriterion: (id, text) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          const trimmed = text.trim();
          if (!trimmed) return state;
          // Trava: se o usuário já escreveu e travou, não permite sobrescrever.
          // Esse é o ponto inteiro do attack (a) — impedir que o usuário copie
          // o comoConfirmar da IA retroativamente.
          if (prev.comoConfirmarUsuarioAt) return state;
          let next: ConceptNodeData = {
            ...prev,
            comoConfirmarUsuario: trimmed,
            comoConfirmarUsuarioAt: now(),
          };
          next = addHistory(
            next,
            'criterio_usuario',
            `Critério do usuário registrado (travado antes de ver o da IA).`,
          );
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      setCritica: (id, critica) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          const next = addHistory(
            { ...prev, critica },
            'critica',
            `Crítica adversarial registrada: ${critica.fraquezas.length} fraqueza(s).`,
          );
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      clearCritica: (id) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev || !prev.critica) return state;
          const { critica: _omit, ...rest } = prev;
          void _omit;
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: rest as ConceptNodeData },
            },
          };
        }),

      addGroundTruthRef: (id, ref) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          const full: GroundTruthRef = {
            ...ref,
            id: nanoid(8),
            addedAt: now(),
          };
          const refs = [...(prev.groundTruthRefs ?? []), full];
          const next = addHistory(
            { ...prev, groundTruthRefs: refs },
            'ground_truth',
            `Âncora ${ref.kind} adicionada: ${ref.label}`,
          );
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      toggleGroundTruthVerified: (id, refId) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev || !prev.groundTruthRefs) return state;
          let changedLabel = '';
          let nowVerified = false;
          const refs = prev.groundTruthRefs.map((r) => {
            if (r.id !== refId) return r;
            changedLabel = r.label;
            nowVerified = !r.verificado;
            return {
              ...r,
              verificado: nowVerified,
              verifiedAt: nowVerified ? now() : undefined,
            };
          });
          if (!changedLabel) return state;
          const next = addHistory(
            { ...prev, groundTruthRefs: refs },
            'ground_truth',
            `Âncora "${changedLabel}" ${nowVerified ? 'verificada ✓' : 'desverificada'}.`,
          );
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      removeGroundTruthRef: (id, refId) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev || !prev.groundTruthRefs) return state;
          const target = prev.groundTruthRefs.find((r) => r.id === refId);
          if (!target) return state;
          const refs = prev.groundTruthRefs.filter((r) => r.id !== refId);
          const next = addHistory(
            { ...prev, groundTruthRefs: refs },
            'ground_truth',
            `Âncora removida: ${target.label}`,
          );
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      reportFailure: (id, context) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          const trimmed = context.trim();
          if (!trimmed) return state;
          let next: ConceptNodeData = {
            ...prev,
            state: 'problem',
            failureContext: trimmed,
            failureReportedAt: now(),
            // Uma falha real invalida qualquer confirmação anterior.
            confirmado: false,
          };
          next = addHistory(next, 'failure', `Falha reportada: ${trimmed}`);
          if (prev.state !== 'problem') {
            next = addHistory(next, 'state', `Estado: ${prev.state} → problem`);
          }
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      clearFailure: (id) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          const { failureContext: _c, failureReportedAt: _a, ...rest } = prev;
          void _c;
          void _a;
          const next = addHistory(
            { ...rest, state: 'concept' } as ConceptNodeData,
            'replan',
            'Falha marcada como resolvida.',
          );
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      stageSuggestions: (parentId, nodes, edges) => {
        set({
          pendingSuggestions: {
            parentId,
            nodes: nodes.map((n) => ({ tempId: n.tempId, data: n })),
            edges,
          },
        });
      },

      acceptSuggestion: (tempId) => {
        const pending = get().pendingSuggestions;
        const project = get().project;
        if (!pending || !project) return;
        const target = pending.nodes.find((n) => n.tempId === tempId);
        if (!target) return;

        const id = nanoid(10);
        const { tempId: _tempIdIgnore, ...dataWithoutTemp } = target.data;
        void _tempIdIgnore;
        const node: ConceptNodeData = {
          ...dataWithoutTemp,
          id,
          parentId: pending.parentId,
          aiSuggested: false,
          history: [historyEntry('created', 'Sugestão AI aceita')],
        };

        const acceptedMap: Record<string, string> = {
          ...(pending.acceptedMap ?? {}),
          [tempId]: id,
        };

        const newEdges: Record<string, ConceptEdgeData> = {};

        // Edge parent → newChild — sempre criada.
        const parentEdgeId = nanoid(10);
        newEdges[parentEdgeId] = {
          id: parentEdgeId,
          source: pending.parentId,
          target: id,
          kind: 'direct',
        };

        // Edges entre nós já aceitos: materializar agora que os dois endpoints
        // têm id real. Edges com o outro endpoint ainda pendente ficam no
        // staging — é o que conserta o B1 (cadeia passo→passo perdida ao
        // aceitar um a um).
        const remainingPendingEdges: typeof pending.edges = [];
        for (const e of pending.edges) {
          const involvesThis = e.sourceTempId === tempId || e.targetTempId === tempId;
          if (!involvesThis) {
            remainingPendingEdges.push(e);
            continue;
          }
          const sourceReal = acceptedMap[e.sourceTempId];
          const targetReal = acceptedMap[e.targetTempId];
          if (sourceReal && targetReal) {
            const eid = nanoid(10);
            newEdges[eid] = {
              id: eid,
              source: sourceReal,
              target: targetReal,
              kind: e.kind,
            };
          } else {
            remainingPendingEdges.push(e);
          }
        }

        const remainingNodes = pending.nodes.filter((n) => n.tempId !== tempId);

        set({
          project: {
            ...project,
            updatedAt: now(),
            nodes: { ...project.nodes, [id]: node },
            edges: { ...project.edges, ...newEdges },
          },
          pendingSuggestions:
            remainingNodes.length === 0
              ? null
              : {
                  ...pending,
                  nodes: remainingNodes,
                  edges: remainingPendingEdges,
                  acceptedMap,
                },
        });
      },

      acceptAllSuggestions: () => {
        const pending = get().pendingSuggestions;
        const project = get().project;
        if (!pending || !project) return;

        const tempIdToRealId: Record<string, string> = {};
        const newNodes: Record<string, ConceptNodeData> = {};
        pending.nodes.forEach((n) => {
          const id = nanoid(10);
          tempIdToRealId[n.tempId] = id;
          const { tempId: _ignore, ...rest } = n.data;
          void _ignore;
          newNodes[id] = {
            ...rest,
            id,
            parentId: pending.parentId,
            aiSuggested: false,
            history: [historyEntry('created', 'Sugestão AI aceita (lote)')],
          };
        });

        const newEdges: Record<string, ConceptEdgeData> = {};
        pending.nodes.forEach((n) => {
          const id = nanoid(10);
          newEdges[id] = {
            id,
            source: pending.parentId,
            target: tempIdToRealId[n.tempId],
            kind: 'direct',
          };
        });
        pending.edges.forEach((e) => {
          const source = tempIdToRealId[e.sourceTempId];
          const target = tempIdToRealId[e.targetTempId];
          if (!source || !target) return;
          const id = nanoid(10);
          newEdges[id] = { id, source, target, kind: e.kind };
        });

        set({
          project: {
            ...project,
            updatedAt: now(),
            nodes: { ...project.nodes, ...newNodes },
            edges: { ...project.edges, ...newEdges },
          },
          pendingSuggestions: null,
        });
      },

      rejectSuggestion: (tempId) => {
        const pending = get().pendingSuggestions;
        if (!pending) return;
        const remaining = pending.nodes.filter((n) => n.tempId !== tempId);
        if (remaining.length === 0) {
          set({ pendingSuggestions: null });
        } else {
          set({
            pendingSuggestions: {
              ...pending,
              nodes: remaining,
              edges: pending.edges.filter(
                (e) => e.sourceTempId !== tempId && e.targetTempId !== tempId,
              ),
            },
          });
        }
      },

      rejectAllSuggestions: () => set({ pendingSuggestions: null }),

      resetProject: () =>
        set({
          project: null,
          selectedNodeId: null,
          focusedParentId: null,
          pendingSuggestions: null,
          lens: 'structure',
          viewMode: 'tutor',
        }),
    }),
    {
      name: 'cellproject-graph',
      version: 3, // v3: ground-truth fields (userCriterion, critica, refs, failure)
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        project: state.project,
        selectedNodeId: state.selectedNodeId,
        focusedParentId: state.focusedParentId,
        lens: state.lens,
        viewMode: state.viewMode,
      }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const breadcrumbFor = (
  project: Project | null,
  nodeId: string | null,
): ConceptNodeData[] => {
  if (!project || !nodeId) return [];
  const chain: ConceptNodeData[] = [];
  let cur: ConceptNodeData | undefined = project.nodes[nodeId];
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? project.nodes[cur.parentId] : undefined;
  }
  return chain;
};

export const confidenceBand = (confidence: number): 'high' | 'mid' | 'low' => {
  if (confidence >= 70) return 'high';
  if (confidence >= 40) return 'mid';
  return 'low';
};

/**
 * A passo is "blocked" when any earlier passo under the same categoria is not
 * yet confirmed. Applies only to kind=passo.
 */
export const isBlocked = (project: Project | null, nodeId: string): boolean => {
  if (!project) return false;
  const node = project.nodes[nodeId];
  if (!node || node.kind !== 'passo') return false;
  const siblings = Object.values(project.nodes)
    .filter((n) => n.parentId === node.parentId && n.kind === 'passo')
    .sort((a, b) => a.order - b.order);
  for (const s of siblings) {
    if (s.id === node.id) return false;
    if (!s.confirmado) return true;
  }
  return false;
};

export const projectProgress = (project: Project | null) => {
  if (!project) return { total: 0, done: 0, percent: 0 };
  const leaves = Object.values(project.nodes).filter(
    (n) => n.kind === 'recurso' || n.kind === 'passo',
  );
  const total = leaves.length;
  const done = leaves.filter((n) => n.confirmado).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
};

/**
 * Next pending in tutor flow:
 *  1. First unconfirmed recurso (any).
 *  2. Otherwise first unconfirmed passo across Execução categorias, respecting
 *     sequencing within each categoria.
 *  3. null when everything is done.
 */
export const nextPendingForTutor = (project: Project | null): ConceptNodeData | null => {
  if (!project) return null;
  const nodes = Object.values(project.nodes);
  const unconfirmedRecurso = nodes.find(
    (n) => n.kind === 'recurso' && !n.confirmado,
  );
  if (unconfirmedRecurso) return unconfirmedRecurso;

  // Group passos by parent, pick first unconfirmed from each in order
  const passosByParent = new Map<string, ConceptNodeData[]>();
  nodes
    .filter((n) => n.kind === 'passo')
    .forEach((n) => {
      const arr = passosByParent.get(n.parentId!) ?? [];
      arr.push(n);
      passosByParent.set(n.parentId!, arr);
    });

  for (const [, arr] of passosByParent) {
    arr.sort((a, b) => a.order - b.order);
    const next = arr.find((p) => !p.confirmado);
    if (next) return next;
  }
  return null;
};

export const projectMetrics = (project: Project | null) => {
  if (!project) return null;
  const nodes = Object.values(project.nodes);
  const confSum = nodes.reduce((a, n) => a + n.confidence, 0);
  const avgConf = nodes.length ? Math.round(confSum / nodes.length) : 0;
  const incomplete = nodes.filter((n) => n.state === 'concept' && n.confidence < 70).length;
  const atRisk = nodes.filter((n) => n.confidence < 40).length;
  const progress = projectProgress(project);
  return {
    nodeCount: nodes.length,
    edgeCount: Object.keys(project.edges).length,
    avgConfidence: avgConf,
    incomplete,
    atRisk,
    progress,
  };
};

export type { Lens, ViewMode, NodeState, NodeKind };
