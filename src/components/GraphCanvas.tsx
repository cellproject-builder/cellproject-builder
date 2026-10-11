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
  confidenceBand,
  effectiveLeaves,
  nextPendingForTutor,
  pendingParent,
  type Lens,
} from '@/store';
import { childrenByParent } from '@/graph/treeIndex';
import { nodePresentation } from '@/graph/nodePresentation';
import { isLeafGridParent, LAYOUT_Y_GAP } from '@/graph/treeLayout';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useReviewingParents } from '@/hooks/useReviewingParents';
import { useT, useLocaleStore } from '@/i18n';
import { ExpandedChrome } from '@/components/ui/ExpandedChrome';
import type { Messages } from '@/i18n';
import { ConceptNode, SIDE_HANDLE } from './ConceptNode';
import { discardSuggestionsWithUndo, acceptSuggestionsWithUndo } from './suggestionActions';
import type { ConceptEdgeData, ConceptNodeData, Project } from '@/types';
import { computeAdaptiveTreeLayout, DEFAULT_NODE_DIMENSIONS, type GraphLayoutMode, type LayoutDimensions, type Orientation } from '@/graph/autoLayout';
import { useCanvasSize } from '@/graph/useCanvasSize';
import { getVisualWorkspace, updateVisualArtifact } from '@/visuals/domain';
import { VisualArtifactNode } from '@/visuals/rendering/VisualArtifactNode';
import { VisualLinkEdge } from '@/visuals/rendering/VisualLinkEdge';
import { VisualWorkspaceBridge } from '@/visuals/VisualWorkspaceBridge';
import { PlannerInkLayer } from '@/ink/PlannerInkLayer';
import { useVisualPopupStore } from '@/visuals/ui/uiStore';
import './planner-mobile.css';

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

const nodeTypes = { concept: ConceptNode, columnHeader: ColumnHeaderNode, visual: VisualArtifactNode };

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
  // Sequência direta: mais grossa e mais clara que o esqueleto da
  // decomposição — na legenda e no canvas as duas não se confundem.
  direct: { stroke: 'color-mix(in srgb, rgb(var(--text-muted)) 85%, rgb(var(--bg-primary)))', strokeWidth: 2.25 },
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
  stroke: 'color-mix(in srgb, rgb(var(--text-faint)) 60%, rgb(var(--bg-primary)))',
  strokeWidth: 1.5,
};

// Lentes Conexões/Fluxo: sem foco, as arestas ficam a meia força; com um nó
// em foco (hover/seleção), só as dele em cor cheia e o resto quase some.
const EDGE_IDLE_OPACITY = 0.6;
const EDGE_DIMMED_OPACITY = 0.3;

// Zoom mínimo do enquadramento automático: abaixo disso o texto dos cards
// fica ilegível. "Ver o grafo inteiro" (⤢) usa o encaixe real, com piso de
// FIT_ALL_MIN_ZOOM.
const READABLE_MIN_ZOOM = 0.7;
// Lentes de colunas: todas as colunas à vista importam mais que o tamanho do
// texto (abaixo de 0.6 o card vira o nível "far": nome legível, sem resumo).
// O encaixe é pela largura — as colunas leem de cima e rolam na vertical.
const COLUMNS_MIN_ZOOM = 0.5;
const CONNECTIONS_MIN_ZOOM = 0.5;
const FIT_ALL_MIN_ZOOM = 0.05;
// Cromo flutuante sobre o canvas (px de tela): faixa dos botões do topo
// (Organizar, zoom, Legenda). O enquadramento automático desconta isso.
const CHROME_TOP = 44;
// Mobile: a pílula de lente/legenda tem alvos de 44px (mais alta) e os
// controles de zoom ocupam o canto de baixo à esquerda.
const CHROME_TOP_MOBILE = 64;
const MOBILE_CONTROLS_W = 60;
const STAGING_BANNER_H = 56;
// Minimapa só quando o grafo é grande o bastante para precisar dele.
const MINIMAP_MIN_NODES = 40;
// Folga mínima entre cards empilhados numa coluna (lentes de colunas).
const STACK_GAP = 28;

const edgeTypes: EdgeTypes = { visualLink: VisualLinkEdge };

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
  if (nodePresentation(project).get(n.id)?.blocked) return 'blocked';
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
const COL_GAP = 72;
const ROW_H = 230;
const MAX_ROWS = 5;
const CARD_W = 300;

const columnsLayout = (
  groups: Array<{ key: string; label: string; tone: string; ids: string[] }>,
): Pick<LensLayout, 'positions' | 'headers'> => {
  const positions: LensLayout['positions'] = {};
  const headers: LensHeader[] = [];
  let x = 0;
  for (const g of groups) {
    if (g.ids.length === 0) continue; // sem colunas vazias
    // Sub-colunas equilibradas sob o mesmo cabeçalho (8 → 4 + 4, não 7 + 1).
    const subCols = Math.ceil(g.ids.length / MAX_ROWS);
    const rows = Math.ceil(g.ids.length / subCols);
    g.ids.forEach((id, i) => {
      positions[id] = { x: x + Math.floor(i / rows) * COL_W, y: (i % rows) * ROW_H };
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
    // Uma coluna por sequência (passos irmãos), com o nome do pai no
    // cabeçalho: "Passo #1" de duas sequências nunca fica lado a lado sem
    // contexto. Dentro da coluna, a ordem é a da sequência (profundidade e
    // depois `order`).
    let colX = others.length > 0 ? gridWidth + COL_GAP * 2 : 0;
    const groups = [...stepsByParent.entries()].sort(([, a], [, b]) => byOrder(a[0].id, b[0].id));
    for (const [parentId, arr] of groups) {
      const ids = arr.map((n) => n.id).sort((a, b) => (depth[a] ?? 0) - (depth[b] ?? 0) || byOrder(a, b));
      ids.forEach((id, i) => {
        positions[id] = { x: colX, y: i * ROW_H };
      });
      headers.push({
        id: `${HEADER_PREFIX}flow-steps-${parentId || 'root'}`,
        label: project.nodes[parentId]?.name || tr.graph.flowSteps,
        count: ids.length,
        tone: 'bg-text-faint/50',
        x: colX,
        y: -90,
        width: CARD_W,
      });
      colX += CARD_W + COL_GAP;
    }
    return { positions, visible, headers, flowEdges };
  }

  // Conexões sem nenhuma ligação além da decomposição: nada a mapear (o
  // mapa radial só espalharia a árvore). O canvas mostra um estado vazio.
  if (!edges.some((e) => !isHierarchyEdge(project, e))) {
    return { positions: {}, visible: new Set(), headers: [] };
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

export function GraphCanvas({ maximized = false, onToggleMaximized }: { maximized?: boolean; onToggleMaximized?: () => void }) {
  const tr = useT();
  const isMobile = useIsMobile();
  const { setViewport, getNode, getNodes, getNodesBounds, zoomIn, zoomOut } =
    useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const project = useGraphStore((s) => s.project);
  const lens = useGraphStore((s) => s.lens);
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const selectionVersion = useGraphStore((s) => s.selectionVersion);
  // Plan context and the canvas selection are different: selecting a photo
  // retains its plan context without leaving that concept selected for drag.
  const [selectedVisualId, setSelectedVisualId] = useState<string | null>(null);
  const selectVisualArtifact = useCallback((id: string | null) => setSelectedVisualId(id ? `visual:${id}` : null), []);
  useEffect(() => { setSelectedVisualId(null); }, [selectionVersion, project?.id]);
  const focusedParentId = useGraphStore((s) => s.focusedParentId);
  const focusVersion = useGraphStore((s) => s.focusVersion);
  const centerRequest = useGraphStore((s) => s.centerRequest);
  const pending = useGraphStore((s) => s.pendingSuggestions);
  const reviewing = useReviewingParents();
  const stagingParent = useGraphStore(pendingParent);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusNode = useGraphStore((s) => s.focusNode);
  const setLens = useGraphStore((s) => s.setLens);
  const updateNodePosition = useGraphStore((s) => s.updateNodePosition);
  const applyLayoutPositions = useGraphStore((s) => s.applyLayoutPositions);

  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const canvasSize = useCanvasSize(containerRef);
  const [layoutMode, setLayoutMode] = useState<GraphLayoutMode>(() => project?.manualLayout ? 'manual' : 'auto');
  const [manualOrientation, setManualOrientation] = useState<Orientation>(() => {
    if (!project) return 'vertical';
    const root = project.nodes[project.rootId];
    const children = Object.values(project.nodes).filter((n) => n.parentId === project.rootId);
    if (!root || !children.length) return 'vertical';
    const dx = children.reduce((sum, n) => sum + n.position.x - root.position.x, 0);
    const dy = children.reduce((sum, n) => sum + n.position.y - root.position.y, 0);
    return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
  });
  // Grow the reserved card envelope when content is taller. Never shrink it on
  // semantic zoom changes, which would otherwise cause layout/zoom oscillation.
  const [dimensions, setDimensions] = useState<LayoutDimensions>({});
  const orientation = layoutMode === 'manual' ? manualOrientation : layoutMode === 'auto' ? canvasSize.orientation : layoutMode;
  const adaptive = lens === 'structure' && layoutMode !== 'manual';
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Seleção feita por clique no próprio canvas: no desktop o nó já está à
  // vista, então não mexemos na câmera.
  const clickedInCanvasRef = useRef(false);
  const selectedByDragRef = useRef(false);

  const layout = useMemo<LensLayout | null>(
    () => {
      if (!project) return null;
      const result = lensLayout(lens, project, tr);
      return adaptive ? { ...result, positions: computeAdaptiveTreeLayout(project, orientation, dimensions) } : result;
    },
    [project, lens, tr, adaptive, orientation, dimensions],
  );

  // -------------------------------------------------------------------------
  // Câmera
  // -------------------------------------------------------------------------

  const layoutRef = useRef<LensLayout | null>(null);
  layoutRef.current = layout;

  const isOnCanvas = useCallback(
    (id: string) => !!layout && (layout.visible === null || layout.visible.has(id)),
    [layout],
  );

  // Área livre do canvas: o cromo flutuante (botões no topo, zoom à
  // esquerda) e, no mobile, o sheet que cobre a metade de baixo.
  const safeArea = useCallback(() => {
    const el = containerRef.current;
    const W = el?.clientWidth ?? window.innerWidth;
    const H = el?.clientHeight ?? window.innerHeight;
    const pad = W < 640 ? 16 : 32;
    // Faixa "N partes sugeridas" flutua no topo: o enquadramento desce abaixo
    // dela (não cobre cabeçalhos de coluna nem a raiz).
    const p = useGraphStore.getState().pendingSuggestions;
    const banner = p && p.nodes.length > 0 ? STAGING_BANNER_H : 0;
    let bottom = pad;
    if (isMobile && useGraphStore.getState().mobileSheetOpen) {
      // O sheet de detalhe cobre a parte de baixo: no mínimo o snap baixo
      // (45%); se ele já estiver mais alto, mede onde começa. Sem sheet,
      // sobra a área inteira.
      bottom = H * 0.45 + 8;
      const sheet = document.querySelector('[data-vaul-drawer][data-state="open"]');
      const rect = el?.getBoundingClientRect();
      const sheetTop = sheet?.getBoundingClientRect().top;
      if (rect && sheetTop !== undefined && sheetTop < rect.bottom) {
        bottom = Math.max(bottom, rect.bottom - sheetTop + 8);
      }
    }
    return {
      W,
      H,
      left: isMobile ? MOBILE_CONTROLS_W : pad,
      right: pad,
      top: pad + (maximized ? 0 : (toolbarRef.current?.offsetHeight || (isMobile ? CHROME_TOP_MOBILE : CHROME_TOP)) + 12) + banner,
      bottom,
    };
  }, [isMobile, maximized]);

  // Enquadra `ids` (num zoom legível) dentro da área livre, com `focusId` no
  // centro: o recorte é simétrico em volta dele, então o nó em foco nunca
  // fica colado na borda. Se não couber, tenta `fallbackIds` (contexto
  // menor) e, por fim, o zoom mínimo legível só no nó.
  const frameIds = useCallback(
    (ids: string[], focusId: string, duration = 300, fallbackIds?: string[]) => {
      const a = safeArea();
      const availW = Math.max(120, a.W - a.left - a.right);
      const availH = Math.max(120, a.H - a.top - a.bottom);
      const hasFocus = !!getNode(focusId);
      const fitAround = (list: string[]) => {
        const present = list.filter((id) => getNode(id));
        if (present.length === 0) return null;
        const b = getNodesBounds(present);
        if (!hasFocus) {
          const fit = Math.min(availW / Math.max(1, b.width), availH / Math.max(1, b.height));
          return { fit, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
        }
        const fb = getNodesBounds([focusId]);
        const cx = fb.x + fb.width / 2;
        const cy = fb.y + fb.height / 2;
        const hw = Math.max(cx - b.x, b.x + b.width - cx);
        const hh = Math.max(cy - b.y, b.y + b.height - cy);
        const fit = Math.min(availW / Math.max(1, 2 * hw), availH / Math.max(1, 2 * hh));
        return { fit, cx, cy };
      };
      let r = fitAround(ids);
      if (!r) return;
      if (r.fit < READABLE_MIN_ZOOM && fallbackIds) {
        const r2 = fitAround(fallbackIds);
        if (r2) r = r2;
      }
      const zoom = Math.min(1, Math.max(READABLE_MIN_ZOOM, r.fit));
      void setViewport(
        { x: a.left + availW / 2 - r.cx * zoom, y: a.top + availH / 2 - r.cy * zoom, zoom },
        { duration },
      );
    },
    [getNode, getNodesBounds, safeArea, setViewport],
  );

  // Foco num nó: ele com o pai e os irmãos (contexto), não só o nó em zoom 1.
  // Se o contexto inteiro não couber legível, fica com o pai e os dois
  // irmãos vizinhos.
  const centerOn = useCallback(
    (id: string) => {
      const proj = useGraphStore.getState().project;
      const node = proj?.nodes[id];
      const onCanvas = (x: string) => {
        const v = layoutRef.current?.visible ?? null;
        return x === id || v === null || v.has(x);
      };
      const ids = [id];
      const near = [id];
      if (proj && node?.parentId) {
        ids.push(node.parentId);
        near.push(node.parentId);
        const sibs = Object.values(proj.nodes)
          .filter((n) => n.parentId === node.parentId)
          .sort((a, b) => a.order - b.order);
        const at = sibs.findIndex((n) => n.id === id);
        sibs.forEach((n, i) => {
          if (n.id === id) return;
          ids.push(n.id);
          if (Math.abs(i - at) === 1) near.push(n.id);
        });
      }
      frameIds(ids.filter(onCanvas), id, 300, near.filter(onCanvas));
    },
    [frameIds],
  );

  // Enquadra um grupo inteiro (sem foco num nó só).
  const fitIds = useCallback(
    (ids: string[]) => {
      const present = ids.filter((id) => getNode(id));
      if (present.length === 0) return;
      frameIds(present, '', 350);
    },
    [frameIds, getNode],
  );

  // Enquadramento legível: encaixa tudo se couber num zoom de leitura; senão
  // fica no zoom mínimo legível e ancora no começo (topo da raiz na Estrutura,
  // canto superior esquerdo nas colunas, centro nas Conexões).
  const frameOverview = useCallback(
    (duration = 350, whole = false) => {
      const el = containerRef.current;
      const st = useGraphStore.getState();
      const proj = st.project;
      if (!el || !proj) return;
      // Visuals keep their user-placed coordinates from Structure. They must
      // not shrink an analytical lens to fit a distant image/model.
      const all = getNodes().filter((n) => !n.hidden && !n.id.startsWith(SUGGESTION_PREFIX)
        && (st.lens === 'structure' || n.type !== 'visual'));
      if (all.length === 0) return;
      const a = safeArea();
      // Origem e tamanho da área livre (descontado o cromo flutuante).
      const W = a.W - a.left - a.right;
      const H = a.H - a.bottom - a.top;
      const pad = 0;
      const b = getNodesBounds(all.map((n) => n.id));
      if (b.width <= 0 || b.height <= 0) return;
      const columns = !whole && (st.lens === 'state' || st.lens === 'risk' || st.lens === 'flow');
      const fit = columns ? W / b.width : Math.min(W / b.width, H / b.height);
      // Conexões é um mapa de relações: precisa caber inteiro, com piso menor.
      // "Ver o grafo inteiro" (whole) encaixa de verdade.
      const floor = whole
        ? FIT_ALL_MIN_ZOOM
        : st.lens === 'connections'
        ? CONNECTIONS_MIN_ZOOM
        : st.lens === 'structure'
        ? READABLE_MIN_ZOOM
        : COLUMNS_MIN_ZOOM;
      const zoom = Math.min(1, Math.max(floor, fit));
      const fitsX = b.width * zoom <= W - pad * 2;
      const fitsY = b.height * zoom <= H - pad * 2;
      let x: number;
      let y: number;
      if (st.lens === 'connections' || (whole && fitsX && fitsY)) {
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
        // Não cabe na largura: começa pela borda esquerda (a 1ª coluna não
        // nasce cortada) desde que a raiz continue à vista.
        if (!fitsX) {
          const rb = getNode(proj.rootId) ? getNodesBounds([proj.rootId]) : null;
          const xLeft = -b.x * zoom;
          if (rb && (rb.x + rb.width) * zoom + xLeft <= W) x = xLeft;
        }
        y = fitsY ? (H - b.height * zoom) / 2 - b.y * zoom : pad - b.y * zoom;
      } else {
        x = fitsX ? (W - b.width * zoom) / 2 - b.x * zoom : pad - b.x * zoom;
        // Colunas leem de cima: cabeçalhos no topo, sem vão acima deles.
        y = pad - b.y * zoom;
      }
      void setViewport({ x: x + a.left, y: y + a.top, zoom }, { duration });
    },
    [getNodes, getNodesBounds, getNode, setViewport, safeArea],
  );

  // Timers de câmera em refs: um re-render no meio (projeto mudou) não pode
  // cancelar um enquadramento já pedido. Só a desmontagem limpa.
  const camTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCameraFrame = useRef<{ lens: Lens; action: () => void } | null>(null);
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
    fitIds([p.parentId, ...p.nodes.map((n) => `${SUGGESTION_PREFIX}${n.tempId}`)]);
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
    schedule(camTimer, () => frameOverview(0, lens === 'structure' && layoutMode !== 'manual'), 30);
  }, [nodesInitialized, initialTarget, frameOverview, schedule, layoutMode, lens]);

  // Reframe after the actual canvas changes (sidebar, inspector, chat or device
  // rotation), allowing React Flow to measure the newly arranged cards first.
  // Text edits and selection do not reset a user's zoom/pan.
  const topology = project ? Object.values(project.nodes).map((n) => `${n.id}:${n.parentId}:${n.order}`).sort().join('|') : '';
  const reframeInputs = useMemo(() => ({ width: canvasSize.width, height: canvasSize.height, orientation, layoutMode, lens, topology, dimensions }),
    [canvasSize.width, canvasSize.height, orientation, layoutMode, lens, topology, dimensions]);
  const lastReframeInputs = useRef<typeof reframeInputs | null>(null);
  useEffect(() => {
    if (layoutMode === 'manual') {
      if (camTimer.current) clearTimeout(camTimer.current);
      camTimer.current = null;
      return;
    }
    if (!nodesInitialized || !canvasSize.width || !canvasSize.height) return;
    // A newly dropped image is measured too. Its ready transition must not
    // reframe the map and move the drop point away from the user's cursor.
    if (lastReframeInputs.current === reframeInputs) return;
    lastReframeInputs.current = reframeInputs;
    schedule(camTimer, () => {
      if (useGraphStore.getState().pendingSuggestions) frameStaging();
      else frameOverview(200, lens === 'structure');
    }, 180);
  }, [canvasSize.width, canvasSize.height, layoutMode, reframeInputs, nodesInitialized, frameOverview, frameStaging, schedule]);

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
      // The new lens first replaces and measures its nodes. A fixed delay can
      // see the old bounds (or no bounds), especially with Manual selected.
      if (camTimer.current) clearTimeout(camTimer.current);
      camTimer.current = null;
      pendingCameraFrame.current = { lens, action: () => frameOverview(350) };
    } else if (focusVersion !== p.focusVersion && focusedParentId && project) {
      const ids = [
        focusedParentId,
        ...Object.values(project.nodes)
          .filter((n) => n.parentId === focusedParentId)
          .map((n) => n.id),
      ].filter(isOnCanvas);
      action = () => {
        if (ids.length > 1) fitIds(ids);
        else if (ids.length === 1) centerOn(ids[0]);
      };
    } else if (centerVersion !== p.centerVersion && centerRequest) {
      const id = centerRequest.nodeId;
      if (isOnCanvas(id)) action = () => centerOn(id);
    } else if (selectionVersion !== p.selectionVersion && selectedId) {
      const fromCanvas = clickedInCanvasRef.current;
      if (!selectedByDragRef.current && (!fromCanvas || isMobile) && isOnCanvas(selectedId)) action = () => centerOn(selectedId);
    }
    clickedInCanvasRef.current = false;
    selectedByDragRef.current = false;
    if (action) {
      // A user's explicit focus supersedes the lens overview, but must also
      // wait for usable bounds instead of being lost during measurement.
      if (camTimer.current) clearTimeout(camTimer.current);
      camTimer.current = null;
      pendingCameraFrame.current = { lens, action };
    }
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
    layoutMode,
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

  const zoomButtons = [
    { label: tr.graph.zoomIn, glyph: '+', onClick: () => void zoomIn({ duration: 200 }) },
    { label: tr.graph.zoomOut, glyph: '−', onClick: () => void zoomOut({ duration: 200 }) },
    { label: tr.graph.fitAll, glyph: '⤢', onClick: () => frameOverview(300, true) },
  ] as const;

  // Esc limpa a seleção (o painel passa a mostrar o resumo do projeto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const popup = [...document.querySelectorAll<HTMLElement>('[data-visual-popup]')]
        .sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex))[0];
      if (popup) {
        const kind = popup.dataset.visualPopup;
        if (maximized && (kind === 'search' || kind === 'model')) {
          e.preventDefault();
          useVisualPopupStore.getState().close(kind);
        }
        return;
      }
      if (maximized && onToggleMaximized) {
        e.preventDefault();
        onToggleMaximized();
        return;
      }
      if (!useGraphStore.getState().selectedNodeId) return;
      selectNode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectNode, maximized, onToggleMaximized]);

  // Tidy tree: recompute positions for the whole decomposition and persist
  // them (structure lens shows stored positions, so switch to it).
  const handleTidy = useCallback(() => {
    if (!project) return;
    applyLayoutPositions(computeAdaptiveTreeLayout(project, canvasSize.orientation, dimensions));
    setLayoutMode('auto');
    if (lens !== 'structure') setLens('structure');
    else schedule(camTimer, () => frameOverview(350, true), 50);
  }, [project, lens, canvasSize.orientation, dimensions, applyLayoutPositions, setLens, frameOverview, schedule]);

  // -------------------------------------------------------------------------
  // Nós
  // -------------------------------------------------------------------------

  const conceptData = useRef(new Map<string, { source: ConceptNodeData; data: Node['data'] }>());
  const computedNodes: Node[] = useMemo(() => {
    if (!project || !layout) return [];
    const nodeList = Object.values(project.nodes).filter(
      (n) => layout.visible === null || layout.visible.has(n.id),
    );
    const nextId = nextPendingForTutor(project, pending, reviewing)?.id ?? null;
    const presentation = nodePresentation(project), nextData = new Map<string, { source: ConceptNodeData; data: Node['data'] }>();

    const base: Node[] = nodeList.map((n) => {
      const status = presentation.get(n.id)!, previous = conceptData.current.get(n.id), isNext = n.id === nextId;
      const data = previous?.source === n && previous.data.childCount === status.childCount && previous.data.edgeCount === status.edgeCount
        && previous.data.blocked === status.blocked && previous.data.stepNo === status.stepNo && previous.data.canConclude === status.canConclude && previous.data.isNext === isNext
        ? previous.data : { ...n, ...status, isNext };
      nextData.set(n.id, { source: n, data });
      return {
        id: n.id,
        type: 'concept',
        position: layout.positions[n.id] || n.position,
        // Stable data lets ConceptNode's memo skip unrelated selection/draft updates.
        data,
        selected: n.id === selectedId && selectedVisualId === null,
        draggable: lens === 'structure',
      };
    });
    conceptData.current = nextData;

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
      // As posições sugeridas ficam sob o pai; se a fileira colidir com um
      // nó existente (outra subárvore), desce em degraus até ficar livre.
      const SUG_W = CARD_W + 20;
      const SUG_H = 190;
      const savedParent = project.nodes[pending.parentId]?.position ?? { x: 0, y: 0 };
      const shownParent = layout.positions[pending.parentId] ?? savedParent;
      const raw = pending.nodes.map((p) => {
        const original = p.data.position as { x: number; y: number };
        const dx = original.x - savedParent.x, dy = original.y - savedParent.y;
        return adaptive && orientation === 'horizontal'
          ? { x: shownParent.x + dy, y: shownParent.y + dx }
          : { x: shownParent.x + dx, y: shownParent.y + dy };
      });
      const existing = Object.values(project.nodes).map((n) => layout.positions[n.id] ?? n.position);
      const horizontal = adaptive && orientation === 'horizontal';
      let dy = 0;
      for (let step = 0; step < 12; step++) {
        const hit = raw.some((r) =>
          existing.some(
            (e) => Math.abs(e.x - (r.x + (horizontal ? dy : 0))) < SUG_W && Math.abs(e.y - (r.y + (horizontal ? 0 : dy))) < SUG_H,
          ),
        );
        if (!hit) break;
        dy += LAYOUT_Y_GAP / 2;
      }
      pending.nodes.forEach((p, i) => {
        const pos = { x: raw[i].x + (horizontal ? dy : 0), y: raw[i].y + (horizontal ? 0 : dy) };
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

    for (const artifact of getVisualWorkspace(project).artifacts) {
      base.push({ id: `visual:${artifact.id}`, type: 'visual', position: { x: artifact.x, y: artifact.y },
        data: { artifact }, width: artifact.width, height: artifact.height, draggable: true, selectable: true,
        selected: `visual:${artifact.id}` === selectedVisualId,
        // React Flow raises selected nodes by 1000; keep concept click targets above visuals.
        connectable: false, dragHandle: '.visual-drag-surface', zIndex: -1001, style: { pointerEvents: 'none' } });
    }
    return base;
  }, [project, layout, lens, selectedId, selectedVisualId, pending, reviewing, adaptive, orientation]);

  // React Flow precisa ser controlado: aplicamos NodeChanges (drag, select,
  // resize) num state local e ressincronizamos sempre que o store recalcular
  // computedNodes. Durante o drag o store não muda — `updateNodePosition` só
  // é chamado em `dragging === false` — portanto não há race com o useEffect.
  const [nodes, setNodes] = useState<Node[]>(computedNodes);
  const [adoptedNodes, setAdoptedNodes] = useState(computedNodes);
  useEffect(() => {
    setNodes(current => {
      const previous = new Map(current.map(node => [node.id, node]));
      return computedNodes.map(node => {
        const live = previous.get(node.id);
        // Keep active geometry during background edits. Selection has one
        // canvas owner, so saving cannot accidentally restore a drag group.
        if (node.type !== 'visual' || !live) return node;
        return { ...node,
          ...(live.dragging ? { position: live.position, dragging: true } : {}),
          ...(live.resizing ? { width: live.width, height: live.height, position: live.position, resizing: true } : {}) };
      });
    });
    setAdoptedNodes(computedNodes);
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

  useEffect(() => {
    const request = pendingCameraFrame.current;
    if (!request || request.lens !== lens || !nodesInitialized) return;
    // useNodesInitialized may still describe the previous render. Wait until
    // our controlled node list has adopted this lens as well as being measured.
    const displayed = new Map(nodes.map(node => [node.id, node]));
    if (adoptedNodes !== computedNodes || nodes.length !== computedNodes.length || computedNodes.some(node => displayed.get(node.id)?.data !== node.data)) return;
    schedule(camTimer, () => {
      if (pendingCameraFrame.current !== request || useGraphStore.getState().lens !== lens) return;
      pendingCameraFrame.current = null;
      request.action();
    }, 30);
  }, [lens, nodes, computedNodes, adoptedNodes, nodesInitialized, focusVersion, selectionVersion, centerRequest, canvasSize.width, canvasSize.height, frameOverview, schedule]);

  // -------------------------------------------------------------------------
  // Arestas
  // -------------------------------------------------------------------------

  const rfEdges: Edge[] = useMemo(() => {
    if (!project || !layout) return [];
    const shown = (id: string) => layout.visible === null || layout.visible.has(id);
    const focusIds = new Set([selectedId, hoveredId].filter(Boolean) as string[]);
    const dimmable = lens === 'connections' || lens === 'flow';
    const pos = (id: string) => layout.positions[id] ?? project.nodes[id]?.position;
    const byParent = childrenByParent(project);
    // Roteamento: aresta entre cards na mesma fileira sai/entra pelo lado
    // (senão o bezier de baixo→cima faz uma laçada); filhos da grade de
    // folhas recebem a aresta pelo lado de dentro, num barramento no vão.
    const routeOf = (source: string, target: string, hierarchy: boolean): Partial<Edge> => {
      const s0 = pos(source);
      const t0 = pos(target);
      if (!s0 || !t0) return {};
      if (hierarchy && lens === 'structure' && orientation === 'horizontal') {
        const right = t0.x > s0.x;
        return {
          type: 'smoothstep',
          sourceHandle: right ? SIDE_HANDLE.sourceRight : SIDE_HANDLE.sourceLeft,
          targetHandle: isLeafGridParent(byParent, source)
            ? (t0.y < s0.y ? SIDE_HANDLE.targetBottom : undefined)
            : (right ? SIDE_HANDLE.targetLeft : SIDE_HANDLE.targetRight),
        };
      }
      if (
        hierarchy &&
        lens === 'structure' &&
        isLeafGridParent(byParent, source) &&
        Math.abs(t0.x - s0.x) > 60
      ) {
        return {
          type: 'smoothstep',
          targetHandle: t0.x < s0.x ? SIDE_HANDLE.targetRight : SIDE_HANDLE.targetLeft,
        };
      }
      // Fluxo: recurso → passo em outra coluna sai/entra pelo lado (o bezier
      // de baixo→cima fazia laçadas em U sob os cards e riscava vizinhos).
      const sideways = lens === 'flow' && Math.abs(t0.x - s0.x) >= CARD_W;
      if (!hierarchy && (sideways || (Math.abs(t0.y - s0.y) < 120 && Math.abs(t0.x - s0.x) > 60))) {
        const right = t0.x > s0.x;
        return {
          type: 'smoothstep',
          sourceHandle: right ? SIDE_HANDLE.sourceRight : SIDE_HANDLE.sourceLeft,
          targetHandle: right ? SIDE_HANDLE.targetLeft : SIDE_HANDLE.targetRight,
        };
      }
      return {};
    };
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
        ...routeOf(e.source, e.target, hierarchy),
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
          ...routeOf(fe.source, fe.target, false),
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
          ...(adaptive && orientation === 'horizontal' ? { sourceHandle: SIDE_HANDLE.sourceRight, targetHandle: SIDE_HANDLE.targetLeft } : {}),
          style: SUGGESTION_EDGE_STYLE,
          animated: !isMobile,
        });
      });
    }

    const artifacts = getVisualWorkspace(project).artifacts;
    for (const artifact of artifacts) {
      const source = artifact.sourceArtifactId && artifacts.find(item => item.id === artifact.sourceArtifactId);
      const linkedId = artifact.linkedNodeId;
      if (!source && (!linkedId || !project.nodes[linkedId] || !shown(linkedId))) continue;
      base.push({
        id: `visual-link:${artifact.id}`, source: source ? `visual:${source.id}` : linkedId!, target: `visual:${artifact.id}`,
        ...(source ? { sourceHandle: 'visual-origin' } : {}),
        type: 'visualLink', targetHandle: 'visual-link',
        selectable: false, deletable: false, focusable: false, reconnectable: false,
        ariaLabel: `${source ? source.label : project.nodes[linkedId!].name} · ${artifact.label}`,
        style: { stroke: 'rgb(var(--ai-accent))', strokeWidth: 1.25, strokeDasharray: '6 5', strokeLinecap: 'round', strokeLinejoin: 'round', opacity: .55, pointerEvents: 'none' },
        zIndex: -1,
      });
    }
    return base;
  }, [project, layout, lens, pending, isMobile, selectedId, hoveredId, adaptive, orientation]);

  const onNodeDragStart = useCallback((_event?: React.MouseEvent, node?: Node) => {
    pendingCameraFrame.current = null;
    if (camTimer.current) clearTimeout(camTimer.current);
    camTimer.current = null;
    if (node?.type === 'visual') return;
    if (node?.type === 'concept' && project?.nodes[node.id]) {
      setSelectedVisualId(null);
      if (useGraphStore.getState().selectedNodeId !== node.id) {
        clickedInCanvasRef.current = true;
        selectedByDragRef.current = true;
        selectNode(node.id);
      }
    }
    if (!adaptive || !layout) return;
    // Freeze every displayed position before entering Manual, so dragging one
    // card never sends its siblings back to their older saved coordinates.
    applyLayoutPositions(layout.positions);
    setManualOrientation(orientation);
    setLayoutMode('manual');
  }, [adaptive, layout, orientation, applyLayoutPositions, project, selectNode]);

  const changeLayoutMode = useCallback((next: GraphLayoutMode) => {
    if (next === 'manual' && adaptive && layout && project) {
      applyLayoutPositions(layout.positions);
      // Manual is a saved user choice, just like a completed card drag.
      const rootPosition = layout.positions[project.rootId];
      if (rootPosition) updateNodePosition(project.rootId, rootPosition);
      setManualOrientation(orientation);
    }
    setLayoutMode(next);
  }, [adaptive, layout, project, orientation, applyLayoutPositions, updateNodePosition]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const selection = changes.find(change => change.type === 'select' && change.selected);
      if (selection && selection.type === 'select') {
        setSelectedVisualId(selection.id.startsWith('visual:') ? selection.id : null);
      } else if (changes.some(change => change.type === 'select' && !change.selected && change.id === selectedVisualId)) {
        setSelectedVisualId(null);
      }
      setNodes((curr) => applyNodeChanges(changes, curr));
      const measured = changes.filter((change) => change.type === 'dimensions' && change.dimensions && project?.nodes[change.id]);
      if (measured.length) setDimensions((current) => {
        let next = current;
        for (const change of measured) {
          if (change.type !== 'dimensions' || !change.dimensions) continue;
          const previous = next[change.id] ?? DEFAULT_NODE_DIMENSIONS;
          const width = Math.max(previous.width ?? DEFAULT_NODE_DIMENSIONS.width, change.dimensions.width);
          const height = Math.max(previous.height ?? DEFAULT_NODE_DIMENSIONS.height, change.dimensions.height);
          if (width !== previous.width || height !== previous.height) next = { ...next, [change.id]: { width, height } };
        }
        return next;
      });
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          if (change.id.startsWith('visual:')) { updateVisualArtifact(change.id.slice(7), change.position); continue; }
          if (!change.id.startsWith(SUGGESTION_PREFIX) && !change.id.startsWith(HEADER_PREFIX)) {
            updateNodePosition(change.id, change.position);
          }
        }
      }
    },
    [updateNodePosition, project, selectedVisualId],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'visual' || node.id.startsWith(SUGGESTION_PREFIX) || node.id.startsWith(HEADER_PREFIX)) return;
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
  // Conexões sem nenhuma ligação além da decomposição: avisa, senão a lente
  // parece só cartões soltos.
  const noCrossLinks =
    lens === 'connections' &&
    !!project &&
    !Object.values(project.edges).some((e) => !isHierarchyEdge(project, e));

  return (
    <div ref={containerRef} data-layout-mode={layoutMode} data-orientation={orientation} data-canvas-maximized={maximized} className="flex-1 min-w-0 min-h-0 relative bg-bg-primary">
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        nodeDragThreshold={4}
        multiSelectionKeyCode={null}
        fitView={!initialTarget}
        fitViewOptions={{ padding: 0.15, minZoom: layoutMode === 'manual' ? READABLE_MIN_ZOOM : FIT_ALL_MIN_ZOOM, maxZoom: 1 }}
        minZoom={FIT_ALL_MIN_ZOOM}
        maxZoom={2}
        colorMode="system"
        proOptions={{ hideAttribution: true }}
      >
        {/* size 2: o React Flow escala o ponto pelo zoom; com 1 ele some abaixo de 100%. */}
        <Background variant={BackgroundVariant.Dots} gap={20} size={2} />
        {/* Controles próprios: no mobile os botões têm 44px de alvo de toque.
            No desktop eles moram numa pílula de vidro no topo (junto do
            "Organizar"), fora da área dos cards. */}
        {isMobile && (
          <Controls showZoom={false} showFitView={false} showInteractive={false}>
            {zoomButtons.map((b) => (
              <ControlButton
                key={b.glyph}
                onClick={b.onClick}
                title={b.label}
                aria-label={b.label}
                className="!text-[15px] !leading-none !w-11 !h-11"
              >
                <span aria-hidden>{b.glyph}</span>
              </ControlButton>
            ))}
          </Controls>
        )}
        <ExpandedChrome expanded={maximized} label={project?.name ?? 'Canvas'} english={useLocaleStore.getState().locale === 'en'} onRestore={() => onToggleMaximized?.()}>
        <Panel
          ref={toolbarRef}
          position="top-left"
          className={`planner-canvas-toolbar flex flex-wrap items-center gap-2 !mr-3 w-[calc(100%-24px)] ${isMobile ? 'bar-solid border rounded-card shadow-mac p-1' : ''}`}
        >
          <button
            onClick={handleTidy}
            title={tr.graph.tidyTitle}
            aria-label={tr.graph.tidy}
            className={`planner-tidy tap btn text-text-primary ${isMobile ? 'btn-ghost btn-icon' : 'glass shadow-mac hover:bg-bg-elevated/60'}`}
          >
            <TidyIcon />
            {!isMobile && canvasSize.width >= 540 && tr.graph.tidy}
          </button>
          {isMobile && (
            <select name="lens" value={lens} onChange={(e) => setLens(e.target.value as Lens)}
              aria-label={tr.topBar.lensSelectAria}
              className="planner-lens-select tap h-9 min-w-0 rounded-control bg-transparent pl-2 pr-6 text-control text-text-primary border-0">
              {MOBILE_LENSES.map((l) => <option key={l} value={l}>{tr.topBar[LENS_LABEL_KEY[l]]}</option>)}
            </select>
          )}
          {lens === 'structure' && (
            <select name="graph-layout" value={layoutMode}
              onChange={(e) => changeLayoutMode(e.target.value as GraphLayoutMode)}
              aria-label={tr.graph.layoutMode} title={tr.graph.layoutHint}
              className={`planner-layout-select tap min-w-0 max-w-full rounded-control pl-2.5 pr-7 text-control text-text-primary ${isMobile ? 'h-11 bg-transparent border-0' : 'h-8 glass border shadow-mac'}`}>
              <option value="auto">{tr.graph.layoutAuto} · {canvasSize.orientation === 'horizontal' ? tr.graph.layoutHorizontal : tr.graph.layoutVertical}</option>
              <option value="horizontal">{tr.graph.layoutHorizontal}</option>
              <option value="vertical">{tr.graph.layoutVertical}</option>
              <option value="manual">{tr.graph.layoutManual}</option>
            </select>
          )}
          {!isMobile && (
            <div role="group" aria-label={tr.graph.zoomGroup} className="glass border rounded-control shadow-mac flex items-center p-0.5">
              {zoomButtons.map((b) => (
                <button key={b.glyph} onClick={b.onClick} title={b.label} aria-label={b.label}
                  className="tap btn btn-ghost btn-icon !h-7 !w-7 text-[15px] leading-none text-text-primary">
                  <span aria-hidden>{b.glyph}</span>
                </button>
              ))}
            </div>
          )}
          {onToggleMaximized && <button type="button" onClick={onToggleMaximized}
            aria-label={maximized ? tr.graph.restoreCanvas : tr.graph.maximizeCanvas}
            title={maximized ? tr.graph.restoreCanvas : tr.graph.maximizeCanvas} aria-pressed={maximized}
            className={`planner-maximize tap btn btn-icon text-text-primary ${isMobile ? 'btn-ghost' : 'glass border shadow-mac hover:bg-bg-elevated/60'}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={maximized ? 'M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'} />
            </svg>
          </button>}
          <div className="planner-legend ml-auto"><EdgeLegend key={lens} tr={tr} inBar={isMobile} /></div>
        </Panel>
        </ExpandedChrome>
        {pending && pending.nodes.length > 0 && (
          <Panel position="top-center" className="planner-staging-panel !mt-16 md:!mt-3 max-w-[calc(100vw-24px)]">
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
                <button onClick={() => discardSuggestionsWithUndo(tr)} className="tap btn btn-secondary">
                  {tr.graph.rejectAll}
                </button>
                <button
                  onClick={() => {
                    const parentId = pending.parentId;
                    acceptSuggestionsWithUndo(tr);
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
        {noCrossLinks ? (
          // Estado vazio centrado (não um mapa radial da árvore).
          <div className="absolute inset-0 z-[5] flex items-center justify-center p-6 pointer-events-none">
            <div className="pointer-events-auto max-w-sm text-center space-y-3">
              <p className="text-body text-text-secondary">{tr.graph.noCrossLinks}</p>
              <button onClick={() => setLens('structure')} className="tap btn btn-secondary">
                {tr.graph.noCrossLinksAction}
              </button>
            </div>
          </div>
        ) : emptyLens && (
          <Panel position="top-center" className="!mt-24">
            <div className="glass border rounded-card shadow-mac px-4 py-2.5 text-control text-text-muted">
              {tr.graph.lensEmpty}
            </div>
          </Panel>
        )}
        {/* The minimap eats a big slice of a phone screen for little return —
            and on a small graph it only covers cards. */}
        {!isMobile && nodes.length >= MINIMAP_MIN_NODES && (
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
      {project && <VisualWorkspaceBridge project={project} containerRef={containerRef} selectedArtifactId={selectedVisualId?.slice(7) ?? null} onSelectArtifact={selectVisualArtifact} />}
      {project && <PlannerInkLayer key={project.id} project={project} containerRef={containerRef} />}
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
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Esc fecha a legenda ANTES do Esc do canvas (que limparia a seleção);
  // clicar fora (ex.: Meus PDFs) também fecha.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as globalThis.Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open]);
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
    <div className="relative shrink-0" ref={rootRef}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={tr.graph.legend}
        className={`tap h-[30px] px-3 rounded-control text-footnote font-medium text-text-secondary hover:text-text-primary flex items-center gap-2 transition-colors duration-120 ease-mac ${
          inBar ? 'hover:bg-bg-elevated/60' : 'glass border shadow-mac'
        }`}
      >
        <svg className="planner-legend-symbol" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>
        <span className="planner-legend-label">{tr.graph.legend}</span>
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
        <div className="planner-legend-details glass border rounded-card shadow-mac-lg animate-sheet-in origin-top-right absolute right-0 top-full mt-1.5 w-[260px] max-w-[calc(100vw-24px)] p-3">
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
          </div>
          <hr className="divider my-2.5" />
          {/* Marcas dentro dos cards. */}
          <div className="space-y-1.5 text-footnote text-text-secondary">
            <div className="flex items-center gap-2.5">
              <span className="w-6 flex justify-center gap-1 shrink-0" aria-hidden>
                <span className="w-2 h-2 rounded-full bg-state-done" />
                <span className="w-2 h-2 rounded-full bg-state-problem" />
              </span>
              {tr.graph.legendStateDot}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-6 flex justify-center text-text-faint shrink-0" aria-hidden>
                <svg width="10" height="11" viewBox="0 0 10 11" fill="none">
                  <rect x="1" y="4.5" width="8" height="6" rx="1.5" fill="currentColor" />
                  <path d="M3 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </span>
              {tr.graph.legendLock}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-6 flex justify-center items-end gap-[2px] text-text-muted shrink-0" aria-hidden>
                <span className="w-[3px] h-1 rounded-sm bg-current" />
                <span className="w-[3px] h-2 rounded-sm bg-current" />
                <span className="w-[3px] h-3 rounded-sm bg-current opacity-40" />
              </span>
              {tr.graph.legendBars}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="chip !h-[18px] bg-accent/12 text-accent shrink-0">{tr.conceptNode.next}</span>
              {tr.graph.legendNext}
            </div>
            <p className="text-text-muted pt-1">{tr.graph.legendDependencyHint}</p>
          </div>
        </div>
      )}
    </div>
  );
}
