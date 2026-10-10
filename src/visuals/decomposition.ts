import { generateObject } from 'ai';
import { nanoid } from 'nanoid';
import { aiModel, assertAIReady, callOpts } from '@/ai/client';
import { useGraphStore } from '@/store';
import { getVisualWorkspace, mutateVisualWorkspace, watchVisualScope } from './domain';
import { decompositionSchema } from './normalize';
import { decompositionResearchSchema } from './decompositionSchema';
import { researchDecomposition, researchDecompositionParts, type DecompositionResearchOptions, type DecompositionResearchResult } from './decompositionResearch';
import { assembleDecompositionGeometry, decompositionGeometrySchema, decompositionGeometryGenerationSchema, decompositionGeometrySystem } from './decompositionGeometry';
import { decompositionContextScene, layoutDecompositionGroups } from './decompositionLayout';
import { loadVisualVisionImages, normalizeVisualVisionError, visualVisionPrompt } from './vision';
import { useVisualViewStore } from './rendering/viewStore';
import { decompositionHash as hash, artifactFingerprint, researchFingerprint, decompositionIsCurrent, decompositionAssemblyCurrent } from './decompositionState';
import type { DecompositionAssembly, ObjectDecomposition, SceneV1, VisualArtifact } from './types';

export { decompositionIsCurrent, decompositionAssemblyCurrent } from './decompositionState';

/** New documentation and geometry stay together until the human approves them. */
export interface DecompositionAssemblyProposal {
  assembly: DecompositionAssembly;
  dossier: ObjectDecomposition;
  /** Includes any applied assembly, so another approval or restore invalidates this proposal. */
  baseDossierFingerprint: string;
}

function artifactById(id: string) {
  const artifact = getVisualWorkspace(useGraphStore.getState().project).artifacts.find(a => a.id === id);
  if (!artifact) throw new Error('decompositionArtifactMissing');
  return artifact;
}
function validatedResearch(result: DecompositionResearchResult) {
  const parsed = decompositionResearchSchema.safeParse(result);
  if (!parsed.success) throw new Error('decompositionNoEvidence');
  return parsed.data;
}
function writeDossier(id: string, dossier: ObjectDecomposition, scope: ReturnType<typeof watchVisualScope>['scope']) {
  const parsed = decompositionSchema.parse(dossier);
  mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => a.id === id ? { ...a, decomposition: parsed } : a) }), scope);
}
function watchArtifact(id: string, options: DecompositionResearchOptions) {
  const guard = watchVisualScope();
  const base = artifactFingerprint(artifactById(id)); let changed = false;
  const off = useGraphStore.subscribe(() => { try { if (artifactFingerprint(artifactById(id)) !== base) changed = true; } catch { changed = true; } });
  const assert = () => { options.signal.throwIfAborted(); guard.assert(); if (changed || artifactFingerprint(artifactById(id)) !== base) throw new Error('decompositionStale'); };
  return { scope: guard.scope, base, assert, options: { ...options, beforeRequest: async () => { assert(); await options.beforeRequest?.(); assert(); } }, dispose: () => { off(); guard.dispose(); } };
}

export async function researchArtifactDecomposition(id: string, identity: string, options: DecompositionResearchOptions): Promise<ObjectDecomposition> {
  if (typeof identity !== 'string' || !identity.trim() || identity.length > 500) throw new Error('decompositionIdentityRequired');
  options.signal.throwIfAborted();
  const artifact = artifactById(id);
  if (artifact.sourceArtifactId) throw new Error('decompositionUseOriginal');
  const legacyProposal = getVisualWorkspace(useGraphStore.getState().project).proposals.find(p => `model-${p.id}` === id);
  if (!artifact.origin && legacyProposal) {
    const origin = { proposalId: legacyProposal.id, instruction: legacyProposal.input.text,
      imageIds: [...new Set(legacyProposal.input.mentions.filter(m => m.kind === 'image').map(m => m.id))].slice(0, 20),
      imageMediaIds: [...new Set([...(legacyProposal.referencedMediaIds ?? []), ...legacyProposal.input.attachments.filter(a => a.mime.startsWith('image/') && a.mediaId).map(a => a.mediaId!)])].slice(0, 20) };
    mutateVisualWorkspace(w => ({ ...w, artifacts: w.artifacts.map(a => a.id === id ? { ...a, origin } : a) }));
  }
  const guard = watchArtifact(id, options);
  try {
    guard.assert(); assertAIReady();
    const workspace = getVisualWorkspace(useGraphStore.getState().project);
    const proposal = workspace.proposals.find(p => `model-${p.id}` === id);
    const imageIds = artifact.origin?.imageIds ?? proposal?.input.mentions.filter(m => m.kind === 'image').map(m => m.id) ?? [];
    const images = workspace.artifacts.filter(a => imageIds.includes(a.id)).map(a => ({ label: a.label, source: a.source }));
    const context = JSON.stringify({ label: artifact.label, originalInstruction: artifact.origin?.instruction ?? proposal?.input.text, source: artifact.source, images }).slice(0, 24000);
    const result = validatedResearch(await researchDecomposition(identity.trim(), context, guard.options));
    guard.assert();
    const dossier: ObjectDecomposition = { version: 1, id: nanoid(), artifactFingerprint: guard.base,
      identity: result.identity, sourceImageIds: imageIds, sources: result.sources, parts: result.parts, unknowns: result.unknowns, researchedAt: Date.now() };
    writeDossier(id, dossier, guard.scope);
    useVisualViewStore.getState().setExplosion(id, 0); useVisualViewStore.getState().selectPart(id, null);
    return dossier;
  } finally { guard.dispose(); }
}

/** Keep original identity and membership evidence; later research can revise AI interpretations. */
function enrichDossier(dossier: ObjectDecomposition, result: DecompositionResearchResult, selected: string[]): ObjectDecomposition {
  const researched = validatedResearch(result);
  if (researched.parts.some(p => !selected.includes(p.id))) throw new Error('decompositionAssemblyInvalid');
  const sources = [...dossier.sources], remap = new Map<string, string>();
  for (const source of researched.sources) {
    const same = sources.find(s => s.url === source.url && s.text === source.text);
    let target = same;
    if (!target) {
      const sourceId = sources.some(s => s.id === source.id) ? `${source.id.slice(0, 170)}-${hash(source.text).replace(':', '-')}` : source.id;
      target = { ...source, id: sourceId }; sources.push(target);
    }
    remap.set(source.id, target.id);
  }
  if (sources.length > 12) throw new Error('decompositionResearchInvalid');
  const parts = dossier.parts.map(part => {
    const update = researched.parts.find(p => p.id === part.id);
    if (!update) return selected.includes(part.id) ? { ...part, unknowns: [...new Set([...part.unknowns, 'A pesquisa individual não acrescentou especificações confirmadas.'])].slice(0, 12) } : part;
    if (part.partNumber && update.partNumber?.normalize('NFKC').toLowerCase() !== part.partNumber.normalize('NFKC').toLowerCase()) throw new Error('decompositionAssemblyInvalid');
    const evidence = [...part.evidence, ...update.evidence.map(e => ({ ...e, sourceId: remap.get(e.sourceId)! }))];
    return { ...part, name: update.name, role: update.role,
      specifications: [...new Set([...part.specifications, ...update.specifications])].slice(0, 12),
      evidence: evidence.filter((e, index) => evidence.findIndex(other => other.sourceId === e.sourceId && other.quote === e.quote) === index).slice(0, 8),
      unknowns: [...new Set([...part.unknowns, ...update.unknowns])].slice(0, 12) };
  });
  return { ...dossier, sources, parts, unknowns: [...new Set([...dossier.unknowns,
    ...researched.unknowns.map(unknown => `Pesquisa individual: ${unknown}`)])].slice(0, 32), assembly: undefined };
}
export async function generateDecompositionAssembly(id: string, partIds: string[], options: DecompositionResearchOptions): Promise<DecompositionAssemblyProposal> {
  const artifact = artifactById(id), initial = artifact.decomposition;
  if (artifact.sourceArtifactId) throw new Error('decompositionUseOriginal');
  if (!initial || !decompositionIsCurrent(artifact)) throw new Error('decompositionStale');
  if (artifact.kind !== 'model' || !Array.isArray(partIds) || !partIds.length || partIds.length > 8 || new Set(partIds).size !== partIds.length || partIds.some(partId => !initial.parts.some(p => p.id === partId))) throw new Error('decompositionSelectionInvalid');
  const selected = [...partIds], guard = watchArtifact(id, options);
  const baseDossierFingerprint = hash(initial); let dossierChanged = false;
  const off = useGraphStore.subscribe(() => { try { const current = artifactById(id).decomposition; if (!current || hash(current) !== baseDossierFingerprint) dossierChanged = true; } catch { dossierChanged = true; } });
  const assert = () => { guard.assert(); if (dossierChanged || hash(artifactById(id).decomposition) !== baseDossierFingerprint) throw new Error('decompositionStale'); };
  const researchOptions = { ...guard.options, beforeRequest: async () => { assert(); await options.beforeRequest?.(); assert(); } };
  try {
    assert(); assertAIReady();
    const result = await researchDecompositionParts(initial.identity, initial.parts.filter(p => selected.includes(p.id)), researchOptions, initial.sources);
    assert();
    const dossier = enrichDossier(initial, result, selected);
    assert(); options.onProgress?.('Preservando os detalhes do original e separando as peças…');
    const workspace = getVisualWorkspace(useGraphStore.getState().project);
    const imageIds = [...new Set([...(artifact.origin?.imageIds ?? []), ...initial.sourceImageIds])];
    const mentions = workspace.artifacts.filter(a => a.kind === 'image' && imageIds.includes(a.id))
      .map(a => ({ id: a.id, kind: 'image' as const, label: a.label, detail: '', fingerprint: '' }));
    const attachments = (artifact.origin?.imageMediaIds ?? []).map(mediaId => ({ id: mediaId, name: artifact.label,
      mime: 'image/png', byteLength: 0, mediaId, text: null }));
    const useImages = !!(mentions.length || attachments.length);
    const images = await loadVisualVisionImages({ text: '', mentions, attachments, analyzeImages: useImages }, workspace,
      { signal: options.signal, assertCurrent: assert });
    await researchOptions.beforeRequest();
    const response = await generateObject({ model: aiModel, schema: decompositionGeometryGenerationSchema,
      system: decompositionGeometrySystem(dossier.identity, useImages),
      ...visualVisionPrompt(JSON.stringify({ identity: dossier.identity, parts: dossier.parts.filter(p => selected.includes(p.id)),
        sources: dossier.sources.map(s => ({ id: s.id, title: s.title, url: s.url })), originalScene: artifact.scene }), images),
      abortSignal: options.signal, maxRetries: 0, ...callOpts('plans', .2),
    });
    assert();
    if (response.finishReason === 'length') throw new Error('decompositionAssemblyInvalid');
    const raw = decompositionGeometrySchema.safeParse(response.object);
    if (!raw.success) throw new Error('decompositionAssemblyInvalid');
    try {
      const assembly = assembleDecompositionGeometry(raw.data, artifact.scene!, dossier, selected, researchFingerprint(dossier));
      if (!decompositionSchema.safeParse({ ...dossier, assembly }).success) throw new Error('decompositionAssemblyInvalid');
      return { assembly, dossier, baseDossierFingerprint };
    }
    catch { throw new Error('decompositionAssemblyInvalid'); }
  } catch (reason) { throw normalizeVisualVisionError(reason);
  } finally { off(); guard.dispose(); }
}

export function applyDecompositionAssembly(id: string, proposal: DecompositionAssemblyProposal): VisualArtifact {
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
    // Check every current rectangle, including earlier approved decompositions.
    let x = artifact.x + artifact.width + gap, y = artifact.y;
    const overlaps = (a: VisualArtifact) => x < a.x + a.width + gap && x + width + gap > a.x
      && y < a.y + a.height + gap && y + height + gap > a.y;
    for (let attempt = 0; attempt <= w.artifacts.length; attempt++) {
      const obstacles = w.artifacts.filter(overlaps);
      if (!obstacles.length) break;
      x = Math.max(...obstacles.map(a => a.x + a.width)) + gap;
      if (x + width > 100_000) { x = artifact.x; y = Math.max(...w.artifacts.map(a => a.y + a.height)) + gap; }
    }
    if (x > 100_000 || y > 100_000 || w.artifacts.some(overlaps)) throw new Error('visualGeometryInvalid');
    const child: VisualArtifact = { id: childId, label: candidate.data.assembly!.scene.label, kind: 'model', sourceArtifactId: id,
      linkedNodeId: artifact.linkedNodeId, origin: artifact.origin, x, y, width, height,
      scene: candidate.data.assembly!.scene, mediaId: null, source: null, decomposition: appliedDossier,
      revisions: [{ scene: candidate.data.assembly!.scene, mediaId: null, createdAt: Date.now() }], revisionIndex: 0 };
    return { ...w, artifacts: [...w.artifacts.map(a => a.id === id ? { ...a, decomposition: appliedDossier } : a), child] };
  });
  useVisualViewStore.getState().setExplosion(childId, 0); useVisualViewStore.getState().selectPart(childId, null);
  return artifactById(childId);
}

export function decompositionTxt(id: string): string {
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
