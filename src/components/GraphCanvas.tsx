import { memo, useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  Panel,
  useReactFlow,
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
    <div
      style={{ width: d.width }}
      className={`pointer-events-none select-none border-b-2 pb-2 font-mono text-xl uppercase tracking-wider ${d.tone}`}
    >
      {d.label} <span className="text-text-muted">· {d.count}</span>
    </div>
  );
});

const nodeTypes = { concept: ConceptNode, columnHeader: ColumnHeaderNode };

// 'direct' é a sequência comum (passo → próximo): neutra, para as cores
// guardarem significado para o que é exceção.
const edgeStyleByKind: Record<ConceptEdgeData['kind'], { stroke: string; strokeWidth: number; strokeDasharray?: string }> = {
  direct: { stroke: '#a1a1aa', strokeWidth: 2 },
  middleware: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '4 2' },
  independent: { stroke: '#6366f1', strokeWidth: 1.5, strokeDasharray: '6 4' },
  optional: { stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '2 3' },
};

const SUGGESTION_EDGE_STYLE = { stroke: '#8b5cf6', strokeWidth: 1.5, strokeDasharray: '3 3' };

// Hierarchy (parent → part) is structure, not semantics — the tree already
// lives in parentId. Rendering it as a subtle skeleton keeps the kind colors
// meaning something.
const DECOMPOSITION_EDGE_STYLE = { stroke: '#52525b', strokeWidth: 1.25 };

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

const BUCKET_TONE: Record<StateBucket, string> = {
  pending: 'text-text-primary border-text-muted',
  blocked: 'text-text-muted border-border-base',
  noProof: 'text-conf-mid border-conf-mid',
  doneProof: 'text-state-done border-state-done',
  known: 'text-ai-accent border-ai-accent',
  problem: 'text-state-problem border-state-problem',
};

type RiskBand = 'low' | 'mid' | 'high';
const RISK_ORDER: RiskBand[] = ['low', 'mid', 'high'];
const RISK_TONE: Record<RiskBand, string> = {
  low: 'text-conf-low border-conf-low',
  mid: 'text-conf-mid border-conf-mid',
  high: 'text-conf-high border-conf-high',
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
}

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
    // Fluxo = só a ordem de trabalho: partes acionáveis e arestas que não são
    // hierarquia. Camadas descem em y (os handles são topo/base).
    const work = nodes.filter((n) => isActionableKind(n.kind));
    const visible = new Set(work.map((n) => n.id));
    const preds: Record<string, string[]> = {};
    edges.forEach((e) => {
      if (isHierarchyEdge(project, e)) return;
      if (!visible.has(e.source) || !visible.has(e.target)) return;
      (preds[e.target] ||= []).push(e.source);
    });
    const depth: Record<string, number> = {};
    const computeDepth = (id: string, visiting: Set<string>): number => {
      if (depth[id] !== undefined) return depth[id];
      if (visiting.has(id)) return 0; // ciclo
      visiting.add(id);
      const ps = preds[id] || [];
      const d = ps.length === 0 ? 0 : 1 + Math.max(...ps.map((p) => computeDepth(p, visiting)));
      visiting.delete(id);
      depth[id] = d;
      return d;
    };
    work.forEach((n) => computeDepth(n.id, new Set()));
    const byLayer: Record<number, string[]> = {};
    work.forEach((n) => (byLayer[depth[n.id]] ||= []).push(n.id));
    const positions: LensLayout['positions'] = {};
    Object.entries(byLayer).forEach(([d, ids]) => {
      ids.sort(byOrder);
      ids.forEach((id, i) => {
        positions[id] = { x: i * COL_W - ((ids.length - 1) * COL_W) / 2, y: Number(d) * 260 };
      });
    });
    return { positions, visible, headers: [] };
  }

  // connections: radial simples por grau; o raio cresce com o número de nós.
  const deg: Record<string, number> = {};
  edges.forEach((e) => {
    deg[e.source] = (deg[e.source] || 0) + 1;
    deg[e.target] = (deg[e.target] || 0) + 1;
  });
  const sorted = [...nodes].sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0));
  const r = Math.max(420, sorted.length * 52);
  const positions: LensLayout['positions'] = {};
  sorted.forEach((n, i) => {
    if (i === 0) positions[n.id] = { x: 0, y: 0 };
    else {
      const angle = (i / (sorted.length - 1)) * Math.PI * 2;
      positions[n.id] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    }
  });
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
  const { fitView, setCenter, getZoom, getNode, zoomIn, zoomOut } = useReactFlow();
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
        else void fitView({ padding: 0.15, duration: 300 });
      },
      60,
    );
    // só na montagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      action = () => void fitView({ padding: 0.15, duration: 350 });
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
    fitView,
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
    const nextId = nextPendingForTutor(project)?.id ?? null;

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

  // -------------------------------------------------------------------------
  // Arestas
  // -------------------------------------------------------------------------

  const rfEdges: Edge[] = useMemo(() => {
    if (!project || !layout) return [];
    const shown = (id: string) => layout.visible === null || layout.visible.has(id);
    const focusIds = new Set([selectedId, hoveredId].filter(Boolean) as string[]);
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
      base.push({
        id: e.id,
        source: e.source,
        target: e.target,
        style: hierarchy ? DECOMPOSITION_EDGE_STYLE : edgeStyleByKind[e.kind],
        animated: !isMobile && !hierarchy && touchesFocus,
        zIndex: !hierarchy && touchesFocus ? 1 : 0,
      });
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
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#27272a" />
        {/* Controles próprios: no mobile os botões têm 44px de alvo de toque. */}
        <Controls showZoom={false} showFitView={false} showInteractive={false} className="!shadow-none rounded-sm overflow-hidden border border-border-base">
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
              className={`!text-sm !leading-none !bg-bg-secondary hover:!bg-bg-elevated !text-text-muted hover:!text-text-primary !border-b !border-border-base last:!border-b-0 ${
                isMobile ? '!w-11 !h-11' : '!w-8 !h-8'
              }`}
            >
              <span aria-hidden>{b.glyph}</span>
            </ControlButton>
          ))}
        </Controls>
        <Panel position="top-left">
          <button
            onClick={handleTidy}
            title={tr.graph.tidyTitle}
            className="px-2.5 py-1.5 min-h-[32px] text-[11px] font-mono bg-bg-secondary/90 backdrop-blur-sm border border-border-base rounded-sm text-text-secondary hover:text-ai-accent hover:border-ai-accent/40 transition-colors"
          >
            {tr.graph.tidy}
          </button>
        </Panel>
        <Panel position="top-right">
          <EdgeLegend tr={tr} />
        </Panel>
        {pending && pending.nodes.length > 0 && (
          <Panel position="top-center" className="!mt-12 md:!mt-3 max-w-[calc(100vw-24px)]">
            <div
              role="status"
              className="flex flex-wrap items-center gap-x-2 gap-y-1.5 bg-bg-secondary/95 backdrop-blur-sm border border-ai-accent/50 rounded-sm px-3 py-2 text-xs shadow-lg"
            >
              <span className="text-ai-accent">◆</span>
              <span className="text-text-primary">
                {tr.graph.stagingSummary(pending.nodes.length, stagingParent?.name ?? '')}
              </span>
              <span className="flex items-center gap-1.5 ml-auto">
                <button
                  onClick={() => {
                    const parentId = pending.parentId;
                    acceptAllSuggestions();
                    // Aceitas, a árvore é relayoutada: enquadra a subárvore nova.
                    focusNode(parentId);
                  }}
                  className="tap px-2.5 py-1 min-h-[30px] rounded-sm border border-conf-high/40 bg-conf-high/15 text-conf-high hover:bg-conf-high/30 transition-colors"
                >
                  {tr.graph.acceptAll}
                </button>
                <button
                  onClick={rejectAllSuggestions}
                  className="tap px-2.5 py-1 min-h-[30px] rounded-sm border border-border-base text-text-secondary hover:text-state-problem hover:border-state-problem/40 transition-colors"
                >
                  {tr.graph.rejectAll}
                </button>
                <button
                  onClick={() => {
                    if (lens !== 'structure') {
                      setLens('structure');
                      schedule(stageTimer, frameStaging, 450);
                    } else frameStaging();
                  }}
                  className="tap px-2.5 py-1 min-h-[30px] rounded-sm border border-ai-accent/40 text-ai-accent hover:bg-ai-accent/10 transition-colors"
                >
                  {tr.graph.viewStaging}
                </button>
              </span>
            </div>
          </Panel>
        )}
        {emptyLens && (
          <Panel position="top-center" className="!mt-24">
            <div className="text-xs text-text-muted bg-bg-secondary/90 border border-border-base rounded-sm px-3 py-2">
              {tr.graph.lensEmpty}
            </div>
          </Panel>
        )}
        {/* The minimap eats a big slice of a phone screen for little return. */}
        {!isMobile && (
          <MiniMap
            bgColor="#09090b"
            maskColor="rgba(9, 9, 11, 0.75)"
            maskStrokeColor="#52525b"
            maskStrokeWidth={2}
            nodeColor={(n) => {
              if (n.type === 'columnHeader') return 'transparent';
              const d = n.data as unknown as ConceptNodeData | undefined;
              if (!d) return '#3f3f46';
              // Suggestions em staging aparecem em roxo pra combinar com as edges.
              if ((n.data as { isSuggestion?: boolean }).isSuggestion) return '#8b5cf6';
              // Estados terminais têm precedência visual sobre confiança.
              if (d.state === 'done') return '#22c55e';
              if (d.state === 'problem') return '#ef4444';
              if (d.state === 'discarded') return '#52525b';
              const band = confidenceBand(d.confidence);
              return band === 'high' ? '#4ade80' : band === 'mid' ? '#fbbf24' : '#f87171';
            }}
            nodeStrokeColor="#3f3f46"
            nodeStrokeWidth={2}
            nodeBorderRadius={3}
            pannable
            zoomable
            style={{ width: 180, height: 120 }}
          />
        )}
      </ReactFlow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edge legend — the four edge kinds + staging suggestions, collapsible so it
// stays a small chip until asked (and by default on phones).
// ---------------------------------------------------------------------------

function Swatch({ stroke, dash, width = 2 }: { stroke: string; dash?: string; width?: number }) {
  return (
    <svg width="24" height="6" className="shrink-0" aria-hidden>
      <line x1="0" y1="3" x2="24" y2="3" stroke={stroke} strokeWidth={width} strokeDasharray={dash} />
    </svg>
  );
}

function EdgeLegend({ tr }: { tr: Messages }) {
  const [open, setOpen] = useState(false);
  const rows: Array<{ label: string; stroke: string; dash?: string; width?: number }> = [
    { label: tr.graph.legendDecomposition, stroke: DECOMPOSITION_EDGE_STYLE.stroke, width: 1.25 },
    { label: tr.graph.legendDirect, stroke: edgeStyleByKind.direct.stroke, width: 2 },
    { label: tr.graph.legendMiddleware, stroke: edgeStyleByKind.middleware.stroke, dash: edgeStyleByKind.middleware.strokeDasharray },
    { label: tr.graph.legendIndependent, stroke: edgeStyleByKind.independent.stroke, dash: edgeStyleByKind.independent.strokeDasharray },
    { label: tr.graph.legendOptional, stroke: edgeStyleByKind.optional.stroke, dash: edgeStyleByKind.optional.strokeDasharray },
    { label: tr.graph.legendSuggestion, stroke: SUGGESTION_EDGE_STYLE.stroke, dash: SUGGESTION_EDGE_STYLE.strokeDasharray },
  ];
  return (
    <div className="bg-bg-secondary/90 backdrop-blur-sm border border-border-base rounded-sm max-w-[260px]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-2.5 py-1.5 min-h-[32px] text-[11px] font-mono uppercase tracking-wider text-text-muted hover:text-text-primary flex items-center gap-1.5 transition-colors"
      >
        <span>{tr.graph.legend}</span>
        <span className="ml-auto">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2">
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center gap-2 text-[11px] text-text-secondary">
                <Swatch stroke={r.stroke} dash={r.dash} width={r.width ?? 2} />
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 pt-2 border-t border-border-base space-y-1 text-[11px] text-text-secondary">
            <div className="flex items-center gap-2">
              <span className="w-4 h-3 rounded-[2px] border-2 border-state-done shrink-0" />
              {tr.graph.legendBorderDone}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-3 rounded-[2px] border-2 border-dashed border-conf-mid shrink-0" />
              {tr.graph.legendBorderNoProof}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-3 rounded-[2px] border-2 border-state-problem shrink-0" />
              {tr.graph.legendBorderProblem}
            </div>
            <p className="text-text-muted pt-1">{tr.graph.legendDependencyHint}</p>
          </div>
        </div>
      )}
    </div>
  );
}
