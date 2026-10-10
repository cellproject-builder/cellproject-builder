export function validateImageBytes(rawMime, bytes) {
  const mime = rawMime.toLowerCase().split(';')[0].trim();
  if (bytes.length > 5 * 1024 * 1024 || bytes.length < 12) throw new Error('Invalid image size');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if ((mime === 'image/png' && png) || (mime === 'image/jpeg' && jpeg) || (mime === 'image/webp' && webp)) return mime;
  throw new Error('Image MIME and signature must match PNG, JPEG or WebP');
}
