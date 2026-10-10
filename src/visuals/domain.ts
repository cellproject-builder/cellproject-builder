import { useGraphStore, canRevealAICriterionNow } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { getPlannerOwnerId } from '@/workspace/planner';
import type { Project } from '@/types';
import type { MentionTarget, VisualArtifact, VisualPromptInput, VisualProposal, VisualWorkspace } from './types';

import { EMPTY_VISUAL_WORKSPACE, sceneSchema } from './normalize';
import { compactSearchContext } from './searchContext';
import { advancedContextScope } from './advancedContext';
import { modelAssemblyMatchesScene, modelAssemblySchema } from './modelAssembly';
import { parseDiagram } from './diagram/model';
export { sceneSchema, generationSceneSchema, normalizeVisualWorkspace } from './normalize';
export function getVisualWorkspace(project: Project | null): VisualWorkspace { return project?.visuals ?? EMPTY_VISUAL_WORKSPACE; }

export function currentVisualScope() {
  const project = useGraphStore.getState().project;
  if (!project) throw new Error('visualProjectMissing');
  const ownerId = getPlannerOwnerId();
  const active = useWorkspaceStore.getState().activeProjectId;
  if (ownerId && active && active !== ownerId) throw new Error('visualProjectChanged');
  return { projectId: project.id, ownerId };
}
export type VisualScope = ReturnType<typeof currentVisualScope>;
export function assertVisualScope(scope: VisualScope) {
  const current = currentVisualScope();
  if (current.projectId !== scope.projectId || current.ownerId !== scope.ownerId) throw new Error('visualProjectChanged');
}
/** Detects switching away and back, including a workspace owner change. */
export function watchVisualScope(scope = currentVisualScope()) {
  let stale = false;
  const check = () => { try { assertVisualScope(scope); } catch { stale = true; } };
  const offGraph = useGraphStore.subscribe(check), offWorkspace = useWorkspaceStore.subscribe(check);
  return { scope, assert: () => { check(); if (stale) throw new Error('visualProjectChanged'); }, dispose: () => { offGraph(); offWorkspace(); } };
}
export function mutateVisualWorkspace(update: (workspace: VisualWorkspace) => VisualWorkspace, scope = currentVisualScope()) {
  assertVisualScope(scope);
  useGraphStore.setState(state => ({ project: { ...state.project!, visuals: update(getVisualWorkspace(state.project)), updatedAt: Date.now() } }));
}
export function copyVisualInput(input: VisualPromptInput): VisualPromptInput {
  if (input.text.length > 12_000 || input.mentions.length > 20 || input.attachments.length > 8) throw new Error('visualInputLimit');
  return JSON.parse(JSON.stringify(input)) as VisualPromptInput;
}
export function saveVisualDraft(kind: 'search' | 'model', input: VisualPromptInput) {
  const copy = copyVisualInput(input);
  mutateVisualWorkspace(w => ({ ...w, drafts: { ...w.drafts, [kind]: copy } }));
}
export function setVisualMode(mode: 'approval' | 'automatic') {
  if (mode !== 'approval' && mode !== 'automatic') throw new Error('visualModeInvalid');
  mutateVisualWorkspace(w => ({ ...w, mode }));
}
export function updateVisualArtifact(id: string, patch: Partial<Pick<VisualArtifact, 'x' | 'y' | 'width' | 'height'>>) {
  for (const [key, value] of Object.entries(patch)) if (!['x', 'y', 'width', 'height'].includes(key) || !Number.isFinite(value) || Math.abs(value!) > 100_000 || (['width', 'height'].includes(key) && value! <= 0)) throw new Error('visualGeometryInvalid');
  mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => a.id === id ? { ...a, ...patch } : a) }));
}
/** Exploratory controls change only this visual document, never plan criteria or evidence. */
export function setDiagramParameter(id: string, parameterId: string, value: number) {
  const artifact = getVisualWorkspace(useGraphStore.getState().project).artifacts.find(a => a.id === id);
  const parameter = artifact?.kind === 'diagram' && artifact.diagram?.parameters.find(p => p.id === parameterId);
  if (!artifact || !parameter || !Number.isFinite(value)) throw new Error('diagramInvalidParameter');
  const diagramValues = { ...artifact.diagramValues, [parameterId]: Math.max(parameter.min, Math.min(parameter.max, value)) };
  mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => a.id === id ? { ...a, diagramValues } : a) }));
}
export function getDefaultVisualNodeId(): string | null {
  const { project, selectedNodeId } = useGraphStore.getState();
  return project && selectedNodeId && Object.hasOwn(project.nodes, selectedNodeId) ? selectedNodeId : null;
}
/** A link supplies context, never a parent transform or a positional constraint. */
export function setVisualArtifactLink(id: string, linkedNodeId: string | null) {
  const scope = currentVisualScope(), project = useGraphStore.getState().project!;
  if (!getVisualWorkspace(project).artifacts.some(a => a.id === id)) throw new Error('visualArtifactMissing');
  if (linkedNodeId !== null && (typeof linkedNodeId !== 'string' || !linkedNodeId || linkedNodeId.length > 200 || !Object.hasOwn(project.nodes, linkedNodeId))) throw new Error('visualNodeMissing');
  mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => a.id === id ? { ...a, linkedNodeId } : a) }), scope);
}
export function removeVisualArtifact(id: string) {
  const removeReference = (input: VisualPromptInput): VisualPromptInput => {
    const mentions = input.mentions.filter(target => target.kind !== 'image' || target.id !== id);
    return mentions.length === input.mentions.length ? input : { ...input, mentions };
  };
  mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.filter(a => a.id !== id), drafts: { search: removeReference(w.drafts.search), model: removeReference(w.drafts.model) } }));
}
export function revertVisualArtifact(id: string) {
  mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => {
    if (a.id !== id) return a;
    // Legacy in-place assemblies can be cleared; linked decompositions keep their snapshot.
    if (a.decomposition?.assembly && !a.decomposition.assemblyArtifactId && !a.sourceArtifactId) return { ...a, decomposition: { ...a.decomposition, assembly: undefined } };
    if (a.revisionIndex <= 0) return a;
    const revisionIndex = a.revisionIndex - 1, revision = a.revisions[revisionIndex];
    return { ...a, scene: revision.scene, mediaId: revision.mediaId, revisionIndex,
      ...(a.kind === 'diagram' ? { diagram: revision.diagram ?? undefined, diagramValues: revision.diagramValues ?? {} } : {}),
      ...(revision.label !== undefined ? { label: revision.label } : {}),
      ...(revision.assembly !== undefined ? { assembly: revision.assembly ?? undefined } : {}),
      ...(revision.decomposition !== undefined ? { decomposition: revision.decomposition ?? undefined } : {}) };
  }) }));
}
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value); let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
function sources() {
  const scope = currentVisualScope(), project = useGraphStore.getState().project!;
  const notes = Object.values(useWorkspaceStore.getState().notes).filter(n => !n.deletedAt && (n.projectId === null || n.projectId === (scope.ownerId ?? project.id)));
  const result: Array<{ target: MentionTarget; text: string }> = [];
  for (const n of notes) {
    const text = JSON.stringify({ title: n.title, blocks: n.blocks });
    result.push({ target: { id: n.id, kind: 'note', label: n.title || 'Nota sem título', detail: n.projectId ? 'Nota do projeto' : 'Nota pessoal', fingerprint: fingerprint([text, n.updatedAt]) }, text });
  }
  for (const n of Object.values(project.nodes)) {
    // Never serialize the full node: hidden independent assessment criteria stay hidden.
    const revealed = canRevealAICriterionNow(n);
    const text = JSON.stringify({ name: n.name, kind: n.kind, oQue: n.oQue, porQue: n.porQue, notes: n.notes,
      ...(n.fx ? { fx: n.fx } : {}),
      ...(n.webResearch ? { webResearch: { query: n.webResearch.query, findings: n.webResearch.findings, sources: n.webResearch.sources.map(source => ({ title: source.title, url: source.url })), searchedAt: n.webResearch.searchedAt } } : {}),
      // A cached explanation may have been generated before a criterion was hidden again.
      ...(revealed ? { comoConfirmar: n.comoConfirmar, ...(n.explicacao ? { explicacao: n.explicacao } : {}) } : {}) });
    result.push({ target: { id: n.id, kind: 'node', label: n.name, detail: n.kind, fingerprint: fingerprint([n, text]) }, text });
  }
  for (const a of getVisualWorkspace(project).artifacts.filter(a => a.kind === 'image')) {
    const text = JSON.stringify({ label: a.label, source: a.source, revisionIndex: a.revisionIndex, mediaId: a.mediaId });
    result.push({ target: { id: a.id, kind: 'image', label: a.label, detail: 'Imagem do plano', fingerprint: fingerprint(text) }, text });
  }
  return result;
}
/** Sanitized reference bodies shared by scoped visual workflows. */
export const visualContextSources = sources;
export function listMentionTargets(query: string): MentionTarget[] {
  if (!useGraphStore.getState().project) return [];
  const q = query.replace(/^@/, '').toLocaleLowerCase();
  return sources().map(s => s.target).filter(t => t.label.toLocaleLowerCase().includes(q)).slice(0, 100);
}
/** Exact ID resolution must not inherit the suggestion menu's 100-item limit. */
export function findMentionTarget(id: string, kind: MentionTarget['kind']): MentionTarget | undefined {
  return sources().find(source => source.target.id === id && source.target.kind === kind)?.target;
}
export function resolveVisualContext(input: VisualPromptInput): { text: string; fingerprint: string } {
  copyVisualInput(input);
  const scope = currentVisualScope(), project = useGraphStore.getState().project!, available = sources();
  const selected = input.mentions.map(target => {
    const source = available.find(s => s.target.id === target.id && s.target.kind === target.kind);
    if (!source) throw new Error('visualSourceMissing');
    return source;
  });
  const attachments = input.attachments.map(a => ({ id: a.id, name: a.name, mime: a.mime, byteLength: a.byteLength, mediaId: a.mediaId, text: a.text }));
  const branch = input.generationMode === 'advanced' ? advancedContextScope(project, input, available) : undefined;
  const diagramNodes = input.artifactKind === 'diagram' ? Object.values(project.nodes).slice(0, 80).map(n => ({ id: n.id, parentId: n.parentId, name: n.name.slice(0, 160), kind: n.kind, oQue: n.oQue.slice(0, 300) })) : undefined;
  const serialized = JSON.stringify({ selected: selected.map(s => ({ id: s.target.id, kind: s.target.kind, label: s.target.label, text: s.text.slice(0, 8_000) })), attachments: attachments.map(a => ({ ...a, text: a.text?.slice(0, 12_000), imageNote: a.mime.startsWith('image/') ? (input.analyzeImages === true ? 'Análise dos pixels solicitada; a imagem será enviada separadamente.' : 'Referência textual; pixels não analisados.') : undefined })), project: { name: project.name, objective: project.objective, rules: project.rules, planApproach: project.planApproach, referenceTarget: project.referenceTarget }, ...(branch ? { planOutline: branch.outline } : {}), ...(diagramNodes ? { planNodes: diagramNodes, planNodesPartial: Object.keys(project.nodes).length > diagramNodes.length } : {}) });
  let text = serialized;
  if (new TextEncoder().encode(serialized).byteLength > 48_000) {
    if (branch) {
      const outlineBytes = new TextEncoder().encode(JSON.stringify(branch.outline)).byteLength;
      text = JSON.stringify({ ...JSON.parse(compactSearchContext(serialized, 48_000 - outlineBytes - 32)), planOutline: branch.outline });
    } else text = compactSearchContext(serialized, 48_000);
  }
  return { text, fingerprint: fingerprint([scope, project.name, project.objective, project.rules, project.planApproach, project.referenceTarget, input.text, selected.map(s => [s.target.id, s.target.kind, s.target.fingerprint]), attachments, ...(input.analyzeImages === true ? ['pixels'] : []), ...(branch ? ['advanced', branch.fingerprintData] : []), ...(diagramNodes ? ['diagram', diagramNodes] : [])]) };
}
export function storeVisualProposal(proposal: VisualProposal, scope: VisualScope) {
  mutateVisualWorkspace(w => ({ ...w, proposals: [...w.proposals, proposal].slice(-40) }), scope);
}
export function rejectVisualProposal(id: string) {
  const scope = currentVisualScope();
  const proposal = getVisualWorkspace(useGraphStore.getState().project).proposals.find(p => p.id === id);
  if (!proposal || proposal.projectId !== scope.projectId) throw new Error('visualProposalMissing');
  if (proposal.status === 'applied') throw new Error('visualProposalApplied');
  if (proposal.status === 'rejected') return;
  mutateVisualWorkspace(w => ({ ...w, proposals: w.proposals.map(p => p.id === id ? { ...p, status: 'rejected' } : p) }), scope);
}
/** Remove only the history entry. Applied artifacts retain their own origin/revisions. */
export function removeVisualProposalHistory(id: string, scope = currentVisualScope()) {
  assertVisualScope(scope);
  const proposal = getVisualWorkspace(useGraphStore.getState().project).proposals.find(p => p.id === id);
  if (!proposal || proposal.projectId !== scope.projectId) throw new Error('visualProposalMissing');
  if (proposal.status === 'ready') throw new Error('visualProposalReady');
  mutateVisualWorkspace(w => ({ ...w, proposals: w.proposals.filter(p => p.id !== id) }), scope);
}
export function applyVisualProposal(id: string): VisualArtifact {
  const scope = currentVisualScope(), workspace = getVisualWorkspace(useGraphStore.getState().project);
  const proposal = workspace.proposals.find(p => p.id === id);
  if (!proposal || proposal.projectId !== scope.projectId) throw new Error('visualProposalMissing');
  if (proposal.status === 'rejected') throw new Error('visualProposalRejected');
  if (proposal.status === 'applied') {
    const artifact = workspace.artifacts.find(a => a.id === `model-${id}`);
    if (!artifact) throw new Error('visualArtifactRemoved');
    return artifact;
  }
  let eligible = false;
  try { eligible = proposal.status === 'ready' && resolveVisualContext(proposal.input).fingerprint === proposal.contextFingerprint; } catch { /* deleted source */ }
  if (!eligible) {
    mutateVisualWorkspace(w => ({ ...w, proposals: w.proposals.map(p => p.id === id ? { ...p, status: 'stale' } : p) }));
    throw new Error('visualProposalStale');
  }
  const project = useGraphStore.getState().project!;
  const diagram = proposal.kind === 'diagram' ? parseDiagram(proposal.diagram, Object.keys(project.nodes)) : undefined;
  const scene = proposal.kind === 'diagram' ? null : sceneSchema.parse(proposal.scene);
  const assembly = proposal.assembly ? modelAssemblySchema.parse(proposal.assembly) : undefined;
  if (assembly && (!scene || !modelAssemblyMatchesScene(assembly, scene))) throw new Error('visualAssemblyInvalid');
  const imageIds = [...new Set([...proposal.input.mentions.filter(target => target.kind === 'image').map(target => target.id), ...(assembly?.selectedImageIds ?? [])])].slice(0, 20);
  const explicitNode = proposal.input.mentions.find(target => target.kind === 'node' && Object.hasOwn(project.nodes, target.id))?.id;
  const imageNode = imageIds.map(imageId => workspace.artifacts.find(item => item.kind === 'image' && item.id === imageId)?.linkedNodeId)
    .find(nodeId => nodeId && Object.hasOwn(project.nodes, nodeId));
  // Keep provenance on the model: proposal history is bounded and source images can be removed.
  const origin = {
    proposalId: proposal.id, imageIds,
    imageMediaIds: [...new Set([...(proposal.referencedMediaIds ?? []), ...proposal.input.attachments.filter(attachment => attachment.mime.startsWith('image/') && attachment.mediaId).map(attachment => attachment.mediaId!)])].slice(0, 20),
    instruction: proposal.input.text,
  };
  const artifact: VisualArtifact = { id: `model-${id}`, label: proposal.label, kind: diagram ? 'diagram' : 'model', linkedNodeId: explicitNode ?? imageNode ?? getDefaultVisualNodeId(), x: 0, y: 0, width: diagram ? diagram.viewBox[2] : 360, height: diagram ? diagram.viewBox[3] + 76 : 280, scene, mediaId: null, source: null, origin, ...(assembly ? { assembly } : {}), ...(diagram ? { diagram, diagramValues: {} } : {}), revisions: [{ scene, mediaId: null, createdAt: Date.now(), ...(diagram ? { diagram, diagramValues: {} } : {}) }], revisionIndex: 0 };
  mutateVisualWorkspace(w => ({ ...w, artifacts: [...w.artifacts, artifact], proposals: w.proposals.map(p => p.id === id ? { ...p, status: 'applied' } : p) }), scope);
  return artifact;
}
