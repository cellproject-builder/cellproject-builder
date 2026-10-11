import { create } from 'zustand';
import { persist, type StateStorage } from 'zustand/middleware';
import { selectedStorage } from '@/cloud/storage';
import { getCloudRuntime } from '@/cloud/runtime';
import { createSelectiveJSONStorage } from '@/data/selectiveJSONStorage';
import { plannerContentValues, type PlannerContentSnapshot } from '@/data/plannerPersistence';
const idbGet = selectedStorage.getItem, idbSet = selectedStorage.setItem, idbDel = selectedStorage.removeItem;
import { nanoid } from 'nanoid';
import type {
  Project,
  ConceptNodeData,
  ConceptEdgeData,
  AIPlan,
  AIPlanOutline,
  AISuggestedNode,
  NodeState,
  NodeKind,
  HistoryEntry,
  AdversarialCritique,
  GroundTruthRef,
  WebResearchDigest,
  WebSourceRef,
  PlanningIntent,
} from '@/types';
import { normalizePlanningIntent } from '@/planningIntent';
import { safeHref } from '@/safeHref';
import { t } from '@/i18n';
import { buildDemoProject, DEMO_PROJECT_ID } from '@/data/demoProject';
import { clearMissingVisualNodeLinks, normalizeVisualWorkspace } from '@/visuals/normalize';
import { normalizeStoredProjectVisuals } from '@/visuals/projectBoundary';
import { childrenByParent } from '@/graph/treeIndex';
import { computeTreeLayout, LAYOUT_X_GAP, LAYOUT_Y_GAP } from '@/graph/treeLayout';
// Compatibility exports for callers using the original graph-store surface.
export { childrenByParent } from '@/graph/treeIndex';
export { computeTreeLayout, isLeafGridParent, LAYOUT_X_GAP, LAYOUT_Y_GAP, LEAF_GRID_ROW } from '@/graph/treeLayout';

type Lens = 'structure' | 'flow' | 'risk' | 'state' | 'connections';
type ViewMode = 'graph' | 'tutor';

// Rascunhos por nó (critério, aferição, falha): sobrevivem a reload e à troca
// de card. Limpos automaticamente quando a ação correspondente é gravada.
export type DraftField = 'criterion' | 'met' | 'failure';
export type NodeDrafts = Partial<Record<DraftField, string>>;

// Rascunho da tela de objetivo — o usuário não perde planos gerados (e pagos)
// se recarregar a página no meio da escolha.
// Planejamento em duas fases: `outlines` são os esboços leves mostrados nos
// cards; `expanded` é o cache das árvores completas já geradas (chave = id do
// esboço); `expansion` marca a expansão em andamento (sobrevive ao reload
// para a UI saber que foi interrompida — como `generatingSince`).
// `plans` (planos completos de generatePlans) segue para compatibilidade.
export interface ObjectiveExpansion {
  outlineId: string;
  startedAt: number;
}

export interface ObjectiveDraft extends PlanningIntent {
  name: string;
  objective: string;
  rules: string[];
  ruleDraft: string;
  plans: AIPlan[] | null;
  outlines: AIPlanOutline[] | null;
  expanded: Record<string, AIPlan>;
  expansion: ObjectiveExpansion | null;
  // Digest da pesquisa web feita com os esboços — a expansão reaproveita.
  outlineResearch: WebResearchDigest | null;
  plansFor: ({ objective: string; rules: string[]; attachmentsFingerprint?: string } & PlanningIntent) | null;
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
  outlines: null,
  expanded: {},
  expansion: null,
  outlineResearch: null,
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
  // Mobile: o sheet de detalhe está aberto (cobre a metade de baixo do grafo).
  // Efêmero — o enquadramento do canvas desconta a área dele.
  mobileSheetOpen: boolean;
  setMobileSheetOpen: (open: boolean) => void;
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
    // Tamanho do lote quando a IA o propôs — o aviso de descarte parcial
    // conta o lote inteiro (aceitas + descartadas uma a uma + restantes).
    originalCount?: number;
  } | null;
  // Lotes de sugestões estacionados (um por pai): quebrar/replanejar outro nó
  // não descarta nem bloqueia por causa do lote em revisão — ele estaciona e
  // volta a ser o ativo quando o usuário reabre aquele pai. Persistido (sobrevive ao reload).
  parkedSuggestions: Record<string, NonNullable<GraphState['pendingSuggestions']>>;
  drafts: Record<string, NodeDrafts>;
  objectiveDraft: ObjectiveDraft;
  lastAction: LastAction | null;
  // Por nó e por tipo: dois jobs diferentes no mesmo nó não se apagam.
  aiJobs: Record<string, Partial<Record<AIJobKind, AIJob>>>;
  // Projeto arquivado pelo último reset/import — permite desfazer.
  archivedProject: Project | null;
  // Sugestões em staging do projeto arquivado (custaram uma chamada de IA):
  // voltam junto no desfazer. Persistido, como o próprio staging.
  archivedPending: GraphState['pendingSuggestions'];
  // Arquivado que o último reset/import/demo substituiu (só há um slot de
  // arquivo). Não persistido: só serve para o desfazer devolvê-lo ao arquivo
  // em vez de perdê-lo de vez.
  replacedArchive: { project: Project; pending: GraphState['pendingSuggestions'] } | null;

  // `alternatives` podem ser esboços (os não escolhidos ficam no projeto).
  createProjectFromPlan: (
    objective: string,
    name: string,
    plan: AIPlan,
    rules?: string[],
    alternatives?: (AIPlan | AIPlanOutline)[],
  ) => void;
  // Cria o projeto a partir do esboço já expandido (cache do rascunho). As
  // alternativas são os outros esboços (ou suas árvores, se já expandidas).
  // false quando a árvore desse esboço ainda não está no cache.
  createProjectFromOutline: (
    objective: string,
    name: string,
    outlineId: string,
    rules?: string[],
  ) => boolean;
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
  // Desfazer do "Descartar todas": devolve o lote descartado (se o pai ainda
  // existe). O lote ativo de outro pai, se houver, estaciona.
  restoreSuggestions: (batch: NonNullable<GraphState['pendingSuggestions']>) => boolean;
  // Desfazer do ✕ (ou parte do desfazer de aceitar): devolve ao lote do pai
  // as sugestões `tempIds` tiradas de `before` (o lote como estava antes).
  reinstateSuggestions: (before: NonNullable<GraphState['pendingSuggestions']>, tempIds: string[]) => boolean;
  // Desfazer de aceitar (uma ou todas): remove os nós criados — se ninguém
  // mexeu neles desde então — e devolve as sugestões ao lote.
  undoAcceptSuggestions: (
    before: NonNullable<GraphState['pendingSuggestions']>,
    added: Record<string, string>,
    parentBefore: ConceptNodeData,
  ) => boolean;
  // Torna ativo o lote estacionado deste pai (estacionando o ativo atual).
  resumeSuggestions: (parentId: string) => boolean;

  setDraft: (nodeId: string, field: DraftField, value: string) => void;
  clearDraft: (nodeId: string, field?: DraftField) => void;
  setObjectiveDraft: (partial: Partial<Omit<ObjectiveDraft, 'updatedAt'>>) => void;
  clearObjectiveDraft: () => void;
  // Troca o conjunto de esboços (nova geração ou "gerar mais" já fundido).
  // Poda do cache as árvores e a expansão de esboços que saíram.
  setOutlines: (
    outlines: AIPlanOutline[] | null,
    plansFor?: ObjectiveDraft['plansFor'],
    research?: WebResearchDigest | null,
  ) => void;
  // Guarda a árvore completa de um esboço (id forçado = id do esboço) e
  // encerra a expansão dele, se era a em andamento.
  setExpandedPlan: (outlineId: string, plan: AIPlan) => void;
  // Marca/desmarca a expansão em andamento (null = nenhuma).
  setExpansion: (outlineId: string | null) => void;

  // Desfaz confirmar / já sei / escolher. Retorna false se não havia o que
  // desfazer (ou o nó mudou depois da ação).
  undoLastAction: () => boolean;
  startAIJob: (nodeId: string, kind: AIJobKind) => void;
  endAIJob: (nodeId: string, kind?: AIJobKind) => void;
  setLastTutorNode: (id: string | null) => void;
  requestCenter: (nodeId: string) => void;

  // Arquiva o projeto atual (desfazível via undoReset) e volta à tela inicial.
  resetProject: () => void;
  undoReset: () => boolean;
  // Aceita o JSON exportado (string ou objeto). Arquiva o projeto atual.
  importProject: (json: unknown) => ImportResult;
}

// ---------------------------------------------------------------------------
// O adapter seletivo evita serializar mudanças apenas de UI. Para alterações
// de conteúdo, agrupamos o I/O em 500ms e descarregamos ao esconder/fechar a
// aba para não perder a última edição.
// ---------------------------------------------------------------------------

const WRITE_DEBOUNCE_MS = 500;
type GraphPersistenceOwner = ReturnType<typeof getCloudRuntime>;
interface PendingGraphWrite { value: string; owner: GraphPersistenceOwner; revision: number }
const pendingWrites = new Map<string, PendingGraphWrite>();
const inFlightWrites = new Map<string, { owner: GraphPersistenceOwner; count: number }>();
const writeRevisions = new Map<string, number>();
let nextWriteRevision = 0;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
export const hasPendingGraphPersistence = () => pendingWrites.size > 0 || inFlightWrites.size > 0;

const ownerChanged = () => new Error('Há alterações de outra sessão de persistência nesta aba. Mantenha esta aba aberta para preservar o rascunho.');
function assertGraphPersistenceOwner(name: string, owner: GraphPersistenceOwner) {
  const pending = pendingWrites.get(name), active = inFlightWrites.get(name);
  if (pending && pending.owner !== owner || active && active.owner !== owner) throw ownerChanged();
}

export async function flushGraphPersistence(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const owner = getCloudRuntime(), entries = [...pendingWrites.entries()];
  // The backend is selected at the call boundary. Never route a retained draft
  // through another account's runtime, and never discard it on that refusal.
  for (const name of new Set([...pendingWrites.keys(), ...inFlightWrites.keys()])) assertGraphPersistenceOwner(name, owner);
  pendingWrites.clear();
  await Promise.all(entries.map(async ([name, entry]) => {
    const active = inFlightWrites.get(name);
    inFlightWrites.set(name, { owner: entry.owner, count: (active?.count ?? 0) + 1 });
    try {
      if (getCloudRuntime() !== entry.owner) throw ownerChanged();
      await idbSet(name, entry.value);
    }
    catch (error) {
      // A debounced enqueue returns before this write completes. Preserve its
      // retry even when the selective adapter skips an identical snapshot, but
      // never put an older value back after a newer write or explicit removal.
      if (writeRevisions.get(name) === entry.revision) pendingWrites.set(name, entry);
      throw error;
    } finally {
      const current = inFlightWrites.get(name)!;
      if (current.count === 1) inFlightWrites.delete(name);
      else inFlightWrites.set(name, { ...current, count: current.count - 1 });
    }
  }));
}

const idbStorage: StateStorage = {
  getItem: async (name) => {
    const owner = getCloudRuntime(), pending = pendingWrites.get(name);
    const value = pending?.owner === owner ? pending.value : await idbGet(name);
    if (getCloudRuntime() !== owner) throw ownerChanged();
    return value ?? null;
  },
  setItem: (name, value) => {
    const owner = getCloudRuntime();
    assertGraphPersistenceOwner(name, owner);
    const revision = ++nextWriteRevision;
    writeRevisions.set(name, revision);
    pendingWrites.set(name, { value, owner, revision });
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      void flushGraphPersistence();
    }, WRITE_DEBOUNCE_MS);
  },
  removeItem: (name) => {
    assertGraphPersistenceOwner(name, getCloudRuntime());
    writeRevisions.delete(name);
    pendingWrites.delete(name);
    return idbDel(name);
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

// As sugestões em staging acompanham o projeto que vai pro arquivo.
const archivePendingCandidate = (
  state: Pick<GraphState, 'project' | 'pendingSuggestions' | 'archivedPending'>,
): GraphState['pendingSuggestions'] =>
  state.project && state.project.id !== DEMO_PROJECT_ID
    ? state.pendingSuggestions
    : state.archivedPending;

// O arquivado atual que será sobrescrito por arquivar `state.project`.
const replacedArchiveCandidate = (
  state: Pick<GraphState, 'project' | 'archivedProject' | 'archivedPending' | 'replacedArchive'>,
): GraphState['replacedArchive'] =>
  state.project &&
  state.project.id !== DEMO_PROJECT_ID &&
  state.archivedProject &&
  state.archivedProject.id !== state.project.id
    ? { project: state.archivedProject, pending: state.archivedPending }
    : state.replacedArchive;

// Troca o lote ativo pelo estacionado de `parentId` (o ativo vai pro estacionamento).
const swapInParked = (
  s: Pick<GraphState, 'pendingSuggestions' | 'parkedSuggestions'>,
  parentId: string,
): Pick<GraphState, 'pendingSuggestions' | 'parkedSuggestions'> => {
  const parked = { ...s.parkedSuggestions };
  const next = parked[parentId];
  delete parked[parentId];
  const cur = s.pendingSuggestions;
  if (cur && cur.parentId !== parentId && cur.nodes.length > 0) parked[cur.parentId] = cur;
  return { pendingSuggestions: next ?? null, parkedSuggestions: parked };
};

// Aceitar sub-partes de um nó com falha registrada = aceitar o replanejamento:
// o texto do pai é do plano antigo. Marca (a UI avisa) e tira a explicação em
// cache, que recomendaria o que falhou. Muta `project.nodes` de um objeto novo.
const markReplaced = (project: Project, parentId: string) => {
  const parent = project.nodes[parentId];
  if (!parent?.failureContext || parent.planReplacedAt) return;
  project.nodes[parentId] = { ...parent, planReplacedAt: now(), explicacao: undefined };
};

// Um lote persistido só volta se for bem formado e o pai existir no projeto.
const validBatch = (
  batch: GraphState['pendingSuggestions'] | undefined,
  project: Project | null,
): GraphState['pendingSuggestions'] =>
  batch &&
  typeof batch === 'object' &&
  typeof batch.parentId === 'string' &&
  Array.isArray(batch.nodes) &&
  batch.nodes.length > 0 &&
  Array.isArray(batch.edges) &&
  project?.nodes?.[batch.parentId]
    ? batch
    : null;

// Estado efêmero que pertence ao projeto aberto — zerado ao trocar de projeto.
const freshProjectSession = () => ({
  pendingSuggestions: null,
  parkedSuggestions: {},
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

export const CRITERION_UNLOCK_MS = 10_000;

// Confirmar, "já sei" e escolher opção revelam o critério da IA na hora:
// marca o momento, e a partir daí o lock do critério do usuário não se desfaz
// (senão daria para ver o da IA, destravar e copiar).
const markAICriterionSeen = (node: ConceptNodeData): ConceptNodeData =>
  node.aiCriterionSeenAt ? node : { ...node, aiCriterionSeenAt: now() };

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

// Rebaixamento: um 'done' que perdeu a prova (âncora desmarcada/removida)
// volta a "confirmado sem prova" — espelho do promoteIfEarned.
function demoteIfLost(project: Project, nodeId: string): Project {
  const node = project.nodes[nodeId];
  if (!node || node.state !== 'done' || !node.confirmado) return project;
  if (canConcludeNode(project, nodeId).ready) return project;
  const next = addHistory(
    { ...node, state: 'validated', confirmedWithoutSignal: true },
    'state',
    t().store.demotedNoProof,
  );
  return putNode(project, next);
}

// Migração v5: 'done' sem sinal real pelo gate atual (critério aferido ou
// âncora que conta) vira 'validated' + confirmedWithoutSignal. Não mexe em nada
// além disso — só desfaz o 'done' que a regra antiga dava a âncora da IA sem
// observação.
export function demoteUnprovenDone(project: Project): Project {
  let nodes: Project['nodes'] | null = null;
  for (const [id, n] of Object.entries(project.nodes ?? {})) {
    if (n.state !== 'done' || !n.confirmado) continue;
    const hasMet = Boolean(n.comoConfirmarAtendido);
    const hasAnchor = (n.groundTruthRefs ?? []).some(refCountsAsSignal);
    if (hasMet || hasAnchor) continue;
    nodes = nodes ?? { ...project.nodes };
    nodes[id] = { ...n, state: 'validated', confirmedWithoutSignal: true };
  }
  return nodes ? { ...project, nodes } : project;
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
export function parseImportedProject(json: unknown): Project | null {
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
  // Import is strict; malformed scenes cannot reach a renderer or write media.
  let visuals: Project['visuals'];
  if (p.visuals !== undefined) {
    try { visuals = normalizeVisualWorkspace(p.visuals); } catch { return null; }
  }

  // URLs de um JSON importado não são confiáveis: só http(s) sobrevive.
  const safeSources = (list: unknown): WebSourceRef[] =>
    Array.isArray(list)
      ? list.filter(
          (s): s is WebSourceRef =>
            !!s && typeof s === 'object' && typeof s.url === 'string' && safeHref(s.url) !== null,
        )
      : [];

  const nodes: Record<string, ConceptNodeData> = {};
  for (const [id, n] of Object.entries(p.nodes)) {
    if (!n || typeof n !== 'object') return null;
    nodes[id] = {
      ...n,
      webResearch:
        n.webResearch && typeof n.webResearch === 'object'
          ? { ...n.webResearch, sources: safeSources(n.webResearch.sources) }
          : undefined,
      critica:
        n.critica && typeof n.critica === 'object'
          ? {
              ...n.critica,
              fontes: n.critica.fontes ? safeSources(n.critica.fontes) : undefined,
            }
          : undefined,
      groundTruthRefs: Array.isArray(n.groundTruthRefs)
        ? n.groundTruthRefs.filter(
            (r) =>
              !!r &&
              typeof r === 'object' &&
              (r.kind !== 'link' || safeHref(String(r.value ?? '')) !== null),
          )
        : undefined,
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
  if (visuals) visuals = clearMissingVisualNodeLinks(visuals, nodes);
  const edges: Record<string, ConceptEdgeData> = {};
  for (const [id, e] of Object.entries(p.edges)) {
    if (!e || typeof e !== 'object' || !nodes[e.source] || !nodes[e.target]) continue;
    edges[id] = { ...e, id };
  }
  const root = nodes[p.rootId];
  // O gate vale também para o import: 'done' sem sinal real não entra verde.
  return demoteUnprovenDone({
    ...p,
    ...normalizePlanningIntent(p),
    ...(visuals === undefined ? {} : { visuals }),
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
  } as Project);
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
      mobileSheetOpen: false,
      pendingSuggestions: null,
      parkedSuggestions: {},
      drafts: {},
      objectiveDraft: EMPTY_OBJECTIVE_DRAFT,
      lastAction: null,
      aiJobs: {},
      archivedProject: null,
      archivedPending: null,
      replacedArchive: null,

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
          ...normalizePlanningIntent(plan),
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

      createProjectFromOutline: (objective, name, outlineId, rules) => {
        const draft = get().objectiveDraft;
        const plan = draft.expanded[outlineId];
        if (!plan) return false;
        const alternatives = (draft.outlines ?? [])
          .filter((o) => o.id !== outlineId)
          .map((o) => draft.expanded[o.id] ?? o);
        get().createProjectFromPlan(objective, name, plan, rules, alternatives);
        return true;
      },

      loadDemoProject: () => {
        const project = buildDemoProject();
        // O projeto real aberto vai pro arquivo (desfazível), nunca é perdido.
        set((state) => ({
          ...freshProjectSession(),
          archivedProject: archiveCandidate(state.project, state.archivedProject),
          archivedPending: archivePendingCandidate(state),
          replacedArchive: replacedArchiveCandidate(state),
          project,
          selectedNodeId: project.rootId,
          focusedParentId: project.rootId,
          lens: 'structure',
          viewMode: 'graph',
        }));
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

      // Abrir um pai com lote estacionado traz as sugestões dele de volta.
      selectNode: (id) =>
        set((s) => ({
          selectedNodeId: id,
          selectionVersion: s.selectionVersion + 1,
          ...(id && s.parkedSuggestions[id] ? swapInParked(s, id) : {}),
        })),
      focusNode: (id) => set((s) => ({ focusedParentId: id, focusVersion: s.focusVersion + 1 })),
      setLens: (lens) => set({ lens }),
      // Ir pro grafo sem seleção útil (nada, nó apagado ou só a raiz) abre o
      // nó em que o usuário estava no tutor — ou o próximo pendente — em vez de
      // jogá-lo na raiz de um grafo grande.
      setViewMode: (mode) =>
        set((s) => {
          if (mode !== 'graph' || !s.project) return { viewMode: mode };
          const fromTutor =
            s.lastTutorNodeId && s.project.nodes[s.lastTutorNodeId] ? s.lastTutorNodeId : null;
          // Vindo do tutor, o nó em que o usuário estava manda — o card mostrado
          // pode não ser a seleção (categoria/nó com filhos → "próximo").
          if (s.viewMode === 'tutor' && fromTutor) {
            return {
              viewMode: mode,
              selectedNodeId: fromTutor,
              selectionVersion:
                fromTutor === s.selectedNodeId ? s.selectionVersion : s.selectionVersion + 1,
              centerRequest: { nodeId: fromTutor, version: (s.centerRequest?.version ?? 0) + 1 },
            };
          }
          const sel = s.selectedNodeId;
          const meaningful = sel && sel !== s.project.rootId && s.project.nodes[sel];
          if (meaningful) return { viewMode: mode };
          const target = fromTutor ?? nextPendingForTutor(s.project, s.pendingSuggestions)?.id ?? null;
          if (!target) return { viewMode: mode };
          return {
            viewMode: mode,
            selectedNodeId: target,
            centerRequest: { nodeId: target, version: (s.centerRequest?.version ?? 0) + 1 },
          };
        }),
      setDetailPanelOpen: (open) => set({ detailPanelOpen: open }),
      setMobileSheetOpen: (open) => {
        if (get().mobileSheetOpen !== open) set({ mobileSheetOpen: open });
      },

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
          // Sugestões de um pai apagado não têm onde entrar.
          const parkedSuggestions = Object.fromEntries(
            Object.entries(state.parkedSuggestions).filter(([pid]) => !toRemove.has(pid)),
          );
          const visuals = state.project.visuals && {
            ...state.project.visuals,
            artifacts: state.project.visuals.artifacts.map(artifact =>
              artifact.linkedNodeId && toRemove.has(artifact.linkedNodeId)
                ? { ...artifact, linkedNodeId: null }
                : artifact,
            ),
          };
          return {
            project: { ...state.project, updatedAt: now(), nodes, edges, ...(visuals ? { visuals } : {}) },
            drafts,
            parkedSuggestions,
            pendingSuggestions:
              state.pendingSuggestions && toRemove.has(state.pendingSuggestions.parentId)
                ? null
                : state.pendingSuggestions,
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
            ...markAICriterionSeen(prev),
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
            { ...(nowKnown ? markAICriterionSeen(prev) : prev), takenAsKnown: nowKnown },
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
              ...markAICriterionSeen(prev),
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
        // O critério da IA já foi exibido (confirmar/"já sei"): não destrava.
        if (prev.aiCriterionSeenAt) return false;
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
          return {
            project: nowVerified ? promoteIfEarned(project, id) : demoteIfLost(project, id),
          };
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
          return { project: demoteIfLost(putNode(state.project, next), id) };
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
            // A real failure invalidates any prior confirmation — including
            // the attestation that the criterion was met (reality refuted it).
            confirmado: false,
            confirmedWithoutSignal: false,
            comoConfirmarAtendido: undefined,
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

      // Um lote de outro pai em revisão não é descartado: estaciona. Um lote
      // novo do MESMO pai substitui o anterior (inclusive o estacionado).
      stageSuggestions: (parentId, nodes, edges) => {
        set((s) => {
          const parked = { ...s.parkedSuggestions };
          delete parked[parentId];
          const cur = s.pendingSuggestions;
          if (cur && cur.parentId !== parentId && cur.nodes.length > 0) parked[cur.parentId] = cur;
          return {
            parkedSuggestions: parked,
            pendingSuggestions: {
              parentId,
              nodes: nodes.map((n) => ({ tempId: n.tempId, data: n })),
              edges,
              originalCount: nodes.length,
            },
          };
        });
      },

      resumeSuggestions: (parentId) => {
        const s = get();
        if (!s.parkedSuggestions[parentId] || !s.project?.nodes[parentId]) return false;
        set(swapInParked(s, parentId));
        return true;
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
        markReplaced(merged, pending.parentId);
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
        markReplaced(merged, pending.parentId);
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

      restoreSuggestions: (batch) => {
        const s = get();
        if (!validBatch(batch, s.project)) return false;
        const cur = s.pendingSuggestions;
        if (cur && cur.parentId === batch.parentId) return false;
        const parked = { ...s.parkedSuggestions };
        if (cur && cur.nodes.length > 0) parked[cur.parentId] = cur;
        delete parked[batch.parentId];
        set({ pendingSuggestions: batch, parkedSuggestions: parked });
        return true;
      },

      reinstateSuggestions: (before, tempIds) => {
        const s = get();
        const project = s.project;
        if (!project?.nodes[before.parentId] || tempIds.length === 0) return false;
        const back = new Set(tempIds);
        const parked = { ...s.parkedSuggestions };
        const cur = s.pendingSuggestions;
        const base =
          cur && cur.parentId === before.parentId ? cur : parked[before.parentId] ?? null;
        delete parked[before.parentId];
        if (cur && cur.parentId !== before.parentId && cur.nodes.length > 0) parked[cur.parentId] = cur;
        const baseIds = new Set((base?.nodes ?? []).map((n) => n.tempId));
        const nodes = before.nodes.filter((n) => back.has(n.tempId) || baseIds.has(n.tempId));
        for (const n of base?.nodes ?? []) if (!nodes.some((x) => x.tempId === n.tempId)) nodes.push(n);
        if (nodes.length === 0) return false;
        const inNodes = new Set(nodes.map((n) => n.tempId));
        // Só aceitas que ainda existem: a aresta pendente materializa depois.
        const acceptedMap = Object.fromEntries(
          Object.entries(base?.acceptedMap ?? before.acceptedMap ?? {}).filter(
            ([tid, real]) => !back.has(tid) && Boolean(project.nodes[real]),
          ),
        );
        const known = (tid: string) => inNodes.has(tid) || Boolean(acceptedMap[tid]);
        const seen = new Set<string>();
        const edges = [...(base?.edges ?? []), ...before.edges].filter((e) => {
          const key = `${e.sourceTempId}>${e.targetTempId}>${e.kind}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return (
            known(e.sourceTempId) &&
            known(e.targetTempId) &&
            (inNodes.has(e.sourceTempId) || inNodes.has(e.targetTempId))
          );
        });
        set({
          parkedSuggestions: parked,
          pendingSuggestions: {
            parentId: before.parentId,
            nodes,
            edges,
            ...(Object.keys(acceptedMap).length > 0 ? { acceptedMap } : {}),
            originalCount: before.originalCount ?? base?.originalCount,
          },
        });
        return true;
      },

      undoAcceptSuggestions: (before, added, parentBefore) => {
        const project = get().project;
        const realIds = Object.values(added);
        if (!project || realIds.length === 0) return false;
        const removing = new Set(realIds);
        // Obsoleto: alguém mexeu no nó aceito (critério, confirmação, filhos…).
        for (const id of realIds) {
          const n = project.nodes[id];
          if (!n || n.history.length > 1 || n.confirmado || n.takenAsKnown) return false;
        }
        if (Object.values(project.nodes).some((n) => n.parentId && removing.has(n.parentId))) return false;
        const nodes = { ...project.nodes };
        for (const id of realIds) delete nodes[id];
        const parent = nodes[before.parentId];
        if (parent && !parentBefore.planReplacedAt && parent.planReplacedAt) {
          nodes[before.parentId] = {
            ...parent,
            planReplacedAt: undefined,
            explicacao: parentBefore.explicacao,
          };
        }
        const edges = Object.fromEntries(
          Object.entries(project.edges).filter(([, e]) => !removing.has(e.source) && !removing.has(e.target)),
        );
        const next: Project = { ...project, updatedAt: now(), nodes, edges };
        set({ project: next.manualLayout === true ? next : withTreeLayout(next) });
        get().reinstateSuggestions(before, Object.keys(added));
        get().selectNode(before.parentId);
        return true;
      },

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

      setOutlines: (outlines, plansFor, research) =>
        set((state) => {
          const d = state.objectiveDraft;
          const ids = new Set((outlines ?? []).map((o) => o.id));
          const expanded = Object.fromEntries(Object.entries(d.expanded).filter(([id]) => ids.has(id)));
          return {
            objectiveDraft: {
              ...d,
              outlines,
              expanded,
              expansion: d.expansion && ids.has(d.expansion.outlineId) ? d.expansion : null,
              plansFor: plansFor === undefined ? d.plansFor : plansFor,
              outlineResearch: research === undefined ? d.outlineResearch : research,
              selectedId: d.selectedId && ids.has(d.selectedId) ? d.selectedId : null,
              updatedAt: now(),
            },
          };
        }),

      setExpandedPlan: (outlineId, plan) =>
        set((state) => {
          const d = state.objectiveDraft;
          return {
            objectiveDraft: {
              ...d,
              expanded: { ...d.expanded, [outlineId]: { ...plan, id: outlineId } },
              expansion: d.expansion?.outlineId === outlineId ? null : d.expansion,
              updatedAt: now(),
            },
          };
        }),

      setExpansion: (outlineId) =>
        set((state) => ({
          objectiveDraft: {
            ...state.objectiveDraft,
            expansion: outlineId ? { outlineId, startedAt: now() } : null,
            updatedAt: now(),
          },
        })),

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
        // O desfazer não "esquece" que o critério da IA já foi visto.
        const snapshot: ConceptNodeData = current.aiCriterionSeenAt
          ? { ...lastAction.prevSnapshot, aiCriterionSeenAt: current.aiCriterionSeenAt }
          : lastAction.prevSnapshot;
        const restored = addHistory(
          snapshot,
          'manual',
          t().store.undone(current.name),
        );
        set({ project: putNode(project, restored), lastAction: null });
        get().selectNode(lastAction.nodeId);
        return true;
      },

      startAIJob: (nodeId, kind) =>
        set((state) => ({
          aiJobs: {
            ...state.aiJobs,
            [nodeId]: { ...state.aiJobs[nodeId], [kind]: { kind, startedAt: now() } },
          },
        })),

      endAIJob: (nodeId, kind) =>
        set((state) => {
          const jobs = state.aiJobs[nodeId];
          if (!jobs) return state;
          const aiJobs = { ...state.aiJobs };
          // Com `kind`, só encerra o marcador do próprio job — outro job no
          // mesmo nó segue. Sem `kind`, encerra todos os do nó (cancelamento).
          if (kind) {
            if (!jobs[kind]) return state;
            const rest = { ...jobs };
            delete rest[kind];
            if (Object.keys(rest).length > 0) aiJobs[nodeId] = rest;
            else delete aiJobs[nodeId];
          } else {
            delete aiJobs[nodeId];
          }
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
          archivedPending: archivePendingCandidate(state),
          replacedArchive: replacedArchiveCandidate(state),
          project: null,
          selectedNodeId: null,
          focusedParentId: null,
          lens: 'structure',
          viewMode: 'tutor',
        })),

      undoReset: () => {
        const { archivedProject, archivedPending, project, pendingSuggestions, replacedArchive } = get();
        if (!archivedProject) return false;
        const keepCurrent = project && project.id !== DEMO_PROJECT_ID;
        // Sem projeto aberto, o arquivo volta a ter o que o reset substituiu.
        const restored =
          !keepCurrent && replacedArchive && replacedArchive.project.id !== archivedProject.id
            ? replacedArchive
            : null;
        set({
          ...freshProjectSession(),
          // Troca, não descarta: se já havia outro projeto aberto, ele é que
          // vai pro arquivo.
          archivedProject: keepCurrent ? project : (restored?.project ?? null),
          archivedPending: keepCurrent ? pendingSuggestions : (restored?.pending ?? null),
          replacedArchive: null,
          pendingSuggestions:
            archivedPending && archivedProject.nodes[archivedPending.parentId] ? archivedPending : null,
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
          archivedPending: archivePendingCandidate(state),
          replacedArchive: replacedArchiveCandidate(state),
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
      version: 6, // v4: drafts, objectiveDraft, archivedProject, lastTutorNodeId; v5: gate da âncora da IA; v6: esboços + cache de expansão no objectiveDraft
      storage: createSelectiveJSONStorage<PlannerContentSnapshot>(() => idbStorage, { select: plannerContentValues, scope: getCloudRuntime }),
      // Pass-through migrate: NEVER drop a user's project on a version bump.
      // zustand discards persisted state on version mismatch when no migrate is
      // provided; all newer fields are optional, so old snapshots rehydrate fine
      // and the UI's `?? []` / archetype defaults cover the missing ones.
      // v<5: o gate passou a exigir observação nas âncoras da IA — nós que
      // ficaram 'done' só por uma delas voltam a "confirmado sem prova".
      // v<6: o objectiveDraft ganhou outlines/expanded/expansion/
      // outlineResearch — completados com os defaults (planos antigos ficam).
      migrate: (persisted, version) => {
        let p = (persisted ?? {}) as Partial<GraphState>;
        if (version < 5) {
          p = {
            ...p,
            project: p.project ? demoteUnprovenDone(p.project) : p.project,
            archivedProject: p.archivedProject ? demoteUnprovenDone(p.archivedProject) : p.archivedProject,
          };
        }
        if (version < 6 && p.objectiveDraft) {
          p = { ...p, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, ...p.objectiveDraft } };
        }
        return { ...p, project: normalizeStoredProjectVisuals(p.project), archivedProject: normalizeStoredProjectVisuals(p.archivedProject) } as GraphState;
      },
      // Campos novos ausentes num snapshot antigo caem no default do estado.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<GraphState>;
        const p = { ...saved, project: normalizeStoredProjectVisuals(saved.project), archivedProject: normalizeStoredProjectVisuals(saved.archivedProject) };
        return {
          ...current,
          ...p,
          drafts: p.drafts ?? current.drafts,
          objectiveDraft: {
            ...EMPTY_OBJECTIVE_DRAFT,
            ...(p.objectiveDraft ?? {}),
            expanded: p.objectiveDraft?.expanded ?? {},
          },
          archivedProject: p.archivedProject ?? null,
          lastTutorNodeId: p.lastTutorNodeId ?? null,
          // Sugestões custaram uma chamada de IA (BYOK): sobrevivem ao reload,
          // mas só se o pai ainda existe no projeto correspondente.
          pendingSuggestions: validBatch(p.pendingSuggestions, p.project ?? null),
          parkedSuggestions: Object.fromEntries(
            Object.entries(p.parkedSuggestions ?? {}).filter(
              ([pid, b]) => validBatch(b, p.project ?? null) && b.parentId === pid,
            ),
          ),
          archivedPending: validBatch(p.archivedPending, p.archivedProject ?? null),
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
        pendingSuggestions: state.pendingSuggestions,
        parkedSuggestions: state.parkedSuggestions,
        archivedPending: state.archivedPending,
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

// Fim da janela em que o lock ainda pode ser desfeito (0 = sem janela). Só
// depois dela o critério da IA aparece — senão daria para ver, destravar e
// copiar. Confirmar/"já sei" revelam na hora (não há lock a desfazer).
export const aiRevealGraceEnd = (
  node: Pick<ConceptNodeData, 'comoConfirmarUsuarioAt' | 'confirmado' | 'takenAsKnown'>,
): number =>
  node.comoConfirmarUsuarioAt && !node.confirmado && !node.takenAsKnown
    ? node.comoConfirmarUsuarioAt + CRITERION_UNLOCK_MS
    : 0;

export const canRevealAICriterionNow = (
  node: Pick<ConceptNodeData, 'comoConfirmarUsuarioAt' | 'confirmado' | 'takenAsKnown'>,
  nowMs: number = Date.now(),
): boolean => canRevealAICriterion(node) && nowMs >= aiRevealGraceEnd(node);

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

// Vizinhança de um nó para o prompt de explicação: pai, filhos e irmãos com
// oQue (preços/quantidades já fixados no plano). Raiz fica de fora.
export const relatedPartsFor = (
  project: Project,
  nodeId: string,
): { relation: 'parent' | 'child' | 'sibling'; name: string; oQue: string }[] => {
  const node = project.nodes[nodeId];
  if (!node) return [];
  const all = Object.values(project.nodes);
  const parent = node.parentId ? project.nodes[node.parentId] : undefined;
  const out: { relation: 'parent' | 'child' | 'sibling'; name: string; oQue: string }[] = [];
  if (parent && parent.kind !== 'root') out.push({ relation: 'parent', name: parent.name, oQue: parent.oQue });
  for (const n of all) {
    if (n.parentId === nodeId) out.push({ relation: 'child', name: n.name, oQue: n.oQue });
  }
  for (const n of all) {
    if (node.parentId && n.parentId === node.parentId && n.id !== nodeId) {
      out.push({ relation: 'sibling', name: n.name, oQue: n.oQue });
    }
  }
  return out.filter((p) => p.oQue?.trim());
};

// Resumo do resto do plano para prompts (cético, replan, quebrar): cada nó
// fora da subárvore de `nodeId`, rotulado pela categoria, em ordem de árvore.
export const planOverviewFor = (
  project: Project,
  nodeId: string,
): { category: string; name: string; oQue: string }[] => {
  const byParent = childrenByParent(project);
  const out: { category: string; name: string; oQue: string }[] = [];
  const walk = (id: string, category: string | null) => {
    for (const child of byParent.get(id) ?? []) {
      if (child.id === nodeId) continue; // a própria subárvore já vai no prompt
      const cat = category ?? child.name;
      out.push({ category: cat, name: child.name, oQue: child.oQue ?? '' });
      walk(child.id, cat);
    }
  };
  walk(project.rootId, null);
  return out;
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

/**
 * The decomposition frontier under `startId`: nodes with no children (the
 * current atoms) plus takenAsKnown nodes (floors — whatever lies below a floor
 * no longer counts). Only actionable kinds; containers resolve through these.
 */
export type PendingSuggestions = NonNullable<GraphState['pendingSuggestions']>;
type PendingRef = Pick<PendingSuggestions, 'parentId' | 'nodes'> | null | undefined;

const hasPendingAt = (pending: PendingRef, id: string): boolean =>
  !!pending && pending.parentId === id && pending.nodes.length > 0;

// Id sintético das sugestões em staging contadas como folhas abertas — nunca
// existe em project.nodes (não selecione por ele).
export const PENDING_LEAF_PREFIX = 'pending:';

/**
 * Com `pending`, as sugestões em staging contam como partes ABERTAS do pai
 * (folhas sintéticas, não confirmadas): aceitar 1 de N não deixa o pai
 * "completo" enquanto as outras esperam revisão. Um pai ainda sem filhos é
 * substituído pelas suas sugestões, como ficará quando forem aceitas.
 */
/**
 * `reviewing`: pais com sugestões ainda em revisão (lote ativo ou estacionado).
 * Um pai desses que já tem filhos aceitos ganha UMA parte aberta sintética
 * (ele mesmo, não resolvido): aceitar 1 de 4 sugestões não o deixa "resolvido"
 * enquanto as outras esperam — o mesmo predicado do nextPendingForTutor, sem
 * inflar o denominador com cada sugestão.
 */
export const effectiveLeavesUnder = (
  project: Project,
  startId: string,
  byParent?: Map<string, ConceptNodeData[]>,
  pending?: PendingRef,
  reviewing?: ReadonlySet<string>,
): ConceptNodeData[] => {
  const map = byParent ?? childrenByParent(project);
  const out: ConceptNodeData[] = [];
  const pushReviewing = (node: ConceptNodeData) => {
    out.push({
      ...node,
      id: PENDING_LEAF_PREFIX + node.id,
      confirmado: false,
      takenAsKnown: false,
      confirmedWithoutSignal: false,
    });
  };
  const start = project.nodes[startId];
  if (start && reviewing?.has(startId) && (map.get(startId) ?? []).length > 0) {
    pushReviewing(start);
  }
  const active = new Set([startId]);
  const stack = [{ id: startId, index: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const children = map.get(frame.id) ?? [];
    if (frame.index < children.length) {
      const child = children[frame.index++];
      if (child.takenAsKnown) {
        if (ACTIONABLE_KINDS.has(child.kind)) out.push(child);
        continue;
      }
      const kids = map.get(child.id);
      if ((kids && kids.length > 0) || hasPendingAt(pending, child.id)) {
        if (kids && kids.length > 0 && reviewing?.has(child.id)) pushReviewing(child);
        if (active.has(child.id)) throw new Error('Árvore de decomposição inválida: ciclo detectado.');
        active.add(child.id);
        stack.push({ id: child.id, index: 0 });
      } else if (ACTIONABLE_KINDS.has(child.kind)) {
        out.push(child);
      }
      continue;
    }
    const id = frame.id;
    if (pending && hasPendingAt(pending, id)) {
      for (const s of pending.nodes) {
        if (!ACTIONABLE_KINDS.has(s.data.kind)) continue;
        out.push({
          ...s.data,
          id: PENDING_LEAF_PREFIX + s.tempId,
          parentId: id,
          history: [],
          confirmado: false,
          takenAsKnown: false,
        } as ConceptNodeData);
      }
    }
    active.delete(id);
    stack.pop();
  }
  return out;
};

// Pais com sugestões em revisão: lote ativo + estacionados (não vazios).
export const reviewingParentIds = (
  pending: GraphState['pendingSuggestions'],
  parked: GraphState['parkedSuggestions'],
): Set<string> => {
  const ids = new Set<string>();
  if (pending && pending.nodes.length > 0) ids.add(pending.parentId);
  for (const [id, b] of Object.entries(parked ?? {})) if (b.nodes.length > 0) ids.add(id);
  return ids;
};

export const effectiveLeaves = (project: Project, pending?: PendingRef): ConceptNodeData[] =>
  effectiveLeavesUnder(project, project.rootId, undefined, pending);

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
  const active = new Set<string>();
  const resolved = new Set<string>();
  const stack = [{ id: nodeId, exiting: false }];
  while (stack.length > 0) {
    const { id, exiting } = stack.pop()!;
    if (resolved.has(id)) continue;
    if (exiting) {
      active.delete(id);
      resolved.add(id);
      continue;
    }
    const current = project.nodes[id];
    if (!current) return false;
    if (current.takenAsKnown) {
      resolved.add(id);
      continue;
    }
    if (active.has(id)) return false;
    const kids = map.get(id) ?? [];
    if (kids.length === 0) {
      if (!current.confirmado) return false;
      resolved.add(id);
      continue;
    }
    active.add(id);
    stack.push({ id, exiting: true });
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push({ id: kids[i].id, exiting: false });
    }
  }
  return true;
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
  blocked = isBlocked(project, nodeId),
): { ready: boolean; missing: string[]; missingKeys: ConcludeMissingKey[] } => {
  if (!project) return { ready: false, missing: ['sem projeto'], missingKeys: [] };
  const node = project.nodes[nodeId];
  if (!node) return { ready: false, missing: ['nó inexistente'], missingKeys: [] };
  const tr = t().store;
  const missing: string[] = [];
  const missingKeys: ConcludeMissingKey[] = [];
  if (blocked) {
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

// Só conta o que está em project.nodes: sugestões ainda não aceitas não
// entram no denominador (nem no total, nem por categoria) — o lote em revisão
// segura o "próximo" do tutor (nextPendingForTutor), não o progresso.
export const projectProgress = (
  project: Project | null,
  reviewing?: ReadonlySet<string>,
) => {
  if (!project) {
    return { total: 0, done: 0, doneWithSignal: 0, doneWithoutSignal: 0, percent: 0 };
  }
  const understand = project.archetype === 'entender';
  // Progress counts the decomposition frontier: every actionable leaf in ANY
  // archetype (a concept node the AI produced in a build project is still a
  // part the user must understand or confirm — hiding it from progress let the
  // tutor declare "done" with work pending).
  const leaves = effectiveLeavesUnder(project, project.rootId, undefined, undefined, reviewing);
  const total = leaves.length;
  const resolved = leaves.filter((n) => n.confirmado || n.takenAsKnown);
  const done = resolved.length;
  const doneWithoutSignal = resolved.filter((n) => resolvedWithoutSignal(n, understand)).length;
  const doneWithSignal = done - doneWithoutSignal;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, doneWithSignal, doneWithoutSignal, percent };
};

/** Recorded verification is distinct from a user-declared recursion floor. */
export const projectEvidenceProgress = (project: Project | null, reviewing?: ReadonlySet<string>) => {
  if (!project) return { withEvidence: 0, assumedKnown: 0 };
  const leaves = effectiveLeavesUnder(project, project.rootId, undefined, undefined, reviewing);
  return {
    withEvidence: leaves.filter((node) =>
      (node.confirmado || node.takenAsKnown) && !node.failureContext &&
      (Boolean(node.comoConfirmarAtendido) || (node.groundTruthRefs ?? []).some(refCountsAsSignal)),
    ).length,
    assumedKnown: leaves.filter((node) => node.takenAsKnown).length,
  };
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
export const nextPendingForTutor = (
  project: Project | null,
  pending?: PendingRef,
  reviewing?: ReadonlySet<string>,
): ConceptNodeData | null => {
  if (!project) return null;
  const byParent = childrenByParent(project);
  const underReview = (id: string) => hasPendingAt(pending, id) || Boolean(reviewing?.has(id));
  const active = new Set([project.rootId]);
  const stack: { id: string; index: number; reviewNode?: ConceptNodeData }[] = [
    { id: project.rootId, index: 0 },
  ];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const children = byParent.get(frame.id) ?? [];
    if (frame.index < children.length) {
      const child = children[frame.index++];
      if (child.takenAsKnown) continue;
      const kids = byParent.get(child.id);
      if (kids && kids.length > 0) {
        if (active.has(child.id)) throw new Error('Árvore de decomposição inválida: ciclo detectado.');
        active.add(child.id);
        stack.push({ id: child.id, index: 0, reviewNode: underReview(child.id) ? child : undefined });
        continue;
      }
      if (underReview(child.id)) return child;
      if (ACTIONABLE_KINDS.has(child.kind) && !child.confirmado) return child;
      continue;
    }
    active.delete(frame.id);
    stack.pop();
    // Filhos resolvidos mas sugestões ainda em revisão: o pai é o pendente.
    if (frame.reviewNode) return frame.reviewNode;
  }
  return null;
};

export const projectMetrics = (project: Project | null, reviewing?: ReadonlySet<string>) => {
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
    progress: projectProgress(project, reviewing),
  };
};

export type { Lens, ViewMode, NodeState, NodeKind };
