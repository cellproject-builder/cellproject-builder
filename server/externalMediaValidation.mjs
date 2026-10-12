import sharp from 'sharp';
import { invalid } from './cloudUtils.mjs';

export const MAX_EXTERNAL_IMAGE_PIXELS = 16_000_000;
const formats = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };

/** Original files cross the same byte-format and decoded-image limits as browser uploads. */
export async function validateExternalMediaBytes(bytes, mime) {
  if (mime === 'application/pdf') {
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw invalid('Invalid PDF original.');
    return;
  }
  if (!Object.hasOwn(formats, mime)) return;
  const ascii = (start, end) => bytes.subarray(start, end).toString('ascii');
  if (mime === 'image/png' && !(bytes[0] === 137 && ascii(1, 4) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10)
    || mime === 'image/jpeg' && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    || mime === 'image/webp' && !(ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')) throw invalid('Invalid image original.');
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_EXTERNAL_IMAGE_PIXELS, animated: true });
    const metadata = await image.metadata();
    if (metadata.format !== formats[mime] || !Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
      || metadata.width < 1 || metadata.height < 1 || metadata.width * (metadata.pageHeight ?? metadata.height) * (metadata.pages ?? 1) > MAX_EXTERNAL_IMAGE_PIXELS) throw invalid('Invalid image dimensions.');
    await image.stats();
  } catch { throw invalid('Invalid image original or dimensions.'); }
}
