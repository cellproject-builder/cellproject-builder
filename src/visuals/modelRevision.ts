import { registerAIAction } from '@/ai/actions';
import { useGraphStore } from '@/store';
import { copyVisualInput, getVisualWorkspace, resolveVisualContext, watchVisualScope } from './domain';
import { generateVisualScene, type VisualSceneOptions } from './generation';
import { artifactSchema } from './normalize';
import { applyVisualModelRevision } from './portableMutations';
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
    const revised = applyVisualModelRevision(id, { scene: result.scene, assembly: result.assembly, input: snapshot, contextFingerprint: result.contextFingerprint, referencedMediaIds: result.referencedMediaIds });
    return revised;
  } finally { off(); guard.dispose(); finish(); }
}
