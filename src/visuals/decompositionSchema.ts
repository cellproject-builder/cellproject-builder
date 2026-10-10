import { z } from 'zod';
import type { SceneV1 } from './types';

export const normalizeExcerpt = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const id = z.string().min(1).max(200);
const timestamp = z.number().finite().nonnegative();
const sourceSchema = z.object({ id, url: z.string().max(2000).refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}), title: z.string().max(1000), text: z.string().min(1).max(12000), retrievedAt: timestamp }).strict();
const partSchema = z.object({ id, name: z.string().min(1).max(300), partNumber: z.string().min(1).max(200).nullable(),
  quantity: z.number().int().positive().max(10000).nullable(), role: z.string().max(800), specifications: z.array(z.string().min(1).max(800)).max(12),
  evidence: z.array(z.object({ sourceId: id, quote: z.string().min(1).max(800) }).strict()).min(1).max(8), unknowns: z.array(z.string().max(800)).max(12),
}).strict();
export const decompositionResearchSchema = z.object({ identity: z.string().trim().min(1).max(500), sources: z.array(sourceSchema).min(1).max(12),
  parts: z.array(partSchema).min(1).max(32), unknowns: z.array(z.string().max(800)).max(32),
}).strict().refine(data => {
  const sources = new Map(data.sources.map(source => [source.id, normalizeExcerpt(source.text)]));
  return sources.size === data.sources.length && new Set(data.parts.map(part => part.id)).size === data.parts.length
    && data.parts.every(part => {
      const quotes = part.evidence.map(e => normalizeExcerpt(e.quote));
      return part.evidence.every(e => !!normalizeExcerpt(e.quote) && sources.get(e.sourceId)?.includes(normalizeExcerpt(e.quote)))
        && (!part.partNumber || quotes.some(quote => quote.toLowerCase().includes(normalizeExcerpt(part.partNumber!).toLowerCase())))
        && part.specifications.every(spec => quotes.some(quote => quote.includes(normalizeExcerpt(spec))))
        && (part.quantity === null || new RegExp(`(?:\\b(?:quantity|qty\\.?|quantidade|qtd\\.?|count)\\s*[:=]?\\s*${part.quantity}\\b|\\b${part.quantity}\\s*(?:pcs|pieces|units|unidades|peças)\\b)`, 'iu').test(quotes.join(' ')));
    });
}, 'decompositionNoEvidence');

export function createDecompositionSchema(scene: z.ZodType<SceneV1>) {
  const offset = z.number().finite().min(-10000).max(10000);
  const group = z.object({ partId: id, objectIds: z.array(id).min(1).max(512), explodeOffset: z.tuple([offset, offset, offset]) }).strict();
  const assembly = z.object({ scene, groups: z.array(group).min(1).max(8), createdAt: timestamp, dossierId: id,
    dossierFingerprint: z.string().max(200).optional(), selectedPartIds: z.array(id).min(1).max(8),
    geometryBasis: z.enum(['source', 'generated', 'mixed']).optional(), reusedObjectIds: z.array(id).max(512).optional(),
  }).strict().refine(a => {
    const selected = new Set(a.selectedPartIds), assigned = a.groups.flatMap(g => g.objectIds);
    const reused = a.reusedObjectIds ?? [];
    const provenanceValid = a.geometryBasis === undefined && a.reusedObjectIds === undefined
      || a.geometryBasis !== undefined && a.reusedObjectIds !== undefined
        && new Set(reused).size === reused.length && reused.every(objectId => a.scene.objects.some(object => object.id === objectId))
        && (a.geometryBasis === 'source' ? reused.length === a.scene.objects.length
          : a.geometryBasis === 'generated' ? reused.length === 0 : reused.length > 0 && reused.length < a.scene.objects.length);
    return selected.size === a.selectedPartIds.length && a.groups.length === selected.size
      && new Set(a.groups.map(g => g.partId)).size === a.groups.length && a.groups.every(g => selected.has(g.partId))
      && assigned.length === a.scene.objects.length && new Set(assigned).size === assigned.length
      && a.scene.objects.every(object => assigned.includes(object.id)) && provenanceValid;
  }, 'decompositionAssemblyInvalid');
  return z.object({ ...decompositionResearchSchema.shape, version: z.literal(1), id, artifactFingerprint: z.string().min(1).max(200),
    sourceImageIds: z.array(id).max(20), researchedAt: timestamp, assembly: assembly.optional(), assemblyArtifactId: id.optional(),
  }).strict().refine(data => decompositionResearchSchema.safeParse({ identity: data.identity, sources: data.sources, parts: data.parts, unknowns: data.unknowns }).success
    && (!data.assembly || (data.assembly.dossierId === data.id && data.assembly.selectedPartIds.every(partId => data.parts.some(part => part.id === partId)))), 'decompositionInvalid');
}
