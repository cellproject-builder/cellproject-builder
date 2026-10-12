import { generateObject } from 'ai';
import { applyStoredDecompositionAssembly, applyDecompositionResearch, portableDecompositionTxt } from './portableMutations';
import { aiModel, assertAIReady, callOpts } from '@/ai/client';
import { useGraphStore } from '@/store';
import { getVisualWorkspace, mutateVisualWorkspace, watchVisualScope } from './domain';
import { decompositionSchema } from './normalize';
import { decompositionResearchSchema } from './decompositionSchema';
import { researchDecomposition, researchDecompositionParts, type DecompositionResearchOptions, type DecompositionResearchResult } from './decompositionResearch';
import { assembleDecompositionGeometry, decompositionGeometrySchema, decompositionGeometryGenerationSchema, decompositionGeometrySystem } from './decompositionGeometry';
import { loadVisualVisionImages, normalizeVisualVisionError, visualVisionPrompt } from './vision';
import { useVisualViewStore } from './rendering/viewStore';
import { decompositionHash as hash, artifactFingerprint, researchFingerprint, decompositionIsCurrent } from './decompositionState';
import type { DecompositionAssembly, ObjectDecomposition, VisualArtifact } from './types';

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
    const dossier = applyDecompositionResearch(id, result);
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
  const child = applyStoredDecompositionAssembly(id, proposal);
  useVisualViewStore.getState().setExplosion(child.id, 0); useVisualViewStore.getState().selectPart(child.id, null);
  return child;
}
export function decompositionTxt(id: string): string { return portableDecompositionTxt(id); }
