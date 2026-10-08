import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { nanoid } from 'nanoid';
import type {
  Project,
  ConceptNodeData,
  ConceptEdgeData,
  AIPlan,
  AISuggestedNode,
  NodeState,
  NodeKind,
  HistoryEntry,
  AdversarialCritique,
  GroundTruthRef,
  WebResearchDigest,
} from '@/types';
import { t } from '@/i18n';
import { buildDemoProject, DEMO_PROJECT_ID } from '@/data/demoProject';

type Lens = 'structure' | 'flow' | 'risk' | 'state' | 'connections';
type ViewMode = 'graph' | 'tutor';

// Rascunhos por nó (critério, aferição, falha): sobrevivem a reload e à troca
// de card. Limpos automaticamente quando a ação correspondente é gravada.
export type DraftField = 'criterion' | 'met' | 'failure';
export type NodeDrafts = Partial<Record<DraftField, string>>;

// Rascunho da tela de objetivo — o usuário não perde planos gerados (e pagos)
// se recarregar a página no meio da escolha.
export interface ObjectiveDraft {
  name: string;
  objective: string;
  rules: string[];
  ruleDraft: string;
  plans: AIPlan[] | null;
  plansFor: { objective: string; rules: string[] } | null;
  selectedId: string | null;
  generatingSince: number | null;
  updatedAt: number;
}

export const EMPTY_OBJECTIVE_DRAFT: ObjectiveDraft = {
  name: '',
  objective: '',
  rules: [],
  ruleDraft: '',
  plans: null,
  plansFor: null,
  selectedId: null,
  generatingSince: null,
  updatedAt: 0,
};

// Última ação desfazível sobre um nó. `afterHistoryId` é a entrada que a ação
// gravou: se o nó mudou depois (nova entrada), o desfazer fica obsoleto.
export interface LastAction {
  nodeId: string;
  kind: 'confirm' | 'known' | 'pick';
  prevSnapshot: ConceptNodeData;
  afterHistoryId: string;
  at: number;
}

// Chamadas de IA em andamento por nó — no store para o estado de carregamento
// sobreviver à remontagem do card (troca de nó, troca de view). Não persiste:
// um reload mata a requisição.
export type AIJobKind = 'explain' | 'decompose' | 'replan' | 'research' | 'critique';
export interface AIJob {
  kind: AIJobKind;
  startedAt: number;
}

export type ImportResult = { ok: true } | { ok: false; error: string };

export interface GraphState {
  project: Project | null;
  selectedNodeId: string | null;
  // Bumped on every selectNode call (even for the same id) so surfaces like
  // the mobile detail sheet can re-open when the user taps the node again.
  selectionVersion: number;
  focusedParentId: string | null;
  // Incrementado em todo focusNode — o GraphCanvas enquadra a subárvore.
  focusVersion: number;
  // Pedido de centralização no grafo (GraphCanvas consome por `version`).
  centerRequest: { nodeId: string; version: number } | null;
  // Último nó que o tutor mostrou: ao ir pro grafo sem seleção, é ele que abre.
  lastTutorNodeId: string | null;
  lens: Lens;
  viewMode: ViewMode;
  // Desktop detail panel collapsed to a thin rail → the graph gets the room.
  detailPanelOpen: boolean;
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
  drafts: Record<string, NodeDrafts>;
  objectiveDraft: ObjectiveDraft;
  lastAction: LastAction | null;
  aiJobs: Record<string, AIJob>;
  // Projeto arquivado pelo último reset/import — permite desfazer.
  archivedProject: Project | null;

  createProjectFromPlan: (
    objective: string,
    name: string,
    plan: AIPlan,
    rules?: string[],
    alternatives?: AIPlan[],
  ) => void;
  loadDemoProject: () => void;
  addRule: (text: string) => void;
  removeRule: (text: string) => void;
  selectNode: (id: string | null) => void;
  focusNode: (id: string | null) => void;
  setLens: (lens: Lens) => void;
  setViewMode: (mode: ViewMode) => void;
  setDetailPanelOpen: (open: boolean) => void;
  // opts.commit: fim de uma edição (blur/Enter) — grava o histórico 'edit' de
  // oQue/porQue com o valor anterior à edição inteira. Renames são agrupados
  // numa única entrada por nó (janela de 5s, ou até o commit).
  updateNode: (id: string, patch: Partial<ConceptNodeData>, opts?: { commit?: boolean }) => void;
  updateNodePosition: (id: string, pos: { x: number; y: number }) => void;
  applyLayoutPositions: (positions: Record<string, { x: number; y: number }>) => void;
  deleteNode: (id: string) => void;
  addManualHistory: (id: string, message: string) => void;

  confirmNode: (id: string, opts?: { force?: boolean }) => void;
  unconfirmNode: (id: string) => void;
  toggleTakenAsKnown: (id: string) => void; // recursion floor: axiom / "already known"
  pickDecisionOption: (nodeId: string, optionId: string) => void;
  setNodeExplanation: (id: string, text: string) => void;

  // Ground truth — breaks the AI→AI loop
  setUserCriterion: (id: string, text: string) => void; // attack (a) — locks after setting
  // Arrependimento curto: destrava o critério só nos primeiros 10s e só antes
  // de aferido. O texto volta pro rascunho para o usuário seguir editando.
  unlockCriterion: (id: string) => boolean;
  attestCriterion: (id: string, observacao: string) => void; // attack (a) — attest the criterion is MET
  setCritica: (id: string, critica: AdversarialCritique) => void; // attack (b)
  clearCritica: (id: string) => void;
  addGroundTruthRef: (
    id: string,
    ref: Omit<GroundTruthRef, 'id' | 'addedAt'>,
  ) => void; // attack (d)
  // Alterna verificado. Para âncoras da IA, verificar por aqui NÃO conta como
  // sinal (falta a observação) — o caminho certo é verifyGroundTruthRef.
  toggleGroundTruthVerified: (id: string, refId: string) => void;
  // Verifica COM o que o usuário conferiu. Âncora da IA só vira sinal assim.
  verifyGroundTruthRef: (id: string, refId: string, observacao: string) => void;
  // Registra que o usuário abriu o link (pré-condição de UI, não prova).
  markRefOpened: (id: string, refId: string) => void;
  removeGroundTruthRef: (id: string, refId: string) => void;
  // Pesquisa web da célula: persiste o digest e converte cada fonte nova em
  // âncora kind="link" (addedByAI, não verificada — verificar continua sendo
  // ato do usuário).
  applyWebResearch: (id: string, digest: WebResearchDigest) => void;
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

  setDraft: (nodeId: string, field: DraftField, value: string) => void;
  clearDraft: (nodeId: string, field?: DraftField) => void;
  setObjectiveDraft: (partial: Partial<Omit<ObjectiveDraft, 'updatedAt'>>) => void;
  clearObjectiveDraft: () => void;

  // Desfaz confirmar / já sei / escolher. Retorna false se não havia o que
  // desfazer (ou o nó mudou depois da ação).
  undoLastAction: () => boolean;
  startAIJob: (nodeId: string, kind: AIJobKind) => void;
  endAIJob: (nodeId: string) => void;
  setLastTutorNode: (id: string | null) => void;
  requestCenter: (nodeId: string) => void;

  // Arquiva o projeto atual (desfazível via undoReset) e volta à tela inicial.
  resetProject: () => void;
  undoReset: () => boolean;
  // Aceita o JSON exportado (string ou objeto). Arquiva o projeto atual.
  importProject: (json: unknown) => ImportResult;
}

// ---------------------------------------------------------------------------
// Persistência com debounce: o persist serializa o projeto inteiro a cada set
// (cada tecla num campo). Agrupamos as escritas em 500ms e descarregamos ao
// esconder/fechar a aba para não perder a última edição.
// ---------------------------------------------------------------------------

const WRITE_DEBOUNCE_MS = 500;
const pendingWrites = new Map<string, string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

export async function flushGraphPersistence(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const entries = [...pendingWrites.entries()];
  pendingWrites.clear();
  await Promise.all(entries.map(([name, value]) => idbSet(name, value)));
}

const idbStorage: StateStorage = {
  getItem: async (name) => pendingWrites.get(name) ?? (await idbGet(name)) ?? null,
  setItem: (name, value) => {
    pendingWrites.set(name, value);
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      void flushGraphPersistence();
    }, WRITE_DEBOUNCE_MS);
  },
  removeItem: async (name) => {
    pendingWrites.delete(name);
    await idbDel(name);
  },
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushGraphPersistence();
  });
  window.addEventListener('pagehide', () => {
    void flushGraphPersistence();
  });
}

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
  extra?: Pick<HistoryEntry, 'field' | 'prevValue'>,
): ConceptNodeData => ({
  ...node,
  history: [...node.history, { ...historyEntry(kind, message), ...extra }],
});

const putNode = (project: Project, node: ConceptNodeData): Project => ({
  ...project,
  updatedAt: now(),
  nodes: { ...project.nodes, [node.id]: node },
});

const lastHistoryId = (node: ConceptNodeData): string =>
  node.history[node.history.length - 1]?.id ?? '';

const stateLabel = (s: NodeState): string => t().store.stateLabels[s] ?? s;

const withoutDraft = (
  drafts: Record<string, NodeDrafts>,
  nodeId: string,
  field?: DraftField,
): Record<string, NodeDrafts> => {
  const cur = drafts[nodeId];
  if (!cur) return drafts;
  const next = { ...drafts };
  if (!field) {
    delete next[nodeId];
    return next;
  }
  if (!(field in cur)) return drafts;
  const rest: NodeDrafts = { ...cur };
  delete rest[field];
  if (Object.keys(rest).length === 0) delete next[nodeId];
  else next[nodeId] = rest;
  return next;
};

// Projetos de demonstração não vão pro arquivo: sair da demo não pode
// sobrescrever o projeto real arquivado.
const archiveCandidate = (current: Project | null, archived: Project | null): Project | null =>
  current && current.id !== DEMO_PROJECT_ID ? current : archived;

// Estado efêmero que pertence ao projeto aberto — zerado ao trocar de projeto.
const freshProjectSession = () => ({
  pendingSuggestions: null,
  drafts: {},
  lastAction: null,
  aiJobs: {},
  lastTutorNodeId: null,
  centerRequest: null,
});

// Baselines de edição em curso (não persistidas): permitem registrar o valor
// ANTERIOR à edição inteira, não o da última tecla.
const RENAME_MERGE_MS = 5000;
const renameBaselines = new Map<string, { from: string; entryId: string; at: number }>();
const editBaselines = new Map<string, string>();
const EDIT_FIELDS = ['oQue', 'porQue'] as const;

const CRITERION_UNLOCK_MS = 10_000;

// Promoção tardia: um nó confirmado sem prova vira 'done' assim que a prova
// chega (critério aferido, âncora verificada) — o progresso sai do amarelo.
function promoteIfEarned(project: Project, nodeId: string): Project {
  const node = project.nodes[nodeId];
  if (!node || !node.confirmado || !node.confirmedWithoutSignal) return project;
  if (!canConcludeNode(project, nodeId).ready) return project;
  const next = addHistory(
    { ...node, state: 'done', confirmedWithoutSignal: false },
    'state',
    t().store.promotedWithProof,
  );
  return putNode(project, next);
}

// Aplica o tidy tree a um projeto (posições são apresentação: sem histórico).
function withTreeLayout(project: Project): Project {
  const positions = computeTreeLayout(project);
  const nodes = { ...project.nodes };
  for (const [id, pos] of Object.entries(positions)) {
    const prev = nodes[id];
    if (prev) nodes[id] = { ...prev, position: pos };
  }
  return { ...project, nodes };
}

// Valida o mínimo de um JSON exportado (rootId, nodes, edges) e normaliza os
// campos obrigatórios de cada nó — um export antigo ou editado à mão não pode
// derrubar a UI com `undefined.map`.
function parseImportedProject(json: unknown): Project | null {
  let raw: unknown = json;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Partial<Project>;
  if (typeof p.rootId !== 'string') return null;
  if (!p.nodes || typeof p.nodes !== 'object') return null;
  if (!p.edges || typeof p.edges !== 'object') return null;
  if (!p.nodes[p.rootId]) return null;

  const nodes: Record<string, ConceptNodeData> = {};
  for (const [id, n] of Object.entries(p.nodes)) {
    if (!n || typeof n !== 'object') return null;
    nodes[id] = {
      ...n,
      id,
      parentId: id === p.rootId ? null : (n.parentId ?? null),
      kind: n.kind ?? 'concept',
      name: typeof n.name === 'string' ? n.name : '',
      fx: n.fx ?? '',
      problem: n.problem ?? '',
      confidence: typeof n.confidence === 'number' ? n.confidence : 50,
      pros: Array.isArray(n.pros) ? n.pros : [],
      cons: Array.isArray(n.cons) ? n.cons : [],
      oQue: n.oQue ?? '',
      porQue: n.porQue ?? '',
      comoConfirmar: n.comoConfirmar ?? '',
      confirmado: Boolean(n.confirmado),
      order: typeof n.order === 'number' ? n.order : 0,
      state: n.state ?? 'concept',
      notes: n.notes ?? '',
      history: Array.isArray(n.history) ? n.history : [],
      aiSuggested: Boolean(n.aiSuggested),
      position:
        n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number'
          ? n.position
          : { x: 0, y: 0 },
    };
  }
  // Nó cujo pai não existe vira órfão invisível — pendura na raiz.
  for (const n of Object.values(nodes)) {
    if (n.id !== p.rootId && (!n.parentId || !nodes[n.parentId])) n.parentId = p.rootId;
  }
  const edges: Record<string, ConceptEdgeData> = {};
  for (const [id, e] of Object.entries(p.edges)) {
    if (!e || typeof e !== 'object' || !nodes[e.source] || !nodes[e.target]) continue;
    edges[id] = { ...e, id };
  }
  const root = nodes[p.rootId];
  return {
    ...p,
    id: typeof p.id === 'string' && p.id ? p.id : nanoid(10),
    name:
      typeof p.name === 'string' && p.name
        ? p.name
        : root.name || t().store.projectFallbackName,
    objective: typeof p.objective === 'string' ? p.objective : root.fx,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : now(),
    updatedAt: now(),
    rootId: p.rootId,
    nodes,
    edges,
  };
}

// Converts AI hints into verifiable refs (addedByAI=true, verificado=false).
// The user flips each one to `verificado=true` manually via toggle.
export function hintsToRefs(
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

// Maps an AI decompose/replan result into the staged-node shape consumed by
// stageSuggestions. One place for the mapping (tutor card, detail panel and
// the failure replan all stage the same way); children fan out below `base`.
export function buildStagedNodes(
  base: { position: { x: number; y: number } },
  nodes: AISuggestedNode[],
  opts?: { notes?: string },
): Array<Omit<ConceptNodeData, 'id' | 'parentId' | 'history'> & { tempId: string }> {
  // Mesma largura de slot do tidy tree — cards de 300px não se sobrepõem.
  const spacing = LAYOUT_X_GAP;
  const start = base.position.x - ((nodes.length - 1) * spacing) / 2;
  return nodes.map((n, i) => ({
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
    ruleConflict: n.ruleConflict,
    state: 'concept' as const,
    notes: opts?.notes ?? '',
    aiSuggested: true,
    position: { x: start + i * spacing, y: base.position.y + LAYOUT_Y_GAP },
  }));
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGraphStore = create<GraphState>()(
  persist(
    (set, get) => ({
      project: null,
      selectedNodeId: null,
      selectionVersion: 0,
      focusedParentId: null,
      focusVersion: 0,
      centerRequest: null,
      lastTutorNodeId: null,
      lens: 'structure',
      viewMode: 'tutor',
      detailPanelOpen: true,
      pendingSuggestions: null,
      drafts: {},
      objectiveDraft: EMPTY_OBJECTIVE_DRAFT,
      lastAction: null,
      aiJobs: {},
      archivedProject: null,

      createProjectFromPlan: (objective, name, plan, rules, alternatives) => {
        const tr = t();
        const cleanRules = (rules ?? []).map((r) => r.trim()).filter(Boolean);
        const projectName = name.trim() || tr.store.projectFallbackName;
        const rootId = nanoid(10);
        const root: ConceptNodeData = {
          id: rootId,
          parentId: null,
          kind: 'root',
          name: projectName,
          fx: objective,
          problem: tr.store.rootProblem,
          confidence: 100,
          confidenceSource: 'ai',
          confidenceReason: tr.store.rootConfidenceReason,
          pros: [],
          cons: [],
          oQue: objective,
          porQue: plan.pitch,
          comoConfirmar: tr.store.rootComoConfirmar,
          confirmado: false,
          order: 0,
          state: 'validated',
          notes: plan.approach,
          history: [historyEntry('created', tr.store.createdFromPlan(plan.title))],
          aiSuggested: false,
          position: { x: 0, y: 0 },
        };

        const nodes: Record<string, ConceptNodeData> = { [rootId]: root };
        const edges: Record<string, ConceptEdgeData> = {};

        plan.tree.categorias.forEach((cat, catIdx) => {
          const catId = nanoid(10);
          nodes[catId] = {
            id: catId,
            parentId: rootId,
            kind: 'categoria',
            name: cat.name,
            fx: tr.store.categoriaFx(cat.name.toLowerCase()),
            problem: cat.porQue,
            confidence: 100,
            confidenceSource: 'ai',
            confidenceReason: tr.store.categoriaConfidenceReason,
            pros: [],
            cons: [],
            oQue: cat.oQue,
            porQue: cat.porQue,
            comoConfirmar: tr.store.categoriaComoConfirmar,
            confirmado: false,
            order: catIdx,
            state: 'validated',
            notes: '',
            history: [historyEntry('created', tr.store.categoriaCreated(cat.name))],
            aiSuggested: false,
            position: { x: 0, y: 0 },
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
              ruleConflict: child.ruleConflict,
              state: 'concept',
              notes: '',
              history: [historyEntry('created', tr.store.generatedInPlan(plan.title))],
              aiSuggested: false,
              position: { x: 0, y: 0 },
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

        const others = (alternatives ?? []).filter((p) => p.id !== plan.id);
        const project: Project = withTreeLayout({
          id: nanoid(10),
          name: projectName,
          objective,
          createdAt: now(),
          updatedAt: now(),
          nodes,
          edges,
          rootId,
          rules: cleanRules.length > 0 ? cleanRules : undefined,
          constructionStrategy: plan.strategy,
          archetype: plan.archetype,
          alternativePlans: others.length > 0 ? others : undefined,
        });

        set({
          ...freshProjectSession(),
          project,
          selectedNodeId: rootId,
          focusedParentId: rootId,
          viewMode: 'tutor',
          objectiveDraft: EMPTY_OBJECTIVE_DRAFT,
        });
      },

      loadDemoProject: () => {
        const project = buildDemoProject();
        set({
          ...freshProjectSession(),
          project,
          selectedNodeId: project.rootId,
          focusedParentId: project.rootId,
          lens: 'structure',
          viewMode: 'graph',
        });
      },

      // Rules are the project's challenge boundaries — managed on the project,
      // audited on the root node's history.
      addRule: (text) =>
        set((state) => {
          if (!state.project) return state;
          const trimmed = text.trim();
          if (!trimmed) return state;
          const rules = state.project.rules ?? [];
          if (rules.includes(trimmed)) return state;
          const root = state.project.nodes[state.project.rootId];
          const nextRoot = root ? addHistory(root, 'manual', t().store.ruleAdded(trimmed)) : root;
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              rules: [...rules, trimmed],
              nodes: nextRoot
                ? { ...state.project.nodes, [nextRoot.id]: nextRoot }
                : state.project.nodes,
            },
          };
        }),

      removeRule: (text) =>
        set((state) => {
          if (!state.project || !state.project.rules?.includes(text)) return state;
          const rules = state.project.rules.filter((r) => r !== text);
          const root = state.project.nodes[state.project.rootId];
          const nextRoot = root ? addHistory(root, 'manual', t().store.ruleRemoved(text)) : root;
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              rules: rules.length > 0 ? rules : undefined,
              nodes: nextRoot
                ? { ...state.project.nodes, [nextRoot.id]: nextRoot }
                : state.project.nodes,
            },
          };
        }),

      selectNode: (id) =>
        set((s) => ({ selectedNodeId: id, selectionVersion: s.selectionVersion + 1 })),
      focusNode: (id) => set((s) => ({ focusedParentId: id, focusVersion: s.focusVersion + 1 })),
      setLens: (lens) => set({ lens }),
      // Ir pro grafo sem seleção útil (nada, nó apagado ou só a raiz) abre o
      // nó em que o usuário estava no tutor — ou o próximo pendente — em vez de
      // jogá-lo na raiz de um grafo grande.
      setViewMode: (mode) =>
        set((s) => {
          if (mode !== 'graph' || !s.project) return { viewMode: mode };
          const sel = s.selectedNodeId;
          const meaningful = sel && sel !== s.project.rootId && s.project.nodes[sel];
          if (meaningful) return { viewMode: mode };
          const fromTutor =
            s.lastTutorNodeId && s.project.nodes[s.lastTutorNodeId] ? s.lastTutorNodeId : null;
          const target = fromTutor ?? nextPendingForTutor(s.project)?.id ?? null;
          if (!target) return { viewMode: mode };
          return {
            viewMode: mode,
            selectedNodeId: target,
            centerRequest: { nodeId: target, version: (s.centerRequest?.version ?? 0) + 1 },
          };
        }),
      setDetailPanelOpen: (open) => set({ detailPanelOpen: open }),

      updateNode: (id, patch, opts) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          const commit = opts?.commit === true;
          let next = { ...prev, ...patch } as ConceptNodeData;
          if (patch.confidence !== undefined && patch.confidence !== prev.confidence) {
            next = addHistory(
              next,
              'confidence',
              t().store.confidenceChange(prev.confidence, patch.confidence),
            );
          }
          if (patch.state !== undefined && patch.state !== prev.state) {
            next = addHistory(
              next,
              'state',
              t().store.stateChange(stateLabel(prev.state), stateLabel(patch.state)),
            );
          }

          // Rename: uma entrada por "sessão" de digitação. Enquanto o último
          // registro for o rename desta sessão (e dentro de 5s), ele é
          // reescrito em vez de empilhar uma entrada por tecla.
          if (patch.name !== undefined && patch.name !== prev.name) {
            const base = renameBaselines.get(id);
            const last = next.history[next.history.length - 1];
            const canMerge =
              base && last && last.id === base.entryId && now() - base.at < RENAME_MERGE_MS;
            if (canMerge) {
              const history = next.history.slice(0, -1);
              if (patch.name === base.from) {
                // Voltou ao nome original: a sessão não mudou nada.
                next = { ...next, history };
                renameBaselines.delete(id);
              } else {
                const entry: HistoryEntry = {
                  ...last,
                  timestamp: now(),
                  message: t().store.renamed(base.from, patch.name),
                };
                next = { ...next, history: [...history, entry] };
                renameBaselines.set(id, { ...base, at: now() });
              }
            } else {
              next = addHistory(next, 'rename', t().store.renamed(prev.name, patch.name));
              renameBaselines.set(id, { from: prev.name, entryId: lastHistoryId(next), at: now() });
            }
          }
          if (commit) renameBaselines.delete(id);

          // Textos educacionais: o histórico guarda o valor de ANTES da edição
          // inteira, gravado só no commit (blur/Enter).
          for (const field of EDIT_FIELDS) {
            const key = `${id}:${field}`;
            const value = patch[field];
            if (value !== undefined && value !== prev[field] && !editBaselines.has(key)) {
              editBaselines.set(key, prev[field]);
            }
            if (!commit) continue;
            const before = editBaselines.get(key) ?? prev[field];
            editBaselines.delete(key);
            if (before !== next[field]) {
              next = addHistory(
                next,
                'edit',
                t().store.edited(t().store.fieldLabels[field], before),
                { field, prevValue: before },
              );
            }
          }

          return { project: putNode(state.project, next) };
        }),

      // Arrastar um nó é decisão de layout do usuário: daqui em diante o
      // layout automático não reposiciona mais a árvore.
      updateNodePosition: (id, pos) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          return {
            project: {
              ...state.project,
              manualLayout: true,
              nodes: { ...state.project.nodes, [id]: { ...prev, position: pos } },
            },
          };
        }),

      // One-shot bulk reposition (auto-layout). Single set, no history spam —
      // positions are presentation, not decisions worth auditing. Pedir o
      // layout automático devolve a árvore ao modo automático.
      applyLayoutPositions: (positions) =>
        set((state) => {
          if (!state.project) return state;
          const nodes = { ...state.project.nodes };
          for (const [id, pos] of Object.entries(positions)) {
            const prev = nodes[id];
            if (!prev) continue;
            nodes[id] = { ...prev, position: pos };
          }
          return { project: { ...state.project, updatedAt: now(), nodes, manualLayout: false } };
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
          let drafts = state.drafts;
          for (const rid of toRemove) drafts = withoutDraft(drafts, rid);
          return {
            project: { ...state.project, updatedAt: now(), nodes, edges },
            drafts,
            lastAction:
              state.lastAction && toRemove.has(state.lastAction.nodeId) ? null : state.lastAction,
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

      confirmNode: (id, opts) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          // Falha real em aberto: a realidade disse "não funciona". Nem o
          // force confirma — primeiro resolve a falha (clearFailure/replan).
          if (prev.failureContext) return state;
          // E2 gate: a node only earns state 'done' against REAL signal — a
          // criterion attested met (attack a) or a verified anchor (attack d).
          // Without signal it still advances (confirmado:true — never a hard
          // block) but stays 'validated' and is flagged, so the green 'done'
          // badge is reserved for nodes backed by ground truth. force:true is
          // the explicit, audited opt-out for "I'm sure, no anchor".
          const { ready, missing } = canConcludeNode(state.project, id);
          const earnsDone = ready || opts?.force === true;
          let next: ConceptNodeData = {
            ...prev,
            confirmado: true,
            state: earnsDone ? ('done' as NodeState) : ('validated' as NodeState),
            confirmedWithoutSignal: !earnsDone,
          };
          const message = ready
            ? t().store.confirmed(prev.name)
            : earnsDone
              ? t().store.confirmedForced(prev.name)
              : t().store.confirmedNoSignal(missing.join('; '), prev.name);
          next = addHistory(next, 'confirmed', message);
          return {
            project: putNode(state.project, next),
            lastAction: {
              nodeId: id,
              kind: 'confirm',
              prevSnapshot: prev,
              afterHistoryId: lastHistoryId(next),
              at: now(),
            },
          };
        }),

      unconfirmNode: (id) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          let next: ConceptNodeData = {
            ...prev,
            confirmado: false,
            state: 'concept' as NodeState,
            confirmedWithoutSignal: false,
          };
          next = addHistory(next, 'unconfirmed', t().store.unconfirmed(prev.name));
          return {
            project: {
              ...state.project,
              updatedAt: now(),
              nodes: { ...state.project.nodes, [id]: next },
            },
          };
        }),

      // Recursion floor: mark a node as a primitive/axiom or "already known" so
      // it stops being a thing to decompose. Counts as resolved (like
      // confirmado) for progress and sequencing. Toggle to reopen.
      toggleTakenAsKnown: (id) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          const nowKnown = !prev.takenAsKnown;
          const next = addHistory(
            { ...prev, takenAsKnown: nowKnown },
            'manual',
            nowKnown ? t().store.markedKnown(prev.name) : t().store.reopenedKnown(prev.name),
          );
          return {
            project: putNode(state.project, next),
            lastAction: {
              nodeId: id,
              kind: 'known',
              prevSnapshot: prev,
              afterHistoryId: lastHistoryId(next),
              at: now(),
            },
          };
        }),

      pickDecisionOption: (nodeId, optionId) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[nodeId];
          if (!prev) return state;
          // Mesmo gate do confirmNode: falha em aberto bloqueia a escolha.
          if (prev.failureContext) return state;
          const opt = prev.decisionOptions?.find((o) => o.id === optionId);
          if (!opt) return state;
          // A decision is a leaf too — earn 'done' only against real signal,
          // same gate as confirmNode. The pick is always recorded and advances.
          const { ready } = canConcludeNode(state.project, nodeId);
          const next: ConceptNodeData = addHistory(
            {
              ...prev,
              decisionPickedId: optionId,
              confirmado: true,
              state: ready ? ('done' as NodeState) : ('validated' as NodeState),
              confirmedWithoutSignal: !ready,
            },
            'decision',
            ready
              ? t().store.decisionPicked(opt.label)
              : t().store.decisionPickedNoSignal(opt.label),
          );
          return {
            project: putNode(state.project, next),
            lastAction: {
              nodeId,
              kind: 'pick',
              prevSnapshot: prev,
              afterHistoryId: lastHistoryId(next),
              at: now(),
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
          // Lock: if the user already wrote and locked, do not allow overwrite.
          // This is the whole point of attack (a) — prevent the user from
          // retroactively copying the AI's comoConfirmar.
          if (prev.comoConfirmarUsuarioAt) return state;
          let next: ConceptNodeData = {
            ...prev,
            comoConfirmarUsuario: trimmed,
            comoConfirmarUsuarioAt: now(),
          };
          next = addHistory(next, 'criterio_usuario', t().store.criterionLocked);
          return {
            project: putNode(state.project, next),
            drafts: withoutDraft(state.drafts, id, 'criterion'),
          };
        }),

      unlockCriterion: (id) => {
        const state = get();
        const prev = state.project?.nodes[id];
        if (!state.project || !prev || !prev.comoConfirmarUsuarioAt) return false;
        if (prev.comoConfirmarAtendido) return false;
        if (now() - prev.comoConfirmarUsuarioAt > CRITERION_UNLOCK_MS) return false;
        const text = prev.comoConfirmarUsuario ?? '';
        const rest: ConceptNodeData = { ...prev };
        delete rest.comoConfirmarUsuario;
        delete rest.comoConfirmarUsuarioAt;
        const next = addHistory(rest, 'criterio_usuario', t().store.criterionUnlocked);
        set({
          project: putNode(state.project, next),
          drafts: { ...state.drafts, [id]: { ...state.drafts[id], criterion: text } },
        });
        return true;
      },

      attestCriterion: (id, observacao) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          const obs = observacao.trim();
          // Reality confirms the node: requires a locked criterion first, plus
          // the user's observation of how they know it is MET. This — not a bare
          // locked criterion — is what earns 'done'.
          if (!prev.comoConfirmarUsuarioAt || !obs) return state;
          const next = addHistory(
            { ...prev, comoConfirmarAtendido: { observacao: obs, at: now() } },
            'criterio_usuario',
            t().store.criterionAttested(obs),
          );
          return {
            project: promoteIfEarned(putNode(state.project, next), id),
            drafts: withoutDraft(state.drafts, id, 'met'),
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
            t().store.critiqueRecorded(critica.fraquezas.length),
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
            t().store.anchorAdded(ref.kind, ref.label),
          );
          return {
            project: promoteIfEarned(putNode(state.project, next), id),
          };
        }),

      applyWebResearch: (id, digest) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev) return state;
          const existing = prev.groundTruthRefs ?? [];
          const known = new Set(existing.map((r) => r.value));
          const fresh: GroundTruthRef[] = digest.sources
            .filter((s) => !known.has(s.url))
            .map((s) => ({
              id: nanoid(8),
              kind: 'link',
              label: s.title,
              value: s.url,
              verificado: false,
              addedAt: now(),
              addedByAI: true,
            }));
          const next = addHistory(
            {
              ...prev,
              webResearch: digest,
              groundTruthRefs: fresh.length > 0 ? [...existing, ...fresh] : prev.groundTruthRefs,
            },
            'ground_truth',
            t().store.webResearchDone(fresh.length),
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
              // Desmarcar descarta a observação: verificar de novo pede outra.
              observacao: nowVerified ? r.observacao : undefined,
            };
          });
          if (!changedLabel) return state;
          const next = addHistory(
            { ...prev, groundTruthRefs: refs },
            'ground_truth',
            nowVerified
              ? t().store.anchorVerified(changedLabel)
              : t().store.anchorUnverified(changedLabel),
          );
          const project = putNode(state.project, next);
          return { project: nowVerified ? promoteIfEarned(project, id) : project };
        }),

      verifyGroundTruthRef: (id, refId, observacao) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev || !prev.groundTruthRefs) return state;
          const target = prev.groundTruthRefs.find((r) => r.id === refId);
          if (!target) return state;
          const obs = observacao.trim();
          // Âncora da IA sem observação não é prova — recusa em vez de gravar
          // um "verificado" que não conta.
          if (target.addedByAI && !obs) return state;
          const refs = prev.groundTruthRefs.map((r) =>
            r.id === refId
              ? { ...r, verificado: true, verifiedAt: now(), observacao: obs || undefined }
              : r,
          );
          const next = addHistory(
            { ...prev, groundTruthRefs: refs },
            'ground_truth',
            obs
              ? t().store.anchorVerifiedWithObs(target.label, obs)
              : t().store.anchorVerified(target.label),
          );
          return { project: promoteIfEarned(putNode(state.project, next), id) };
        }),

      markRefOpened: (id, refId) =>
        set((state) => {
          if (!state.project) return state;
          const prev = state.project.nodes[id];
          if (!prev || !prev.groundTruthRefs) return state;
          if (!prev.groundTruthRefs.some((r) => r.id === refId)) return state;
          const refs = prev.groundTruthRefs.map((r) =>
            r.id === refId ? { ...r, openedAt: now() } : r,
          );
          return { project: putNode(state.project, { ...prev, groundTruthRefs: refs }) };
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
            t().store.anchorRemoved(target.label),
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
            // A real failure invalidates any prior confirmation.
            confirmado: false,
            confirmedWithoutSignal: false,
          };
          next = addHistory(next, 'failure', t().store.failureReported(trimmed));
          if (prev.state !== 'problem') {
            next = addHistory(
              next,
              'state',
              t().store.stateChange(stateLabel(prev.state), stateLabel('problem')),
            );
          }
          return {
            project: putNode(state.project, next),
            drafts: withoutDraft(state.drafts, id, 'failure'),
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
          // Restore the state the node legitimately earned instead of always
          // dropping to 'concept' (which silently discarded a prior anchored
          // 'done' even though its locked criterion / verified anchor survived).
          // O gate é avaliado já SEM a falha (ela bloquearia por si só).
          const cleared = { ...rest } as ConceptNodeData;
          const { ready } = canConcludeNode(putNode(state.project, cleared), id);
          const restored: ConceptNodeData = ready
            ? { ...cleared, state: 'done', confirmado: true, confirmedWithoutSignal: false }
            : { ...cleared, state: 'concept', confirmado: false };
          const next = addHistory(restored, 'replan', t().store.failureCleared);
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
          history: [historyEntry('created', t().store.suggestionAccepted)],
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

        // Edges between already-accepted nodes: materialize now that both
        // endpoints have real ids. Edges with the other endpoint still
        // pending stay in staging — that's what fixes the step→step chain
        // being lost when accepting one at a time.
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

        const merged: Project = {
          ...project,
          updatedAt: now(),
          nodes: { ...project.nodes, [id]: node },
          edges: { ...project.edges, ...newEdges },
        };
        set({
          project: merged.manualLayout === true ? merged : withTreeLayout(merged),
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
            history: [historyEntry('created', t().store.suggestionAcceptedBatch)],
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

        const merged: Project = {
          ...project,
          updatedAt: now(),
          nodes: { ...project.nodes, ...newNodes },
          edges: { ...project.edges, ...newEdges },
        };
        set({
          project: merged.manualLayout === true ? merged : withTreeLayout(merged),
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

      setDraft: (nodeId, field, value) =>
        set((state) => {
          // Rascunho vazio = sem rascunho (não acumula chaves mortas).
          if (!value.trim()) return { drafts: withoutDraft(state.drafts, nodeId, field) };
          return {
            drafts: { ...state.drafts, [nodeId]: { ...state.drafts[nodeId], [field]: value } },
          };
        }),

      clearDraft: (nodeId, field) =>
        set((state) => ({ drafts: withoutDraft(state.drafts, nodeId, field) })),

      setObjectiveDraft: (partial) =>
        set((state) => ({
          objectiveDraft: { ...state.objectiveDraft, ...partial, updatedAt: now() },
        })),

      clearObjectiveDraft: () => set({ objectiveDraft: EMPTY_OBJECTIVE_DRAFT }),

      undoLastAction: () => {
        const { lastAction, project } = get();
        if (!lastAction || !project) return false;
        const current = project.nodes[lastAction.nodeId];
        // Obsoleto: o nó sumiu ou mudou depois da ação (outra entrada no
        // histórico) — restaurar o snapshot apagaria esse trabalho.
        if (!current || lastHistoryId(current) !== lastAction.afterHistoryId) {
          set({ lastAction: null });
          return false;
        }
        const restored = addHistory(
          lastAction.prevSnapshot,
          'manual',
          t().store.undone(current.name),
        );
        set({ project: putNode(project, restored), lastAction: null });
        get().selectNode(lastAction.nodeId);
        return true;
      },

      startAIJob: (nodeId, kind) =>
        set((state) => ({ aiJobs: { ...state.aiJobs, [nodeId]: { kind, startedAt: now() } } })),

      endAIJob: (nodeId) =>
        set((state) => {
          if (!state.aiJobs[nodeId]) return state;
          const aiJobs = { ...state.aiJobs };
          delete aiJobs[nodeId];
          return { aiJobs };
        }),

      setLastTutorNode: (id) => set({ lastTutorNodeId: id }),

      requestCenter: (nodeId) =>
        set((state) => ({
          centerRequest: { nodeId, version: (state.centerRequest?.version ?? 0) + 1 },
        })),

      resetProject: () =>
        set((state) => ({
          ...freshProjectSession(),
          archivedProject: archiveCandidate(state.project, state.archivedProject),
          project: null,
          selectedNodeId: null,
          focusedParentId: null,
          lens: 'structure',
          viewMode: 'tutor',
        })),

      undoReset: () => {
        const { archivedProject, project } = get();
        if (!archivedProject) return false;
        set({
          ...freshProjectSession(),
          // Troca, não descarta: se já havia outro projeto aberto, ele é que
          // vai pro arquivo.
          archivedProject: project && project.id !== DEMO_PROJECT_ID ? project : null,
          project: archivedProject,
          selectedNodeId: archivedProject.rootId,
          focusedParentId: archivedProject.rootId,
          viewMode: 'tutor',
        });
        return true;
      },

      importProject: (json) => {
        const parsed = parseImportedProject(json);
        if (!parsed) return { ok: false, error: t().store.importInvalid };
        set((state) => ({
          ...freshProjectSession(),
          archivedProject: archiveCandidate(state.project, state.archivedProject),
          project: parsed,
          selectedNodeId: parsed.rootId,
          focusedParentId: parsed.rootId,
          lens: 'structure',
          viewMode: 'tutor',
        }));
        return { ok: true };
      },
    }),
    {
      name: 'cellproject-graph',
      version: 4, // v4: drafts, objectiveDraft, archivedProject, lastTutorNodeId
      storage: createJSONStorage(() => idbStorage),
      // Pass-through migrate: NEVER drop a user's project on a version bump.
      // zustand discards persisted state on version mismatch when no migrate is
      // provided; all newer fields are optional, so old snapshots rehydrate fine
      // and the UI's `?? []` / archetype defaults cover the missing ones.
      migrate: (persisted) => persisted as GraphState,
      // Campos novos ausentes num snapshot antigo caem no default do estado.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<GraphState>;
        return {
          ...current,
          ...p,
          drafts: p.drafts ?? current.drafts,
          objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, ...(p.objectiveDraft ?? {}) },
          archivedProject: p.archivedProject ?? null,
          lastTutorNodeId: p.lastTutorNodeId ?? null,
        };
      },
      partialize: (state) => ({
        project: state.project,
        selectedNodeId: state.selectedNodeId,
        focusedParentId: state.focusedParentId,
        lens: state.lens,
        viewMode: state.viewMode,
        detailPanelOpen: state.detailPanelOpen,
        lastTutorNodeId: state.lastTutorNodeId,
        drafts: state.drafts,
        objectiveDraft: state.objectiveDraft,
        archivedProject: state.archivedProject,
      }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const isDemoProject = (project: Project | null): boolean =>
  project?.id === DEMO_PROJECT_ID;

// Nó-pai das sugestões em staging (uso: useGraphStore(pendingParent)).
export const pendingParent = (
  s: Pick<GraphState, 'project' | 'pendingSuggestions'>,
): ConceptNodeData | null => {
  if (!s.project || !s.pendingSuggestions) return null;
  return s.project.nodes[s.pendingSuggestions.parentId] ?? null;
};

// O critério da IA só aparece depois que o usuário travou o dele (ou fechou o
// nó por outro caminho) — critério do usuário ANTES do da IA.
export const canRevealAICriterion = (
  node: Pick<ConceptNodeData, 'comoConfirmarUsuarioAt' | 'confirmado' | 'takenAsKnown'>,
): boolean => Boolean(node.comoConfirmarUsuarioAt) || node.confirmado || Boolean(node.takenAsKnown);

export const breadcrumbFor = (
  project: Project | null,
  nodeId: string | null,
): ConceptNodeData[] => {
  if (!project || !nodeId) return [];
  const chain: ConceptNodeData[] = [];
  const seen = new Set<string>();
  let cur: ConceptNodeData | undefined = project.nodes[nodeId];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id); // guard against a cyclic parentId in corrupted data
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

// ---------------------------------------------------------------------------
// Tree walking — the project IS a decomposition tree, so every selector reads
// it the same way: children in sibling `order` (the decomposition order),
// `takenAsKnown` as a recursion floor that closes its whole subtree.
// ---------------------------------------------------------------------------

// Kinds the user acts on. categoria/root are structure — they resolve through
// their children, never directly.
const ACTIONABLE_KINDS: ReadonlySet<NodeKind> = new Set([
  'recurso',
  'passo',
  'decisao',
  'concept',
]);

export const isActionableKind = (kind: NodeKind): boolean => ACTIONABLE_KINDS.has(kind);

export const childrenByParent = (project: Project): Map<string, ConceptNodeData[]> => {
  const map = new Map<string, ConceptNodeData[]>();
  for (const n of Object.values(project.nodes)) {
    if (!n.parentId) continue;
    const arr = map.get(n.parentId);
    if (arr) arr.push(n);
    else map.set(n.parentId, [n]);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }
  return map;
};

/**
 * The decomposition frontier under `startId`: nodes with no children (the
 * current atoms) plus takenAsKnown nodes (floors — whatever lies below a floor
 * no longer counts). Only actionable kinds; containers resolve through these.
 */
export const effectiveLeavesUnder = (
  project: Project,
  startId: string,
  byParent?: Map<string, ConceptNodeData[]>,
): ConceptNodeData[] => {
  const map = byParent ?? childrenByParent(project);
  const out: ConceptNodeData[] = [];
  const walk = (id: string) => {
    for (const child of map.get(id) ?? []) {
      if (child.takenAsKnown) {
        if (ACTIONABLE_KINDS.has(child.kind)) out.push(child);
        continue;
      }
      const kids = map.get(child.id);
      if (kids && kids.length > 0) {
        walk(child.id);
      } else if (ACTIONABLE_KINDS.has(child.kind)) {
        out.push(child);
      }
    }
  };
  walk(startId);
  return out;
};

export const effectiveLeaves = (project: Project): ConceptNodeData[] =>
  effectiveLeavesUnder(project, project.rootId);

// ---------------------------------------------------------------------------
// Auto-layout — tidy tree over the decomposition. Children spread under their
// parent in sibling order, each subtree gets a horizontal slot proportional to
// its leaf count, parents sit centered over their slot, depth maps to y.
// World units sized for the widest node card (300px) plus breathing room.
// ---------------------------------------------------------------------------

export const LAYOUT_X_GAP = 340;
export const LAYOUT_Y_GAP = 300;

export function computeTreeLayout(project: Project): Record<string, { x: number; y: number }> {
  const byParent = childrenByParent(project);
  const widths = new Map<string, number>(); // subtree width in leaf slots
  const widthOf = (id: string): number => {
    const cached = widths.get(id);
    if (cached !== undefined) return cached;
    const kids = byParent.get(id) ?? [];
    const w = kids.length === 0 ? 1 : kids.reduce((acc, k) => acc + widthOf(k.id), 0);
    widths.set(id, w);
    return w;
  };

  const positions: Record<string, { x: number; y: number }> = {};
  const place = (id: string, depth: number, left: number) => {
    positions[id] = { x: (left + widthOf(id) / 2) * LAYOUT_X_GAP, y: depth * LAYOUT_Y_GAP };
    let cursor = left;
    for (const kid of byParent.get(id) ?? []) {
      place(kid.id, depth + 1, cursor);
      cursor += widthOf(kid.id);
    }
  };
  place(project.rootId, 0, 0);

  // Keep the root at x=0 so the layout is stable regardless of tree size.
  const shift = positions[project.rootId]?.x ?? 0;
  for (const pos of Object.values(positions)) pos.x -= shift;
  return positions;
}

/**
 * A node is resolved when reality (or the user) closed it: a leaf via
 * confirmado/takenAsKnown; a decomposed node when EVERY child is resolved.
 * This is what lets a step that was broken into sub-steps unblock its next
 * sibling once the sub-steps are all confirmed.
 */
export const isNodeResolved = (
  project: Project,
  nodeId: string,
  byParent?: Map<string, ConceptNodeData[]>,
): boolean => {
  const node = project.nodes[nodeId];
  if (!node) return false;
  if (node.takenAsKnown) return true;
  const map = byParent ?? childrenByParent(project);
  const kids = map.get(nodeId) ?? [];
  if (kids.length === 0) return node.confirmado;
  return kids.every((k) => isNodeResolved(project, k.id, map));
};

const createdAtOf = (n: ConceptNodeData): number => n.history[0]?.timestamp ?? 0;

// Passos irmãos na ordem de execução: `order`, depois criação, depois nome.
const passoSiblings = (
  project: Project,
  node: ConceptNodeData,
  byParent?: Map<string, ConceptNodeData[]>,
): ConceptNodeData[] => {
  if (!node.parentId) return [];
  const map = byParent ?? childrenByParent(project);
  return (map.get(node.parentId) ?? [])
    .filter((n) => n.kind === 'passo')
    .sort(
      (a, b) =>
        a.order - b.order || createdAtOf(a) - createdAtOf(b) || a.name.localeCompare(b.name),
    );
};

/**
 * O primeiro passo anterior (entre irmãos) ainda não resolvido — quem está
 * bloqueando este passo. null quando não está bloqueado ou não é passo.
 */
export const firstBlockerOf = (
  project: Project | null,
  nodeId: string,
): ConceptNodeData | null => {
  if (!project) return null;
  const node = project.nodes[nodeId];
  if (!node || node.kind !== 'passo' || !node.parentId) return null;
  const byParent = childrenByParent(project);
  for (const s of passoSiblings(project, node, byParent)) {
    if (s.id === node.id) return null;
    if (!isNodeResolved(project, s.id, byParent)) return s;
  }
  return null;
};

/**
 * A passo is "blocked" while any earlier passo among its siblings is not yet
 * resolved (confirmed, taken as known, or fully resolved through its own
 * decomposition). Applies only to kind=passo.
 */
export const isBlocked = (project: Project | null, nodeId: string): boolean =>
  firstBlockerOf(project, nodeId) !== null;

// Posição 1-based do passo entre os passos irmãos (o "#n" da UI).
export const stepSequence = (project: Project | null, nodeId: string): number | null => {
  if (!project) return null;
  const node = project.nodes[nodeId];
  if (!node || node.kind !== 'passo' || !node.parentId) return null;
  const idx = passoSiblings(project, node).findIndex((s) => s.id === nodeId);
  return idx < 0 ? null : idx + 1;
};

// Uma âncora conta como sinal real quando verificada; se veio da IA, só com a
// observação do que o usuário conferiu (marcar sem olhar não é prova).
export const refCountsAsSignal = (r: GroundTruthRef): boolean =>
  r.verificado && (!r.addedByAI || Boolean(r.observacao?.trim()));

export type ConcludeMissingKey =
  | 'blocked'
  | 'criterionNotLocked'
  | 'criterionNotAttested'
  | 'openFailure'
  | 'noSignal';

/**
 * A node may only be CONCLUDED (state 'done') when reality CONFIRMED it: a
 * criterion attested met (a) or a verified real-world anchor (d), it isn't
 * blocked by an earlier sibling and has no open failure. A bare critique (b)
 * or failure-report (c) is process, not confirmation, and does NOT earn
 * 'done'. `missing` são frases prontas; `missingKeys` deixa a UI montar a
 * mensagem certa (não travado ≠ travado mas não aferido).
 */
export const canConcludeNode = (
  project: Project | null,
  nodeId: string,
): { ready: boolean; missing: string[]; missingKeys: ConcludeMissingKey[] } => {
  if (!project) return { ready: false, missing: ['sem projeto'], missingKeys: [] };
  const node = project.nodes[nodeId];
  if (!node) return { ready: false, missing: ['nó inexistente'], missingKeys: [] };
  const tr = t().store;
  const missing: string[] = [];
  const missingKeys: ConcludeMissingKey[] = [];
  if (isBlocked(project, nodeId)) {
    missing.push(tr.missingBlocked);
    missingKeys.push('blocked');
  }
  // Falha real em aberto: a realidade disse "não funciona" — nada conclui.
  if (node.failureContext) {
    missing.push(tr.missingOpenFailure);
    missingKeys.push('openFailure');
  }
  // Reality must CONFIRM the node, not merely be engaged.
  const hasMetCriterion = Boolean(node.comoConfirmarAtendido); // (a) attested MET
  const hasVerifiedAnchor = (node.groundTruthRefs ?? []).some(refCountsAsSignal); // (d)
  if (!hasMetCriterion && !hasVerifiedAnchor) {
    if (!node.comoConfirmarUsuarioAt) {
      missing.push(tr.missingSignal);
      missingKeys.push('criterionNotLocked');
    } else {
      missing.push(tr.missingCriterionNotAttested);
      missingKeys.push('criterionNotAttested');
    }
    missingKeys.push('noSignal');
  }
  return { ready: missingKeys.length === 0, missing, missingKeys };
};

// "Sem prova" = confirmado no palpite, OU um chão takenAsKnown num projeto de
// CONSTRUIR — "já sabido" só é axioma legítimo em projeto de entender.
const resolvedWithoutSignal = (n: ConceptNodeData, understand: boolean): boolean =>
  Boolean(n.confirmedWithoutSignal) || (Boolean(n.takenAsKnown) && !understand);

export const projectProgress = (project: Project | null) => {
  if (!project) {
    return { total: 0, done: 0, doneWithSignal: 0, doneWithoutSignal: 0, percent: 0 };
  }
  const understand = project.archetype === 'entender';
  // Progress counts the decomposition frontier: every actionable leaf in ANY
  // archetype (a concept node the AI produced in a build project is still a
  // part the user must understand or confirm — hiding it from progress let the
  // tutor declare "done" with work pending).
  const leaves = effectiveLeaves(project);
  const total = leaves.length;
  const resolved = leaves.filter((n) => n.confirmado || n.takenAsKnown);
  const done = resolved.length;
  const doneWithoutSignal = resolved.filter((n) => resolvedWithoutSignal(n, understand)).length;
  const doneWithSignal = done - doneWithoutSignal;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, doneWithSignal, doneWithoutSignal, percent };
};

// Ids das folhas resolvidas sem prova (mesma regra do doneWithoutSignal), na
// ordem da árvore — para o DoneCard e a StatusBar apontarem quais são.
export const nodesWithoutSignal = (project: Project | null): string[] => {
  if (!project) return [];
  const understand = project.archetype === 'entender';
  return effectiveLeaves(project)
    .filter((n) => (n.confirmado || n.takenAsKnown) && resolvedWithoutSignal(n, understand))
    .map((n) => n.id);
};

/**
 * Next pending node for the tutor: depth-first over the tree in decomposition
 * order — the first unresolved actionable leaf. Depth-first is the concept's
 * core loop made literal: after decomposing a node, its parts come before the
 * next sibling, so the user goes "down to the atom" before moving on.
 * takenAsKnown subtrees are skipped entirely (the floor closed them).
 */
export const nextPendingForTutor = (project: Project | null): ConceptNodeData | null => {
  if (!project) return null;
  const byParent = childrenByParent(project);
  const walk = (id: string): ConceptNodeData | null => {
    for (const child of byParent.get(id) ?? []) {
      if (child.takenAsKnown) continue;
      const kids = byParent.get(child.id);
      if (kids && kids.length > 0) {
        const found = walk(child.id);
        if (found) return found;
        continue;
      }
      if (ACTIONABLE_KINDS.has(child.kind) && !child.confirmado) return child;
    }
    return null;
  };
  return walk(project.rootId);
};

export const projectMetrics = (project: Project | null) => {
  if (!project) return null;
  const nodes = Object.values(project.nodes);
  // Risco = trabalho pendente de baixa confiança. Raiz/categorias (100 fixo) e
  // folhas já resolvidas não contam.
  const atRisk = effectiveLeaves(project).filter(
    (n) => !n.confirmado && !n.takenAsKnown && n.confidence < 40,
  ).length;
  return {
    nodeCount: nodes.length,
    atRisk,
    progress: projectProgress(project),
  };
};

export type { Lens, ViewMode, NodeState, NodeKind };
