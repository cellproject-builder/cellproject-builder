import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { hasActiveAIActions } from '@/ai/actions';
import { torqueDiagram } from '@/visuals/diagram/fixture';
import { DiagramLabelsMissingError } from '@/visuals/diagram/quality';
import { useWorkspaceStore as store } from './store';
import { generateNoteDiagram, noteDiagramSignature } from './noteDiagram';

vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('@/ai/client', () => ({ aiModel: {}, assertAIReady: vi.fn(), callOpts: () => ({ maxOutputTokens: 8000 }) }));

const output = () => {
  const diagram = torqueDiagram();
  diagram.elements = diagram.elements.map(({ nodeId: _nodeId, ...element }) => element);
  return { text: JSON.stringify(diagram), finishReason: 'stop' } as Awaited<ReturnType<typeof generateText>>;
};
let noteId: string;
beforeEach(async () => {
  await store.persist.rehydrate();
  store.setState({ projects: {}, notes: {}, folders: {}, tasks: {}, activeProjectId: null });
  noteId = store.getState().createNote({ title: 'Minha bancada' });
  const note = store.getState().notes[noteId];
  store.getState().updateNote(noteId, { blocks: [{ ...note.blocks[0], text: 'Comparar carga e distância ao eixo.' }] });
  store.getState().createNote({ title: 'Outra nota privada' });
  vi.mocked(generateText).mockReset();
});
afterEach(() => vi.restoreAllMocks());
const request = (useContent = true, signal = new AbortController().signal) => generateNoteDiagram({ noteId, prompt: 'Ilustrar a relação', useContent }, { signal });

it('uses only the authorized note and returns a validated diagram without changing the note', async () => {
  const before = store.getState().notes[noteId];
  vi.mocked(generateText).mockImplementation(async () => { expect(hasActiveAIActions()).toBe(true); return output(); });
  expect((await request()).title).toBe('Carga e distância ao eixo');
  expect(store.getState().notes[noteId]).toBe(before);
  const call = vi.mocked(generateText).mock.calls[0][0];
  expect(call).toMatchObject({ maxRetries: 0 });
  expect(call.prompt).toContain('Minha bancada');
  expect(call.prompt).toContain('Comparar carga e distância');
  expect(call.prompt).not.toContain('Outra nota privada');
  expect(call.system).toContain('untrusted source data');
  expect(call.system).toContain('not physical evidence');
  expect(call.system).toContain('EXPLANATORY NOMENCLATURE');
  expect(hasActiveAIActions()).toBe(false);
});
it('checks the contextual request guard immediately before calling the provider', async () => {
  const beforeRequest = vi.fn(async () => { throw new Error('chatContextModelChanged'); });
  await expect(generateNoteDiagram({ noteId, prompt: 'Ilustrar', useContent: true }, { signal: new AbortController().signal, beforeRequest })).rejects.toThrow('chatContextModelChanged');
  expect(beforeRequest).toHaveBeenCalledTimes(1);
  expect(generateText).not.toHaveBeenCalled();
  expect(store.getState().notes[noteId].canvas).toBeUndefined();
});
it('refuses an unlabeled illustration without changing the note or repairing the response', async () => {
  const before = store.getState().notes[noteId], response = output(), diagram = JSON.parse(response.text);
  diagram.elements = diagram.elements.filter((element: { type: string }) => element.type !== 'text');
  diagram.bindings = diagram.bindings.filter((binding: { elementId: string }) => binding.elementId !== 'result');
  vi.mocked(generateText).mockResolvedValue({ ...response, text: JSON.stringify(diagram) });
  await expect(request()).rejects.toBeInstanceOf(DiagramLabelsMissingError);
  expect(store.getState().notes[noteId]).toBe(before);
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(hasActiveAIActions()).toBe(false);
});

it('can omit all note content and ignores changes to content that was not shared', async () => {
  vi.mocked(generateText).mockImplementation(async () => {
    store.getState().updateNote(noteId, { title: 'Mudou sem ser compartilhado' });
    return output();
  });
  await expect(request(false)).resolves.toHaveProperty('version', 1);
  const prompt = vi.mocked(generateText).mock.calls[0][0].prompt;
  expect(prompt).not.toContain('Minha bancada');
  expect(prompt).not.toContain('Comparar carga');
});

it('rejects a result when shared content changes even if restored before the response', async () => {
  const original = store.getState().notes[noteId].title;
  vi.mocked(generateText).mockImplementation(async () => {
    store.getState().updateNote(noteId, { title: 'Outro contexto' });
    store.getState().updateNote(noteId, { title: original });
    return output();
  });
  await expect(request()).rejects.toThrow('noteDiagramContextChanged');
  expect(hasActiveAIActions()).toBe(false);
});

it.each(['trash', 'delete', 'replace'] as const)('rejects a note that is %s during generation', async (change) => {
  vi.mocked(generateText).mockImplementation(async () => {
    if (change === 'trash') store.getState().trashNote(noteId);
    else if (change === 'delete') store.setState(state => ({ notes: Object.fromEntries(Object.entries(state.notes).filter(([id]) => id !== noteId)) }));
    else store.setState(state => ({ notes: { ...state.notes, [noteId]: { ...state.notes[noteId], createdAt: state.notes[noteId].createdAt + 1 } } }));
    return output();
  });
  await expect(request()).rejects.toThrow('noteDiagramContextChanged');
});

it('omits image pixels and ignores layout changes while retaining semantic canvas content', async () => {
  const canvas = { version: 1, width: 1000, height: 700, paper: 'plain', strokes: [], items: [
    { id: 'label', kind: 'text', x: 10, y: 10, width: 120, height: 40, text: 'Braço de teste', color: '#fff', fontSize: 16 },
    { id: 'image', kind: 'image', x: 20, y: 60, width: 120, height: 80, label: 'Servo MG90S', src: 'data:image/png;base64,PRIVATE_PIXELS' },
  ] };
  store.setState(state => ({ notes: { ...state.notes, [noteId]: { ...state.notes[noteId], canvas } as typeof state.notes[string] } }));
  const signature = noteDiagramSignature(noteId, true);
  vi.mocked(generateText).mockImplementation(async () => {
    store.setState(state => ({ notes: { ...state.notes, [noteId]: { ...state.notes[noteId], canvas: { ...canvas, width: 2000, paper: 'grid', items: canvas.items.map(item => ({ ...item, x: 400, width: 300 })) } } as typeof state.notes[string] } }));
    expect(noteDiagramSignature(noteId, true)).toBe(signature);
    return output();
  });
  await request();
  const prompt = vi.mocked(generateText).mock.calls[0][0].prompt;
  expect(prompt).toContain('Braço de teste');
  expect(prompt).toContain('Servo MG90S');
  expect(prompt).not.toContain('PRIVATE_PIXELS');
  expect(prompt).not.toContain('data:image');
});

it('shares a diagram’s semantic labels and current parameters, without its geometry or project IDs', async () => {
  const diagram = torqueDiagram('project-node-secret');
  const canvas = { version: 1, width: 1000, height: 700, paper: 'plain', strokes: [], items: [
    { id: 'diagram', kind: 'diagram', x: 0, y: 0, width: 460, height: 300, diagram, values: { mass: .4 } },
  ] };
  store.setState(state => ({ notes: { ...state.notes, [noteId]: { ...state.notes[noteId], canvas } as typeof state.notes[string] } }));
  vi.mocked(generateText).mockResolvedValue(output());
  await request();
  const call = vi.mocked(generateText).mock.calls[0][0];
  expect(call.prompt).toContain('Carga e distância ao eixo');
  expect(call.prompt).toContain('0.4');
  expect(call.prompt).not.toContain('project-node-secret');
  expect(call.prompt).not.toContain('strokeWidth');
});

it('rejects changed canvas labels and cancels the in-flight provider call', async () => {
  const canvas = { version: 1, width: 1000, height: 700, paper: 'plain', strokes: [], items: [
    { id: 'image', kind: 'image', x: 20, y: 60, width: 120, height: 80, label: 'Servo MG90S', src: 'data:image/png;base64,PRIVATE_PIXELS' },
  ] };
  store.setState(state => ({ notes: { ...state.notes, [noteId]: { ...state.notes[noteId], canvas } as typeof state.notes[string] } }));
  vi.mocked(generateText).mockImplementation(async call => {
    store.setState(state => ({ notes: { ...state.notes, [noteId]: { ...state.notes[noteId], canvas: { ...canvas, items: canvas.items.map(item => ({ ...item, label: 'Outro servo' })) } } as typeof state.notes[string] } }));
    expect(call.abortSignal?.aborted).toBe(true);
    return output();
  });
  await expect(request()).rejects.toThrow('noteDiagramContextChanged');
});

it.each(['script', 'node', 'truncated'] as const)('refuses %s output with no paid repair retry', async (kind) => {
  const response = { ...output() };
  if (kind === 'script') response.text = '{"jsx":"<script>bad</script>"}';
  if (kind === 'node') response.text = JSON.stringify(torqueDiagram('invented-node'));
  if (kind === 'truncated') response.finishReason = 'length';
  vi.mocked(generateText).mockResolvedValue(response);
  await expect(request()).rejects.toThrow(kind === 'truncated' ? 'noteDiagramIncomplete' : 'noteDiagramInvalid');
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(hasActiveAIActions()).toBe(false);
});

it('does not issue a request after cancellation or with an empty prompt', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(request(true, controller.signal)).rejects.toThrow();
  await expect(generateNoteDiagram({ noteId, prompt: ' ', useContent: true }, { signal: new AbortController().signal })).rejects.toThrow('noteDiagramPromptRequired');
  expect(generateText).not.toHaveBeenCalled();
  expect(hasActiveAIActions()).toBe(false);
});
