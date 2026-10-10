import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSpecificationDocuments } from './specDocuments.mjs';

const source = (url = 'https://manufacturer.example/board') => ({ url, title: 'Official board specification' });
const response = (url, text, mime = 'text/html') => ({ finalUrl: url, mime, bytes: Buffer.from(text) });

test('extracts real HTML specification text and tables, omitting scripts and navigation', async () => {
  const result = await fetchSpecificationDocuments([source()], { now: () => 123, publicFetch: async url => response(url, '<title>UNO R3</title><nav>BUY LOGIN</nav><main><h1>UNO R3</h1><table><tr><td>U4</td><td>ATMEGA328P-PU</td></tr></table><script>SECRET_SCRIPT</script><p>Clock 16 MHz.</p></main>') });
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].text, 'UNO R3 U4 ATMEGA328P-PU Clock 16 MHz.');
  assert.equal(result.documents[0].url, source().url);
  assert.equal(result.documents[0].retrievedAt, 123);
  assert.equal(result.documents[0].mime, 'text/html');
  assert.ok(result.documents[0].id);
});

test('accepts bounded plain text and signed PDF bytes without pretending the PDF was read', async () => {
  const result = await fetchSpecificationDocuments([source('https://manufacturer.example/a.txt'), source('https://manufacturer.example/b.pdf')], { publicFetch: async url => response(url, url.endsWith('.pdf') ? '%PDF-1.7\nactual bounded bytes' : 'Part: ATmega328P.\n  Clock: 16MHz.', url.endsWith('.pdf') ? 'application/pdf' : 'text/plain') });
  assert.equal(result.documents[0].text, 'Part: ATmega328P. Clock: 16MHz.');
  assert.equal(result.documents[1].text, undefined);
  assert.equal(Buffer.from(result.documents[1].base64, 'base64').toString(), '%PDF-1.7\nactual bounded bytes');
});

test('rejects invalid source URLs and excessive lists before any upstream download', async () => {
  let calls = 0;
  const publicFetch = async () => { calls++; assert.fail('Must not download invalid sources'); };
  for (const sources of [[], Array(7).fill(source()), [source('http://example.com')], [source('https://user:password@example.com')], [source('https://localhost/a')], [source('https://example.com:8080/a')], [{ url: 'https://example.com', title: 4 }]]) {
    await assert.rejects(fetchSpecificationDocuments(sources, { publicFetch }), /Invalid/);
  }
  assert.equal(calls, 0);
});

test('deduplicates URLs and rejects empty, binary, oversized and disguised PDFs as unavailable sources', async () => {
  const urls = ['empty', 'binary', 'large', 'disguised']; let calls = 0;
  const result = await fetchSpecificationDocuments([...urls.map(name => source(`https://manufacturer.example/${name}`)), source('https://manufacturer.example/empty')], { publicFetch: async url => {
    calls++;
    if (url.endsWith('empty')) return response(url, '<script>only script</script>');
    if (url.endsWith('binary')) return response(url, 'binary', 'application/zip');
    if (url.endsWith('large')) return response(url, 'x'.repeat(3 * 1024 * 1024 + 1), 'text/plain');
    return response(url, '<html>Error</html>', 'application/pdf');
  } });
  assert.equal(calls, 4); assert.equal(result.documents.length, 0); assert.equal(result.failures.length, 4);
  assert.equal(JSON.stringify(result).includes('only script'), false);
});

test('limits concurrency to two, truncates source text and retains successful documents on partial failure', async () => {
  let active = 0, peak = 0;
  const result = await fetchSpecificationDocuments(Array.from({ length: 6 }, (_, index) => source(`https://manufacturer.example/${index}`)), { publicFetch: async url => {
    active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--;
    if (url.endsWith('/3')) throw new Error('SENTINEL_SECRET');
    return response(url, 'Specification text. '.repeat(1000), 'text/plain');
  } });
  assert.equal(peak, 2); assert.equal(result.documents.length, 5); assert.equal(result.documents[0].text.length, 12000);
  assert.equal(result.failures.length, 1); assert.equal(JSON.stringify(result).includes('SENTINEL_SECRET'), false);
});

test('cancellation propagates rather than returning a partial dossier', async () => {
  const controller = new AbortController();
  await assert.rejects(fetchSpecificationDocuments([source()], { signal: controller.signal, publicFetch: async url => { controller.abort(); return response(url, 'Part ATMEGA328P-PU'); } }), { name: 'AbortError' });
});
