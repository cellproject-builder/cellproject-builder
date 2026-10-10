import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { fetchPublicHttps } from './publicHttps.mjs';

const MAX_BYTES = 3 * 1024 * 1024;
const normalize = text => text.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\s+/gu, ' ').trim();
function sourceUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2000 || /[\x00-\x20\x7f]/.test(raw)) throw new Error('Invalid specification source');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new Error('Invalid specification source');
  url.hash = '';
  return url.href;
}
export function parseSpecificationSources(sources) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 6) throw new Error('Invalid specification sources');
  const seen = new Set();
  return sources.flatMap(source => {
    if (!source || typeof source !== 'object' || typeof source.title !== 'string' || source.title.length > 1000) throw new Error('Invalid specification source');
    const url = sourceUrl(source.url);
    if (seen.has(url)) return [];
    seen.add(url);
    return [{ url, title: normalize(source.title).slice(0, 300) || new URL(url).hostname }];
  });
}
function htmlText(bytes) {
  const $ = load(bytes.toString('utf8'));
  $('script,style,noscript,nav,header,footer,form,iframe,svg,canvas,template,[hidden],[aria-hidden="true"]').remove();
  $('p,div,li,table,td,th,tr,section,article,main,h1,h2,h3,h4,h5,h6,br,pre').before(' ').after(' ');
  return normalize($('body').text());
}

/** Public source bytes only: never forwards credentials and never treats a PDF as extracted text. */
export async function fetchSpecificationDocuments(sources, { publicFetch = fetchPublicHttps, signal, now = Date.now } = {}) {
  const input = parseSpecificationSources(sources), results = new Array(input.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, input.length) }, async () => {
    while (next < input.length) {
      const index = next++, source = input[index];
      signal?.throwIfAborted();
      try {
        const page = await publicFetch(source.url, { maxBytes: MAX_BYTES, signal });
        signal?.throwIfAborted();
        if (!Buffer.isBuffer(page.bytes) || page.bytes.length > MAX_BYTES) throw new Error('Unsupported specification document');
        const url = sourceUrl(page.finalUrl ?? source.url);
        const common = { id: `spec-${createHash('sha256').update(url).digest('hex').slice(0, 20)}`, url, title: source.title, retrievedAt: now(), mime: page.mime };
        if (page.mime === 'application/pdf') {
          if (!page.bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Unsupported PDF');
          results[index] = { document: { ...common, base64: page.bytes.toString('base64') }, byteLength: page.bytes.length };
        } else {
          if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(page.mime)) throw new Error('Unsupported specification type');
          const text = (page.mime === 'text/plain' ? normalize(page.bytes.toString('utf8')) : htmlText(page.bytes)).slice(0, 12000);
          if (!text || !/[\p{L}\p{N}]/u.test(text)) throw new Error('Empty specification document');
          results[index] = { document: { ...common, text }, byteLength: Buffer.byteLength(text) };
        }
      } catch {
        signal?.throwIfAborted();
        results[index] = { failure: { url: source.url, reason: 'unavailable-or-unsupported' } };
      }
    }
  }));
  signal?.throwIfAborted();
  const documents = [], failures = [], seen = new Set(); let total = 0;
  for (const result of results) {
    if (result.failure) { failures.push(result.failure); continue; }
    if (seen.has(result.document.url)) continue;
    // Bound aggregate response size as well as each download.
    if (total + result.byteLength > 8 * 1024 * 1024) { failures.push({ url: result.document.url, reason: 'document-budget-exceeded' }); continue; }
    total += result.byteLength; seen.add(result.document.url); documents.push(result.document);
  }
  return { documents, failures };
}
