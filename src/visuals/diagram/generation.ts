import { generateText } from 'ai';
import { nanoid } from 'nanoid';
import { aiModel, assertAIReady, callOpts } from '@/ai/client';
import { registerAIAction } from '@/ai/actions';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { applyVisualProposal, copyVisualInput, getVisualWorkspace, mutateVisualWorkspace, resolveVisualContext, storeVisualProposal, watchVisualScope } from '../domain';
import { loadVisualVisionImages, normalizeVisualVisionError, visualVisionPrompt } from '../vision';
import { readVisualMedia } from '../media';
import { artifactSchema } from '../normalize';
import type { DiagramV1 } from './model';
import { buildDiagramSystem } from './prompt';
import { DiagramLabelsMissingError, parseGeneratedDiagram } from './quality';
import type { VisualArtifact, VisualDiagramProposal, VisualPromptInput } from '../types';
import type { VisualSceneOptions } from '../generation';

const system = buildDiagramSystem('plan');

/** One text/JSON inference avoids provider-specific tuple/strict-schema failures from the lab. Local validation is mandatory, no paid repair retry. */
async function inferDiagram(input: VisualPromptInput, options: VisualSceneOptions & { sourceDiagram?: DiagramV1 }) {
  const guard = watchVisualScope(), snapshot = copyVisualInput({ ...input, artifactKind: 'diagram', generationMode: 'standard' });
  let offGraph = () => {}, offWorkspace = () => {};
  try {
    options.signal.throwIfAborted(); assertAIReady();
    if (!snapshot.text.trim() && !snapshot.mentions.length && !snapshot.attachments.length) throw new Error('visualPromptRequired');
    const context = resolveVisualContext(snapshot); let changed = false;
    const allowedNodes = Object.keys(useGraphStore.getState().project!.nodes);
    const check = () => { try { if (resolveVisualContext(snapshot).fingerprint !== context.fingerprint) changed = true; } catch { changed = true; } };
    offGraph = useGraphStore.subscribe(check); offWorkspace = useWorkspaceStore.subscribe(check);
    const assertCurrent = () => { options.signal.throwIfAborted(); guard.assert(); check(); if (changed) throw new Error('visualContextChanged'); };
    const workspace = getVisualWorkspace(useGraphStore.getState().project);
    for (const attachment of snapshot.attachments) if (attachment.mediaId && !(await readVisualMedia(attachment.mediaId))) throw new Error('visualMediaMissing');
    const images = await loadVisualVisionImages(snapshot, workspace, { signal: options.signal, assertCurrent });
    await options.beforeRequest?.(); assertCurrent();
    const result = await generateText({ model: aiModel, system, ...visualVisionPrompt(JSON.stringify({ instruction: snapshot.text, context: context.text, ...(options.sourceDiagram ? { sourceDiagram: options.sourceDiagram, revisionInstruction: 'Revise this existing document, preserving meaningful element/parameter IDs and assumptions unless the user explicitly changes them. Return the complete replacement document.' } : {}) }), images), abortSignal: options.signal, maxRetries: 0, ...callOpts('plans', .3) });
    options.signal.throwIfAborted(); guard.assert();
    if (result.finishReason === 'length' || result.text.length > 150000) throw new Error('visualGenerationIncomplete');
    let diagram: DiagramV1;
    try { diagram = parseGeneratedDiagram(JSON.parse(result.text.trim()), allowedNodes); }
    catch (reason) { if (reason instanceof DiagramLabelsMissingError) throw reason; throw new Error('visualDiagramInvalid', { cause: reason }); }
    check();
    const referencedMediaIds = [...new Set([...snapshot.mentions.filter(m => m.kind === 'image').flatMap(m => { const a = workspace.artifacts.find(a => a.id === m.id); return a?.mediaId ? [a.mediaId] : []; }), ...snapshot.attachments.flatMap(a => a.mediaId ? [a.mediaId] : [])])].slice(0, 20);
    return { diagram, input: snapshot, contextFingerprint: context.fingerprint, contextSnapshot: context.text.slice(0, 48000), referencedMediaIds, current: !changed };
  } catch (reason) { throw normalizeVisualVisionError(reason); }
  finally { offGraph(); offWorkspace(); guard.dispose(); }
}

export async function generateVisualDiagram(input: VisualPromptInput, options: VisualSceneOptions): Promise<VisualDiagramProposal> {
  const guard = watchVisualScope();
  try {
    const result = await inferDiagram(input, options); guard.assert(); options.signal.throwIfAborted();
    const { current, ...payload } = result;
    const proposal: VisualDiagramProposal = { ...payload, id: nanoid(), projectId: guard.scope.projectId, kind: 'diagram', label: result.diagram.title, scene: null, createdAt: Date.now(), status: current ? 'ready' : 'stale' };
    storeVisualProposal(proposal, guard.scope);
    if (current && getVisualWorkspace(useGraphStore.getState().project).mode === 'automatic') { applyVisualProposal(proposal.id); proposal.status = 'applied'; }
    return proposal;
  } finally { guard.dispose(); }
}

const identity = (a: VisualArtifact) => JSON.stringify([a.kind, a.label, a.diagram, a.diagramValues, a.revisionIndex, a.linkedNodeId]);
/** Explicit OK revises one artifact; movements/resizing during inference remain intact. */
export async function reviseVisualDiagram(id: string, input: VisualPromptInput, options: VisualSceneOptions): Promise<VisualArtifact> {
  const guard = watchVisualScope(), finish = registerAIAction(); let off = () => {};
  try {
    options.signal.throwIfAborted();
    const find = () => getVisualWorkspace(useGraphStore.getState().project).artifacts.find(a => a.id === id);
    const source = find(); if (source?.kind !== 'diagram' || !source.diagram) throw new Error('visualArtifactMissing');
    const signature = identity(source); let changed = false;
    off = useGraphStore.subscribe(() => { const a = find(); if (!a || identity(a) !== signature) changed = true; });
    const result = await inferDiagram(input, { ...options, sourceDiagram: source.diagram });
    guard.assert(); options.signal.throwIfAborted(); const current = find();
    if (changed || !current || identity(current) !== signature || !result.current || resolveVisualContext(result.input).fingerprint !== result.contextFingerprint) throw new Error('visualContextChanged');
    if (current.revisionIndex >= 99) throw new Error('visualRevisionLimit');
    const revisions = current.revisions.slice(0, current.revisionIndex + 1);
    revisions[revisions.length - 1] = { ...revisions[revisions.length - 1], diagram: current.diagram, diagramValues: current.diagramValues ?? {}, label: current.label };
    const diagramValues = Object.fromEntries(result.diagram.parameters.flatMap(p => { const value = current.diagramValues?.[p.id]; return value !== undefined && value >= p.min && value <= p.max ? [[p.id, value]] : []; }));
    revisions.push({ scene: null, mediaId: null, createdAt: Date.now(), diagram: result.diagram, diagramValues, label: result.diagram.title, input: result.input, contextFingerprint: result.contextFingerprint, referencedMediaIds: result.referencedMediaIds });
    const revised = artifactSchema.parse({ ...current, label: result.diagram.title, diagram: result.diagram, diagramValues, revisions, revisionIndex: revisions.length - 1 });
    mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => a.id === id ? revised : a) }), guard.scope);
    return revised;
  } finally { off(); guard.dispose(); finish(); }
}
