import { beforeEach, expect, it, vi } from 'vitest';
import { generateObject, generateText } from 'ai';
import { torqueDiagram } from '@/visuals/diagram/fixture';
import { DiagramLabelsMissingError } from '@/visuals/diagram/quality';
import { boardAISignature, generateBoardItem, searchBoardImages, importBoardReference } from './generation';

const harness = vi.hoisted(() => ({ state: { boards: {} as Record<string, any>, activeBoardId: 'board' as string | null }, listeners: new Set<() => void>() }));
vi.mock('@/workspace/store', () => ({ useWorkspaceStore: { getState: () => harness.state, subscribe: (fn: () => void) => { harness.listeners.add(fn); return () => harness.listeners.delete(fn); } } }));
vi.mock('ai', () => ({ generateText: vi.fn(), generateObject: vi.fn() }));
vi.mock('@/ai/client', () => ({ aiModel: {}, assertAIReady: vi.fn(), callOpts: () => ({ maxOutputTokens: 8000 }) }));
vi.mock('@/config/store', () => ({ getActiveConfig: () => null }));
vi.mock('@/ai/research', () => ({ groundedText: vi.fn() }));
vi.mock('@/cloud/runtime', () => ({ sessionAwareFetch: vi.fn(), getCloudRuntime: () => null }));
vi.mock('@/workspace/noteImages', () => ({ importNoteImage: vi.fn(async () => ({ src: 'data:image/png;base64,iVBORw0KGgoA', label: 'photo', width: 300, height: 200 })) }));
import { sessionAwareFetch } from '@/cloud/runtime';
import { hasActiveDataIngestions } from '@/cloud/activity';

const update = (mutate: (board: any) => any) => { harness.state.boards.board = mutate(harness.state.boards.board); harness.listeners.forEach(fn => fn()); };
const diagram = () => { const value = torqueDiagram(); value.elements = value.elements.map(({ nodeId: _id, ...element }) => element); return value; };
const output = () => ({ text: JSON.stringify(diagram()), finishReason: 'stop' }) as Awaited<ReturnType<typeof generateText>>;
const request = (useContent = true, kind: 'diagram' | 'model' | 'refine' = 'diagram') => generateBoardItem({ boardId: 'board', kind, prompt: 'Ilustrar relação', useContent, ...(kind === 'refine' ? { itemId: 'card' } : {}) }, { signal: new AbortController().signal });
beforeEach(() => {
  harness.state.activeBoardId = 'board'; harness.state.boards = { board: { id: 'board', title: 'Minha oficina', createdAt: 1, archived: false, document: { version: 1, viewport: { x: 0, y: 0, zoom: 1 }, edges: [], items: [
    { id: 'card', kind: 'card', x: 10, y: 20, width: 300, height: 200, text: 'Comparar torque e carga', color: '#a78bfa', fontSize: 16 },
    { id: 'image', kind: 'image', x: 50, y: 20, width: 300, height: 200, label: 'Servo MG90S', src: 'data:image/png;base64,PRIVATE_PIXELS' },
  ] } }, other: { title: 'SEGREDO DE OUTRO QUADRO' } };
  vi.mocked(generateText).mockReset().mockResolvedValue(output()); vi.mocked(generateObject).mockReset(); vi.mocked(sessionAwareFetch).mockReset();
});

it('generates a validated transparent diagram from only this board without mutating it', async () => {
  const before = JSON.stringify(harness.state.boards);
  const item = await request();
  expect(item).toMatchObject({ kind: 'diagram', x: 0, y: 0, diagram: { version: 1 } });
  const call = vi.mocked(generateText).mock.calls[0][0];
  expect(call.prompt).toContain('Minha oficina'); expect(call.prompt).toContain('Comparar torque');
  expect(call.prompt).not.toContain('PRIVATE_PIXELS'); expect(call.prompt).not.toContain('SEGREDO');
  expect(JSON.stringify(harness.state.boards)).toBe(before); expect(call.maxRetries).toBe(0);
  expect(call.system).toContain('EXPLANATORY NOMENCLATURE');
});
it('refuses an unlabeled illustration without mutating the board or repairing the response', async () => {
  const before = JSON.stringify(harness.state.boards), value = diagram();
  value.elements = value.elements.filter(element => element.type !== 'text');
  value.bindings = value.bindings.filter(binding => binding.elementId !== 'result');
  vi.mocked(generateText).mockResolvedValue({ ...output(), text: JSON.stringify(value) });
  await expect(request()).rejects.toBeInstanceOf(DiagramLabelsMissingError);
  expect(JSON.stringify(harness.state.boards)).toBe(before);
  expect(generateText).toHaveBeenCalledTimes(1);
});
it('ignores layout and drawing changes but rejects semantic changes, including changing back', async () => {
  const signature = boardAISignature('board', true);
  update(board => ({ ...board, document: { ...board.document, viewport: { x: 400, y: 500, zoom: 2 }, items: board.document.items.map((item: any) => ({ ...item, x: 900, width: 500 })) } }));
  expect(boardAISignature('board', true)).toBe(signature);
  vi.mocked(generateText).mockImplementation(async call => {
    update(board => ({ ...board, title: 'Mudou' })); update(board => ({ ...board, title: 'Minha oficina' }));
    expect(call.abortSignal?.aborted).toBe(true); return output();
  });
  await expect(request()).rejects.toThrow('boardContextChanged');
});
it('can omit board content while always retaining a refinement target', async () => {
  vi.mocked(generateText).mockResolvedValue({ text: '## Torque\nCarga revisada', finishReason: 'stop' } as Awaited<ReturnType<typeof generateText>>);
  const item = await request(false, 'refine');
  expect(item).toMatchObject({ id: 'card', kind: 'card', text: '## Torque\nCarga revisada', x: 10, width: 300 });
  const prompt = vi.mocked(generateText).mock.calls[0][0].prompt;
  expect(prompt).toContain('Comparar torque'); expect(prompt).not.toContain('Minha oficina'); expect(prompt).not.toContain('Servo MG90S');
});
it('supports native custom geometry with the existing model schema and guide', async () => {
  vi.mocked(generateObject).mockResolvedValue({ object: { version: 1, label: 'Suporte ilustrativo', objects: [{ id: 'support', type: 'custom', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#aaaaaa', geometry: { kind: 'extrude', points: [[0, 0], [2, 0], [2, 2], [0, 2]], holes: [], depth: 1, bevel: 0 } }] }, finishReason: 'stop' } as never);
  const item = await request(true, 'model'); expect(item).toMatchObject({ kind: 'model', scene: { objects: [expect.objectContaining({ type: 'custom' })] } });
  expect(vi.mocked(generateObject).mock.calls[0][0].system).toContain('CUSTOM GEOMETRY');
});
it.each(['invalid', 'node', 'truncated'])('rejects %s diagrams with no repair request', async kind => {
  const result = { ...output() };
  if (kind === 'invalid') result.text = '{"jsx":"<script/>"}';
  if (kind === 'node') result.text = JSON.stringify(torqueDiagram('invented-plan-id'));
  if (kind === 'truncated') result.finishReason = 'length';
  vi.mocked(generateText).mockResolvedValue(result);
  await expect(request()).rejects.toThrow(kind === 'truncated' ? 'boardGenerationIncomplete' : 'boardGenerationInvalid'); expect(generateText).toHaveBeenCalledTimes(1);
});
it('rejects switching boards and missing references without a late apply', async () => {
  vi.mocked(generateText).mockImplementation(async () => { harness.state.activeBoardId = 'other'; harness.listeners.forEach(fn => fn()); return output(); });
  await expect(request()).rejects.toThrow('boardContextChanged');
  harness.state.activeBoardId = 'board';
  await expect(generateBoardItem({ boardId: 'board', kind: 'diagram', prompt: 'x', useContent: false, referenceIds: ['gone'] }, { signal: new AbortController().signal })).rejects.toThrow('boardReferenceMissing');
});
it('searches a separate registered board scope and only accepts gateway image URLs', async () => {
  const reference = { id: 'candidate', sessionId: 'session', title: 'Servo', description: '', imageUrl: '/api/visuals/media?sessionId=session&candidateId=candidate', sourcePageUrl: 'https://example.com/servo', width: 300, height: 200, credit: null, license: null };
  vi.mocked(sessionAwareFetch).mockImplementation(async url => new Response(JSON.stringify(String(url).endsWith('capabilities') ? { references: true } : { sessionId: 'session', candidates: [reference] })));
  const results = await searchBoardImages({ boardId: 'board', prompt: 'Servo MG90S', useContent: true }, { signal: new AbortController().signal });
  expect(results).toHaveLength(1);
  const body = JSON.parse(String(vi.mocked(sessionAwareFetch).mock.calls[1][1]?.body)); expect(body.projectId).toBe('board:board'); expect(body.context).toContain('Minha oficina');
  vi.mocked(sessionAwareFetch).mockResolvedValue(new Response(JSON.stringify({ sessionId: 'session', candidates: [{ ...reference, imageUrl: 'https://untrusted.example/x' }] })));
  await expect(searchBoardImages({ boardId: 'board', prompt: 'Servo', useContent: true }, { signal: new AbortController().signal })).rejects.toThrow();
});
it('refuses unregistered media before making a fetch', async () => {
  await expect(importBoardReference({ boardId: 'board', reference: { id: 'x', imageUrl: 'https://evil.example/x' } as never }, { signal: new AbortController().signal })).rejects.toThrow('boardImageInvalid');
  expect(sessionAwareFetch).not.toHaveBeenCalled();
});
it('bounds the complete serialized context even for a full board of detailed models', async () => {
  const objects = Array.from({ length: 128 }, (_, index) => ({ id: `Peça_${index}_${'x'.repeat(70)}`, type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }));
  update(board => ({ ...board, document: { ...board.document, items: Array.from({ length: 200 }, (_, index) => ({ id: `model-${index}`, kind: 'model', scene: { version: 1, label: 'Conjunto de teste', objects }, x: 0, y: 0, width: 600, height: 440 })) } }));
  await request();
  const prompt = JSON.parse(vi.mocked(generateText).mock.calls[0][0].prompt as string);
  expect(new TextEncoder().encode(JSON.stringify(prompt.context)).byteLength).toBeLessThanOrEqual(24_000);
  expect(prompt.context.truncated).toBe(true); expect(prompt.context.board.items[0]).toHaveProperty('objectCount', 128);
  expect(prompt.context.board.items[0].partNames).toHaveLength(8);
});
it('invalidates full text and model semantics beyond the shortened context', () => {
  update(board => ({ ...board, document: { ...board.document, items: [{ ...board.document.items[0], text: `${'a'.repeat(9000)}original` }] } }));
  const original = boardAISignature('board', true);
  update(board => ({ ...board, document: { ...board.document, items: [{ ...board.document.items[0], text: `${'a'.repeat(9000)}changed` }] } }));
  expect(boardAISignature('board', true)).not.toBe(original);
});
it('tracks image ingestion for the complete import lifecycle and always releases it', async () => {
  vi.mocked(sessionAwareFetch).mockImplementation(async () => { expect(hasActiveDataIngestions()).toBe(true); return new Response(new Blob(['pixels'], { type: 'image/png' })); });
  const reference = { id: 'ref', sessionId: 's', title: 'Photo', imageUrl: '/api/visuals/media?sessionId=s&candidateId=ref' } as never;
  const item = await importBoardReference({ boardId: 'board', reference }, { signal: new AbortController().signal });
  expect(item).toMatchObject({ kind: 'image', label: 'Photo' }); expect(hasActiveDataIngestions()).toBe(false);
  vi.mocked(sessionAwareFetch).mockRejectedValue(new Error('offline'));
  await expect(importBoardReference({ boardId: 'board', reference }, { signal: new AbortController().signal })).rejects.toThrow('offline'); expect(hasActiveDataIngestions()).toBe(false);
});
