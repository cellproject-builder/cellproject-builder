import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({
  research: vi.fn(), config: vi.fn(), intent: vi.fn(),
  graph: { project: { id: 'plan' } }, workspace: { activeProjectId: 'project' },
  resolve: vi.fn(),
}));
vi.mock('@/ai/research', () => ({ groundedText: deps.research, runResearch: deps.research }));
vi.mock('./searchIntent', async importOriginal => ({ ...await importOriginal<typeof import('./searchIntent')>(), resolveImageSearchIntent: deps.intent }));
vi.mock('@/config/store', () => ({ getActiveConfig: deps.config }));
vi.mock('@/store', () => ({ useGraphStore: { getState: () => deps.graph } }));
vi.mock('@/workspace/store', () => ({ useWorkspaceStore: { getState: () => deps.workspace } }));
vi.mock('./domain', () => ({ resolveVisualContext: deps.resolve }));
import { reviewVisualReference, searchVisualImages } from './search';

const input = { text: 'ESP32', mentions: [], attachments: [] };
const reference = { id: 'image', sessionId: 'session', title: 'Real board', description: 'real reference', imageUrl: '/api/visuals/media?sessionId=session&candidateId=image', sourcePageUrl: 'https://example.com/page', credit: null, license: null, width: null, height: null, assessment: null };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  deps.graph.project = { id: 'plan' }; deps.workspace.activeProjectId = 'project';
  deps.resolve.mockReturnValue({ text: 'Selected note only', fingerprint: 'chosen-context' });
  deps.config.mockReturnValue(null);
  deps.intent.mockResolvedValue({ query: 'ESP32', label: 'ESP32', targetTerms: ['ESP32'], uncertainty: '' });
  fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(_url.includes('capabilities') ? { references: true } : { sessionId: 'session', expiresAt: Date.now() + 1, candidates: [reference] })));
  vi.stubGlobal('fetch', fetchMock);
});

describe('reviewVisualReference', () => {
  it('returns null with no configured TypeSafe and makes no review request', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ references: true, textualReview: false })));
    await expect(reviewVisualReference(reference, input, { signal: new AbortController().signal })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/visuals/capabilities');
  });
  it('explicit review posts only immutable candidate IDs and selected context fingerprint to the local gateway', async () => {
    const assessment = { score: 2.35, confidence: .91 };
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('capabilities') ? { references: true, textualReview: true } : { candidateId: reference.id, assessment })));
    await expect(reviewVisualReference(reference, input, { signal: new AbortController().signal })).resolves.toEqual(assessment);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ projectId: 'plan', sessionId: 'session', candidateId: 'image', contextFingerprint: 'chosen-context' });
    expect(deps.research).not.toHaveBeenCalled();
  });
  it('rejects malformed review scores and changes to the project during a review', async () => {
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('capabilities') ? { references: true, textualReview: true } : { candidateId: reference.id, assessment: { score: 4, confidence: .9 } })));
    await expect(reviewVisualReference(reference, input, { signal: new AbortController().signal })).rejects.toThrow(/invalid/i);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('capabilities')) return new Response(JSON.stringify({ references: true, textualReview: true }));
      deps.workspace.activeProjectId = 'changed';
      return new Response(JSON.stringify({ candidateId: reference.id, assessment: { score: 2.35, confidence: .9 } }));
    });
    await expect(reviewVisualReference(reference, input, { signal: new AbortController().signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('searchVisualImages', () => {
  it('without BYOK uses real gateway Commons fallback and sends only resolved chosen context', async () => {
    const result = await searchVisualImages(input, { signal: new AbortController().signal });
    expect(result).toEqual([reference]); expect(deps.research).not.toHaveBeenCalled();
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/visuals/reference-sessions');
    expect(JSON.parse(options.body)).toMatchObject({ query: 'ESP32', context: 'Selected note only', contextFingerprint: 'chosen-context', sources: [] });
    expect(options.credentials).toBe('same-origin');
    expect(fetchMock.mock.calls.every(([target]) => String(target).startsWith('/api/visuals/'))).toBe(true);
  });
  it('uses real research source pages and preserves no arbitrary model-produced image URL', async () => {
    deps.config.mockReturnValue({ provider: 'fake' });
    deps.research.mockResolvedValue({ sources: [{ url: 'https://example.com/page', title: 'Board' }], findings: 'Never passed as image URL' });
    await searchVisualImages(input, { signal: new AbortController().signal });
    expect(deps.research).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).sources).toEqual([{ url: 'https://example.com/page', title: 'Board' }]);
  });
  it('retrieves each requested component independently and shares the source limit across them', async () => {
    deps.config.mockReturnValue({ provider: 'fake' });
    deps.intent.mockResolvedValue({ query: 'Arduino Uno USB cable', label: 'Arduino Uno e cabo USB', targetTerms: ['Arduino Uno board', 'USB data cable'], targets: [
      { aliases: ['Arduino Uno board'], identifiers: ['Arduino Uno'] },
      { aliases: ['USB data cable'], identifiers: [] },
    ], uncertainty: '' });
    deps.research.mockImplementation(async ({ prompt }: { prompt: string }) => ({ sources: Array.from({ length: 6 }, (_, i) => ({ url: `https://example.com/${prompt.startsWith('Arduino') ? 'board' : 'cable'}-${i}`, title: prompt })), text: '' }));
    await searchVisualImages(input, { signal: new AbortController().signal });
    expect(deps.research.mock.calls.map(([call]) => call.prompt)).toEqual(['Arduino Uno board', 'USB data cable']);
    const posted = JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
    expect(posted.sources.map((source: { url: string }) => source.url)).toEqual([
      'https://example.com/board-0', 'https://example.com/cable-0',
      'https://example.com/board-1', 'https://example.com/cable-1',
      'https://example.com/board-2', 'https://example.com/cable-2',
    ]);
    expect(posted.targets).toHaveLength(2);
  });
  it('keeps independent component sources when another retrieval fails, leaving the gateway to recover missing targets', async () => {
    deps.config.mockReturnValue({ provider: 'fake' });
    deps.intent.mockResolvedValue({ query: 'Arduino Uno USB cable', label: 'Arduino e cabo', targetTerms: ['Arduino Uno', 'USB cable'], targets: [
      { aliases: ['Arduino Uno'], identifiers: [] }, { aliases: ['USB cable'], identifiers: [] },
    ], uncertainty: '' });
    deps.research.mockImplementation(async ({ prompt }: { prompt: string }) => {
      if (prompt === 'USB cable') throw new Error('Unavailable source provider');
      return { sources: [{ url: 'https://example.com/board', title: 'Arduino Uno' }], text: '' };
    });
    await expect(searchVisualImages(input, { signal: new AbortController().signal })).resolves.toEqual([reference]);
    expect(deps.research.mock.calls.map(([call]) => call.prompt)).toEqual(['Arduino Uno', 'USB cable']);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).sources).toEqual([{ url: 'https://example.com/board', title: 'Arduino Uno' }]);
  });
  it('bounds parallel component retrieval and stops before the gateway when their context changes', async () => {
    deps.config.mockReturnValue({ provider: 'fake' });
    deps.intent.mockResolvedValue({ query: 'components', label: 'Componentes', targetTerms: ['component'], targets: Array.from({ length: 8 }, (_, i) => ({ aliases: [`component ${i}`], identifiers: [] })), uncertainty: '' });
    let active = 0, peak = 0;
    deps.research.mockImplementation(async ({ prompt }: { prompt: string }) => {
      active++; peak = Math.max(peak, active);
      await Promise.resolve(); active--;
      return { sources: [{ url: `https://example.com/${prompt.replace(' ', '-')}`, title: prompt }], text: '' };
    });
    await searchVisualImages(input, { signal: new AbortController().signal });
    expect(peak).toBeLessThanOrEqual(3);
    expect(deps.research).toHaveBeenCalledTimes(8);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).sources).toHaveLength(6);
    fetchMock.mockClear(); deps.research.mockClear();
    deps.research.mockImplementation(async () => {
      deps.resolve.mockReturnValue({ text: 'source changed', fingerprint: 'changed' });
      return { sources: [], text: '' };
    });
    await expect(searchVisualImages(input, { signal: new AbortController().signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(deps.research).toHaveBeenCalledTimes(3);
  });
  it('searches the resolved component instead of the raw contextual request and passes object aliases to the gateway', async () => {
    deps.config.mockReturnValue({ provider: 'fake' });
    deps.resolve.mockReturnValue({ text: JSON.stringify({ selected: [{ label: 'Motores, transmissões e estrutura', text: 'Quatro motores de passo, reduções e rolamentos; medir peças antes de dimensionar os braços.' }], project: { name: 'Robô de dois braços' } }), fingerprint: 'motors' });
    deps.intent.mockResolvedValue({ query: 'stepper motor component photo', label: 'Motores de passo', targetTerms: ['stepper motor', 'motor de passo'], uncertainty: 'Modelo não informado na referência.' });
    deps.research.mockResolvedValue({ sources: [{ url: 'https://example.com/motors', title: 'Stepper motors' }], text: '' });
    const onIntent = vi.fn();
    await searchVisualImages({ ...input, text: 'traga-me os motores apontados daqui' }, { signal: new AbortController().signal, onIntent });
    expect(deps.research.mock.calls[0][0].prompt).toContain('stepper motor component photo');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ query: 'stepper motor component photo', targetTerms: ['stepper motor', 'motor de passo'] });
    expect(onIntent).toHaveBeenCalledWith(expect.objectContaining({ label: 'Motores de passo' }));
  });
  it('stops before web research when the selected context changes during intent resolution', async () => {
    deps.config.mockReturnValue({ provider: 'fake' });
    deps.intent.mockImplementation(async () => {
      deps.resolve.mockReturnValue({ text: 'changed', fingerprint: 'changed' });
      return { query: 'stepper motor', label: 'Motor', targetTerms: ['stepper motor'], uncertainty: '' };
    });
    await expect(searchVisualImages(input, { signal: new AbortController().signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(deps.research).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('publishes automatic TypeSafe review status with already assessed references and rejects malformed scores', async () => {
    const assessment = { kind: 'textual', model: 'jev-test', score: 2.8, confidence: .9 };
    const review = { status: 'ranked', assessed: 2, removed: 1 };
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('capabilities') ? { references: true, textualReview: true } : { sessionId: 'session', candidates: [{ ...reference, assessment }], review })));
    const onReview = vi.fn();
    const result = await searchVisualImages(input, { signal: new AbortController().signal, onReview });
    expect(result[0].assessment).toMatchObject({ score: 2.8 });
    expect(onReview).toHaveBeenCalledWith(review);
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('capabilities') ? { references: true } : { sessionId: 'session', candidates: [{ ...reference, assessment: { score: 9, confidence: .9 } }] })));
    await expect(searchVisualImages(input, { signal: new AbortController().signal })).rejects.toThrow(/Invalid textual review/);
  });
  it('rejects response after project or chosen context changes, without publishing it', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('capabilities')) return new Response(JSON.stringify({ references: true }));
      deps.workspace.activeProjectId = 'another';
      return new Response(JSON.stringify({ sessionId: 'session', candidates: [reference] }));
    });
    await expect(searchVisualImages(input, { signal: new AbortController().signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('newer search cancels earlier request and external image URLs are rejected', async () => {
    let release!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    const old = searchVisualImages(input, { signal: new AbortController().signal });
    const caught = old.catch(error => error);
    await searchVisualImages(input, { signal: new AbortController().signal });
    release(new Response(JSON.stringify({ references: true })));
    expect(await caught).toMatchObject({ name: 'AbortError' });
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('capabilities') ? { references: true } : { sessionId: 'session', candidates: [{ ...reference, imageUrl: 'https://untrusted.example/image.png' }] })));
    await expect(searchVisualImages(input, { signal: new AbortController().signal })).rejects.toThrow(/invalid|inválid/i);
  });
});
