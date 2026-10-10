import { z } from 'zod';
import { nanoid } from 'nanoid';
import { useGraphStore } from '@/store';
import { computeTreeLayout } from '@/graph/treeLayout';
import type { ConceptNodeData, Project } from '@/types';
import { readPlanner, capturePlanner, plannerBusy } from '@/workspace/planner';
import { useWorkspaceStore } from '@/workspace/store';
import { requestWorkspaceUI } from '@/workspace/uiRequests';
import { projectFiles } from '@/attachments/projectFiles';
import { sourceFingerprint } from '@/attachments/files';
import type { PlannerSnapshot } from '@/workspace/types';

const id = z.string().min(1).max(100), text = z.string().max(8000);
const provenance = { sourceIds: z.array(id).max(12).optional() };
export const planStructureSchema = z.object({
  projectId: id, revision: id, reason: z.string().min(1).max(2000),
  operations: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('add'), key: id, parentId: id, name: z.string().min(1).max(180), nodeKind: z.enum(['categoria', 'recurso', 'passo', 'decisao', 'concept']), oQue: text, porQue: text, order: z.number().int().min(0).max(10000).optional(), ...provenance }).strict(),
    z.object({ kind: z.literal('update'), nodeId: id, patch: z.object({ name: z.string().min(1).max(180).optional(), oQue: text.optional(), porQue: text.optional(), notes: text.optional() }).strict(), ...provenance }).strict(),
    z.object({ kind: z.literal('move'), nodeId: id, parentId: id, order: z.number().int().min(0).max(10000), ...provenance }).strict(),
  ])).min(1).max(24),
}).strict();
export function planRevision(project: Project) { return sourceFingerprint(JSON.stringify(project)); }
const pendingWorkRevision = (snapshot: Pick<PlannerSnapshot, 'drafts' | 'pendingSuggestions' | 'parkedSuggestions'>) => sourceFingerprint(JSON.stringify({ drafts: snapshot.drafts, pendingSuggestions: snapshot.pendingSuggestions, parkedSuggestions: snapshot.parkedSuggestions }));
const undoEntries = new Map<string, { projectId: string; before: Project; after: string; pendingWork: string }>();
export function canUndoPlanStructure(projectId: string, undoId: string) {
  const entry = undoEntries.get(undoId), snapshot = readPlanner(projectId), project = snapshot.project;
  return !!entry && entry.projectId === projectId && !!project && planRevision(project) === entry.after && pendingWorkRevision(snapshot) === entry.pendingWork;
}
export function applyPlanStructure(raw: unknown) {
  const input = planStructureSchema.parse(raw);
  if (plannerBusy()) throw new Error('plannerBusy');
  const before = readPlanner(input.projectId).project;
  if (!before || planRevision(before) !== input.revision) throw new Error('planChanged');
  const files = projectFiles(input.projectId), nodes = { ...before.nodes }, edges = { ...before.edges };
  const added: Record<string, string> = Object.create(null);
  const timestamp = Date.now(), changes: Array<{ kind: string; nodeId: string; name: string }> = [];
  const resolve = (value: string) => added[value] ?? value;
  const sequence = (parentId: string | null, inserted?: ConceptNodeData) => {
    const siblings = Object.values(nodes).filter(node => node.parentId === parentId && node.id !== inserted?.id).sort((a, b) => a.order - b.order);
    if (inserted) siblings.splice(Math.min(inserted.order, siblings.length), 0, inserted);
    siblings.forEach((node, order) => { if (node.order !== order) nodes[node.id] = { ...node, order }; });
  };
  for (const op of input.operations) {
    const sourceIds = op.sourceIds ?? [];
    if (sourceIds.some(id => !files.some(file => file.id === id))) throw new Error('attachmentMissing');
    const history = { id: nanoid(10), timestamp, kind: 'edit' as const, message: input.reason + (sourceIds.length ? ` [${sourceIds.map(id => files.find(file => file.id === id)!.name).join(', ')}]` : '') };
    let target: ConceptNodeData, previousParent: string | null | undefined;
    if (op.kind === 'add') {
      if (Object.hasOwn(added, op.key) || nodes[op.key]) throw new Error('duplicateNodeKey');
      const parentId = resolve(op.parentId), parent = nodes[parentId]; if (!parent) throw new Error('parentMissing');
      if (parent.takenAsKnown || parent.confirmado || parent.state === 'done') throw new Error('parentResolved');
      if (Object.values(nodes).some(node => node.parentId === parentId && node.name.trim().toLocaleLowerCase() === op.name.trim().toLocaleLowerCase())) throw new Error('duplicateNode');
      const nodeId = nanoid(10); added[op.key] = nodeId;
      target = { id: nodeId, parentId, kind: op.nodeKind, name: op.name, fx: op.oQue, oQue: op.oQue, porQue: op.porQue, problem: '', confidence: 50, confidenceSource: 'ai', confidenceReason: '', pros: [], cons: [], comoConfirmar: '', confirmado: false, order: op.order ?? Object.values(nodes).filter(n => n.parentId === parentId).length, state: 'concept', notes: '', history: [history], aiSuggested: true, position: { x: parent.position.x + 340, y: parent.position.y + 300 } };
      const edgeId = nanoid(10); edges[edgeId] = { id: edgeId, source: parentId, target: nodeId, kind: 'direct' };
    } else {
      const nodeId = resolve(op.nodeId), current = nodes[nodeId]; if (!current) throw new Error('nodeMissing');
      previousParent = current.parentId;
      target = { ...current, history: [...current.history, history] };
      if (op.kind === 'update') { target = { ...target, ...op.patch, explicacao: undefined }; }
      else {
        const parentId = resolve(op.parentId), parent = nodes[parentId];
        if (!parent || nodeId === before.rootId) throw new Error('invalidParent');
        if (parent.confirmado || parent.takenAsKnown || parent.state === 'done') throw new Error('parentResolved');
        let ancestor: ConceptNodeData | undefined = parent;
        const visited = new Set<string>();
        while (ancestor) {
          if (ancestor.id === nodeId || visited.has(ancestor.id)) throw new Error('planCycle');
          visited.add(ancestor.id); ancestor = ancestor.parentId ? nodes[ancestor.parentId] : undefined;
        }
        for (const [id, edge] of Object.entries(edges)) if (edge.source === current.parentId && edge.target === nodeId && edge.kind === 'direct') delete edges[id];
        const edgeId = nanoid(10); edges[edgeId] = { id: edgeId, source: parentId, target: nodeId, kind: 'direct' };
        target = { ...target, parentId, order: op.order };
      }
    }
    if (sourceIds.length) target.sourceAttachmentIds = [...new Set([...(target.sourceAttachmentIds ?? []), ...sourceIds])];
    nodes[target.id] = target;
    if (op.kind !== 'update') {
      sequence(target.parentId, target);
      if (previousParent !== undefined && previousParent !== target.parentId) sequence(previousParent);
    }
    changes.push({ kind: op.kind, nodeId: target.id, name: target.name });
  }
  let after: Project = { ...before, nodes, edges, updatedAt: timestamp };
  // Keep human layout; new parts get an initial position next to their parent.
  if (!before.manualLayout) {
    const layout = computeTreeLayout(after);
    after = { ...after, nodes: Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, id === before.rootId ? node : { ...node, position: layout[id] ?? node.position }])) };
  }
  requestWorkspaceUI({ projectId: input.projectId, surface: 'planner' });
  if (!useGraphStore.getState().project || planRevision(useGraphStore.getState().project!) !== input.revision) throw new Error('planChanged');
  useGraphStore.setState({ project: after, lastAction: null });
  useWorkspaceStore.getState().savePlanner(input.projectId, capturePlanner());
  const undoId = nanoid(12); undoEntries.set(undoId, { projectId: input.projectId, before, after: planRevision(after), pendingWork: pendingWorkRevision(useGraphStore.getState()) });
  if (undoEntries.size > 20) undoEntries.delete(undoEntries.keys().next().value!);
  return { changed: true, projectId: input.projectId, planId: after.id, undoId, reason: input.reason, changes, added };
}
export function undoPlanStructure(projectId: string, undoId: string) {
  if (plannerBusy()) throw new Error('plannerBusy');
  if (!canUndoPlanStructure(projectId, undoId)) throw new Error('planChanged');
  const entry = undoEntries.get(undoId)!;
  requestWorkspaceUI({ projectId, surface: 'planner' });
  const current = useGraphStore.getState();
  useGraphStore.setState({ project: entry.before, lastAction: null,
    selectedNodeId: current.selectedNodeId && entry.before.nodes[current.selectedNodeId] ? current.selectedNodeId : entry.before.rootId,
    focusedParentId: current.focusedParentId && entry.before.nodes[current.focusedParentId] ? current.focusedParentId : entry.before.rootId,
  });
  useWorkspaceStore.getState().savePlanner(projectId, capturePlanner()); undoEntries.delete(undoId);
  return { changed: true, projectId, undoId };
}
