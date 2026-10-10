import { useGraphStore } from '@/store';
import { getVisualWorkspace } from './domain';
import type { ObjectDecomposition, VisualArtifact } from './types';

// Read-only validity checks; renderers must not import AI generation services.
export function decompositionHash(value: unknown) {
  const text = JSON.stringify(value); let result = 2166136261;
  for (let i = 0; i < text.length; i++) result = Math.imul(result ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(result >>> 0).toString(16)}`;
}
/** Screen transforms and inspection state do not change the physical object's identity. */
export function artifactFingerprint(artifact: VisualArtifact) {
  const workspace = getVisualWorkspace(useGraphStore.getState().project);
  const proposal = workspace.proposals.find(p => `model-${p.id}` === artifact.id);
  const imageIds = artifact.origin?.imageIds ?? proposal?.input.mentions.filter(m => m.kind === 'image').map(m => m.id) ?? [];
  const images = imageIds.map(id => {
    const image = workspace.artifacts.find(a => a.id === id);
    return image ? [id, image.label, image.mediaId, image.source] : [id, 'removed'];
  });
  return decompositionHash([artifact.id, artifact.kind, artifact.label, artifact.scene, artifact.mediaId, artifact.origin, artifact.source, images]);
}
export function researchFingerprint(dossier: ObjectDecomposition) {
  return decompositionHash([dossier.id, dossier.identity, dossier.sources, dossier.parts, dossier.unknowns]);
}
export function decompositionIsCurrent(artifact: VisualArtifact): boolean {
  const original = artifact.sourceArtifactId ? getVisualWorkspace(useGraphStore.getState().project).artifacts.find(a => a.id === artifact.sourceArtifactId) : artifact;
  return !!original && !original.sourceArtifactId && !!artifact.decomposition
    && artifact.decomposition.artifactFingerprint === artifactFingerprint(original)
    && (!artifact.sourceArtifactId || (!!original.decomposition
      && original.decomposition.id === artifact.decomposition.id
      && original.decomposition.identity === artifact.decomposition.identity
      && researchFingerprint(original.decomposition) === researchFingerprint(artifact.decomposition)));
}
export function decompositionAssemblyCurrent(artifact: VisualArtifact): boolean {
  const dossier = artifact.decomposition;
  return decompositionIsCurrent(artifact) && !!dossier?.assembly
    && dossier.assembly.dossierId === dossier.id && dossier.assembly.dossierFingerprint === researchFingerprint(dossier)
    && (!artifact.sourceArtifactId || decompositionHash(artifact.scene) === decompositionHash(dossier.assembly.scene));
}
