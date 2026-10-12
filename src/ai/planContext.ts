import { canRevealAICriterionNow } from '@/store';
import { readPlanner } from '@/workspace/planner';
import type { ConceptNodeData } from '@/types';
import { projectFiles } from '@/attachments/projectFiles';
import { planRevision } from './planStructure';
import { useWorkspaceStore } from '@/workspace/store';

export const PLAN_TEXT_FIELDS = ['name', 'objective', 'rules', 'referenceTarget', 'fx', 'problem', 'confidenceReason', 'oQue', 'porQue', 'notes',
  'explicacao', 'comoConfirmar', 'comoConfirmarUsuario', 'comoConfirmarAtendido', 'failureContext', 'pros', 'cons', 'decisionOptions', 'groundTruthRefs', 'webResearch', 'history'] as const;
export interface AssistantPlanRead {
  projectId: string; offset?: number; limit?: number; edgeOffset?: number; nodeId?: string;
  suggestionOffset?: number; parkedOffset?: number;
  textField?: typeof PLAN_TEXT_FIELDS[number]; textOffset?: number;
}
function page(total: number, offset: number, returned: number) {
  return { total, offset, returned, nextOffset: offset + returned < total ? offset + returned : null };
}
function limitedText() {
  const truncatedFields: string[] = [];
  let remaining = 6000;
  const text = (field: string, value: string | undefined, limit: number) => {
    const original = value ?? '', result = original.slice(0, Math.min(limit, remaining));
    remaining -= result.length;
    if (result.length < original.length) truncatedFields.push(field);
    return result;
  };
  return { text, truncatedFields };
}
function summarizeNode(node: ConceptNodeData, detailed: boolean) {
  const { text, truncatedFields } = limitedText();
  const summary = {
    id: node.id, parentId: node.parentId, kind: node.kind, name: text('name', node.name, 160), order: node.order,
    state: node.state, confirmado: node.confirmado, takenAsKnown: node.takenAsKnown,
    confirmedWithoutSignal: node.confirmedWithoutSignal,
    oQue: text('oQue', node.oQue, detailed ? 1200 : 160),
    comoConfirmar: canRevealAICriterionNow(node) ? text('comoConfirmar', node.comoConfirmar, detailed ? 800 : 160) : '',
  };
  if (!detailed) return { ...summary, truncatedFields };
  return { ...summary, fx: text('fx', node.fx, 500), problem: text('problem', node.problem, 500),
    porQue: text('porQue', node.porQue, 800), notes: text('notes', node.notes, 800),
    confidence: node.confidence, confidenceSource: node.confidenceSource,
    confidenceReason: text('confidenceReason', node.confidenceReason, 300),
    comoConfirmarUsuario: text('comoConfirmarUsuario', node.comoConfirmarUsuario, 500),
    comoConfirmarAtendido: node.comoConfirmarAtendido ? { at: node.comoConfirmarAtendido.at, observacao: text('comoConfirmarAtendido', node.comoConfirmarAtendido.observacao, 500) } : null,
    failureContext: text('failureContext', node.failureContext, 500),
    pros: text('pros', node.pros.join('\n'), 500), cons: text('cons', node.cons.join('\n'), 500),
    decisionPickedId: node.decisionPickedId,
    decisionOptions: node.decisionOptions?.slice(0, 10).map(option => ({ id: option.id, label: text('decisionOptions', option.label, 100) })),
    historyCount: node.history.length, groundTruthRefCount: node.groundTruthRefs?.length ?? 0,
    decisionOptionCount: node.decisionOptions?.length ?? 0, truncatedFields,
    detailNote: 'Bounded public detail. Use textField + textOffset to retrieve complete fields in chunks before replacing text. History and references are available through textField.',
  };
}

/** Read-only public projection. Large source bodies are retrieved explicitly in chunks. */
export function readAssistantPlan(input: AssistantPlanRead) {
  const snapshot = readPlanner(input.projectId), project = snapshot.project;
  const offset = input.offset ?? 0, limit = input.limit ?? 10, edgeOffset = input.edgeOffset ?? 0;
  const allNodes = project ? Object.values(project.nodes) : [];
  const selected = input.nodeId ? project?.nodes[input.nodeId] : null;
  if (input.nodeId && !selected) throw new Error('nodeMissing');
  const projectText = project ?? snapshot.objectiveDraft;
  const metadataText = limitedText();
  const outlines = snapshot.objectiveDraft.outlines ?? [];
  const files = projectFiles(input.projectId);
  const attachmentOffset = offset;
  const attachments = files.slice(attachmentOffset, attachmentOffset + limit).map(file => ({ id: file.id, name: file.name.slice(0, 160), kind: file.kind, truncated: file.truncated }));
  const nodes = input.textField ? [] : selected ? [selected] : allNodes.slice(offset, offset + limit);
  const allEdges = project ? Object.values(project.edges) : [];
  const pending = snapshot.pendingSuggestions, suggestionOffset = input.suggestionOffset ?? 0, parkedOffset = input.parkedOffset ?? 0;
  const parked = Object.values(snapshot.parkedSuggestions).flatMap(batch => batch.nodes.map(node => ({ parentId: batch.parentId, node })));
  const suggestionSummary = (item: NonNullable<typeof pending>['nodes'][number]) => ({ tempId: item.tempId,
    kind: item.data.kind, name: item.data.name.slice(0, 160), oQue: item.data.oQue.slice(0, 160),
    truncated: item.data.name.length > 160 || item.data.oQue.length > 160 });
  const edges = input.textField || selected ? [] : allEdges.slice(edgeOffset, edgeOffset + limit);
  const textField = input.textField;
  let fullText: string | undefined;
  if (textField) {
    if (['name', 'objective', 'rules', 'referenceTarget'].includes(textField) && (!selected || textField !== 'name')) {
      const source = projectText as unknown as Record<string, unknown>;
      const value = source[textField];
      fullText = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '';
    } else {
      if (!selected) throw new Error('Choose nodeId for this textField.');
      const value = textField === 'comoConfirmar' && !canRevealAICriterionNow(selected) ? '' : selected[textField as keyof ConceptNodeData];
      fullText = typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);
    }
  }
  const textOffset = input.textOffset ?? 0, content = fullText?.slice(textOffset, textOffset + 4000);
  const publicProject = project ? {
    id: project.id, name: metadataText.text('name', project.name, 240), rootId: project.rootId,
    objective: metadataText.text('objective', project.objective, 400),
    rules: metadataText.text('rules', (project.rules ?? []).join('\n'), 1200),
    constructionStrategy: project.constructionStrategy, archetype: project.archetype,
    planApproach: project.planApproach, referenceTarget: metadataText.text('referenceTarget', project.referenceTarget, 400),
    nodes: Object.fromEntries(nodes.map(node => [node.id, summarizeNode(node, !!selected)])),
    edges: Object.fromEntries(edges.map(edge => [edge.id, { id: edge.id, source: edge.source, target: edge.target, kind: edge.kind,
      middlewareNodeId: edge.middlewareNodeId, note: edge.note?.slice(0, 160), truncated: !!edge.note && edge.note.length > 160 }])),
    truncatedFields: metadataText.truncatedFields,
  } : null;
  return {
    workspaceProjectId: input.projectId,
    workspaceProjectName: useWorkspaceStore.getState().projects[input.projectId]?.name.slice(0, 240) ?? '',
    planId: project?.id ?? null,
    readMode: textField ? 'text' as const : selected ? 'node' as const : 'overview' as const,
    hiddenCriterionNodeIds: (textField === 'comoConfirmar' && selected ? [selected] : nodes)
      .filter(node => node.comoConfirmar?.trim() && !canRevealAICriterionNow(node)).map(node => node.id),
    project: publicProject, revision: project ? planRevision(project) : null,
    selectedNodeId: snapshot.selectedNodeId, focusedParentId: snapshot.focusedParentId, lens: snapshot.lens, viewMode: snapshot.viewMode,
    nodePage: selected || textField ? { total: selected ? 1 : 0, offset: 0, returned: nodes.length, nextOffset: null, scope: textField ? 'text-only' : 'selected-node' } : page(allNodes.length, offset, nodes.length),
    edgePage: selected || textField ? { total: allEdges.length, offset: 0, returned: 0, nextOffset: null, omitted: true } : page(allEdges.length, edgeOffset, edges.length),
    attachments, attachmentPage: page(files.length, attachmentOffset, attachments.length),
    pendingSuggestions: pending ? { parentId: pending.parentId, originalCount: pending.originalCount,
      nodes: pending.nodes.slice(suggestionOffset, suggestionOffset + limit).map(suggestionSummary) } : null,
    suggestionPage: page(pending?.nodes.length ?? 0, suggestionOffset, Math.min(limit, Math.max(0, (pending?.nodes.length ?? 0) - suggestionOffset))),
    parkedSuggestions: parked.slice(parkedOffset, parkedOffset + limit).map(({ parentId, node }) => ({ parentId, ...suggestionSummary(node) })),
    parkedSuggestionPage: page(parked.length, parkedOffset, Math.min(limit, Math.max(0, parked.length - parkedOffset))),
    ...(!project ? { objectiveDraft: { name: metadataText.text('name', projectText.name, 240), objective: metadataText.text('objective', projectText.objective, 1200),
      rules: metadataText.text('rules', (projectText.rules ?? []).join('\n'), 1200), planApproach: projectText.planApproach,
      referenceTarget: metadataText.text('referenceTarget', projectText.referenceTarget, 400),
      outlines: outlines.slice(offset, offset + limit).map(outline => ({ id: outline.id, title: outline.title.slice(0, 160), pitch: outline.pitch.slice(0, 300), rank: outline.rank })),
      truncatedFields: metadataText.truncatedFields }, outlinePage: page(outlines.length, offset, Math.min(limit, Math.max(0, outlines.length - offset))) } : {}),
    ...(fullText !== undefined ? { text: { field: textField, content, offset: textOffset, totalCharacters: fullText.length,
      nextOffset: textOffset + content!.length < fullText.length ? textOffset + content!.length : null } } : {}),
    note: 'Public paginated projection, not a complete planner snapshot. Follow nextOffset for nodes/attachments/outlines and edgeOffset for edges. Retrieve nodeId details or textField + textOffset before replacing incomplete fields. Visual payloads, archived plans and attachment bodies are not included.',
  };
}
