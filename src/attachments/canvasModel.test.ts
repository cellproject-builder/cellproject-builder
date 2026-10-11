import { expect, it } from 'vitest';
import { canvasAttachmentsSchema, createCanvasAttachments, resourceLink, removeCanvasResource, placeCanvasResources } from './canvasModel';

it('keeps file bytes out of the document and accepts legacy text-only PDFs', () => {
  const resource = { id: 'file-1', name: 'Manual.pdf', kind: 'pdf', mediaId: null, mime: 'application/pdf', size: 4, text: 'Legacy excerpt', url: null, addedAt: 1 };
  expect(canvasAttachmentsSchema.parse({ resources: [resource], cards: [] }).resources[0].text).toBe('Legacy excerpt');
  expect(canvasAttachmentsSchema.safeParse({ resources: [{ ...resource, bytes: 'secret' }], cards: [] }).success).toBe(false);
});
it('places a deck without copying resources and removes dangling cards on deletion', () => {
  const a = resourceLink('https://example.org/a'), b = resourceLink('https://example.org/b');
  const library = { ...createCanvasAttachments(), resources: [a, b] };
  const placed = placeCanvasResources(library, [a.id, b.id], { x: 50, y: 70 });
  expect(placed.resources).toEqual(library.resources);
  expect(placed.cards[0]).toMatchObject({ resourceIds: [a.id, b.id], x: 50, y: 70 });
  expect(removeCanvasResource(placed, a.id).cards[0].resourceIds).toEqual([b.id]);
  expect(removeCanvasResource(removeCanvasResource(placed, a.id), b.id).cards).toEqual([]);
});
it('rejects unsafe links, unknown references, duplicate identities and unbounded cards', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'https://user:password@example.org']) expect(() => resourceLink(url)).toThrow();
  const a = resourceLink('https://example.org/manual');
  expect(canvasAttachmentsSchema.safeParse({ resources: [a, a], cards: [] }).success).toBe(false);
  expect(() => placeCanvasResources({ resources: [a], cards: [] }, ['missing'], { x: 0, y: 0 })).toThrow();
  expect(() => placeCanvasResources({ resources: [a], cards: [] }, [a.id], { x: Infinity, y: 0 })).toThrow();
});
it('does not accumulate tombstones when repeatedly removing imported resources', () => {
  let library = createCanvasAttachments();
  for (let i = 0; i < 205; i++) {
    const resource = resourceLink(`https://example.org/${i}`);
    library = removeCanvasResource({ ...library, resources: [resource] }, resource.id);
  }
  expect(library.hiddenResourceIds).toEqual([]);
  expect(removeCanvasResource(library, 'file-legacy').hiddenResourceIds).toEqual(['file-legacy']);
});
