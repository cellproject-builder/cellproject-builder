import { useMemo, useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  applyNodeChanges,
  type EdgeTypes,
} from '@xyflow/react';
import {
  useGraphStore,
  computeTreeLayout,
  confidenceBand,
  isBlocked,
  type Lens,
} from '@/store';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useT } from '@/i18n';
import type { Messages } from '@/i18n';
import { ConceptNode } from './ConceptNode';
import type { ConceptEdgeData, ConceptNodeData } from '@/types';

const nodeTypes = { concept: ConceptNode };

const edgeStyleByKind: Record<ConceptEdgeData['kind'], { stroke: string; strokeWidth: number; strokeDasharray?: string }> = {
  direct: { stroke: '#22c55e', strokeWidth: 2.5 },
  middleware: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '4 2' },
  independent: { stroke: '#6366f1', strokeWidth: 1.5, strokeDasharray: '6 4' },
  optional: { stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '2 3' },
};

const SUGGESTION_EDGE_STYLE = { stroke: '#8b5cf6', strokeWidth: 1.5, strokeDasharray: '3 3' };

const edgeTypes: EdgeTypes = {};

const lensPositions = (
  lens: Lens,
  nodes: ConceptNodeData[],
  edges: ConceptEdgeData[],
): Record<string, { x: number; y: number }> => {
  const out: Record<string, { x: number; y: number }> = {};

  if (lens === 'structure') {
    nodes.forEach((n) => {
      out[n.id] = n.position;
    });
    return out;
  }

  // Spacing note: a node card occupies up to ~300×260 world px at the nearest
  // zoom bucket, so column/row steps must clear that or the lens overlaps.
  if (lens === 'flow') {
    // Simple layered layout by in-degree depth
    const depth: Record<string, number> = {};
    const byTarget: Record<string, string[]> = {};
    edges.forEach((e) => {
      (byTarget[e.target] ||= []).push(e.source);
    });
    const computeDepth = (id: string, visited: Set<string>): number => {
      if (depth[id] !== undefined) return depth[id];
      if (visited.has(id)) return 0;
      visited.add(id);
      const preds = byTarget[id] || [];
      const d = preds.length === 0 ? 0 : 1 + Math.max(...preds.map((p) => computeDepth(p, visited)));
      depth[id] = d;
      return d;
    };
    nodes.forEach((n) => computeDepth(n.id, new Set()));
    const byLayer: Record<number, string[]> = {};
    nodes.forEach((n) => {
      const d = depth[n.id];
      (byLayer[d] ||= []).push(n.id);
    });
    Object.entries(byLayer).forEach(([d, ids]) => {
      const x0 = Number(d) * 400;
      ids.forEach((id, i) => {
        out[id] = { x: x0, y: i * 280 - (ids.length - 1) * 140 };
      });
    });
    return out;
  }

  if (lens === 'risk') {
    const bands: Record<'high' | 'mid' | 'low', string[]> = { high: [], mid: [], low: [] };
    nodes.forEach((n) => bands[confidenceBand(n.confidence)].push(n.id));
    const bandOrder: Array<'low' | 'mid' | 'high'> = ['low', 'mid', 'high'];
    bandOrder.forEach((band, col) => {
      bands[band].forEach((id, i) => {
        out[id] = { x: col * 420, y: i * 280 - (bands[band].length - 1) * 140 };
      });
    });
    return out;
  }

  if (lens === 'state') {
    const order = ['concept', 'validated', 'executing', 'problem', 'done', 'discarded'];
    const byState: Record<string, string[]> = {};
    nodes.forEach((n) => {
      (byState[n.state] ||= []).push(n.id);
    });
    order.forEach((s, col) => {
      (byState[s] || []).forEach((id, i) => {
        out[id] = { x: col * 420, y: i * 280 - ((byState[s]?.length ?? 1) - 1) * 140 };
      });
    });
    return out;
  }

  if (lens === 'connections') {
    // Force-like simple radial layout by degree; radius grows with node count
    // so big graphs don't pile up on the circle.
    const deg: Record<string, number> = {};
    edges.forEach((e) => {
      deg[e.source] = (deg[e.source] || 0) + 1;
      deg[e.target] = (deg[e.target] || 0) + 1;
    });
    const sorted = [...nodes].sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0));
    const r = Math.max(420, sorted.length * 52);
    sorted.forEach((n, i) => {
      if (i === 0) out[n.id] = { x: 0, y: 0 };
      else {
        const angle = (i / (sorted.length - 1)) * Math.PI * 2;
        out[n.id] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
      }
    });
    return out;
  }

  nodes.forEach((n) => (out[n.id] = n.position));
  return out;
};

export function GraphCanvas() {
  const tr = useT();
  const isMobile = useIsMobile();
  const { fitView } = useReactFlow();
  const project = useGraphStore((s) => s.project);
  const lens = useGraphStore((s) => s.lens);
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const pending = useGraphStore((s) => s.pendingSuggestions);
  const selectNode = useGraphStore((s) => s.selectNode);
  const setLens = useGraphStore((s) => s.setLens);
  const updateNodePosition = useGraphStore((s) => s.updateNodePosition);
  const applyLayoutPositions = useGraphStore((s) => s.applyLayoutPositions);

  // Each lens recomputes positions — re-fit the viewport so the new
  // arrangement is actually on screen instead of wherever the user last was.
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 350 }), 50);
    return () => clearTimeout(t);
  }, [lens, fitView]);

  // Tidy tree: recompute positions for the whole decomposition and persist
  // them (structure lens shows stored positions, so switch to it).
  const handleTidy = useCallback(() => {
    if (!project) return;
    applyLayoutPositions(computeTreeLayout(project));
    if (lens !== 'structure') setLens('structure');
    else setTimeout(() => fitView({ padding: 0.15, duration: 350 }), 50);
  }, [project, lens, applyLayoutPositions, setLens, fitView]);

  const computedNodes: Node[] = useMemo(() => {
    if (!project) return [];
    const nodeList = Object.values(project.nodes);
    const edgeList = Object.values(project.edges);
    const positions = lensPositions(lens, nodeList, edgeList);

    const childCountByParent: Record<string, number> = {};
    nodeList.forEach((n) => {
      if (n.parentId) {
        childCountByParent[n.parentId] = (childCountByParent[n.parentId] || 0) + 1;
      }
    });

    const edgeCountByNode: Record<string, number> = {};
    edgeList.forEach((e) => {
      edgeCountByNode[e.source] = (edgeCountByNode[e.source] || 0) + 1;
      edgeCountByNode[e.target] = (edgeCountByNode[e.target] || 0) + 1;
    });

    const base: Node[] = nodeList.map((n) => ({
      id: n.id,
      type: 'concept',
      position: positions[n.id] || n.position,
      data: {
        ...n,
        childCount: childCountByParent[n.id] || 0,
        edgeCount: edgeCountByNode[n.id] || 0,
        // Precompute blocked here (once per project change) so each ConceptNode
        // doesn't subscribe to the whole project and rescan siblings on every
        // mutation — collapses an O(n) re-render storm.
        blocked: n.kind === 'passo' && isBlocked(project, n.id),
      },
      selected: n.id === selectedId,
      draggable: lens === 'structure',
    }));

    if (pending) {
      pending.nodes.forEach((p) => {
        const pos = p.data.position as { x: number; y: number };
        base.push({
          id: `suggestion-${p.tempId}`,
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
        });
      });
    }

    return base;
  }, [project, lens, selectedId, pending]);

  // React Flow precisa ser controlado: aplicamos NodeChanges (drag, select,
  // resize) num state local e ressincronizamos sempre que o store recalcular
  // computedNodes. Durante o drag o store não muda — `updateNodePosition` só
  // é chamado em `dragging === false` — portanto não há race com o useEffect.
  const [nodes, setNodes] = useState<Node[]>(computedNodes);
  useEffect(() => {
    setNodes(computedNodes);
  }, [computedNodes]);

  const rfEdges: Edge[] = useMemo(() => {
    if (!project) return [];
    // Edge animation is a battery/jank cost on touch devices — static there.
    const base: Edge[] = Object.values(project.edges).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      style: edgeStyleByKind[e.kind],
      animated: !isMobile && e.kind === 'direct',
    }));

    if (pending) {
      pending.nodes.forEach((p) => {
        base.push({
          id: `sugg-edge-${p.tempId}`,
          source: pending.parentId,
          target: `suggestion-${p.tempId}`,
          style: SUGGESTION_EDGE_STYLE,
          animated: true,
        });
      });
    }

    return base;
  }, [project, pending, isMobile]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((curr) => applyNodeChanges(changes, curr));
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          if (!change.id.startsWith('suggestion-')) {
            updateNodePosition(change.id, change.position);
          }
        }
      }
    },
    [updateNodePosition],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id.startsWith('suggestion-')) return;
      selectNode(node.id);
    },
    [selectNode],
  );

  const onPaneClick = useCallback(() => {
    // keep selection — clicking pane does not deselect to keep panel stable
  }, []);

  return (
    <div className="flex-1 relative bg-bg-primary">
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#27272a" />
        <Controls showInteractive={false} />
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
        {/* The minimap eats a big slice of a phone screen for little return. */}
        {!isMobile && (
          <MiniMap
            bgColor="#09090b"
            maskColor="rgba(9, 9, 11, 0.75)"
            maskStrokeColor="#52525b"
            maskStrokeWidth={2}
            nodeColor={(n) => {
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
    { label: tr.graph.legendDirect, stroke: edgeStyleByKind.direct.stroke, width: 2.5 },
    { label: tr.graph.legendMiddleware, stroke: edgeStyleByKind.middleware.stroke, dash: edgeStyleByKind.middleware.strokeDasharray },
    { label: tr.graph.legendIndependent, stroke: edgeStyleByKind.independent.stroke, dash: edgeStyleByKind.independent.strokeDasharray },
    { label: tr.graph.legendOptional, stroke: edgeStyleByKind.optional.stroke, dash: edgeStyleByKind.optional.strokeDasharray },
    { label: tr.graph.legendSuggestion, stroke: SUGGESTION_EDGE_STYLE.stroke, dash: SUGGESTION_EDGE_STYLE.strokeDasharray },
  ];
  return (
    <div className="bg-bg-secondary/90 backdrop-blur-sm border border-border-base rounded-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full px-2.5 py-1.5 min-h-[32px] text-[11px] font-mono uppercase tracking-wider text-text-muted hover:text-text-primary flex items-center gap-1.5 transition-colors"
      >
        <span>{tr.graph.legend}</span>
        <span className="ml-auto">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="px-2.5 pb-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2 text-[11px] text-text-secondary">
              <Swatch stroke={r.stroke} dash={r.dash} width={r.width ?? 2} />
              <span>{r.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
