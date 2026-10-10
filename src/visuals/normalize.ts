import { z } from 'zod';
import type { VisualArtifact, VisualPromptInput, VisualWorkspace } from './types';
import { createDecompositionSchema } from './decompositionSchema';
import { modelAssemblySchema, modelAssemblyMatchesScene } from './modelAssembly';
import { customGeometrySchema, generationGeometrySchema, withinGeometryBudget } from './geometrySchema';

const coordinate = z.number().finite().min(-10_000).max(10_000);
const triple = z.tuple([coordinate, coordinate, coordinate]);
const scale = z.number().finite().positive().max(10_000);
export const sceneSchema = z.object({ version: z.literal(1), label: z.string().trim().min(1).max(160), objects: z.array(z.object({
  id: z.string().min(1).max(100), type: z.enum(['box', 'sphere', 'cylinder', 'cone', 'torus', 'custom']),
  position: triple, rotation: triple, scale: z.tuple([scale, scale, scale]), color: z.string().regex(/^#[\da-fA-F]{6}$/),
  geometry: customGeometrySchema.nullable().optional(),
}).strict().refine(object => object.type === 'custom' ? !!object.geometry : !object.geometry, 'visualGeometryInvalid')).min(1).max(512).refine(objects => new Set(objects.map(o => o.id)).size === objects.length, 'duplicateObjectId').refine(withinGeometryBudget, 'visualGeometryBudgetExceeded') }).strict();

// Provider structured-output subset: enforce numerical bounds with sceneSchema after inference.
const generationTriple = z.array(z.number());
export const generationSceneSchema = z.object({ version: z.literal(1), label: z.string(), objects: z.array(z.object({
  id: z.string(), type: z.enum(['box', 'sphere', 'cylinder', 'cone', 'torus', 'custom']), position: generationTriple, rotation: generationTriple, scale: generationTriple, color: z.string(), geometry: generationGeometrySchema.nullable(),
}).strict()) }).strict();

const mediaIdSchema = z.string().regex(/^[\w-]{1,100}$/);
const promptSchema = z.object({ text: z.string().max(12_000), analyzeImages: z.boolean().optional(), generationMode: z.enum(['standard', 'advanced']).optional(), mentions: z.array(z.object({ id: z.string().max(100), kind: z.enum(['note', 'node', 'image']), label: z.string().max(1000), detail: z.string().max(1000), fingerprint: z.string().max(200) }).strict()).max(20), attachments: z.array(z.object({ id: z.string().max(100), name: z.string().max(1000), mime: z.enum(['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp']), byteLength: z.number().int().nonnegative().max(10 * 1024 * 1024), mediaId: mediaIdSchema.nullable(), text: z.string().max(24_000).nullable() }).strict()).max(8) }).strict();
const safeUrl = z.string().max(4000).refine(value => { try { return ['https:', 'http:'].includes(new URL(value, 'https://local.invalid').protocol); } catch { return false; } }, 'visualUrlInvalid');
const probability = z.number().finite().min(0).max(1);
const distribution = z.object({ '0': probability, '1': probability, '2': probability, '3': probability }).strict().refine(p => Math.abs(p['0'] + p['1'] + p['2'] + p['3'] - 1) <= .001, 'visualAssessmentDistributionInvalid');
const legendText = z.string().min(1).max(1000);
const legacyAssessment = z.object({ score: z.number().finite().min(0).max(3), confidence: probability }).strict();
export const visualAssessmentSchema = z.union([legacyAssessment, legacyAssessment.extend({
  kind: z.literal('textual'), model: z.string().min(1).max(200), rubricVersion: z.string().min(1).max(200),
  probabilities: distribution, legend: z.object({ '0': legendText, '1': legendText, '2': legendText, '3': legendText }).strict(), assessedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()]);
const referenceSchema = z.object({ id: z.string().max(200), title: z.string().max(1000), description: z.string().max(8000), imageUrl: safeUrl, sourcePageUrl: safeUrl, credit: z.string().max(2000).nullable(), license: z.string().max(2000).nullable(), width: z.number().finite().positive().nullable(), height: z.number().finite().positive().nullable(), assessment: visualAssessmentSchema.nullable().optional(), sessionId: z.string().max(200).optional() }).strict();
const layoutCoordinate = z.number().finite().min(-100_000).max(100_000);
export const decompositionSchema = createDecompositionSchema(sceneSchema);
const revisionSchema = z.object({ scene: sceneSchema.nullable(), mediaId: mediaIdSchema.nullable(), createdAt: z.number().finite().nonnegative(), label: z.string().max(1000).optional(), assembly: modelAssemblySchema.nullable().optional(), decomposition: decompositionSchema.nullable().optional(), input: promptSchema.optional(), contextFingerprint: z.string().max(200).optional(), referencedMediaIds: z.array(mediaIdSchema).max(20).optional() }).strict().refine(r => !r.assembly || !!r.scene && modelAssemblyMatchesScene(r.assembly, r.scene), 'visualAssemblyInvalid');
const originSchema = z.object({ proposalId: z.string().min(1).max(100), imageIds: z.array(z.string().min(1).max(200)).max(20), imageMediaIds: z.array(mediaIdSchema).max(20), instruction: z.string().max(12000) }).strict();
export const artifactSchema = z.object({ id: z.string().min(1).max(200), label: z.string().max(1000), kind: z.enum(['image', 'model']), linkedNodeId: z.string().min(1).max(200).nullable().optional(), sourceArtifactId: z.string().min(1).max(200).optional(), x: layoutCoordinate, y: layoutCoordinate, width: z.number().finite().positive().max(100_000), height: z.number().finite().positive().max(100_000), mediaId: mediaIdSchema.nullable(), scene: sceneSchema.nullable(), source: referenceSchema.nullable(), revisions: z.array(revisionSchema).min(1).max(100), revisionIndex: z.number().int().nonnegative(), origin: originSchema.optional(), decomposition: decompositionSchema.optional(), assembly: modelAssemblySchema.optional() }).strict().refine(a => a.revisionIndex < a.revisions.length && (a.kind === 'image' ? a.mediaId !== null && a.scene === null && !a.assembly : a.scene !== null && a.mediaId === null), 'visualArtifactInvalid');
const workspaceSchema = z.object({ version: z.literal(1), mode: z.enum(['approval', 'automatic']), artifacts: z.array(artifactSchema).max(512), proposals: z.array(z.object({ id: z.string().min(1).max(100), projectId: z.string().min(1).max(100), label: z.string().max(1000), scene: sceneSchema, input: promptSchema, contextFingerprint: z.string().max(200), contextSnapshot: z.string().max(48_000).optional(), referencedMediaIds: z.array(mediaIdSchema).max(20).optional(), createdAt: z.number().finite().nonnegative(), status: z.enum(['ready', 'applied', 'stale', 'rejected']), assembly: modelAssemblySchema.optional() }).strict().refine(p => !p.assembly || modelAssemblyMatchesScene(p.assembly, p.scene), 'visualAssemblyInvalid')).max(40), drafts: z.object({ search: promptSchema, model: promptSchema }).strict() }).strict().refine(w => new Set(w.artifacts.map(a => a.id)).size === w.artifacts.length && new Set(w.proposals.map(p => p.id)).size === w.proposals.length, 'visualDuplicateId').refine(w => !hasArtifactSourceCycle(w.artifacts), 'visualSourceCycle');

const emptyInput = (): VisualPromptInput => ({ text: '', mentions: [], attachments: [] });
export const EMPTY_VISUAL_WORKSPACE: VisualWorkspace = { version: 1, mode: 'approval', artifacts: [], proposals: [], drafts: { search: emptyInput(), model: emptyInput() } };
// Missing workspace has a stable identity for React selectors.

/** Missing sources survive as stale references; only actual reference cycles are invalid. */
function hasArtifactSourceCycle(artifacts: Pick<VisualArtifact, 'id' | 'sourceArtifactId'>[]): boolean {
  const sources = new Map(artifacts.map(artifact => [artifact.id, artifact.sourceArtifactId]));
  for (const artifact of artifacts) {
    const seen = new Set<string>();
    let next: string | undefined = artifact.id;
    while (next !== undefined && sources.has(next)) {
      if (seen.has(next)) return true;
      seen.add(next); next = sources.get(next);
    }
  }
  return false;
}

/** A durable id makes import/recovery repeatable without duplicating a derived view. */
export function decompositionArtifactId(sourceArtifactId: string, dossierId: string): string {
  let hash = 2166136261;
  for (const character of `${sourceArtifactId}\0${dossierId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `decomposition-${(hash >>> 0).toString(36)}`;
}

export function decompositionArtifactPosition(source: Pick<VisualArtifact, 'x' | 'y' | 'width' | 'height'>, artifacts: VisualArtifact[]) {
  const width = Math.max(280, source.width), height = Math.max(220, source.height), gap = 64;
  const startX = Math.min(100_000 - width, source.x + source.width + gap);
  let x = startX, y = source.y;
  for (let attempt = 0; attempt <= artifacts.length; attempt++) {
    const collision = artifacts.find(artifact => x < artifact.x + artifact.width + gap && x + width + gap > artifact.x
      && y < artifact.y + artifact.height + gap && y + height + gap > artifact.y);
    if (!collision) break;
    x = collision.x + collision.width + gap;
    if (x > 100_000 - width) { x = startX; y = Math.min(100_000, collision.y + collision.height + gap); }
  }
  return { x, y, width, height };
}

/** Older releases painted the assembly over the original. Retain both views on recovery. */
function migrateSeparateDecompositions(workspace: VisualWorkspace): VisualWorkspace {
  const artifacts = [...workspace.artifacts];
  let changed = false;
  for (const source of workspace.artifacts) {
    const assembly = source.decomposition?.assembly;
    if (!assembly || source.sourceArtifactId || source.decomposition?.assemblyArtifactId) continue;
    const existingChild = artifacts.find(artifact => artifact.sourceArtifactId === source.id);
    if (existingChild) {
      artifacts[artifacts.findIndex(artifact => artifact.id === source.id)] = { ...source, decomposition: { ...source.decomposition!, assemblyArtifactId: existingChild.id } };
      changed = true;
      continue;
    }
    if (artifacts.length >= 512) continue;
    const baseId = decompositionArtifactId(source.id, source.decomposition!.id);
    let id = baseId, suffix = 1;
    while (artifacts.some(artifact => artifact.id === id)) id = `${baseId}-${suffix++}`;
    const decomposition = { ...source.decomposition!, assemblyArtifactId: id };
    artifacts[artifacts.findIndex(artifact => artifact.id === source.id)] = { ...source, decomposition };
    changed = true;
    artifacts.push({
      id, label: assembly.scene.label, kind: 'model', sourceArtifactId: source.id,
      ...(source.linkedNodeId !== undefined ? { linkedNodeId: source.linkedNodeId } : {}), ...decompositionArtifactPosition(source, artifacts),
      scene: assembly.scene, mediaId: null, source: null,
      revisions: [{ scene: assembly.scene, mediaId: null, createdAt: assembly.createdAt }], revisionIndex: 0,
      ...(source.origin ? { origin: source.origin } : {}), decomposition,
    });
  }
  return changed ? { ...workspace, artifacts } : workspace;
}

/** Import/hydration boundary: malformed or executable payloads fail closed. */
export function normalizeVisualWorkspace(raw: unknown): VisualWorkspace {
  return raw == null ? EMPTY_VISUAL_WORKSPACE : migrateSeparateDecompositions(workspaceSchema.parse(raw));
}

/** A missing concept releases the visual; its media and canvas position survive. */
export function clearMissingVisualNodeLinks(workspace: VisualWorkspace, nodes: Record<string, unknown>): VisualWorkspace {
  if (!workspace.artifacts.some(a => a.linkedNodeId && !Object.hasOwn(nodes, a.linkedNodeId))) return workspace;
  return { ...workspace, artifacts: workspace.artifacts.map(a =>
    a.linkedNodeId && !Object.hasOwn(nodes, a.linkedNodeId) ? { ...a, linkedNodeId: null } : a,
  ) };
}
