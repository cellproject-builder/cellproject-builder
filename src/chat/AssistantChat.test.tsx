import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConfigStore } from '@/config/store';
import { useLocaleStore } from '@/i18n';
import { runAssistant } from '@/ai/assistant';
import { useGraphStore } from '@/store';
import { AssistantChat } from './AssistantChat';
import { AssistantChatDockProvider, PlannerChatDock } from './AssistantChatDock';
import { flushChatPersistence, useChatStore } from './store';
import { flushWorkspacePersistence, useWorkspaceStore } from '@/workspace/store';
import { requestChatReferences, useChatReferenceHandoff } from '@/references/chatHandoff';
import { addChatImageReference } from '@/visuals/controller';
import { useVisualPopupStore } from '@/visuals/ui/uiStore';
import type { ImageReference, VisualArtifact } from '@/visuals/types';
import { buildDemoProject } from '@/data/demoProject';
import { capturePlanner, initializeWorkspace, openPlanner } from '@/workspace/planner';
import { applyPlanStructure, planRevision } from '@/ai/planStructure';

vi.mock('@/ai/assistant', () => ({ runAssistant: vi.fn() }));
vi.mock('@/visuals/controller', () => ({ addChatImageReference: vi.fn() }));
const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => viewport.mobile }));
let host: HTMLDivElement;
let root: Root;

it('shows audit and undo when a structural batch applied but saving failed', async () => {
  initializeWorkspace();
  const projectId = useWorkspaceStore.getState().createProject('Save failure QA'); openPlanner(projectId);
  useGraphStore.getState().loadDemoProject();
  const before = useGraphStore.getState().project!;
  const result = applyPlanStructure({ projectId, revision: planRevision(before), reason: 'Estudar o controle', operations: [{ kind: 'add', key: 'control', parentId: before.rootId, name: 'Controle PWM', nodeKind: 'passo', oQue: 'Programar', porQue: 'Controlar o servo' }] });
  useChatStore.setState({ messages: [{ id: 'applied', role: 'assistant', text: 'Aplicado, mas houve falha ao salvar.', createdAt: Date.now(), actions: [{ id: 'a', name: 'planner_structure', action: 'planner_structure', status: 'error', result: { applied: true, saved: false, result } }] }] });
  act(() => root.render(<PlannerHarness />));
  expect(host.querySelector('.dd-chat-plan-changes')?.textContent).toContain('Controle PWM');
  expect(host.querySelector('.dd-chat-plan-changes')?.textContent).toMatch(/gravação|salv/);
  const retry = [...host.querySelectorAll<HTMLButtonElement>('.dd-chat-plan-changes button')].find(button => button.textContent === 'Tentar salvar novamente')!;
  await act(async () => { Simulate.click(retry); await flushWorkspacePersistence(); });
  expect(host.querySelector('.dd-chat-plan-changes')?.textContent).not.toContain('a gravação falhou');
  const undo = [...host.querySelectorAll<HTMLButtonElement>('.dd-chat-plan-changes button')].find(button => button.textContent === 'Desfazer estrutura')!;
  expect(undo.disabled).toBe(false);
  await act(async () => { Simulate.click(undo); await flushChatPersistence(); });
  expect(useGraphStore.getState().project).toBe(before);
  expect(host.querySelector('.dd-chat-plan-changes')?.textContent).toContain('Desfeito');
  await act(async () => { await flushChatPersistence(); await useChatStore.persist.rehydrate(); });
  const action = useChatStore.getState().messages[0].actions![0];
  expect(action.result).toMatchObject({ applied: true, result: { undone: true } });
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(runAssistant).mockReset();
  vi.mocked(addChatImageReference).mockReset();
  viewport.mobile = false;
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  await useConfigStore.persist.rehydrate();
  await useChatStore.persist.rehydrate();
  await useWorkspaceStore.persist.rehydrate();
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null });
  useChatReferenceHandoff.setState({ pending: null });
  useVisualPopupStore.setState({ searchOpen: false, modelOpen: false, modelBase: null });
  useLocaleStore.setState({ locale: 'pt-BR' });
  useConfigStore.setState({ activeProvider: 'openai', providers: { openai: { apiKey: 'test-only-key', mainModel: 'test-model', kbModel: 'test-kb' } } });
  useChatStore.setState({ messages: [], archivedSessions: [], modelHistory: [], pendingHistory: null, open: true, running: false, hydrated: true, rateLimits: { 'openai:test-model': Date.now() + 5000 } });
  await flushChatPersistence();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

function PlannerHarness({ planner = true }: { planner?: boolean }) {
  return <AssistantChatDockProvider>
    <div className="planner-work-area">{planner && <PlannerChatDock />}<input aria-label="Inspector draft" defaultValue="Detalhe em edição" /></div>
    <AssistantChat />
  </AssistantChatDockProvider>;
}

it.each([true, false])('docks one chat, retains drafts across destinations and restores the inspector preference (%s)', (panelOpen) => {
  useGraphStore.setState({ detailPanelOpen: panelOpen });
  act(() => root.render(<PlannerHarness />));
  let panel = host.querySelector<HTMLElement>('.dd-chat')!;
  expect(panel.parentElement?.classList.contains('dd-chat-dock')).toBe(true);
  expect(panel.getAttribute('role')).toBe('complementary');
  expect(panel.hasAttribute('aria-modal')).toBe(false);
  const input = panel.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => Simulate.change(input, { target: { value: 'Rascunho sem enviar' } } as never));
  const inspector = host.querySelector<HTMLInputElement>('[aria-label="Inspector draft"]')!;
  inspector.focus(); // A docked chat must allow focus in the planner.
  expect(document.activeElement).toBe(inspector);
  act(() => root.render(<PlannerHarness planner={false} />));
  expect(host.querySelectorAll('.dd-chat')).toHaveLength(1);
  expect(host.querySelector<HTMLTextAreaElement>('.dd-chat textarea')?.value).toBe('Rascunho sem enviar');
  expect(host.querySelector('.dd-chat')?.classList.contains('is-docked')).toBe(false);
  act(() => root.render(<PlannerHarness />));
  panel = host.querySelector<HTMLElement>('.dd-chat')!;
  expect(panel.parentElement?.classList.contains('dd-chat-dock')).toBe(true);
  expect(host.querySelector('[aria-label="Inspector draft"]')).toBe(inspector);
  act(() => Simulate.click(panel.querySelector('[aria-label="Fechar chat"]')!));
  expect(host.querySelector('.dd-chat')).toBeNull();
  const trigger = host.querySelector<HTMLButtonElement>('.dd-chat-trigger')!;
  expect(document.activeElement).toBe(trigger);
  expect(useGraphStore.getState().detailPanelOpen).toBe(panelOpen);
  act(() => Simulate.click(trigger));
  expect(host.querySelector<HTMLTextAreaElement>('.dd-chat textarea')?.value).toBe('Rascunho sem enviar');
  expect(runAssistant).not.toHaveBeenCalled();
});

it('changes from dock to a mobile dialog without losing the draft, traps Tab and closes Escape locally', () => {
  act(() => root.render(<PlannerHarness />));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => Simulate.change(input, { target: { value: 'Continuar depois' } } as never));
  viewport.mobile = true;
  act(() => root.render(<PlannerHarness />));
  const panel = host.querySelector<HTMLElement>('.dd-chat')!;
  expect(panel.getAttribute('role')).toBe('dialog');
  expect(panel.getAttribute('aria-modal')).toBe('true');
  const mobileInput = panel.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(mobileInput.value).toBe('Continuar depois');
  expect(document.activeElement).toBe(mobileInput);
  const first = panel.querySelector<HTMLButtonElement>('button')!;
  const last = panel.querySelector<HTMLButtonElement>('[aria-label="Referenciar com @"]')!;
  last.focus(); // Send is disabled by cooldown; reference is the last available control.
  act(() => Simulate.keyDown(last, { key: 'Tab' }));
  expect(document.activeElement).toBe(first);
  act(() => Simulate.keyDown(first, { key: 'Tab', shiftKey: true }));
  expect(document.activeElement).toBe(last);
  const outsideEscape = vi.fn();
  window.addEventListener('keydown', outsideEscape);
  act(() => { mobileInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  window.removeEventListener('keydown', outsideEscape);
  expect(outsideEscape).not.toHaveBeenCalled();
  expect(useChatStore.getState().open).toBe(false);
  expect(document.activeElement).toBe(host.querySelector('.dd-chat-trigger'));
});

it('keeps focus in an existing settings modal when the viewport changes', () => {
  act(() => root.render(<PlannerHarness />));
  const modal = document.createElement('div');
  modal.setAttribute('aria-modal', 'true');
  const button = document.createElement('button');
  modal.append(button); document.body.append(modal); button.focus();
  try {
    viewport.mobile = true;
    act(() => root.render(<PlannerHarness />));
    expect(document.activeElement).toBe(button);
  } finally { modal.remove(); }
});

afterEach(async () => {
  if (root) act(() => root.unmount()); host?.remove();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
  vi.useRealTimers();
  await flushChatPersistence();
  vi.restoreAllMocks();
});

it('keeps a blocked Enter draft and enables sending when the provider wait expires without resending automatically', () => {
  vi.useFakeTimers();
  act(() => root.render(<AssistantChat />));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  const send = host.querySelector<HTMLButtonElement>('[aria-label="Enviar"]')!;
  act(() => Simulate.change(input, { target: { value: 'Continuar meu plano' } } as never));
  expect(send.disabled).toBe(true);
  expect(host.querySelector('.dd-chat-cooldown')?.textContent).toContain('5s');
  act(() => Simulate.keyDown(input, { key: 'Enter' }));
  expect(input.value).toBe('Continuar meu plano');
  expect(runAssistant).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(5000));
  expect(host.querySelector('.dd-chat-cooldown')).toBeNull();
  expect(send.disabled).toBe(false);
  expect(input.value).toBe('Continuar meu plano');
  expect(runAssistant).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('selects @ personal notes with Enter without sending, keeps removable chips across close/reopen', () => {
  useChatStore.setState({ rateLimits: {} });
  const note = useWorkspaceStore.getState().createNote({ title: 'Medições da bancada' });
  act(() => root.render(<AssistantChat />));
  let input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => Simulate.change(input, { target: { value: 'Explique @Medições', selectionStart: 'Explique @Medições'.length } } as never));
  expect(host.querySelector('[role="listbox"]')?.textContent).toContain('Medições da bancada');
  act(() => Simulate.keyDown(input, { key: 'Enter' }));
  expect(host.querySelector('.dd-chat-reference-chip')?.textContent).toContain('Medições da bancada');
  expect(input.value).toBe('Explique ');
  expect(runAssistant).not.toHaveBeenCalled();
  act(() => { useChatStore.getState().setOpen(false); });
  act(() => { useChatStore.getState().setOpen(true); });
  expect(host.querySelector('.dd-chat-reference-chip')?.getAttribute('data-reference-id')).toBe(note);
  act(() => Simulate.click(host.querySelector('[aria-label="Remover referência Medições da bancada"]')!));
  expect(host.querySelector('.dd-chat-reference-chip')).toBeNull();
});

it('dismisses @ before closing chat and ignores Enter while composing with IME', () => {
  useChatStore.setState({ rateLimits: {} });
  useWorkspaceStore.getState().createNote({ title: 'Fonte' });
  act(() => root.render(<AssistantChat />));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => Simulate.change(input, { target: { value: '@', selectionStart: 1 } } as never));
  act(() => Simulate.compositionStart(input));
  act(() => Simulate.keyDown(input, { key: 'Enter' }));
  expect(host.querySelector('.dd-chat-reference-chip')).toBeNull();
  expect(runAssistant).not.toHaveBeenCalled();
  act(() => Simulate.compositionEnd(input));
  act(() => Simulate.keyDown(input, { key: 'Escape' }));
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  expect(useChatStore.getState().open).toBe(true);
  act(() => Simulate.keyDown(input, { key: 'Escape' }));
  expect(useChatStore.getState().open).toBe(false);
});

it('accepts canvas handoff into the existing draft without sending or navigating', () => {
  const projectId = useWorkspaceStore.getState().createProject('Robô');
  const note = useWorkspaceStore.getState().createNote({ title: 'Teste do servo', projectId });
  useWorkspaceStore.setState({ activeProjectId: null, surface: 'projects' });
  act(() => root.render(<AssistantChat />));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => Simulate.change(input, { target: { value: 'Conferir esta premissa' } } as never));
  act(() => requestChatReferences(projectId, [{ id: note, kind: 'note', label: 'Teste do servo', detail: '', fingerprint: '' }]));
  expect(host.querySelector('.dd-chat-reference-chip')?.textContent).toContain('Teste do servo');
  expect(host.querySelector('.dd-chat-context')?.textContent).toContain('Robô');
  expect(input.value).toBe('Conferir esta premissa');
  expect(useChatReferenceHandoff.getState().pending).toBeNull();
  expect(useWorkspaceStore.getState().activeProjectId).toBeNull();
  expect(useWorkspaceStore.getState().surface).toBe('projects');
  expect(runAssistant).not.toHaveBeenCalled();
});

it('rejects a handoff from another project while preserving the current draft and references', () => {
  const first = useWorkspaceStore.getState().createProject('Primeiro');
  const note = useWorkspaceStore.getState().createNote({ title: 'Primeira fonte', projectId: first });
  const second = useWorkspaceStore.getState().createProject('Segundo');
  const other = useWorkspaceStore.getState().createNote({ title: 'Outra fonte', projectId: second });
  act(() => root.render(<AssistantChat />));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => Simulate.change(input, { target: { value: 'Minha análise' } } as never));
  act(() => requestChatReferences(first, [{ id: note, kind: 'note', label: '', detail: '', fingerprint: '' }]));
  act(() => requestChatReferences(second, [{ id: other, kind: 'note', label: '', detail: '', fingerprint: '' }]));
  expect(host.querySelectorAll('.dd-chat-reference-chip')).toHaveLength(1);
  expect(host.querySelector('.dd-chat-reference-chip')?.textContent).toContain('Primeira fonte');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('outro projeto');
  expect(input.value).toBe('Minha análise');
  expect(useChatReferenceHandoff.getState().pending).toBeNull();
  expect(runAssistant).not.toHaveBeenCalled();
});

const carouselImage: ImageReference = { id: 'search-photo', title: 'Arduino Uno R3', description: 'Placa controladora', imageUrl: 'https://example.com/arduino.jpg', sourcePageUrl: 'https://example.com/arduino', credit: null, license: null, width: null, height: null };
function imageSearchMessage(projectId: string, id = 'search', image = carouselImage) {
  return { id, role: 'assistant' as const, text: 'Escolha a referência da placa.', createdAt: Date.now(), actions: [{ id: `${id}-action`, name: 'visual_action', action: 'search_images', status: 'done' as const, result: { projectId, count: 1, imageReferences: [image], input: { text: 'Arduino Uno', mentions: [{ id: 'arduino-node', kind: 'node', label: 'Arduino', detail: '', fingerprint: '' }], attachments: [] } } }] };
}
function imageProject(name = 'Robô') {
  const projectId = useWorkspaceStore.getState().createProject(name);
  useGraphStore.setState({ project: { ...buildDemoProject(), id: `plan-${projectId}` } });
  useWorkspaceStore.getState().savePlanner(projectId, capturePlanner()); initializeWorkspace();
  return projectId;
}

it('renders every image search in chat and selecting one inserts the real canvas image as @ context', async () => {
  const projectId = imageProject();
  for (let index = 0; index < 105; index++) useWorkspaceStore.getState().createNote({ projectId, title: `Nota ${index}` });
  const artifact: VisualArtifact = { id: 'actual-canvas-photo', label: carouselImage.title, kind: 'image', x: 0, y: 0, width: 100, height: 100, mediaId: 'local-media', scene: null, source: carouselImage, revisions: [], revisionIndex: 0 };
  vi.mocked(addChatImageReference).mockImplementation(async () => {
    const plan = useGraphStore.getState().project!;
    useGraphStore.setState({ project: { ...plan, visuals: { version: 1, mode: 'approval', artifacts: [artifact], proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } } } });
    return artifact;
  });
  useChatStore.setState({ messages: [imageSearchMessage(projectId), imageSearchMessage(projectId, 'second-search', { ...carouselImage, id: 'other-photo', title: 'Cabo USB' })] });
  act(() => root.render(<AssistantChat />));
  expect(host.querySelectorAll('.dd-chat-image-results')).toHaveLength(2);
  expect(useVisualPopupStore.getState().searchOpen).toBe(false);
  expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Abrir no canvas')).toBe(false);
  await act(async () => Simulate.click(host.querySelector('[aria-label="Escolher Arduino Uno R3"]')!));
  expect(addChatImageReference).toHaveBeenCalledWith(carouselImage, projectId, { useAs3D: false, linkedNodeId: 'arduino-node' });
  expect(host.querySelector('.dd-chat-reference-chip')?.getAttribute('data-reference-id')).toBe(artifact.id);
  expect(host.querySelector('.dd-chat-reference-chip')?.textContent).toContain(carouselImage.title);
  expect(useVisualPopupStore.getState().searchOpen).toBe(false);
  expect(runAssistant).not.toHaveBeenCalled();
});

it('shows historic image searches after a project switch without adding images to the new plan', () => {
  const origin = imageProject('Origem'); imageProject('Outro projeto');
  useChatStore.setState({ messages: [imageSearchMessage(origin)] });
  act(() => root.render(<AssistantChat />));
  expect(host.querySelector('.dd-chat-image-results')).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Escolher Arduino Uno R3"]')?.disabled).toBe(true);
  expect(host.textContent).toContain('Voltar ao projeto');
  expect(addChatImageReference).not.toHaveBeenCalled();
  act(() => { const projects = { ...useWorkspaceStore.getState().projects }; delete projects[origin]; useWorkspaceStore.setState({ projects }); });
  expect(host.querySelector('.dd-chat-image-results')).not.toBeNull();
  expect(host.textContent).toContain('projeto de origem foi removido');
});

it('rejects choosing an image while the draft references another project before changing the canvas', async () => {
  const origin = imageProject('Referências');
  const note = useWorkspaceStore.getState().createNote({ title: 'Fonte anterior', projectId: origin });
  const current = imageProject('Busca atual');
  useChatStore.setState({ messages: [imageSearchMessage(current)] });
  act(() => root.render(<AssistantChat />));
  act(() => requestChatReferences(origin, [{ id: note, kind: 'note', label: '', detail: '', fingerprint: '' }]));
  await act(async () => Simulate.click(host.querySelector('[aria-label="Escolher Arduino Uno R3"]')!));
  expect(host.querySelector('.dd-chat-reference-chip')?.textContent).toContain('Fonte anterior');
  expect(host.querySelector('.dd-chat-image-error')?.textContent).toContain('outro projeto');
  expect(addChatImageReference).not.toHaveBeenCalled();
});

it('does not put a late image choice into a new conversation', async () => {
  const projectId = imageProject();
  let finish!: (artifact: VisualArtifact) => void;
  vi.mocked(addChatImageReference).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  useChatStore.setState({ messages: [imageSearchMessage(projectId)] });
  act(() => root.render(<AssistantChat />));
  act(() => Simulate.click(host.querySelector('[aria-label="Escolher Arduino Uno R3"]')!));
  act(() => useChatStore.getState().newConversation());
  await act(async () => finish({ id: 'late', label: 'Arduino', kind: 'image' } as VisualArtifact));
  expect(host.querySelector('.dd-chat-reference-chip')).toBeNull();
  expect(useChatStore.getState().messages).toHaveLength(0);
});

it('keeps an image choice from racing a chat submission and closes chat only for the explicit 3D action', async () => {
  const projectId = imageProject();
  let finish!: (artifact: VisualArtifact) => void;
  const artifact: VisualArtifact = { id: 'chosen-photo', label: carouselImage.title, kind: 'image', x: 0, y: 0, width: 100, height: 100, mediaId: 'media', scene: null, source: carouselImage, revisions: [], revisionIndex: 0 };
  vi.mocked(addChatImageReference).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  useChatStore.setState({ messages: [imageSearchMessage(projectId)], rateLimits: {} });
  act(() => root.render(<AssistantChat />));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => Simulate.change(input, { target: { value: 'Use esta imagem' } } as never));
  act(() => Simulate.click(host.querySelector('[aria-label="Escolher Arduino Uno R3"]')!));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Enviar"]')?.disabled).toBe(true);
  act(() => Simulate.keyDown(input, { key: 'Enter' }));
  expect(runAssistant).not.toHaveBeenCalled();
  await act(async () => {
    const project = useGraphStore.getState().project!;
    useGraphStore.setState({ project: { ...project, visuals: { version: 1, mode: 'approval', artifacts: [artifact], proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } } } });
    finish(artifact);
  });
  expect(useChatStore.getState().open).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Enviar"]')?.disabled).toBe(false);
  vi.mocked(addChatImageReference).mockResolvedValue(artifact);
  await act(async () => Simulate.click(host.querySelector('[aria-label="Usar Arduino Uno R3 como base 3D"]')!));
  expect(addChatImageReference).toHaveBeenLastCalledWith(carouselImage, projectId, { useAs3D: true, linkedNodeId: 'arduino-node' });
  expect(useChatStore.getState().open).toBe(false);
  act(() => { useChatStore.getState().setOpen(true); });
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Use esta imagem');
  expect(host.querySelectorAll('.dd-chat-reference-chip')).toHaveLength(1);
});

it('blocks an old search after replacing a plan inside the same workspace project', () => {
  const projectId = imageProject();
  const planId = useGraphStore.getState().project!.id;
  const message = imageSearchMessage(projectId);
  useChatStore.setState({ messages: [{ ...message, actions: message.actions.map(action => ({ ...action, result: { ...action.result, planId } })) }] });
  act(() => root.render(<AssistantChat />));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Escolher Arduino Uno R3"]')?.disabled).toBe(false);
  act(() => { useGraphStore.setState({ project: { ...useGraphStore.getState().project!, id: 'replacement-plan' } }); });
  expect(useWorkspaceStore.getState().activeProjectId).toBe(projectId);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Escolher Arduino Uno R3"]')?.disabled).toBe(true);
  expect(host.querySelector('.dd-chat-image-hint')?.textContent).toContain('O plano mudou');
  expect(host.querySelector('.dd-chat-image-source')).not.toBeNull();
  expect(addChatImageReference).not.toHaveBeenCalled();
});

it('passes the original plan identity to image insertion instead of trusting the current project alone', async () => {
  const projectId = imageProject(), planId = useGraphStore.getState().project!.id;
  const message = imageSearchMessage(projectId);
  vi.mocked(addChatImageReference).mockRejectedValue(new Error('visualPlanChanged'));
  useChatStore.setState({ messages: [{ ...message, actions: message.actions.map(action => ({ ...action, result: { ...action.result, planId } })) }] });
  act(() => root.render(<AssistantChat />));
  await act(async () => { Simulate.click(host.querySelector('[aria-label="Escolher Arduino Uno R3"]')!); });
  expect(addChatImageReference).toHaveBeenCalledWith(carouselImage, projectId, { useAs3D: false, linkedNodeId: 'arduino-node', expectedPlanId: planId });
  expect(host.querySelector('.dd-chat-image-error')?.textContent).toContain('O plano mudou');
  expect(host.querySelector('.dd-chat-reference-chip')).toBeNull();
});
