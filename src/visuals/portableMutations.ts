import { nanoid } from 'nanoid';
import { useGraphStore } from '@/store';
import { artifactSchema, decompositionSchema } from './normalize';
import { decompositionResearchSchema } from './decompositionSchema';
import { copyVisualInput, getVisualWorkspace, mutateVisualWorkspace } from './domain';
import { modelAssemblyMatchesScene } from './modelAssembly';
import { decompositionHash as hash, artifactFingerprint, researchFingerprint, decompositionIsCurrent, decompositionAssemblyCurrent } from './decompositionState';
import { decompositionContextScene, layoutDecompositionGroups } from './decompositionLayout';
import type { DecompositionAssemblyProposal } from './decomposition';
import type { ObjectDecomposition, SceneV1, VisualArtifact, VisualModelAssembly, VisualPromptInput } from './types';

function artifactById(id: string): VisualArtifact {
  const artifact = getVisualWorkspace(useGraphStore.getState().project).artifacts.find(value => value.id === id);
  if (!artifact) throw new Error('visualArtifactMissing');
  return artifact;
}
/** Shared deterministic application boundary; callers own asynchronous context guards. */
export function applyVisualModelRevision(id: string, result: { scene: SceneV1; assembly?: VisualModelAssembly; input?: VisualPromptInput; contextFingerprint?: string; referencedMediaIds?: string[] }): VisualArtifact {
  const current = artifactById(id);
  if (current.kind !== 'model' || !current.scene) throw new Error('visualArtifactMissing');
  if (result.assembly && !modelAssemblyMatchesScene(result.assembly, result.scene)) throw new Error('visualAssemblyInvalid');
  if (current.revisions.length >= 100 && current.revisionIndex >= 99) throw new Error('visualRevisionLimit');
  const snapshot = result.input ? copyVisualInput(result.input) : undefined;
  const revisions = current.revisions.slice(0, current.revisionIndex + 1);
  if (!revisions.length) revisions.push({ scene: current.scene, mediaId: null, createdAt: Date.now() });
  revisions[revisions.length - 1] = { ...revisions[revisions.length - 1], scene: current.scene, mediaId: current.mediaId, label: current.label, assembly: current.assembly ?? null, decomposition: current.decomposition ?? null };
  revisions.push({ scene: result.scene, mediaId: null, createdAt: Date.now(), label: result.scene.label, assembly: result.assembly ?? null, decomposition: null,
    ...(snapshot ? { input: snapshot } : {}), ...(result.contextFingerprint ? { contextFingerprint: result.contextFingerprint } : {}),
    referencedMediaIds: [...new Set([...(result.referencedMediaIds ?? []), ...(snapshot?.attachments.flatMap(a => a.mediaId ? [a.mediaId] : []) ?? [])])].slice(0, 20) });
  const revised = artifactSchema.parse({ ...current, label: result.scene.label, scene: result.scene, revisions, revisionIndex: revisions.length - 1, assembly: result.assembly, decomposition: undefined });
  mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => a.id === id ? revised : a) }));
  return revised;
}
/** Externally retrieved source quotes cross the same documentary evidence schema. */
export function applyDecompositionResearch(id: string, raw: unknown): ObjectDecomposition {
  const artifact = artifactById(id); if (artifact.sourceArtifactId) throw new Error('decompositionUseOriginal');
  const value = decompositionResearchSchema.parse(raw), workspace = getVisualWorkspace(useGraphStore.getState().project);
  const proposal = workspace.proposals.find(p => `model-${p.id}` === id);
  const imageIds = artifact.origin?.imageIds ?? proposal?.input.mentions.filter(m => m.kind === 'image').map(m => m.id) ?? [];
  const dossier = decompositionSchema.parse({ ...value, version: 1, id: nanoid(), artifactFingerprint: artifactFingerprint(artifact), sourceImageIds: imageIds, researchedAt: Date.now() });
  mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => a.id === id ? { ...a, decomposition: dossier } : a) }));
  return dossier;
}
/** Applies documented geometry using the exact UI source/context and reuse checks. */
export function applyStoredDecompositionAssembly(id: string, proposal: DecompositionAssemblyProposal): VisualArtifact {
  const artifact = artifactById(id), dossier = artifact.decomposition;
  if (artifact.sourceArtifactId) throw new Error('decompositionUseOriginal');
  if (!proposal?.assembly || !proposal.dossier || typeof proposal.baseDossierFingerprint !== 'string') throw new Error('decompositionAssemblyInvalid');
  if (!dossier || !decompositionIsCurrent(artifact) || hash(dossier) !== proposal.baseDossierFingerprint
    || proposal.dossier.id !== dossier.id || proposal.dossier.artifactFingerprint !== dossier.artifactFingerprint
    || proposal.dossier.identity !== dossier.identity || proposal.assembly.dossierId !== dossier.id
    || proposal.assembly.dossierFingerprint !== researchFingerprint(proposal.dossier)) throw new Error('decompositionStale');
  const candidate = decompositionSchema.safeParse({ ...proposal.dossier, assembly: proposal.assembly });
  if (!candidate.success) throw new Error('decompositionAssemblyInvalid');
  if (artifact.scene) decompositionContextScene(candidate.data.assembly!.scene, artifact.scene);
  const originalObjects = new Map(artifact.scene?.objects.map(object => [object.id, object]));
  const proposedObjects = new Map(candidate.data.assembly!.scene.objects.map(object => [object.id, object]));
  const geometryTuple = (object: SceneV1['objects'][number]) => JSON.stringify([object.type, object.position, object.rotation, object.scale, object.color, object.geometry ?? null]);
  for (const reusedId of candidate.data.assembly!.reusedObjectIds ?? []) {
    const originalObject = originalObjects.get(reusedId), proposedObject = proposedObjects.get(reusedId);
    if (!originalObject || !proposedObject || geometryTuple(originalObject) !== geometryTuple(proposedObject)) throw new Error('decompositionAssemblyInvalid');
  }
  const childBaseId = `decomposition-${nanoid()}`;
  let childId = childBaseId;
  mutateVisualWorkspace(w => {
    if (w.artifacts.length >= 512) throw new Error('visualArtifactLimit');
    let suffix = 1;
    while (w.artifacts.some(a => a.id === childId)) childId = `${childBaseId}-${suffix++}`;
    const appliedDossier = decompositionSchema.parse({ ...candidate.data, assemblyArtifactId: childId });
    const gap = 64, width = artifact.width, height = artifact.height;
    let x = artifact.x + artifact.width + gap, y = artifact.y;
    const overlaps = (a: VisualArtifact) => x < a.x + a.width + gap && x + width + gap > a.x && y < a.y + a.height + gap && y + height + gap > a.y;
    for (let attempt = 0; attempt <= w.artifacts.length; attempt++) {
      const obstacles = w.artifacts.filter(overlaps); if (!obstacles.length) break;
      x = Math.max(...obstacles.map(a => a.x + a.width)) + gap;
      if (x + width > 100_000) { x = artifact.x; y = Math.max(...w.artifacts.map(a => a.y + a.height)) + gap; }
    }
    if (x > 100_000 || y > 100_000 || w.artifacts.some(overlaps)) throw new Error('visualGeometryInvalid');
    const child: VisualArtifact = { id: childId, label: candidate.data.assembly!.scene.label, kind: 'model', sourceArtifactId: id,
      linkedNodeId: artifact.linkedNodeId, origin: artifact.origin, x, y, width, height, scene: candidate.data.assembly!.scene, mediaId: null, source: null, decomposition: appliedDossier,
      revisions: [{ scene: candidate.data.assembly!.scene, mediaId: null, createdAt: Date.now() }], revisionIndex: 0 };
    return { ...w, artifacts: [...w.artifacts.map(a => a.id === id ? { ...a, decomposition: appliedDossier } : a), child] };
  });
  return artifactById(childId);
}

export function portableDecompositionTxt(id: string): string {
  const artifact = artifactById(id), dossier = artifact.decomposition;
  if (!dossier) throw new Error('decompositionNoEvidence');
  const workspace = getVisualWorkspace(useGraphStore.getState().project);
  const original = artifact.sourceArtifactId ? workspace.artifacts.find(a => a.id === artifact.sourceArtifactId) : artifact;
  const children = workspace.artifacts.filter(a => a.sourceArtifactId === original?.id && a.decomposition?.id === dossier.id);
  const lines = ['DECOMPOSIÇÃO DOCUMENTADA — DYNAMIC DIARY', `Objeto: ${dossier.identity}`, `Artefato: ${id}`, `Plano: ${useGraphStore.getState().project!.id}`,
    `Artefato original: ${artifact.sourceArtifactId ?? artifact.id}`, `Artefato decomposto: ${artifact.sourceArtifactId ? artifact.id : dossier.assemblyArtifactId ?? children.at(-1)?.id ?? 'não aplicado'}`,
    `Dossiê: ${dossier.id}`, `Pesquisa: ${new Date(dossier.researchedAt).toISOString()}`, `Estado: ${decompositionIsCurrent(artifact) ? 'atual' : 'desatualizado'}`,
    `Imagens de origem: ${dossier.sourceImageIds.join(', ') || 'não registradas'}`, '',
    'A geometria e a posição das peças são ilustrativas e didáticas. Documentação não comprova medidas físicas, compatibilidade, conexões elétricas ou procedimento de desmontagem.',
    'A lista pode ser parcial. Somente peças com trechos das fontes aparecem abaixo.',
    'Trechos e códigos documentados não validam, por si só, as classificações e funções sugeridas pela IA.', ''];
  for (const part of dossier.parts) {
    lines.push(`[${part.id}] ${part.partNumber ?? 'Componente sem código documentado'}`, `Nome sugerido pela IA: ${part.name}`,
      `Código: ${part.partNumber ?? 'não documentado'} | Quantidade: ${part.quantity ?? 'não documentada'}`, `Função sugerida pela IA: ${part.role}`);
    for (const spec of part.specifications) lines.push(`  Especificação: ${spec}`);
    for (const evidence of part.evidence) lines.push(`  Evidência [${evidence.sourceId}]: "${evidence.quote}"`);
    for (const unknown of part.unknowns) lines.push(`  A verificar: ${unknown}`);
    lines.push('');
  }
  lines.push('FONTES CONSULTADAS');
  for (const source of dossier.sources) lines.push(`[${source.id}] ${source.title}`, source.url, `Lida em: ${new Date(source.retrievedAt).toISOString()}`);
  lines.push('', 'LACUNAS E CONFLITOS', ...dossier.unknowns.map(unknown => `- ${unknown}`));
  if (original?.scene) lines.push('', 'MODELO ORIGINAL — GEOMETRIA DECLARATIVA ILUSTRATIVA', JSON.stringify(original.scene, null, 2));
  else if (artifact.sourceArtifactId) lines.push('', 'MODELO ORIGINAL AUSENTE — não é possível exportar sua geometria.');
  if (dossier.assembly) {
    const current = decompositionAssemblyCurrent(artifact);
    const inspection = current && original?.scene ? decompositionContextScene(dossier.assembly.scene, original.scene) : null;
    const contextIds = inspection?.objects.filter(object => !dossier.assembly!.scene.objects.some(part => part.id === object.id)).map(object => object.id) ?? [];
    lines.push('', 'CONTEXTO VISUAL NÃO CLASSIFICADO',
      'Estas formas do modelo original continuam visíveis como contexto. Não são novas peças comprovadas pela pesquisa.',
      contextIds.join(', ') || (current ? 'Nenhuma forma adicional de contexto.' : 'Contexto atual indisponível para uma montagem desatualizada.'));
    const exported = inspection ? { ...dossier.assembly, groups: layoutDecompositionGroups(inspection, dossier.assembly.groups) } : dossier.assembly;
    lines.push('', `GEOMETRIA DECLARATIVA (${current ? 'atual' : 'desatualizada'})`,
      'Posições abaixo correspondem ao conjunto montado; explodeOffset representa o afastamento didático calculado na vista atual. O contexto usa a geometria original acima.', JSON.stringify(exported, null, 2));
  }
  return lines.join('\n');
}
