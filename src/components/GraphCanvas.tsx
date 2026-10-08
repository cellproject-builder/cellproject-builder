import { memo, useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  ControlButton,
  MiniMap,
  Panel,
  useReactFlow,
  useNodesInitialized,
  type Node,
  type Edge,
  type NodeChange,
  type NodeProps,
  applyNodeChanges,
  type EdgeTypes,
} from '@xyflow/react';
import {
  useGraphStore,
  computeTreeLayout,
  confidenceBand,
  isBlocked,
  canConcludeNode,
  stepSequence,
  childrenByParent,
  effectiveLeaves,
  isActionableKind,
  nextPendingForTutor,
  pendingParent,
  type Lens,
} from '@/store';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/i18n';
import type { Messages } from '@/i18n';
import { ConceptNode } from './ConceptNode';
import type { ConceptEdgeData, ConceptNodeData, Project } from '@/types';

// ---------------------------------------------------------------------------
// Cabeçalho de coluna (lentes Risco/Estado) — nó não interativo.
// ---------------------------------------------------------------------------

interface ColumnHeaderData {
  label: string;
  count: number;
  tone: string;
  width: number;
}

const ColumnHeaderNode = memo(function ColumnHeaderNode({ data }: NodeProps) {
  const d = data as unknown as ColumnHeaderData;
  return (
    // Cabeçalho quieto: texto primário, cor só no ponto; hairline neutra.
    <div
      style={{ width: d.width }}
      className="pointer-events-none select-none flex items-center gap-2 border-b border-border-base/70 pb-2 text-title3 font-semibold text-text-primary"
    >
      <span aria-hidden className={`w-2 h-2 rounded-full shrink-0 ${d.tone}`} />
      <span>{d.label}</span>
      <span className="font-medium tabular-nums text-text-muted">{d.count}</span>
    </div>
  );
});

const nodeTypes = { concept: ConceptNode, columnHeader: ColumnHeaderNode };

const MOBILE_LENSES: Lens[] = ['structure', 'flow', 'risk', 'state', 'connections'];
const LENS_LABEL_KEY = {
  structure: 'lensStructure',
  flow: 'lensFlow',
  risk: 'lensRisk',
  state: 'lensState',
  connections: 'lensConnections',
} as const satisfies Record<Lens, string>;

// 'direct' é a sequência comum (passo → próximo): neutra, para as cores
// guardarem significado para o que é exceção.
// Cores pelas variáveis do tema (claro/escuro automático), nunca hex.
const edgeStyleByKind: Record<ConceptEdgeData['kind'], { stroke: string; strokeWidth: number; strokeDasharray?: string }> = {
  // Cor opaca (mistura com o fundo) em vez de alpha: arestas sobrepostas não
  // escurecem onde se cruzam.
  direct: { stroke: 'color-mix(in srgb, rgb(var(--text-muted)) 70%, rgb(var(--bg-primary)))', strokeWidth: 1.5 },
  middleware: { stroke: 'rgb(var(--conn-middleware))', strokeWidth: 1.5, strokeDasharray: '4 3' },
  independent: { stroke: 'rgb(var(--conn-independent))', strokeWidth: 1.5, strokeDasharray: '6 4' },
  optional: { stroke: 'rgb(var(--conn-optional))', strokeWidth: 1.25, strokeDasharray: '2 3' },
};

const SUGGESTION_EDGE_STYLE = { stroke: 'rgb(var(--ai-accent))', strokeWidth: 1.5, strokeDasharray: '3 3' };

// Hierarchy (parent → part) is structure, not semantics — the tree already
// lives in parentId. Rendering it as a subtle skeleton keeps the kind colors
// meaning something.
// Opaca pelo mesmo motivo: as arestas categoria→filho que descem pela mesma
// coluna não viram uma barra grossa e escura.
const DECOMPOSITION_EDGE_STYLE = {
  stroke: 'color-mix(in srgb, rgb(var(--text-faint)) 45%, rgb(var(--bg-primary)))',
  strokeWidth: 1.25,
};

// Lentes Conexões/Fluxo: sem foco, as arestas ficam a meia força; com um nó
// em foco (hover/seleção), só as dele em cor cheia e o resto quase some.
const EDGE_IDLE_OPACITY = 0.5;
const EDGE_DIMMED_OPACITY = 0.15;

// Zoom mínimo do enquadramento automático: abaixo disso o texto dos cards
// fica ilegível. "Ver o grafo inteiro" continua livre.
const READABLE_MIN_ZOOM = 0.7;
const CONNECTIONS_MIN_ZOOM = 0.5;
// Folga mínima entre cards empilhados numa coluna (lentes de colunas).
const STACK_GAP = 28;

const edgeTypes: EdgeTypes = {};

const HEADER_PREFIX = 'header-';
const SUGGESTION_PREFIX = 'suggestion-';

// ---------------------------------------------------------------------------
// Lentes — cada uma decide quais nós aparecem, onde e com quais cabeçalhos.
// ---------------------------------------------------------------------------

type StateBucket = 'pending' | 'blocked' | 'noProof' | 'doneProof' | 'known' | 'problem';
const STATE_BUCKETS: StateBucket[] = ['pending', 'blocked', 'noProof', 'doneProof', 'known', 'problem'];

const stateBucketOf = (project: Project, n: ConceptNodeData): StateBucket => {
  if (n.state === 'problem' || n.failureContext) return 'problem';
  if (n.takenAsKnown) return 'known';
  if (n.confirmado) return n.state === 'done' && !n.confirmedWithoutSignal ? 'doneProof' : 'noProof';
  if (isBlocked(project, n.id)) return 'blocked';
  return 'pending';
};

// Cor do ponto do cabeçalho de coluna (o texto fica neutro).
const BUCKET_TONE: Record<StateBucket, string> = {
  pending: 'ring-1 ring-inset ring-text-faint/60',
  blocked: 'bg-text-faint/50',
  noProof: 'bg-conf-mid',
  doneProof: 'bg-state-done',
  known: 'bg-ai-accent',
  problem: 'bg-state-problem',
};

type RiskBand = 'low' | 'mid' | 'high';
const RISK_ORDER: RiskBand[] = ['low', 'mid', 'high'];
const RISK_TONE: Record<RiskBand, string> = {
  low: 'bg-conf-low',
  mid: 'bg-conf-mid',
  high: 'bg-conf-high',
};

interface LensHeader {
  id: string;
  label: string;
  count: number;
  tone: string;
  x: number;
  y: number;
  width: number;
}

interface LensLayout {
  positions: Record<string, { x: number; y: number }>;
  // null = todos os nós do projeto aparecem.
  visible: Set<string> | null;
  headers: LensHeader[];
  // Arestas derivadas só desta lente (sequência implícita entre passos).
  flowEdges?: FlowEdge[];
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

const FLOW_EDGE_PREFIX = 'flow-seq-';

// Colunas: largura de um card + folga; colunas longas quebram em sub-colunas
// para não virarem uma tira de 8000px que o fitView reduz a pílulas.
const COL_W = 340;
const COL_GAP = 120;
const ROW_H = 230;
const MAX_ROWS = 7;
const CARD_W = 300;

const columnsLayout = (
  groups: Array<{ key: string; label: string; tone: string; ids: string[] }>,
): Pick<LensLayout, 'positions' | 'headers'> => {
  const positions: LensLayout['positions'] = {};
  const headers: LensHeader[] = [];
  let x = 0;
  for (const g of groups) {
    if (g.ids.length === 0) continue; // sem colunas vazias
    const subCols = Math.ceil(g.ids.length / MAX_ROWS);
    g.ids.forEach((id, i) => {
      positions[id] = { x: x + Math.floor(i / MAX_ROWS) * COL_W, y: (i % MAX_ROWS) * ROW_H };
    });
    const width = (subCols - 1) * COL_W + CARD_W;
    headers.push({
      id: `${HEADER_PREFIX}${g.key}`,
      label: g.label,
      count: g.ids.length,
      tone: g.tone,
      x,
      y: -90,
      width,
    });
    x += width + COL_GAP;
  }
  return { positions, headers };
};

// Ordem de leitura da árvore (DFS em `order`) — chave estável para ordenar
// nós dentro de uma coluna ou camada.
const treeOrder = (project: Project): Map<string, number> => {
  const byParent = childrenByParent(project);
  const idx = new Map<string, number>();
  let i = 0;
  const walk = (id: string) => {
    idx.set(id, i++);
    for (const kid of byParent.get(id) ?? []) walk(kid.id);
  };
  walk(project.rootId);
  for (const id of Object.keys(project.nodes)) if (!idx.has(id)) idx.set(id, i++);
  return idx;
};

const isHierarchyEdge = (project: Project, e: ConceptEdgeData): boolean =>
  project.nodes[e.target]?.parentId === e.source || project.nodes[e.source]?.parentId === e.target;

const lensLayout = (lens: Lens, project: Project, tr: Messages): LensLayout => {
  const nodes = Object.values(project.nodes);
  const edges = Object.values(project.edges);

  if (lens === 'structure') {
    const positions: LensLayout['positions'] = {};
    nodes.forEach((n) => (positions[n.id] = n.position));
    return { positions, visible: null, headers: [] };
  }

  const order = treeOrder(project);
  const byOrder = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0);

  if (lens === 'state' || lens === 'risk') {
    // Só folhas efetivas: raiz e categorias se resolvem pelos filhos e só
    // poluíam as colunas (confiança 100 fixa, estado 'validated').
    const leaves = effectiveLeaves(project);
    const visible = new Set(leaves.map((n) => n.id));
    if (lens === 'state') {
      const groups = STATE_BUCKETS.map((b) => ({
        key: b,
        label: tr.graph.bucket[b],
        tone: BUCKET_TONE[b],
        ids: leaves.filter((n) => stateBucketOf(project, n) === b).map((n) => n.id).sort(byOrder),
      }));
      return { ...columnsLayout(groups), visible };
    }
    // Risco = trabalho pendente por faixa de confiança (o resolvido não corre risco).
    const pendingLeaves = leaves.filter((n) => !n.confirmado && !n.takenAsKnown);
    const riskVisible = new Set(pendingLeaves.map((n) => n.id));
    const groups = RISK_ORDER.map((band) => ({
      key: band,
      label: tr.graph.risk[band],
      tone: RISK_TONE[band],
      ids: pendingLeaves
        .filter((n) => confidenceBand(n.confidence) === band)
        .map((n) => n.id)
        .sort(byOrder),
    }));
    return { ...columnsLayout(groups), visible: riskVisible };
  }

  if (lens === 'flow') {
    // Fluxo = a ordem de trabalho sobre a fronteira da decomposição (folhas
    // acionáveis). Recursos/conceitos/decisões numa grade à esquerda; passos em
    // camadas que descem em y, ligados pela sequência — as arestas explícitas
    // (não-hierarquia) e, sem elas, a ordem entre passos irmãos.
    const work = effectiveLeaves(project);
    const visible = new Set(work.map((n) => n.id));
    const steps = work.filter((n) => n.kind === 'passo');
    const others = work.filter((n) => n.kind !== 'passo').map((n) => n.id).sort(byOrder);
    const preds: Record<string, string[]> = {};
    const seen = new Set<string>();
    const flowEdges: FlowEdge[] = [];
    const link = (source: string, target: string, explicit: boolean) => {
      const key = `${source}>${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      (preds[target] ||= []).push(source);
      if (!explicit) flowEdges.push({ id: `${FLOW_EDGE_PREFIX}${source}-${target}`, source, target });
    };
    edges.forEach((e) => {
      if (isHierarchyEdge(project, e)) return;
      if (!visible.has(e.source) || !visible.has(e.target)) return;
      link(e.source, e.target, true);
    });
    const stepsByParent = new Map<string, ConceptNodeData[]>();
    steps.forEach((n) => {
      const k = n.parentId ?? '';
      const arr = stepsByParent.get(k);
      if (arr) arr.push(n);
      else stepsByParent.set(k, [n]);
    });
    stepsByParent.forEach((arr) => {
      arr.sort((a, b) => a.order - b.order || byOrder(a.id, b.id));
      for (let i = 1; i < arr.length; i++) {
        // Já há aresta explícita entrando no passo: ela manda.
        if ((preds[arr[i].id] ?? []).length > 0) continue;
        link(arr[i - 1].id, arr[i].id, false);
      }
    });
    const depth: Record<string, number> = {};
    const computeDepth = (id: string, visiting: Set<string>): number => {
      if (depth[id] !== undefined) return depth[id];
      if (visiting.has(id)) return 0; // ciclo
      visiting.add(id);
      const ps = (preds[id] || []).filter((p) => steps.some((s) => s.id === p));
      const d = ps.length === 0 ? 0 : 1 + Math.max(...ps.map((p) => computeDepth(p, visiting)));
      visiting.delete(id);
      depth[id] = d;
      return d;
    };
    steps.forEach((n) => computeDepth(n.id, new Set()));
    const positions: LensLayout['positions'] = {};
    const headers: LensHeader[] = [];
    // Grade de recursos: 2 colunas à esquerda.
    const GRID_COLS = 2;
    const gridWidth = others.length > 0 ? (Math.min(GRID_COLS, others.length) - 1) * COL_W + CARD_W : 0;
    others.forEach((id, i) => {
      positions[id] = { x: (i % GRID_COLS) * COL_W, y: Math.floor(i / GRID_COLS) * ROW_H };
    });
    if (others.length > 0) {
      headers.push({
        id: `${HEADER_PREFIX}flow-res`,
        label: tr.graph.flowResources,
        count: others.length,
        tone: 'bg-text-faint/50',
        x: 0,
        y: -90,
        width: gridWidth,
      });
    }
    const stepsX = others.length > 0 ? gridWidth + COL_GAP * 2 : 0;
    const byLayer: Record<number, string[]> = {};
    steps.forEach((n) => (byLayer[depth[n.id]] ||= []).push(n.id));
    let maxLayer = 1;
    Object.entries(byLayer).forEach(([d, ids]) => {
      ids.sort(byOrder);
      maxLayer = Math.max(maxLayer, ids.length);
      ids.forEach((id, i) => {
        positions[id] = { x: stepsX + i * COL_W, y: Number(d) * 260 };
      });
    });
    if (steps.length > 0) {
      headers.push({
        id: `${HEADER_PREFIX}flow-steps`,
        label: tr.graph.flowSteps,
        count: steps.length,
        tone: 'bg-text-faint/50',
        x: stepsX,
        y: -90,
        width: (maxLayer - 1) * COL_W + CARD_W,
      });
    }
    return { positions, visible, headers, flowEdges };
  }

  // connections: radial simples por grau; o raio cresce com o número de nós.
  const deg: Record<string, number> = {};
  edges.forEach((e) => {
    deg[e.source] = (deg[e.source] || 0) + 1;
    deg[e.target] = (deg[e.target] || 0) + 1;
  });
  // Dois anéis (os mais conectados por dentro) em vez de um círculo enorme:
  // o conjunto cabe num zoom em que os cards ainda se leem.
  const sorted = [...nodes].sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0));
  const positions: LensLayout['positions'] = {};
  const rest = sorted.slice(1);
  const innerN = Math.min(rest.length, Math.max(6, Math.round(rest.length * 0.38)));
  const inner = rest.slice(0, innerN);
  const outer = rest.slice(innerN);
  const SLOT = COL_W - 10; // largura de um card + folga ao longo do anel
  const r1 = Math.max(380, (inner.length * SLOT) / (2 * Math.PI));
  const r2 = Math.max(r1 + 300, (outer.length * SLOT) / (2 * Math.PI));
  const place = (id: string, angle: number, r: number) => {
    positions[id] = { x: Math.cos(angle) * r - CARD_W / 2, y: Math.sin(angle) * r * 0.8 - 50 };
  };
  if (sorted[0]) positions[sorted[0].id] = { x: -CARD_W / 2, y: -50 };
  inner.forEach((n, i) => place(n.id, (i / inner.length) * Math.PI * 2 - Math.PI / 2, r1));
  outer.forEach((n, i) => place(n.id, ((i + 0.5) / outer.length) * Math.PI * 2 - Math.PI / 2, r2));
  return { positions, visible: null, headers: [] };
};

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function GraphCanvas() {
  const tr = useT();
  const isMobile = useIsMobile();
  const { fitView, setCenter, setViewport, getZoom, getNode, getNodes, getNodesBounds, zoomIn, zoomOut } =
    useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const project = useGraphStore((s) => s.project);
  const lens = useGraphStore((s) => s.lens);
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const selectionVersion = useGraphStore((s) => s.selectionVersion);
  const focusedParentId = useGraphStore((s) => s.focusedParentId);
  const focusVersion = useGraphStore((s) => s.focusVersion);
  const centerRequest = useGraphStore((s) => s.centerRequest);
  const pending = useGraphStore((s) => s.pendingSuggestions);
  const stagingParent = useGraphStore(pendingParent);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusNode = useGraphStore((s) => s.focusNode);
  const setLens = useGraphStore((s) => s.setLens);
  const updateNodePosition = useGraphStore((s) => s.updateNodePosition);
  const applyLayoutPositions = useGraphStore((s) => s.applyLayoutPositions);
  const acceptAllSuggestions = useGraphStore((s) => s.acceptAllSuggestions);
  const rejectAllSuggestions = useGraphStore((s) => s.rejectAllSuggestions);

  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Seleção feita por clique no próprio canvas: no desktop o nó já está à
  // vista, então não mexemos na câmera.
  const clickedInCanvasRef = useRef(false);

  const layout = useMemo<LensLayout | null>(
    () => (project ? lensLayout(lens, project, tr) : null),
    [project, lens, tr],
  );

  // -------------------------------------------------------------------------
  // Câmera
  // -------------------------------------------------------------------------

  const isOnCanvas = useCallback(
    (id: string) => !!layout && (layout.visible === null || layout.visible.has(id)),
    [layout],
  );

  const centerOn = useCallback(
    (id: string) => {
      const n = getNode(id);
      if (!n) return;
      const w = n.measured?.width ?? n.width ?? 260;
      const h = n.measured?.height ?? n.height ?? 120;
      const zoom = Math.max(getZoom(), 0.9);
      let cy = n.position.y + h / 2;
      // No mobile o sheet cobre a metade de baixo: o nó sobe 25% da tela.
      if (isMobile) {
        const vh = containerRef.current?.clientHeight ?? window.innerHeight;
        cy += (vh * 0.25) / zoom;
      }
      setCenter(n.position.x + w / 2, cy, { zoom, duration: 300 });
    },
    [getNode, getZoom, setCenter, isMobile],
  );

  const fitIds = useCallback(
    (ids: string[], padding = 0.25) => {
      const present = ids.filter((id) => getNode(id));
      if (present.length === 0) return;
      void fitView({ nodes: present.map((id) => ({ id })), padding, duration: 350, maxZoom: 1.2 });
    },
    [fitView, getNode],
  );

  // Enquadramento legível: encaixa tudo se couber num zoom de leitura; senão
  // fica no zoom mínimo legível e ancora no começo (topo da raiz na Estrutura,
  // canto superior esquerdo nas colunas, centro nas Conexões).
  const frameOverview = useCallback(
    (duration = 350) => {
      const el = containerRef.current;
      const st = useGraphStore.getState();
      const proj = st.project;
      if (!el || !proj) return;
      const all = getNodes().filter((n) => !n.hidden && !n.id.startsWith(SUGGESTION_PREFIX));
      if (all.length === 0) return;
      const W = el.clientWidth;
      const H = el.clientHeight;
      const pad = W < 640 ? 24 : 48;
      const b = getNodesBounds(all.map((n) => n.id));
      if (b.width <= 0 || b.height <= 0) return;
      const fit = Math.min((W - pad * 2) / b.width, (H - pad * 2) / b.height);
      // Conexões é um mapa de relações: precisa caber inteiro, com piso menor.
      const floor = st.lens === 'connections' ? CONNECTIONS_MIN_ZOOM : READABLE_MIN_ZOOM;
      const zoom = Math.min(1, Math.max(floor, fit));
      const fitsX = b.width * zoom <= W - pad * 2;
      const fitsY = b.height * zoom <= H - pad * 2;
      let x: number;
      let y: number;
      if (st.lens === 'connections') {
        x = W / 2 - (b.x + b.width / 2) * zoom;
        y = H / 2 - (b.y + b.height / 2) * zoom;
      } else if (st.lens === 'structure') {
        // Raiz + primeiro nível centrados no eixo x; topo da árvore no alto.
        const firstLevel = [
          proj.rootId,
          ...all.filter((n) => proj.nodes[n.id]?.parentId === proj.rootId).map((n) => n.id),
        ].filter((id) => getNode(id));
        const fb = firstLevel.length > 0 ? getNodesBounds(firstLevel) : b;
        const cx = fitsX ? b.x + b.width / 2 : fb.x + fb.width / 2;
        x = W / 2 - cx * zoom;
        y = fitsY ? (H - b.height * zoom) / 2 - b.y * zoom : pad - b.y * zoom;
      } else {
        x = fitsX ? (W - b.width * zoom) / 2 - b.x * zoom : pad - b.x * zoom;
        y = fitsY ? (H - b.height * zoom) / 2 - b.y * zoom : pad - b.y * zoom;
      }
      void setViewport({ x, y, zoom }, { duration });
    },
    [getNodes, getNodesBounds, getNode, setViewport],
  );

  // Timers de câmera em refs: um re-render no meio (projeto mudou) não pode
  // cancelar um enquadramento já pedido. Só a desmontagem limpa.
  const camTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = useCallback(
    (slot: { current: ReturnType<typeof setTimeout> | null }, fn: () => void, ms: number) => {
      if (slot.current) clearTimeout(slot.current);
      slot.current = setTimeout(() => {
        slot.current = null;
        fn();
      }, ms);
    },
    [],
  );
  useEffect(
    () => () => {
      if (camTimer.current) clearTimeout(camTimer.current);
      if (stageTimer.current) clearTimeout(stageTimer.current);
    },
    [],
  );

  const frameStaging = useCallback(() => {
    const p = useGraphStore.getState().pendingSuggestions;
    if (!p) return;
    fitIds([p.parentId, ...p.nodes.map((n) => `${SUGGESTION_PREFIX}${n.tempId}`)], 0.3);
  }, [fitIds]);

  // Montagem: com um nó útil selecionado (vindo do tutor, por exemplo),
  // centraliza nele em vez de mostrar a árvore inteira.
  const [initialTarget] = useState<string | null>(() => {
    const s = useGraphStore.getState();
    const sel = s.selectedNodeId;
    if (!s.project || !sel || sel === s.project.rootId || !s.project.nodes[sel]) return null;
    return sel;
  });
  useEffect(() => {
    if (!initialTarget) return;
    schedule(
      camTimer,
      () => {
        if (isOnCanvas(initialTarget)) centerOn(initialTarget);
        else frameOverview(300);
      },
      60,
    );
    // só na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Sem alvo: assim que os cards têm tamanho medido, enquadra legível.
  const didInitialFrame = useRef(false);
  useEffect(() => {
    if (didInitialFrame.current || initialTarget || !nodesInitialized) return;
    didInitialFrame.current = true;
    schedule(camTimer, () => frameOverview(0), 30);
  }, [nodesInitialized, initialTarget, frameOverview, schedule]);

  // Um efeito só para os pedidos de câmera — breadcrumb (focusNode) chama
  // selectNode junto, e o enquadramento da subárvore tem precedência.
  const prevCam = useRef({
    lens,
    focusVersion,
    centerVersion: centerRequest?.version ?? 0,
    selectionVersion,
  });
  useEffect(() => {
    const p = prevCam.current;
    const centerVersion = centerRequest?.version ?? 0;
    prevCam.current = { lens, focusVersion, centerVersion, selectionVersion };
    let action: (() => void) | null = null;

    if (lens !== p.lens) {
      action = () => frameOverview(350);
    } else if (focusVersion !== p.focusVersion && focusedParentId && project) {
      const ids = [
        focusedParentId,
        ...Object.values(project.nodes)
          .filter((n) => n.parentId === focusedParentId)
          .map((n) => n.id),
      ].filter(isOnCanvas);
      action = () => {
        if (ids.length > 1) fitIds(ids, 0.2);
        else if (ids.length === 1) centerOn(ids[0]);
      };
    } else if (centerVersion !== p.centerVersion && centerRequest) {
      const id = centerRequest.nodeId;
      if (isOnCanvas(id)) action = () => centerOn(id);
    } else if (selectionVersion !== p.selectionVersion && selectedId) {
      const fromCanvas = clickedInCanvasRef.current;
      if ((!fromCanvas || isMobile) && isOnCanvas(selectedId)) action = () => centerOn(selectedId);
    }
    clickedInCanvasRef.current = false;
    if (action) schedule(camTimer, action, 60);
  }, [
    lens,
    focusVersion,
    focusedParentId,
    centerRequest,
    selectionVersion,
    selectedId,
    project,
    isMobile,
    frameOverview,
    fitIds,
    centerOn,
    isOnCanvas,
    schedule,
  ]);

  // Sugestões novas (decompor): enquadra pai + sugestões. Fora da Estrutura
  // elas não têm onde aparecer, então a lente volta para a Estrutura.
  const stagingKey = pending ? pending.parentId : null;
  const prevStagingKey = useRef(stagingKey);
  useEffect(() => {
    const prev = prevStagingKey.current;
    prevStagingKey.current = stagingKey;
    if (!stagingKey || stagingKey === prev) return;
    if (useGraphStore.getState().lens !== 'structure') {
      setLens('structure');
      // A troca de lente reenquadra tudo; o enquadramento das sugestões
      // vem depois dela.
      schedule(stageTimer, frameStaging, 450);
      return;
    }
    schedule(stageTimer, frameStaging, 80);
  }, [stagingKey, setLens, frameStaging, schedule]);

  // Esc limpa a seleção (o painel passa a mostrar o resumo do projeto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (!useGraphStore.getState().selectedNodeId) return;
      selectNode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectNode]);

  // Tidy tree: recompute positions for the whole decomposition and persist
  // them (structure lens shows stored positions, so switch to it).
  const handleTidy = useCallback(() => {
    if (!project) return;
    applyLayoutPositions(computeTreeLayout(project));
    if (lens !== 'structure') setLens('structure');
    else schedule(camTimer, () => void fitView({ padding: 0.15, duration: 350 }), 50);
  }, [project, lens, applyLayoutPositions, setLens, fitView, schedule]);

  // -------------------------------------------------------------------------
  // Nós
  // -------------------------------------------------------------------------

  const computedNodes: Node[] = useMemo(() => {
    if (!project || !layout) return [];
    const nodeList = Object.values(project.nodes).filter(
      (n) => layout.visible === null || layout.visible.has(n.id),
    );
    const edgeList = Object.values(project.edges);
    const nextId = nextPendingForTutor(project, pending)?.id ?? null;

    const childCountByParent: Record<string, number> = {};
    Object.values(project.nodes).forEach((n) => {
      if (n.parentId) {
        childCountByParent[n.parentId] = (childCountByParent[n.parentId] || 0) + 1;
      }
    });

    const edgeCountByNode: Record<string, number> = {};
    edgeList.forEach((e) => {
      edgeCountByNode[e.source] = (edgeCountByNode[e.source] || 0) + 1;
      edgeCountByNode[e.target] = (edgeCountByNode[e.target] || 0) + 1;
    });

    const base: Node[] = nodeList.map((n) => {
      const isLeafAction = isActionableKind(n.kind) && !childCountByParent[n.id];
      return {
        id: n.id,
        type: 'concept',
        position: layout.positions[n.id] || n.position,
        data: {
          ...n,
          childCount: childCountByParent[n.id] || 0,
          edgeCount: edgeCountByNode[n.id] || 0,
          // Precomputed here (once per project change) so each ConceptNode
          // doesn't subscribe to the whole project.
          blocked: n.kind === 'passo' && isBlocked(project, n.id),
          stepNo: n.kind === 'passo' ? stepSequence(project, n.id) : null,
          isNext: n.id === nextId,
          canConclude: isLeafAction && !n.confirmado ? canConcludeNode(project, n.id).ready : false,
        },
        selected: n.id === selectedId,
        draggable: lens === 'structure',
      };
    });

    layout.headers.forEach((h) => {
      base.push({
        id: h.id,
        type: 'columnHeader',
        position: { x: h.x, y: h.y },
        data: { label: h.label, count: h.count, tone: h.tone, width: h.width } satisfies ColumnHeaderData,
        draggable: false,
        selectable: false,
        focusable: false,
        connectable: false,
      });
    });

    // Sugestões só existem na Estrutura (a posição delas é relativa ao pai lá).
    if (pending && lens === 'structure') {
      pending.nodes.forEach((p) => {
        const pos = p.data.position as { x: number; y: number };
        base.push({
          id: `${SUGGESTION_PREFIX}${p.tempId}`,
          type: 'concept',
          position: pos,
          data: {
            ...p.data,
            tempId: p.tempId,
            isSuggestion: true,
            childCount: 0,
            edgeCount: 0,
          },
          draggable: false,
          selectable: false,
          // Por cima dos nós existentes, se a posição sugerida colidir.
          zIndex: 10,
        });
      });
    }

    return base;
  }, [project, layout, lens, selectedId, pending]);

  // React Flow precisa ser controlado: aplicamos NodeChanges (drag, select,
  // resize) num state local e ressincronizamos sempre que o store recalcular
  // computedNodes. Durante o drag o store não muda — `updateNodePosition` só
  // é chamado em `dragging === false` — portanto não há race com o useEffect.
  const [nodes, setNodes] = useState<Node[]>(computedNodes);
  useEffect(() => {
    setNodes(computedNodes);
  }, [computedNodes]);

  // Lentes de colunas: o layout usa uma altura de linha fixa, mas os cards
  // expandidos variam. Medidos, empilha cada coluna com folga mínima.
  useEffect(() => {
    if (!layout || (lens !== 'state' && lens !== 'risk' && lens !== 'flow')) return;
    const cols = new Map<number, Node[]>();
    for (const n of nodes) {
      if (n.type !== 'concept' || !layout.positions[n.id]) continue;
      if (!n.measured?.height) return; // espera todos medidos
      const x = layout.positions[n.id].x;
      const arr = cols.get(x);
      if (arr) arr.push(n);
      else cols.set(x, [n]);
    }
    const next: Record<string, number> = {};
    cols.forEach((arr) => {
      arr.sort((a, b) => layout.positions[a.id].y - layout.positions[b.id].y);
      let bottom = -Infinity;
      for (const n of arr) {
        // Fluxo mantém as camadas alinhadas (só desce se sobrepor); Risco e
        // Estado empilham pela altura real.
        const ly = layout.positions[n.id].y;
        const y = bottom === -Infinity ? ly : lens === 'flow' ? Math.max(ly, bottom + STACK_GAP) : bottom + STACK_GAP;
        if (Math.abs(y - n.position.y) > 0.5) next[n.id] = y;
        bottom = y + (n.measured?.height ?? 0);
      }
    });
    if (Object.keys(next).length === 0) return;
    setNodes((curr) =>
      curr.map((n) => (next[n.id] !== undefined ? { ...n, position: { ...n.position, y: next[n.id] } } : n)),
    );
  }, [nodes, layout, lens]);

  // -------------------------------------------------------------------------
  // Arestas
  // -------------------------------------------------------------------------

  const rfEdges: Edge[] = useMemo(() => {
    if (!project || !layout) return [];
    const shown = (id: string) => layout.visible === null || layout.visible.has(id);
    const focusIds = new Set([selectedId, hoveredId].filter(Boolean) as string[]);
    const dimmable = lens === 'connections' || lens === 'flow';
    const dimOpacity = (touches: boolean) =>
      touches ? 1 : focusIds.size > 0 ? EDGE_DIMMED_OPACITY : EDGE_IDLE_OPACITY;
    const base: Edge[] = [];
    for (const e of Object.values(project.edges)) {
      if (!shown(e.source) || !shown(e.target)) continue;
      const hierarchy = isHierarchyEdge(project, e);
      const touchesFocus = focusIds.has(e.source) || focusIds.has(e.target);
      if (lens === 'structure') {
        // Estrutura: o esqueleto de decomposição sempre; dependências só no
        // hover ou com o nó selecionado — senão viram um novelo.
        if (!hierarchy && !touchesFocus) continue;
      } else if (lens === 'flow') {
        if (hierarchy) continue;
      } else if (lens === 'state' || lens === 'risk') {
        if (hierarchy || !touchesFocus) continue;
      }
      const baseStyle = hierarchy ? DECOMPOSITION_EDGE_STYLE : edgeStyleByKind[e.kind];
      base.push({
        id: e.id,
        source: e.source,
        target: e.target,
        style: dimmable ? { ...baseStyle, opacity: dimOpacity(touchesFocus) } : baseStyle,
        animated: !isMobile && !hierarchy && touchesFocus,
        // Sempre sob os nós: a aresta destacada não risca títulos de cards.
        zIndex: 0,
      });
    }

    if (lens === 'flow') {
      for (const fe of layout.flowEdges ?? []) {
        const touchesFocus = focusIds.has(fe.source) || focusIds.has(fe.target);
        base.push({
          id: fe.id,
          source: fe.source,
          target: fe.target,
          style: { ...edgeStyleByKind.direct, opacity: dimOpacity(touchesFocus) },
          animated: !isMobile && touchesFocus,
          zIndex: 0,
        });
      }
    }

    if (pending && lens === 'structure') {
      pending.nodes.forEach((p) => {
        base.push({
          id: `sugg-edge-${p.tempId}`,
          source: pending.parentId,
          target: `${SUGGESTION_PREFIX}${p.tempId}`,
          style: SUGGESTION_EDGE_STYLE,
          animated: !isMobile,
        });
      });
    }

    return base;
  }, [project, layout, lens, pending, isMobile, selectedId, hoveredId]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((curr) => applyNodeChanges(changes, curr));
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          if (!change.id.startsWith(SUGGESTION_PREFIX) && !change.id.startsWith(HEADER_PREFIX)) {
            updateNodePosition(change.id, change.position);
          }
        }
      }
    },
    [updateNodePosition],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id.startsWith(SUGGESTION_PREFIX) || node.id.startsWith(HEADER_PREFIX)) return;
      clickedInCanvasRef.current = true;
      selectNode(node.id);
    },
    [selectNode],
  );

  const onNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'concept' && !node.id.startsWith(SUGGESTION_PREFIX)) setHoveredId(node.id);
  }, []);
  const onNodeMouseLeave = useCallback(() => setHoveredId(null), []);

  const emptyLens = !!layout && layout.visible !== null && layout.visible.size === 0;

  return (
    <div ref={containerRef} className="flex-1 relative bg-bg-primary">
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        fitView={!initialTarget}
        fitViewOptions={{ padding: 0.15, minZoom: READABLE_MIN_ZOOM, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        colorMode="system"
        proOptions={{ hideAttribution: true }}
      >
        {/* size 2: o React Flow escala o ponto pelo zoom; com 1 ele some abaixo de 100%. */}
        <Background variant={BackgroundVariant.Dots} gap={20} size={2} />
        {/* Controles próprios: no mobile os botões têm 44px de alvo de toque. */}
        <Controls showZoom={false} showFitView={false} showInteractive={false}>
          {(
            [
              { label: tr.graph.zoomIn, glyph: '+', onClick: () => void zoomIn({ duration: 200 }) },
              { label: tr.graph.zoomOut, glyph: '−', onClick: () => void zoomOut({ duration: 200 }) },
              { label: tr.graph.fitAll, glyph: '⤢', onClick: () => void fitView({ padding: 0.15, duration: 300 }) },
            ] as const
          ).map((b) => (
            <ControlButton
              key={b.glyph}
              onClick={b.onClick}
              title={b.label}
              aria-label={b.label}
              className={`!text-[15px] !leading-none ${isMobile ? '!w-11 !h-11' : '!w-8 !h-8'}`}
            >
              <span aria-hidden>{b.glyph}</span>
            </ControlButton>
          ))}
        </Controls>
        {isMobile ? (
          // Mobile: os três controles numa única barra de vidro (sem frestas
          // por onde o texto dos cards aparecia), todos com 44px de alvo.
          <Panel
            position="top-left"
            className="glass-host border rounded-card shadow-mac p-1 flex items-center gap-1 max-w-[calc(100%-24px)]"
          >
            <button
              onClick={handleTidy}
              title={tr.graph.tidyTitle}
              aria-label={tr.graph.tidy}
              className="tap btn btn-ghost btn-icon text-text-primary"
            >
              <TidyIcon />
            </button>
            <select
              value={lens}
              onChange={(e) => setLens(e.target.value as Lens)}
              aria-label={tr.topBar.lensSelectAria}
              className="tap h-[30px] min-w-0 rounded-control bg-transparent hover:bg-bg-elevated/60 pl-2.5 pr-7 text-control text-text-primary border-0"
            >
              {MOBILE_LENSES.map((l) => (
                <option key={l} value={l}>
                  {tr.topBar[LENS_LABEL_KEY[l]]}
                </option>
              ))}
            </select>
            <span aria-hidden className="w-px h-5 bg-border-base/70 shrink-0" />
            <EdgeLegend key={lens} tr={tr} inBar />
          </Panel>
        ) : (
          <>
            <Panel position="top-left" className="flex items-center gap-2">
              <button
                onClick={handleTidy}
                title={tr.graph.tidyTitle}
                className="tap glass btn shadow-mac text-text-primary hover:bg-bg-elevated/60"
              >
                <TidyIcon />
                {tr.graph.tidy}
              </button>
            </Panel>
            <Panel position="top-right">
              {/* key=lens: trocar de lente fecha a legenda (não cobre colunas novas). */}
              <EdgeLegend key={lens} tr={tr} />
            </Panel>
          </>
        )}
        {pending && pending.nodes.length > 0 && (
          <Panel position="top-center" className="!mt-16 md:!mt-3 max-w-[calc(100vw-24px)]">
            <div
              role="status"
              className="glass border animate-sheet-in flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card shadow-mac-lg pl-3.5 pr-2 py-2 text-control"
            >
              <span className="ai-icon" aria-hidden>
                ✦
              </span>
              <span className="text-text-primary">
                {tr.graph.stagingSummary(pending.nodes.length, stagingParent?.name ?? '')}
              </span>
              <span className="flex items-center gap-1.5 ml-auto">
                <button
                  onClick={() => {
                    if (lens !== 'structure') {
                      setLens('structure');
                      schedule(stageTimer, frameStaging, 450);
                    } else frameStaging();
                  }}
                  className="tap btn btn-tertiary"
                >
                  {tr.graph.viewStaging}
                </button>
                <button onClick={rejectAllSuggestions} className="tap btn btn-secondary">
                  {tr.graph.rejectAll}
                </button>
                <button
                  onClick={() => {
                    const parentId = pending.parentId;
                    acceptAllSuggestions();
                    // Aceitas, a árvore é relayoutada: enquadra a subárvore nova.
                    focusNode(parentId);
                  }}
                  className="tap btn btn-primary"
                >
                  {tr.graph.acceptAll}
                </button>
              </span>
            </div>
          </Panel>
        )}
        {emptyLens && (
          <Panel position="top-center" className="!mt-24">
            <div className="glass border rounded-card shadow-mac px-4 py-2.5 text-control text-text-muted">
              {tr.graph.lensEmpty}
            </div>
          </Panel>
        )}
        {/* The minimap eats a big slice of a phone screen for little return. */}
        {!isMobile && (
          <MiniMap
            maskStrokeWidth={1}
            nodeColor={(n) => {
              if (n.type === 'columnHeader') return 'transparent';
              const d = n.data as unknown as ConceptNodeData | undefined;
              if (!d) return 'rgb(var(--text-faint) / .5)';
              // Suggestions em staging aparecem em violeta pra combinar com as edges.
              if ((n.data as { isSuggestion?: boolean }).isSuggestion) return 'rgb(var(--ai-accent))';
              // Estados terminais têm precedência visual sobre confiança.
              // Tons baixos: o minimapa orienta, não grita.
              if (d.state === 'done') return 'rgb(var(--state-done) / .4)';
              if (d.state === 'problem') return 'rgb(var(--state-problem) / .45)';
              if (d.state === 'discarded') return 'rgb(var(--state-discarded) / .5)';
              const band = confidenceBand(d.confidence);
              return band === 'high'
                ? 'rgb(var(--conf-high) / .25)'
                : band === 'mid'
                ? 'rgb(var(--conf-mid) / .25)'
                : 'rgb(var(--conf-low) / .3)';
            }}
            nodeStrokeColor="transparent"
            nodeStrokeWidth={0}
            nodeBorderRadius={12}
            pannable
            zoomable
            style={{ width: 168, height: 112 }}
          />
        )}
      </ReactFlow>
    </div>
  );
}

function TidyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-text-muted">
      <rect x="6" y="1.5" width="4" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="11.5" width="4" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="10.5" y="11.5" width="4" height="3" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.5V8M3.5 11.5V8h9v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Edge legend — the four edge kinds + staging suggestions, collapsible so it
// stays a small chip until asked (and by default on phones).
// ---------------------------------------------------------------------------

function Swatch({ stroke, dash, width = 2 }: { stroke: string; dash?: string; width?: number }) {
  return (
    <svg width="24" height="6" className="shrink-0" aria-hidden>
      <line x1="0" y1="3" x2="24" y2="3" stroke={stroke} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

function EdgeLegend({ tr, inBar = false }: { tr: Messages; inBar?: boolean }) {
  const [open, setOpen] = useState(false);
  const rows: Array<{ label: string; stroke: string; dash?: string; width?: number }> = [
    { label: tr.graph.legendDecomposition, stroke: DECOMPOSITION_EDGE_STYLE.stroke, width: DECOMPOSITION_EDGE_STYLE.strokeWidth },
    { label: tr.graph.legendDirect, stroke: edgeStyleByKind.direct.stroke, width: edgeStyleByKind.direct.strokeWidth },
    { label: tr.graph.legendMiddleware, stroke: edgeStyleByKind.middleware.stroke, dash: edgeStyleByKind.middleware.strokeDasharray },
    { label: tr.graph.legendIndependent, stroke: edgeStyleByKind.independent.stroke, dash: edgeStyleByKind.independent.strokeDasharray },
    { label: tr.graph.legendOptional, stroke: edgeStyleByKind.optional.stroke, dash: edgeStyleByKind.optional.strokeDasharray },
    { label: tr.graph.legendSuggestion, stroke: SUGGESTION_EDGE_STYLE.stroke, dash: SUGGESTION_EDGE_STYLE.strokeDasharray },
  ];
  return (
    // Pílula do mesmo tamanho dos outros controles; a legenda abre como
    // popover (não estica a barra).
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`tap h-[30px] px-3 rounded-control text-footnote font-medium text-text-secondary hover:text-text-primary flex items-center gap-2 transition-colors duration-120 ease-mac ${
          inBar ? 'hover:bg-bg-elevated/60' : 'glass border shadow-mac'
        }`}
      >
        <span>{tr.graph.legend}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden
          className={`ml-auto text-text-faint transition-transform duration-180 ease-mac ${open ? 'rotate-90' : ''}`}
        >
          <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="glass border rounded-card shadow-mac-lg animate-sheet-in origin-top-right absolute right-0 top-full mt-1.5 w-[260px] max-w-[calc(100vw-24px)] p-3">
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center gap-2.5 text-footnote text-text-secondary">
                <Swatch stroke={r.stroke} dash={r.dash} width={r.width ?? 1.5} />
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
          <hr className="divider my-2.5" />
          <div className="space-y-1.5 text-footnote text-text-secondary">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-3.5 rounded-[4px] border-[1.5px] border-state-done shrink-0" />
              {tr.graph.legendBorderDone}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-3.5 rounded-[4px] border-[1.5px] border-dashed border-conf-mid shrink-0" />
              {tr.graph.legendBorderNoProof}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-3.5 rounded-[4px] border-[1.5px] border-state-problem shrink-0" />
              {tr.graph.legendBorderProblem}
            </div>
            <p className="text-text-muted pt-1">{tr.graph.legendDependencyHint}</p>
          </div>
        </div>
      )}
    </div>
  );
}
