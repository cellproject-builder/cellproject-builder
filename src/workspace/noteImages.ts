const MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_INLINE_BYTES = 1024 * 1024;
const MAX_PIXELS = 16_000_000;
interface ImageCarrier { canvas?: { items: Array<{kind: string; src?: string}> } }
const imageChars = (note: ImageCarrier) => note.canvas?.items.reduce((sum, item) => sum + (item.kind === 'image' ? item.src?.length ?? 0 : 0), 0) ?? 0;
/** Inline images travel inside the existing encrypted workspace envelope. */
export function assertNoteImageBudget(notes: ImageCarrier[], target: ImageCarrier, incoming: string[]) {
  const added = incoming.reduce((sum, src) => sum + src.length, 0);
  if (imageChars(target) + added > 6 * 1024 * 1024 || notes.reduce((sum, note) => sum + imageChars(note), 0) + added > 16 * 1024 * 1024) throw new Error('noteImageBudget');
}
const bytesOf = (blob: Blob): Promise<ArrayBuffer> => typeof blob.arrayBuffer === 'function' ? blob.arrayBuffer() : new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
});
const dataOf = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
});
function validateHeader(bytes: Uint8Array, mime: string) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const check = (width: number, height: number) => { if (!width || !height || width * height > MAX_PIXELS) throw new Error('noteImageSize'); };
  if (mime === 'image/png' && !(bytes[0] === 137 && ascii(1, 4) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10)
    || mime === 'image/jpeg' && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    || mime === 'image/webp' && !(ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')) throw new Error('noteImageInvalid');
  if (mime === 'image/png') {
    if (bytes.length < 24) throw new Error('noteImageInvalid');
    check(view.getUint32(16), view.getUint32(20));
  } else if (mime === 'image/jpeg') {
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 255) {offset++; continue;}
      const marker = bytes[offset + 1];
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {check(view.getUint16(offset + 7), view.getUint16(offset + 5)); break;}
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) {offset += 2; continue;}
      const length = view.getUint16(offset + 2); if (length < 2) throw new Error('noteImageInvalid'); offset += length + 2;
    }
  } else if (mime === 'image/webp') {
    const encoding = ascii(12,16);
    if (encoding === 'VP8X' && bytes.length >= 30) check(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16));
    else if (encoding === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) check(1 + bytes[21] + ((bytes[22] & 0x3f) << 8), 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0xf) << 10));
    else if (encoding === 'VP8 ' && bytes.length >= 30) check(view.getUint16(26,true) & 0x3fff, view.getUint16(28,true) & 0x3fff);
    else throw new Error('noteImageInvalid');
  }
}
async function decode(blob: Blob, signal?: AbortSignal): Promise<{source: CanvasImageSource; width: number; height: number; release: () => void}> {
  if (typeof createImageBitmap === 'function') {
    const image = await createImageBitmap(blob);
    if (signal?.aborted) { image.close(); signal.throwIfAborted(); }
    return {source:image, width:image.width, height:image.height, release:() => image.close()};
  }
  const url = URL.createObjectURL(blob), image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const done = (reason?: unknown) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); image.onload = null; image.onerror = null; reason ? reject(reason) : resolve(); };
      const abort = () => done(new DOMException('Cancelled', 'AbortError'));
      const timer = setTimeout(() => done(new Error('noteImageInvalid')), 10_000);
      signal?.addEventListener('abort', abort, {once:true});
      image.onload = () => done(); image.onerror = () => done(new Error('noteImageInvalid')); image.src = url;
    });
    return {source:image, width:image.naturalWidth, height:image.naturalHeight, release:() => {URL.revokeObjectURL(url); image.src = '';}};
  } catch (error) {URL.revokeObjectURL(url); image.src = ''; throw error;}
}
/** Decode and re-encode raster content; arbitrary HTML/SVG and remote URLs never become note images. */
export async function importNoteImage(file: File, signal?: AbortSignal): Promise<{src: string; width: number; height: number; label: string}> {
  signal?.throwIfAborted();
  if (!MIME.has(file.type)) throw new Error('noteImageType');
  if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error('noteImageSize');
  const bytes = new Uint8Array(await bytesOf(file)); signal?.throwIfAborted(); validateHeader(bytes, file.type);
  const image = await decode(new Blob([bytes], {type:file.type}), signal);
  try {
    signal?.throwIfAborted();
    if (!image.width || !image.height || image.width * image.height > MAX_PIXELS) throw new Error('noteImageSize');
    const factor = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * factor)); canvas.height = Math.max(1, Math.round(image.height * factor));
    const context = canvas.getContext('2d'); if (!context) throw new Error('noteImageInvalid');
    context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
    const encoded = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('noteImageInvalid')), 'image/webp', .86));
    signal?.throwIfAborted(); if (encoded.size > MAX_INLINE_BYTES) throw new Error('noteImageSize');
    const src = await dataOf(encoded); signal?.throwIfAborted();
    return {src, width:canvas.width, height:canvas.height, label:file.name.slice(0, 120) || 'Image'};
  } finally {image.release();}
}
