import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('ai', async importOriginal => ({ ...await importOriginal<typeof import('ai')>(), generateObject: deps.generate }));
vi.mock('@/ai/client', () => ({ kbModel: { id: 'fit-model' }, currentModelIds: () => ({ kb: 'fit-model' }), callOpts: () => ({ maxOutputTokens: 8000 }) }));
import { assessImageProjectFit } from './componentFit';

const image = { id: 'motor', title: 'Motor X12', description: 'SEARCH SNIPPET MUST NOT BECOME EVIDENCE', sourcePageUrl: 'https://maker.example/x12', imageUrl: 'https://maker.example/x12.png', credit: null, license: null, width: null, height: null };
const context = { revision: 'r1', partial: false, sources: [{ id: 'req', label: 'Bancada', kind: 'project', text: 'Usar alimentação de 5 V.', truncated: false }] };
const doc = { id: 'doc', title: 'Motor X12', url: image.sourcePageUrl, mime: 'text/html', text: 'Motor X12. Operating voltage: 12 V.', retrievedAt: 123 };
const generated = { candidates: [{ imageId: image.id, productName: image.title, identity: { sourceId: doc.id, quote: 'Motor X12.' }, checks: [{ aspect: 'Tensão', status: 'conflict', explanation: 'A tensão nominal diverge da alimentação prevista.', requirement: { sourceId: 'req', quote: 'Usar alimentação de 5 V.' }, evidence: [{ sourceId: doc.id, quote: 'Operating voltage: 12 V.' }], relatedImageIds: [] }], unknowns: ['Torque não informado.'] }] };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ documents: [doc], failures: [] })));
  vi.stubGlobal('fetch', fetchMock);
  deps.generate.mockResolvedValue({ object: generated, finishReason: 'stop' });
});
afterEach(() => vi.unstubAllGlobals());

it('reads real page text and checks model citations before returning a documented conflict', async () => {
  const [fit] = await assessImageProjectFit([image], context, 'Compare o motor', { signal: new AbortController().signal });
  expect(fetchMock.mock.calls[0][0]).toBe('/api/visuals/specifications');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sources: [{ url: image.sourcePageUrl, title: image.title }] });
  const request = deps.generate.mock.calls[0][0];
  expect(JSON.parse(request.prompt).documents[0].text).toBe(doc.text);
  expect(request.system).toContain('Never use model memory');
  expect(request.system).toContain('TypeSafe relevance');
  expect(fit.status).toBe('conflict');
  expect(fit.checks[0].evidence[0].quote).toBe('Operating voltage: 12 V.');
});

it('keeps compatibility pending if documents, bounded output, or quotations fail', async () => {
  for (const response of [
    { object: { candidates: [] }, finishReason: 'length' },
    { object: { candidates: [null] }, finishReason: 'stop' },
    { object: { candidates: [{ ...generated.candidates[0], checks: [{ ...generated.candidates[0].checks[0], evidence: [{ sourceId: 'doc', quote: 'Operating voltage: 5 V.' }] }] }] }, finishReason: 'stop' },
  ]) {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ documents: [doc], failures: [] })));
    deps.generate.mockResolvedValue(response);
    expect((await assessImageProjectFit([image], context, '', { signal: new AbortController().signal }))[0].status).toBe('unknown');
  }
  deps.generate.mockClear(); fetchMock.mockRejectedValue(new Error('network'));
  const result = await assessImageProjectFit([image], context, '', { signal: new AbortController().signal });
  expect(result[0].status).toBe('unknown'); expect(deps.generate).not.toHaveBeenCalled();
});

it('propagates cancellation rather than publishing a fallback assessment', async () => {
  const controller = new AbortController();
  fetchMock.mockImplementation(async () => { controller.abort(); throw controller.signal.reason; });
  await expect(assessImageProjectFit([image], context, '', { signal: controller.signal })).rejects.toThrow();
  expect(deps.generate).not.toHaveBeenCalled();
});

it('reserves a specification source for each requested item before reading more alternatives', async () => {
  const images = Array.from({ length: 8 }, (_, i) => ({ ...image, id: `i${i}`, sourcePageUrl: `https://maker.example/product-${i}` }));
  await assessImageProjectFit(images, context, '', { signal: new AbortController().signal, groups: [{ imageIds: images.slice(0, 7).map(item => item.id) }, { imageIds: ['i7'] }] });
  const sources = JSON.parse(fetchMock.mock.calls[0][1].body).sources;
  expect(sources).toHaveLength(6); expect(sources[0].url).toBe(images[0].sourcePageUrl); expect(sources[1].url).toBe(images[7].sourcePageUrl);
});
