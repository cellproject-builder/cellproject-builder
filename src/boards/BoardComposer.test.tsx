import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConfigStore } from '@/config/store';
import { useWorkspaceStore as store } from '@/workspace/store';
import { torqueDiagram } from '@/visuals/diagram/fixture';
import { DiagramLabelsMissingError } from '@/visuals/diagram/quality';
import { BoardComposer } from './BoardComposer';
import { generateBoardItem, searchBoardImages, importBoardReference } from './generation';
import type { BoardItem } from './model';
vi.mock('./generation', async original => {
  const actual = await original<typeof import('./generation')>();
  return { ...actual, generateBoardItem: vi.fn(), searchBoardImages: vi.fn(), importBoardReference: vi.fn() };
});
vi.mock('./BoardModelPreview', () => ({ BoardModelPreview: () => <div>3D preview</div> }));
let root: Root, host: HTMLDivElement, boardId: string;
const insert = vi.fn(), close = vi.fn();
const result = (): BoardItem => { const diagram = torqueDiagram(); diagram.elements = diagram.elements.map(({ nodeId: _nodeId, ...element }) => element); return { id: 'generated', kind: 'diagram', x: 0, y: 0, width: 600, height: 440, diagram, values: {} }; };
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await store.persist.rehydrate(); store.setState({ boards: {}, activeBoardId: null }); boardId = store.getState().createBoard('Ideias');
  const board = store.getState().boards[boardId];
  store.getState().updateBoard(boardId, { document: { ...board.document, items: [{ id: 'card', kind: 'card', x: 5, y: 6, width: 300, height: 200, text: 'Comparar torque', color: '#a78bfa', fontSize: 16 }] } });
  useConfigStore.setState({ activeProvider: 'openrouter', providers: { openrouter: { apiKey: 'test', mainModel: 'test', kbModel: 'test' } } });
  insert.mockReset(); close.mockReset(); vi.mocked(generateBoardItem).mockReset().mockResolvedValue(result()); vi.mocked(searchBoardImages).mockReset(); vi.mocked(importBoardReference).mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<BoardComposer boardId={boardId} kind="diagram" onInsert={insert} onClose={close} />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const prompt = (value = 'Mostrar carga e distância') => act(() => Simulate.change(host.querySelector('textarea')!, { target: { value } } as never));
const submit = () => act(async () => { Simulate.submit(host.querySelector('form')!); });

it('previews a diagram before inserting, preserving its explored parameter values', async () => {
  expect(host.querySelector('[aria-label="Minimizar: Diagrama"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Fechar: Diagrama"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Minimizar estúdio 3D"]')).toBeNull();
  prompt(); await submit(); expect(insert).not.toHaveBeenCalled();
  expect(host.querySelector('svg[aria-label="Carga e distância ao eixo"]')).not.toBeNull();
  act(() => Simulate.change(host.querySelector('[aria-label="Carga"]')!, { target: { value: '.4' } } as never));
  act(() => Simulate.click(host.querySelector('[data-board-insert]')!));
  expect(insert.mock.calls[0][0]).toMatchObject({ kind: 'diagram', values: { mass: .4 } }); expect(close).toHaveBeenCalledOnce();
});
it('references only items of the current board through @', async () => {
  prompt('@');
  const option = host.querySelector('[data-board-reference="card"]'); expect(option).not.toBeNull();
  act(() => Simulate.click(option!)); prompt('Desenhar essa ideia'); await submit();
  expect(generateBoardItem).toHaveBeenCalledWith(expect.objectContaining({ boardId, referenceIds: ['card'] }), expect.anything());
});
it.each([false, true])('explains missing diagram labels and retains the prompt and board references for retry (english=%s)', async english => {
  await act(async () => root.render(<BoardComposer boardId={boardId} kind="diagram" onInsert={insert} onClose={close} english={english} />));
  prompt('@'); act(() => Simulate.click(host.querySelector('[data-board-reference="card"]')!));
  act(() => Simulate.change(host.querySelector('[type="checkbox"]')!, { target: { checked: false } } as never));
  prompt('Nomear as peças e conexões');
  vi.mocked(generateBoardItem).mockRejectedValueOnce(new DiagramLabelsMissingError());
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(english
    ? 'The drawing came without visible names or labels. Generate again to get an explanatory diagram.'
    : 'O desenho veio sem nomes ou legendas visíveis. Gere novamente para obter um diagrama explicativo.');
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Nomear as peças e conexões');
  expect(host.querySelector<HTMLInputElement>('[type="checkbox"]')!.checked).toBe(false);
  expect(host.querySelector('.board-reference-chips')?.textContent).toContain('Comparar torque');
  expect(host.querySelector('[data-board-insert]')).toBeNull(); expect(insert).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  await submit();
  expect(vi.mocked(generateBoardItem).mock.calls.map(([input]) => input)).toEqual([
    { boardId, prompt: 'Nomear as peças e conexões', useContent: false, referenceIds: ['card'], kind: 'diagram' },
    { boardId, prompt: 'Nomear as peças e conexões', useContent: false, referenceIds: ['card'], kind: 'diagram' },
  ]);
  expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.querySelector('[data-board-insert]')).not.toBeNull();
});
it('minimizes without aborting generation and restores the completed preview', async () => {
  let resolve!: (item: BoardItem) => void;
  vi.mocked(generateBoardItem).mockReturnValue(new Promise(done => { resolve = done; }));
  prompt(); await submit(); const signal = vi.mocked(generateBoardItem).mock.calls[0][1].signal;
  act(() => Simulate.click(host.querySelector('.visual-popup-header button')!));
  expect(host.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(true); expect(signal.aborted).toBe(false);
  await act(async () => { resolve(result()); await Promise.resolve(); });
  act(() => Simulate.click(host.querySelector('[data-board-restore]')!));
  expect(host.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(false); expect(host.querySelector('[data-board-insert]')).not.toBeNull();
});
it('invalidates a preview on shared semantic edits, but ignores position changes', async () => {
  prompt(); await submit();
  act(() => { const board = store.getState().boards[boardId]; store.getState().updateBoard(boardId, { document: { ...board.document, items: board.document.items.map(item => ({ ...item, x: 800 })) } }); });
  expect(host.querySelector<HTMLButtonElement>('[data-board-insert]')!.disabled).toBe(false);
  act(() => { store.getState().updateBoard(boardId, { title: 'Outro assunto' }); });
  expect(host.querySelector<HTMLButtonElement>('[data-board-insert]')!.disabled).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('quadro mudou');
});
it('cancels on Escape and never applies a late response', async () => {
  let resolve!: (item: BoardItem) => void;
  vi.mocked(generateBoardItem).mockReturnValue(new Promise(done => { resolve = done; })); prompt(); await submit();
  const signal = vi.mocked(generateBoardItem).mock.calls[0][1].signal;
  act(() => host.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(signal.aborted).toBe(true); expect(close).toHaveBeenCalledOnce();
  await act(async () => { resolve(result()); await Promise.resolve(); }); expect(insert).not.toHaveBeenCalled();
});
it('chooses a returned image and imports it through the validated raster service', async () => {
  const reference = { id: 'ref', title: 'Servo', imageUrl: '/api/visuals/media?sessionId=s&candidateId=ref', sourcePageUrl: 'https://example.com/servo', sessionId: 's', description: '', credit: null, license: null, width: 300, height: 200 };
  vi.mocked(searchBoardImages).mockResolvedValue([reference]);
  vi.mocked(importBoardReference).mockResolvedValue({ id: 'photo', kind: 'image', x: 0, y: 0, width: 300, height: 200, src: 'data:image/webp;base64,AA==', label: 'Servo' });
  await act(async () => root.render(<BoardComposer boardId={boardId} kind="image" onInsert={insert} onClose={close} />)); prompt('servo'); await submit();
  expect(insert).not.toHaveBeenCalled(); act(() => Simulate.click(host.querySelector('[data-board-image="ref"]')!));
  await act(async () => { await Promise.resolve(); }); expect(importBoardReference).toHaveBeenCalledWith({ boardId, reference }, expect.anything());
  expect(insert.mock.calls[0][0]).toMatchObject({ kind: 'image', label: 'Servo' });
});
it('applies a text refinement to the original card while preserving moves made after preview', async () => {
  vi.mocked(generateBoardItem).mockResolvedValue({ id: 'card', kind: 'card', x: 5, y: 6, width: 300, height: 200, text: 'Texto aprimorado', color: '#a78bfa', fontSize: 16 });
  await act(async () => root.render(<BoardComposer boardId={boardId} kind="refine" itemId="card" onInsert={insert} onClose={close} />)); prompt('Melhore'); await submit();
  act(() => { const board = store.getState().boards[boardId]; store.getState().updateBoard(boardId, { document: { ...board.document, items: board.document.items.map(item => ({ ...item, x: 900, width: 420 })) } }); });
  act(() => Simulate.click(host.querySelector('[data-board-insert]')!));
  expect(insert.mock.calls[0][0]).toMatchObject({ id: 'card', x: 900, width: 420, text: 'Texto aprimorado' });
});
