import { useMemo, useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeChange,
  applyNodeChanges,
  type EdgeTypes,
} from '@xyflow/react';
import { useGraphStore, confidenceBand, isBlocked, type Lens } from '@/store';
import { ConceptNode } from './ConceptNode';
import type { ConceptEdgeData, ConceptNodeData } from '@/types';

const nodeTypes = { concept: ConceptNode };

const edgeStyleByKind: Record<ConceptEdgeData['kind'], { stroke: string; strokeWidth: number; strokeDasharray?: string }> = {
  direct: { stroke: '#22c55e', strokeWidth: 2.5 },
  middleware: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '4 2' },
  independent: { stroke: '#6366f1', strokeWidth: 1.5, strokeDasharray: '6 4' },
  optional: { stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '2 3' },
};

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
      const x0 = Number(d) * 360;
      ids.forEach((id, i) => {
        out[id] = { x: x0, y: i * 180 - (ids.length - 1) * 90 };
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
        out[id] = { x: col * 360, y: i * 160 - (bands[band].length - 1) * 80 };
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
        out[id] = { x: col * 340, y: i * 160 - ((byState[s]?.length ?? 1) - 1) * 80 };
      });
    });
    return out;
  }

  if (lens === 'connections') {
    // Force-like simple radial layout by degree
    const deg: Record<string, number> = {};
    edges.forEach((e) => {
      deg[e.source] = (deg[e.source] || 0) + 1;
      deg[e.target] = (deg[e.target] || 0) + 1;
    });
    const sorted = [...nodes].sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0));
    sorted.forEach((n, i) => {
      if (i === 0) out[n.id] = { x: 0, y: 0 };
      else {
        const angle = (i / (sorted.length - 1)) * Math.PI * 2;
        const r = 400;
        out[n.id] = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
      }
    });
    return out;
  }

  nodes.forEach((n) => (out[n.id] = n.position));
  return out;
};

export function GraphCanvas() {
  const project = useGraphStore((s) => s.project);
  const lens = useGraphStore((s) => s.lens);
  const selectedId = useGraphStore((s) => s.selectedNodeId);
  const pending = useGraphStore((s) => s.pendingSuggestions);
  const selectNode = useGraphStore((s) => s.selectNode);
  const updateNodePosition = useGraphStore((s) => s.updateNodePosition);

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
    const base: Edge[] = Object.values(project.edges).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      style: edgeStyleByKind[e.kind],
      animated: e.kind === 'direct',
    }));

    if (pending) {
      pending.nodes.forEach((p) => {
        base.push({
          id: `sugg-edge-${p.tempId}`,
          source: pending.parentId,
          target: `suggestion-${p.tempId}`,
          style: { stroke: '#8b5cf6', strokeWidth: 1.5, strokeDasharray: '3 3' },
          animated: true,
        });
      });
    }

    return base;
  }, [project, pending]);

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
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#27272a" />
        <Controls showInteractive={false} />
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
      </ReactFlow>
    </div>
  );
}
