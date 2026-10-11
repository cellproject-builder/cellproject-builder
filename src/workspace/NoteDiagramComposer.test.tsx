import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { useConfigStore } from '@/config/store';
import { torqueDiagram } from '@/visuals/diagram/fixture';
import { DiagramLabelsMissingError } from '@/visuals/diagram/quality';
import { useWorkspaceStore as store } from './store';
import { NoteDiagramComposer } from './NoteDiagramComposer';
import * as noteDiagram from './noteDiagram';

vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('@/ai/client', () => ({ aiModel: {}, assertAIReady: vi.fn(), callOpts: () => ({ maxOutputTokens: 8000 }) }));
let root: Root, host: HTMLDivElement, noteId: string;
const inserted = vi.fn(), closed = vi.fn();
const response = () => {
  const diagram = torqueDiagram(); diagram.elements = diagram.elements.map(({ nodeId: _id, ...element }) => element);
  return { text: JSON.stringify(diagram), finishReason: 'stop' } as Awaited<ReturnType<typeof generateText>>;
};
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await store.persist.rehydrate();
  store.setState({ projects: {}, notes: {}, folders: {}, tasks: {} });
  useConfigStore.setState({ activeProvider: 'openrouter', providers: { openrouter: { apiKey: 'test-key', mainModel: 'test', kbModel: 'test' } } });
  noteId = store.getState().createNote({ title: 'Minha nota' });
  inserted.mockReset(); closed.mockReset(); vi.mocked(generateText).mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<NoteDiagramComposer noteId={noteId} onInsert={inserted} onClose={closed} />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
function prompt(value = 'Comparar massa e distância') {
  act(() => Simulate.change(host.querySelector('textarea')!, { target: { value } } as never));
}
async function submit() { await act(async () => Simulate.submit(host.querySelector('form')!)); }

it('previews an isolated result and only inserts it after explicit confirmation', async () => {
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('[type="checkbox"]')!.checked).toBe(true);
  vi.mocked(generateText).mockResolvedValue(response()); prompt(); await submit();
  expect(inserted).not.toHaveBeenCalled();
  expect(host.querySelector('svg[aria-label="Carga e distância ao eixo"]')).not.toBeNull();
  act(() => Simulate.change(host.querySelector('[aria-label="Carga"]')!, { target: { value: '.4' } } as never));
  act(() => Simulate.click(host.querySelector('[data-note-diagram-insert]')!));
  expect(inserted.mock.calls[0][0].parameters.find((p: { id: string }) => p.id === 'mass').value).toBe(.4);
  expect(closed).toHaveBeenCalledTimes(1);
});

it('makes a completed result unavailable when its shared note context changes', async () => {
  vi.mocked(generateText).mockResolvedValue(response()); prompt(); await submit();
  act(() => { store.getState().updateNote(noteId, { title: 'Contexto novo' }); });
  expect(host.querySelector<HTMLButtonElement>('[data-note-diagram-insert]')?.disabled).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('nota mudou');
  act(() => Simulate.click(host.querySelector('[data-note-diagram-insert]')!));
  expect(inserted).not.toHaveBeenCalled();
});

it('cancels on Escape and ignores a late provider response', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof generateText>>) => void;
  vi.mocked(generateText).mockReturnValue(new Promise(done => { resolve = done; }));
  prompt(); await submit();
  const signal = vi.mocked(generateText).mock.calls[0][0].abortSignal!;
  act(() => host.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(signal.aborted).toBe(true); expect(closed).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(response()); await Promise.resolve(); });
  expect(host.querySelector('[data-note-diagram-insert]')).toBeNull();
  expect(inserted).not.toHaveBeenCalled();
});

it('aborts and discards the result when the selected note changes', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof generateText>>) => void;
  vi.mocked(generateText).mockReturnValue(new Promise(done => { resolve = done; }));
  prompt(); await submit();
  const signal = vi.mocked(generateText).mock.calls[0][0].abortSignal!;
  const nextId = store.getState().createNote({ title: 'Próxima nota' });
  await act(async () => root.render(<NoteDiagramComposer noteId={nextId} onInsert={inserted} onClose={closed} />));
  expect(signal.aborted).toBe(true);
  await act(async () => { resolve(response()); await Promise.resolve(); });
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
  expect(host.querySelector('[data-note-diagram-insert]')).toBeNull();
});

it('omits note context when its compact opt-in checkbox is unchecked', async () => {
  vi.mocked(generateText).mockResolvedValue(response());
  act(() => Simulate.change(host.querySelector('[type="checkbox"]')!, { target: { checked: false } } as never));
  prompt('Fluxo abstrato'); await submit();
  expect(vi.mocked(generateText).mock.calls[0][0].prompt).not.toContain('Minha nota');
});

it.each([false, true])('explains missing diagram labels and retains the note request for retry (english=%s)', async english => {
  await act(async () => root.render(<NoteDiagramComposer noteId={noteId} onInsert={inserted} onClose={closed} english={english} />));
  const generate = vi.spyOn(noteDiagram, 'generateNoteDiagram').mockRejectedValueOnce(new DiagramLabelsMissingError());
  vi.mocked(generateText).mockResolvedValue(response());
  act(() => Simulate.change(host.querySelector('[type="checkbox"]')!, { target: { checked: false } } as never));
  prompt('Nomear as peças e conexões'); await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(english
    ? 'The drawing came without visible names or labels. Generate again to get an explanatory diagram.'
    : 'O desenho veio sem nomes ou legendas visíveis. Gere novamente para obter um diagrama explicativo.');
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Nomear as peças e conexões');
  expect(host.querySelector<HTMLInputElement>('[type="checkbox"]')!.checked).toBe(false);
  expect(host.querySelector('[data-note-diagram-insert]')).toBeNull(); expect(inserted).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled();
  await submit();
  expect(generate.mock.calls.map(([input]) => input)).toEqual([
    { noteId, prompt: 'Nomear as peças e conexões', useContent: false },
    { noteId, prompt: 'Nomear as peças e conexões', useContent: false },
  ]);
  expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.querySelector('[data-note-diagram-insert]')).not.toBeNull();
});

it('retains a failed insertion preview so the user does not lose the generated diagram', async () => {
  vi.mocked(generateText).mockResolvedValue(response()); prompt(); await submit();
  inserted.mockImplementationOnce(() => { throw new Error('quota'); });
  act(() => Simulate.click(host.querySelector('[data-note-diagram-insert]')!));
  expect(closed).not.toHaveBeenCalled();
  expect(host.querySelector('svg[aria-label="Carga e distância ao eixo"]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível inserir');
});
