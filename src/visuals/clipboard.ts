import type { ImageReference } from './types';

let copied: { projectId: string; hash: string; reference: ImageReference } | null = null;
function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
  });
}
async function digest(blob: Blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await readBytes(blob))), value => value.toString(16).padStart(2, '0')).join('');
}
async function asClipboardPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const image = await createImageBitmap(blob);
  try {
    if (image.width * image.height > 16_000_000) throw new Error('visualImageInvalid');
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('visualImageInvalid');
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('visualImageInvalid')), 'image/png'));
    if (png.size > 5 * 1024 * 1024) throw new Error('visualFileTooLarge');
    return png;
  } finally { image.close(); }
}
/** Copies actual pixels. A matching digest is required before reusing source provenance on paste. */
export async function copyVisualReference(reference: ImageReference, projectId: string): Promise<void> {
  const url = new URL(reference.imageUrl, window.location.origin);
  if (url.origin !== window.location.origin || url.pathname !== '/api/visuals/media' || !url.searchParams.get('sessionId') || !url.searchParams.get('candidateId')) throw new Error('visualReferenceUnregistered');
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard unavailable. Use Add to canvas.');
  const response = await sessionAwareFetch(url, { redirect: 'error', credentials: 'same-origin' });
  if (!response.ok) throw new Error('visualImageFetchFailed');
  const blob = await response.blob();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 5 * 1024 * 1024) throw new Error('visualImageInvalid');
  const png = await asClipboardPng(blob), hash = await digest(png);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  copied = { projectId, hash, reference: { ...reference } };
}
export async function referenceFromClipboard(file: Blob, projectId: string): Promise<ImageReference | null> {
  const candidate = copied;
  if (!candidate || candidate.projectId !== projectId || file.size > 5 * 1024 * 1024) return null;
  return await digest(file) === candidate.hash ? candidate.reference : null;
}
import { sessionAwareFetch } from '@/cloud/runtime';
