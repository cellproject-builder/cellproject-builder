import { z } from 'zod';
import { nanoid } from 'nanoid';

const identity = z.string().min(1).max(200).regex(/^[\w-]+$/);
const coordinate = z.number().finite().min(-100_000).max(100_000);
export function safeResourceUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('attachmentLinkInvalid');
  return url.href;
}
const url = z.string().max(4000).refine(value => { try { safeResourceUrl(value); return true; } catch { return false; } });
export const canvasResourceSchema = z.object({
  id: identity, name: z.string().trim().min(1).max(240), kind: z.enum(['pdf', 'image', 'text', 'link']),
  mediaId: identity.nullable(), mime: z.enum(['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp']).nullable(),
  size: z.number().int().min(0).max(10 * 1024 * 1024), text: z.string().max(24_000).nullable(), url: url.nullable(),
  addedAt: z.number().finite().nonnegative(), pages: z.number().int().min(1).max(100).optional(),
}).strict().refine(resource => resource.kind === 'link'
  ? resource.url !== null && resource.mediaId === null && resource.mime === null
  : resource.url === null && (resource.kind === 'pdf' ? resource.mime === 'application/pdf'
    : resource.kind === 'image' ? !!resource.mediaId && !!resource.mime?.startsWith('image/')
      : resource.mime === 'text/plain' || resource.mime === 'text/markdown'), 'attachmentResourceInvalid');
export const canvasAttachmentCardSchema = z.object({
  id: identity, resourceIds: z.array(identity).min(1).max(24), x: coordinate, y: coordinate,
  width: z.number().finite().min(140).max(1600), height: z.number().finite().min(120).max(1600),
}).strict();
export const canvasAttachmentsSchema = z.object({
  resources: z.array(canvasResourceSchema).max(100), cards: z.array(canvasAttachmentCardSchema).max(100),
  hiddenResourceIds: z.array(identity).max(200).optional(),
}).strict().superRefine((library, ctx) => {
  const ids = new Set(library.resources.map(resource => resource.id));
  if (ids.size !== library.resources.length || new Set(library.cards.map(card => card.id)).size !== library.cards.length)
    ctx.addIssue({ code: 'custom', message: 'attachmentDuplicateId' });
  if (library.cards.some(card => new Set(card.resourceIds).size !== card.resourceIds.length || card.resourceIds.some(id => !ids.has(id))))
    ctx.addIssue({ code: 'custom', message: 'attachmentMissingResource' });
  if (library.resources.reduce((sum, resource) => sum + (resource.text?.length ?? 0), 0) > 240_000)
    ctx.addIssue({ code: 'custom', message: 'attachmentTextBudget' });
});
export type CanvasResource = z.infer<typeof canvasResourceSchema>;
export type CanvasAttachmentCard = z.infer<typeof canvasAttachmentCardSchema>;
export type CanvasAttachments = z.infer<typeof canvasAttachmentsSchema>;
export const EMPTY_CANVAS_ATTACHMENTS: CanvasAttachments = { resources: [], cards: [] };
export const createCanvasAttachments = (): CanvasAttachments => ({ resources: [], cards: [] });
export function resourceLink(value: string): CanvasResource {
  const href = safeResourceUrl(value), url = new URL(href);
  return canvasResourceSchema.parse({ id: nanoid(12), name: `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`.slice(0, 240), kind: 'link', mediaId: null, mime: null, size: 0, text: null, url: href, addedAt: Date.now() });
}
export function placeCanvasResources(library: CanvasAttachments, resourceIds: string[], point: { x: number; y: number }): CanvasAttachments {
  return canvasAttachmentsSchema.parse({ ...library, cards: [...library.cards, { id: nanoid(12), resourceIds: [...new Set(resourceIds)], ...point, width: 240, height: 290 }] });
}
export function removeCanvasResource(library: CanvasAttachments, id: string): CanvasAttachments {
  // Only derived project sources need suppression; imported library files cannot reappear.
  const derived = /^(file|image|studio)-/.test(id);
  return canvasAttachmentsSchema.parse({ ...library, resources: library.resources.filter(resource => resource.id !== id), cards: library.cards.map(card => ({ ...card, resourceIds: card.resourceIds.filter(value => value !== id) })).filter(card => card.resourceIds.length), hiddenResourceIds: [...new Set([...(library.hiddenResourceIds ?? []), ...(derived ? [id] : [])])] });
}
export const CANVAS_ATTACHMENT_DRAG_TYPE = 'application/x-dynamic-diary-attachment';
