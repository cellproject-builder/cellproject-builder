import { createStore, get, set } from 'idb-keyval';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { history.replaceState({}, '', '/'); vi.restoreAllMocks(); vi.resetModules(); });

it('keeps demo uploads, imports, exports and orphan collection entirely separate from real media', async () => {
  const realMedia = createStore('cellproject-visual-media', 'media');
  await set('private-media', { id: 'private-media', mime: 'text/plain', name: 'private.txt', bytes: new TextEncoder().encode('Private original').buffer, createdAt: 1, projectId: 'private-project' }, realMedia);
  history.replaceState({}, '', '/demo');
  vi.resetModules();
  const { storeCanvasFile, importVisualMedia, exportVisualMedia, readVisualMedia, collectUnreferencedVisualMedia } = await import('@/visuals/media');
  expect(await readVisualMedia('private-media')).toBeNull();
  const upload = await storeCanvasFile(new File(['Example upload'], 'example.txt', { type: 'text/plain' }), 'board:example');
  await importVisualMedia([{ id: 'example-import', mime: 'text/plain', name: 'import.txt', base64: 'RXhhbXBsZSBpbXBvcnQ=' }], 'board:example');
  expect((await readVisualMedia(upload.id))?.size).toBe(14);
  expect(await exportVisualMedia([upload.id, 'example-import'])).toEqual([
    { id: upload.id, mime: 'text/plain', name: 'example.txt', base64: 'RXhhbXBsZSB1cGxvYWQ=' },
    { id: 'example-import', mime: 'text/plain', name: 'import.txt', base64: 'RXhhbXBsZSBpbXBvcnQ=' },
  ]);
  expect(await get(upload.id, realMedia)).toBeUndefined();
  expect(await get('example-import', realMedia)).toBeUndefined();
  await collectUnreferencedVisualMedia(Date.now() + 60 * 60 * 1000);
  expect(await readVisualMedia(upload.id)).toBeNull();
  expect(await readVisualMedia('example-import')).toBeNull();
  expect(await get('private-media', realMedia)).toMatchObject({ name: 'private.txt' });

  const unsavedUpload = await storeCanvasFile(new File(['Reload discards this'], 'reload.txt', { type: 'text/plain' }), 'board:example');
  vi.resetModules();
  const reloadedMedia = await import('@/visuals/media');
  expect(await reloadedMedia.readVisualMedia(unsavedUpload.id)).toBeNull();
});
