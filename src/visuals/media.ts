import { createStore, del, entries, get, set } from 'idb-keyval';
import { nanoid } from 'nanoid';
import { currentVisualScope, getDefaultVisualNodeId, getVisualWorkspace, mutateVisualWorkspace, watchVisualScope } from './domain';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import type { Project } from '@/types';
import { collectVisualMediaIds } from './references';
import { containedImageRect } from './rendering/geometry';
import type { ImageReference, VisualArtifact, VisualAttachment } from './types';

export const MAX_VISUAL_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_VISUAL_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VISUAL_STORAGE_BYTES = 50 * 1024 * 1024;
const MAX_GLOBAL_MEDIA_BYTES = 500 * 1024 * 1024;
const ORPHAN_GRACE_MS = 15 * 60 * 1000;
export const MAX_VISUAL_EXPORT_BYTES = 40 * 1024 * 1024;
const db = createStore('cellproject-visual-media', 'media');
interface MediaRecord { id: string; mime: string; name: string; bytes: ArrayBuffer; createdAt?: number; projectId?: string }
interface ImageSize { width: number; height: number }
export interface PortableVisualMedia { id: string; mime: string; name: string; base64: string }
const supported = new Set(['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp']);

function fileBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(file);
  });
}
function validateBytes(bytes: ArrayBuffer, mime: string) {
  if (!supported.has(mime) || !bytes.byteLength || bytes.byteLength > MAX_VISUAL_FILE_BYTES) throw new Error('visualFileInvalid');
  const b = new Uint8Array(bytes), ascii = (start: number, end: number) => String.fromCharCode(...b.slice(start, end));
  if (mime === 'image/png' && !(b[0] === 137 && ascii(1, 4) === 'PNG' && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10)) throw new Error('visualImageInvalid');
  if (mime === 'image/jpeg' && !(b[0] === 255 && b[1] === 216 && b[2] === 255)) throw new Error('visualImageInvalid');
  if (mime === 'image/webp' && !(ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')) throw new Error('visualImageInvalid');
  if (mime === 'application/pdf' && ascii(0, 5) !== '%PDF-') throw new Error('visualPdfInvalid');
  if (mime.startsWith('image/') && bytes.byteLength > MAX_VISUAL_IMAGE_BYTES) throw new Error('visualImageTooLarge');
}
function checkPixels(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > 16_000_000) throw new Error('visualImageDimensions');
}
async function validateImage(bytes: ArrayBuffer, mime: string, signal?: AbortSignal): Promise<ImageSize | null> {
  if (!mime.startsWith('image/')) return null;
  const b = new Uint8Array(bytes), view = new DataView(bytes);
  // Reject oversized headers before allocating a decoded bitmap.
  if (mime === 'image/png') {
    if (bytes.byteLength < 24) throw new Error('visualImageInvalid');
    checkPixels(view.getUint32(16), view.getUint32(20));
  } else if (mime === 'image/jpeg') {
    for (let i = 2; i + 8 < b.length;) {
      if (b[i] !== 255) { i++; continue; }
      const marker = b[i + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) { checkPixels(view.getUint16(i + 7), view.getUint16(i + 5)); break; }
      if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
      const length = view.getUint16(i + 2); if (length < 2) throw new Error('visualImageInvalid'); i += length + 2;
    }
  } else if (mime === 'image/webp') {
    const encoding = String.fromCharCode(...b.slice(12, 16));
    if (encoding === 'VP8X' && b.length >= 30) checkPixels(1 + b[24] + (b[25] << 8) + (b[26] << 16), 1 + b[27] + (b[28] << 8) + (b[29] << 16));
    else if (encoding === 'VP8L' && b.length >= 25 && b[20] === 0x2f) checkPixels(1 + b[21] + ((b[22] & 0x3f) << 8), 1 + (b[22] >> 6) + (b[23] << 2) + ((b[24] & 0xf) << 10));
    else if (encoding === 'VP8 ' && b.length >= 30) checkPixels(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    else throw new Error('visualImageInvalid');
  }
  signal?.throwIfAborted();
  const blob = new Blob([bytes], { type: mime });
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      signal?.throwIfAborted(); checkPixels(bitmap.width, bitmap.height);
      return { width: bitmap.width, height: bitmap.height };
    } finally { bitmap.close(); }
  } else {
    const url = URL.createObjectURL(blob), image = new Image();
    try { await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('visualImageDecodeTimeout')); }, 10_000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(signal?.reason ?? new Error('visualCancelled')); };
      signal?.addEventListener('abort', abort, { once: true });
      image.onload = () => { cleanup(); resolve(); }; image.onerror = () => { cleanup(); reject(new Error('visualImageInvalid')); }; image.src = url;
    }); signal?.throwIfAborted(); checkPixels(image.naturalWidth, image.naturalHeight);
      return { width: image.naturalWidth, height: image.naturalHeight };
    } finally { URL.revokeObjectURL(url); image.src = ''; }
  }
}
let mediaWrites: Promise<unknown> = Promise.resolve();
const pendingMedia = new Map<string, { projectId: string; createdAt: number }>();
function storedProjects(): Project[] {
  const graph = useGraphStore.getState();
  return [graph.project, graph.archivedProject, graph.replacedArchive?.project,
    ...Object.values(useWorkspaceStore.getState().projects).flatMap(p => [p.planner?.project, p.planner?.archivedProject])].filter((p): p is Project => Boolean(p));
}
function referencedIds(projects = storedProjects()) {
  const ids = new Set<string>();
  for (const project of projects) { try { for (const id of collectVisualMediaIds(project)) ids.add(id); } catch { /* Invalid snapshots are isolated by projectBoundary. */ } }
  return ids;
}
function releaseReferencedPending() { if (!pendingMedia.size) return; for (const id of referencedIds()) pendingMedia.delete(id); }
useGraphStore.subscribe(releaseReferencedPending);
useWorkspaceStore.subscribe(releaseReferencedPending);
async function pruneStoredMedia(now: number) {
  const referenced = referencedIds();
  for (const [id, record] of await entries<string, MediaRecord>(db)) {
    const pending = pendingMedia.get(id);
    if (pending && now - pending.createdAt < ORPHAN_GRACE_MS) continue;
    if (!referenced.has(id) && now - (record.createdAt ?? 0) >= ORPHAN_GRACE_MS) { await del(id, db); pendingMedia.delete(id); }
  }
}
export async function collectUnreferencedVisualMedia(now = Date.now()): Promise<void> {
  const operation = mediaWrites.then(() => pruneStoredMedia(now));
  mediaWrites = operation.catch(() => {}); await operation;
}
async function persistMedia(records: MediaRecord[], projectId: string) {
  const operation = mediaWrites.then(async () => {
    releaseReferencedPending();
    await pruneStoredMedia(Date.now());
    const stored = await entries<string, MediaRecord>(db);
    const recordsById = new Map(stored);
    const projectRefs = referencedIds(storedProjects().filter(p => p.id === projectId));
    for (const [id, pending] of pendingMedia) if (pending.projectId === projectId && Date.now() - pending.createdAt < ORPHAN_GRACE_MS) projectRefs.add(id);
    for (const record of records) projectRefs.add(record.id);
    const incoming = new Map(records.map(record => [record.id, record]));
    const projectBytes = [...projectRefs].reduce((sum, id) => sum + (recordsById.get(id)?.bytes.byteLength ?? incoming.get(id)?.bytes.byteLength ?? 0), 0);
    if (projectBytes > MAX_VISUAL_STORAGE_BYTES) throw new Error('visualProjectStorageFull');
    let total = stored.reduce((sum, [, r]) => sum + r.bytes.byteLength, 0);
    for (const record of records) {
      const old = recordsById.get(record.id);
      if (old && (old.mime !== record.mime || old.bytes.byteLength !== record.bytes.byteLength || new Uint8Array(old.bytes).some((v, i) => v !== new Uint8Array(record.bytes)[i]))) throw new Error('visualMediaCollision');
      if (!old) total += record.bytes.byteLength;
    }
    if (total > MAX_GLOBAL_MEDIA_BYTES) throw new Error('visualStorageFull');
    for (const record of records) {
      await set(record.id, { ...record, createdAt: record.createdAt ?? Date.now(), projectId }, db);
      pendingMedia.set(record.id, { projectId, createdAt: Date.now() });
    }
  });
  mediaWrites = operation.catch(() => {}); await operation;
}
function inferredMime(file: File) {
  if (supported.has(file.type)) return file.type;
  if (file.type) throw new Error('visualFileUnsupported');
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ({ pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[ext ?? ''] ?? '';
}
async function writeMedia(file: Blob, name: string, signal?: AbortSignal): Promise<MediaRecord & { imageSize: ImageSize | null }> {
  signal?.throwIfAborted();
  const projectId = currentVisualScope().projectId;
  if (file.size > MAX_VISUAL_FILE_BYTES) throw new Error('visualFileTooLarge');
  const bytes = await fileBytes(file); signal?.throwIfAborted(); validateBytes(bytes, file.type);
  const imageSize = await validateImage(bytes, file.type, signal);
  const record = { id: nanoid(), mime: file.type, name, bytes, createdAt: Date.now(), projectId };
  await persistMedia([record], projectId); signal?.throwIfAborted();
  return { ...record, imageSize };
}
export async function readVisualMedia(mediaId: string): Promise<Blob | null> {
  const record = await get<MediaRecord>(mediaId, db);
  return record ? new Blob([record.bytes], { type: record.mime }) : null;
}
/** Original local bytes only; no provider URL downloads or hidden image selection. */
export async function readVisualImage(mediaId: string, signal?: AbortSignal): Promise<{ image: Uint8Array<ArrayBuffer>; mediaType: string }> {
  signal?.throwIfAborted();
  const blob = await readVisualMedia(mediaId);
  signal?.throwIfAborted();
  if (!blob) throw new Error('visualMediaMissing');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('visualImageInvalid');
  if (blob.size > MAX_VISUAL_IMAGE_BYTES) throw new Error('visualVisionLimit');
  const bytes = await fileBytes(blob);
  signal?.throwIfAborted(); validateBytes(bytes, blob.type);
  await validateImage(bytes, blob.type, signal); signal?.throwIfAborted();
  return { image: new Uint8Array(bytes), mediaType: blob.type };
}
export async function attachVisualFile(file: File, signal?: AbortSignal): Promise<VisualAttachment> {
  const guard = watchVisualScope();
  try {
    signal?.throwIfAborted(); const mime = inferredMime(file);
    if (!supported.has(mime)) throw new Error('visualFileUnsupported');
    const record = await writeMedia(new Blob([file], { type: mime }), file.name, signal);
    let text: string | null = null;
    if (mime.startsWith('text/')) text = new TextDecoder('utf-8', { fatal: true }).decode(record.bytes).slice(0, 24_000);
    if (mime === 'application/pdf') {
      const { extractPdfText } = await import('@/kb/extract');
      text = (await extractPdfText(new File([record.bytes], file.name, { type: mime }), undefined, { signal, maxPages: 100, maxChars: 24_000 })).text;
    }
    signal?.throwIfAborted(); guard.assert();
    return { id: nanoid(), name: file.name, mime, byteLength: file.size, mediaId: record.id, text };
  } finally { guard.dispose(); }
}
function createImage(mediaId: string, label: string, source: ImageReference | null, point: { x: number; y: number }, initialNodeId: string | null, imageSize: ImageSize | null): VisualArtifact {
  if (![point.x, point.y].every(Number.isFinite) || Math.abs(point.x) > 100_000 || Math.abs(point.y) > 100_000) throw new Error('visualGeometryInvalid');
  if (!imageSize) throw new Error('visualImageInvalid');
  const { width, height } = containedImageRect({ x: 0, y: 0, width: 280, height: 220 }, imageSize.width, imageSize.height);
  const nodes = useGraphStore.getState().project!.nodes;
  const linkedNodeId = initialNodeId && Object.hasOwn(nodes, initialNodeId) ? initialNodeId : null;
  return { id: nanoid(), label: label.slice(0, 160), kind: 'image', linkedNodeId, x: point.x, y: point.y, width, height, mediaId, scene: null, source, revisions: [{ scene: null, mediaId, createdAt: Date.now() }], revisionIndex: 0 };
}
export async function addLocalImage(file: File, point: { x: number; y: number }, signal?: AbortSignal): Promise<VisualArtifact> {
  const guard = watchVisualScope(), initialNodeId = getDefaultVisualNodeId();
  try {
    const mime = inferredMime(file); if (!mime.startsWith('image/')) throw new Error('visualImageRequired');
    const record = await writeMedia(new Blob([file], { type: mime }), file.name, signal);
    signal?.throwIfAborted(); guard.assert();
    const artifact = createImage(record.id, file.name, null, point, initialNodeId, record.imageSize);
    mutateVisualWorkspace(w => ({ ...w, artifacts: [...w.artifacts, artifact] }), guard.scope);
    return artifact;
  } finally { guard.dispose(); }
}
export async function addReferenceImage(reference: ImageReference, point: { x: number; y: number }, signal?: AbortSignal, options: { center?: boolean; linkedNodeId?: string | null; beforeInsert?: () => void } = {}): Promise<VisualArtifact> {
  const guard = watchVisualScope(), initialNodeId = options.linkedNodeId !== undefined ? options.linkedNodeId : getDefaultVisualNodeId();
  try {
    signal?.throwIfAborted();
    const existingReference = () => getVisualWorkspace(useGraphStore.getState().project).artifacts.find(a => a.kind === 'image' && a.source && ((a.source.id === reference.id && a.source.sessionId === reference.sessionId) || a.source.imageUrl === reference.imageUrl));
    const existing = existingReference(); if (existing) return existing;
    const url = new URL(reference.imageUrl, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== '/api/visuals/media' || !url.searchParams.get('sessionId') || !url.searchParams.get('candidateId')) throw new Error('visualReferenceUnregistered');
    const response = await fetch(url, { signal, redirect: 'error', credentials: 'same-origin' });
    if (!response.ok) throw new Error('visualImageFetchFailed');
    const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!mime.startsWith('image/') || Number(response.headers.get('content-length')) > MAX_VISUAL_FILE_BYTES) throw new Error('visualImageInvalid');
    const reader = response.body?.getReader(); if (!reader) throw new Error('visualImageInvalid');
    const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
    try { while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_VISUAL_FILE_BYTES) { await reader.cancel(); throw new Error('visualFileTooLarge'); }
      chunks.push(new Uint8Array(value)); signal?.throwIfAborted();
    } } finally { reader.releaseLock(); }
    const record = await writeMedia(new Blob(chunks, { type: mime }), reference.title, signal);
    signal?.throwIfAborted(); guard.assert();
    options.beforeInsert?.();
    const duplicate = existingReference(); if (duplicate) return duplicate;
    const artifact = createImage(record.id, reference.title, reference, point, initialNodeId, record.imageSize);
    if (options.center) { artifact.x -= artifact.width / 2; artifact.y -= artifact.height / 2; }
    mutateVisualWorkspace(w => ({ ...w, artifacts: [...w.artifacts, artifact] }), guard.scope);
    return artifact;
  } finally { guard.dispose(); }
}
export async function exportVisualMedia(ids: string[]): Promise<PortableVisualMedia[]> {
  const result: PortableVisualMedia[] = []; let total = 0;
  for (const id of new Set(ids)) {
    const record = await get<MediaRecord>(id, db); if (!record) throw new Error('visualMediaMissing');
    total += record.bytes.byteLength; if (total > MAX_VISUAL_EXPORT_BYTES) throw new Error('visualExportTooLarge');
    let binary = ''; const bytes = new Uint8Array(record.bytes);
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    result.push({ id, mime: record.mime, name: record.name, base64: btoa(binary) });
  }
  return result;
}
export async function importVisualMedia(records: PortableVisualMedia[], projectId = useGraphStore.getState().project?.id ?? 'import'): Promise<void> {
  let total = 0; const decoded: MediaRecord[] = [];
  if (records.length > 512) throw new Error('visualExportTooLarge');
  const ids = new Set<string>();
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || !/^[\w-]{1,100}$/.test(record.id) || ids.has(record.id) || typeof record.mime !== 'string' || typeof record.name !== 'string' || record.name.length > 1000 || typeof record.base64 !== 'string' || record.base64.length > Math.ceil(MAX_VISUAL_FILE_BYTES / 3) * 4) throw new Error('visualMediaInvalid');
    ids.add(record.id); const binary = atob(record.base64), bytes = Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
    total += bytes.byteLength; if (total > MAX_VISUAL_EXPORT_BYTES) throw new Error('visualExportTooLarge');
    validateBytes(bytes, record.mime); await validateImage(bytes, record.mime); decoded.push({ id: record.id, mime: record.mime, name: record.name, bytes });
  }
  // Validate the whole bundle before writes; IDs reference immutable content.
  await persistMedia(decoded, projectId);
}
