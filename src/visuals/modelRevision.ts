import { registerAIAction } from '@/ai/actions';
import { useGraphStore } from '@/store';
import { copyVisualInput, getVisualWorkspace, mutateVisualWorkspace, resolveVisualContext, watchVisualScope } from './domain';
import { generateVisualScene, type VisualSceneOptions } from './generation';
import { artifactSchema } from './normalize';
import { modelAssemblyMatchesScene } from './modelAssembly';
import type { VisualArtifact, VisualPromptInput } from './types';

const identity = (artifact: VisualArtifact) => JSON.stringify([artifact.label, artifact.scene, artifact.assembly, artifact.decomposition, artifact.revisionIndex, artifact.origin, artifact.linkedNodeId]);
/** Explicit OK applies one revision to the selected model; generation never inserts another object. */
export async function reviseVisualModel(id: string, input: VisualPromptInput, options: VisualSceneOptions): Promise<VisualArtifact> {
  const guard = watchVisualScope(), finish = registerAIAction(); let off = () => {};
  try {
    options.signal.throwIfAborted();
    const find = () => getVisualWorkspace(useGraphStore.getState().project).artifacts.find(a => a.id === id);
    const found = find(); if (!found || found.kind !== 'model' || !found.scene) throw new Error('visualArtifactMissing');
    const source = artifactSchema.parse(found), signature = identity(source), snapshot = copyVisualInput(input);
    if (!snapshot.text.trim()) throw new Error('visualPromptRequired');
    let changed = false;
    off = useGraphStore.subscribe(() => { const current = find(); if (!current || identity(current) !== signature) changed = true; });
    const result = await generateVisualScene(snapshot, { ...options, sourceModel: { label: source.label, scene: source.scene!, ...(source.assembly ? { assembly: source.assembly } : {}) } });
    options.signal.throwIfAborted(); guard.assert();
    const current = find();
    if (changed || !current || identity(current) !== signature || !result.current || resolveVisualContext(snapshot).fingerprint !== result.contextFingerprint) throw new Error('visualContextChanged');
    if (result.assembly && !modelAssemblyMatchesScene(result.assembly, result.scene)) throw new Error('visualAssemblyInvalid');
    if (current.revisions.length >= 100 && current.revisionIndex >= 99) throw new Error('visualRevisionLimit');
    const revisions = current.revisions.slice(0, current.revisionIndex + 1);
    if (!revisions.length) revisions.push({ scene: current.scene, mediaId: null, createdAt: Date.now() });
    revisions[revisions.length - 1] = { ...revisions[revisions.length - 1], scene: current.scene, mediaId: current.mediaId, label: current.label, assembly: current.assembly ?? null, decomposition: current.decomposition ?? null };
    revisions.push({ scene: result.scene, mediaId: null, createdAt: Date.now(), label: result.scene.label, assembly: result.assembly ?? null, decomposition: null, input: snapshot, contextFingerprint: result.contextFingerprint, referencedMediaIds: [...new Set([...result.referencedMediaIds, ...snapshot.attachments.flatMap(a => a.mediaId ? [a.mediaId] : [])])].slice(0, 20) });
    const revised = artifactSchema.parse({ ...current, label: result.scene.label, scene: result.scene, revisions, revisionIndex: revisions.length - 1, assembly: result.assembly, decomposition: undefined });
    // All validation precedes the single mutation. Layout remains whatever the user moved during inference.
    mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => a.id === id ? revised : a) }), guard.scope);
    return revised;
  } finally { off(); guard.dispose(); finish(); }
}
