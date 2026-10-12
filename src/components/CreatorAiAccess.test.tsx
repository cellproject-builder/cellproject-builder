import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudRuntime, configureCloud, type CloudProvider } from '@/cloud/runtime';
import { useConfigStore, type Provider } from '@/config/store';
import { useLocaleStore } from '@/i18n';
import { EMPTY_OBJECTIVE_DRAFT, flushGraphPersistence, useGraphStore } from '@/store';
import { useWorkspaceStore, flushWorkspacePersistence } from '@/workspace/store';
import { useKBStore } from '@/kb/store';
import { flushChatPersistence, useChatStore } from '@/chat/store';
import { AssistantChat } from '@/chat/AssistantChat';
import { NoteRewriteDialog } from '@/workspace/NoteRewriteDialog';
import { ObjectiveScreen } from './ObjectiveScreen';
import { TopBar } from './TopBar';
import type { AIPlanOutline } from '@/types';

const inference = vi.hoisted(() => ({ chat: vi.fn(), outlines: vi.fn(), rewrite: vi.fn() }));
vi.mock('@/ai/assistant', () => ({ runAssistant: inference.chat }));
vi.mock('@/ai/service', async importOriginal => ({ ...await importOriginal<typeof import('@/ai/service')>(), outlinePlans: inference.outlines }));
vi.mock('@/ai/noteRewrite', () => ({ rewriteNoteText: inference.rewrite }));

const outline: AIPlanOutline = {
  id: 'cloud-plan', title: 'Investigar a primeira junta', pitch: 'Conferir a carga',
  approach: 'Medir por partes', strategy: 'do_zero', archetype: 'entender', rank: 1, rankReason: 'Direto',
  outline: { categorias: [{ name: 'Ensaio', kind: 'execucao', nodes: [] }] },
};
let root: Root, host: HTMLDivElement, cloud: CloudRuntime | null;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  configureCloud(null); cloud = null;
  await Promise.all([useConfigStore.persist.rehydrate(), useChatStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useLocaleStore.setState({ locale: 'pt-BR' });
  useWorkspaceStore.setState({ projects: {}, tasks: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: null, archivedProject: null, aiJobs: {}, pendingSuggestions: null,
    objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, objective: 'Investigar a carga da primeira junta' } });
  useChatStore.setState({ messages: [], modelHistory: [], pendingHistory: null, open: true, running: false, hydrated: true, rateLimits: {} });
  useConfigStore.setState({ activeProvider: null, providers: {}, webResearchEnabled: false });
  // Flush the local graph before serverProviders switches persistence owners.
  await Promise.all([flushWorkspacePersistence(), flushChatPersistence(), flushGraphPersistence()]);
  vi.spyOn(useKBStore.getState(), 'getContextFor').mockResolvedValue([]);
  inference.chat.mockReset().mockResolvedValue({ text: 'Resposta usando o provedor do servidor.', messages: [] });
  inference.outlines.mockReset().mockResolvedValue([outline]);
  inference.rewrite.mockReset().mockResolvedValue('Texto revisado pelo servidor.');
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  // Unmount may cancel an outline and enqueue a final graph draft for this owner.
  await flushGraphPersistence();
  await cloud?.flush(); configureCloud(null);
  await Promise.all([flushWorkspacePersistence(), flushChatPersistence()]);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

function serverProviders(providers: Partial<Record<CloudProvider, boolean>>, selected: Provider | null = null) {
  useConfigStore.setState({ activeProvider: selected, providers: selected ? {
    [selected]: { apiKey: '', mainModel: 'unavailable-local-model', kbModel: 'unavailable-local-kb' },
  } : {} });
  cloud = new CloudRuntime({ documents: [], media: [] }, async () => Response.json({ revision: 1 }));
  configureCloud(cloud, providers);
}

it.each([null, 'openai'] as const)('sends chat using the server provider without a local key (selection: %s)', async selected => {
  serverProviders({ openrouter: true }, selected);
  await act(async () => root.render(<AssistantChat />));
  const contextToggle = host.querySelector<HTMLButtonElement>('[aria-label="Contexto da conversa"]')!;
  expect(contextToggle.getAttribute('aria-expanded')).toBe('false');
  act(() => contextToggle.click());
  expect(contextToggle.getAttribute('aria-expanded')).toBe('true');
  const modelButton = host.querySelector<HTMLButtonElement>('[aria-label="Configurar modelo de IA"]')!;
  expect(modelButton.closest<HTMLElement>('[hidden]')).toBeNull();
  expect(modelButton.textContent).toBe('openai/gpt-6.1-sol');
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => Simulate.change(input, { target: { value: 'Quais evidências preciso registrar?' } } as never));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Enviar"]')?.disabled).toBe(false);
  await act(async () => { Simulate.submit(input.closest('form')!); await flushChatPersistence(); });
  expect(inference.chat).toHaveBeenCalledOnce();
  expect(inference.chat).toHaveBeenCalledWith(expect.objectContaining({ userText: 'Quais evidências preciso registrar?' }));
  expect(host.textContent).toContain('Resposta usando o provedor do servidor.');
  expect(useChatStore.getState().messages.find(message => message.role === 'user')?.text).toBe('Quais evidências preciso registrar?');
  expect(host.querySelector('.dd-chat-configure')).toBeNull();

  await act(async () => { useConfigStore.getState().saveProviderConfig('openrouter', { apiKey: '', mainModel: 'server-preferred-model', kbModel: 'server-kb' }); await cloud?.flush(); });
  expect(modelButton.textContent).toBe('server-preferred-model');
});

it('keeps chat blocked when cloud has no provider, even if the browser has an old key', async () => {
  serverProviders({});
  useConfigStore.setState({ activeProvider: 'openai', providers: { openai: { apiKey: 'old-browser-key', mainModel: 'old-model', kbModel: 'old-kb' } } });
  await act(async () => root.render(<AssistantChat />));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => Simulate.change(input, { target: { value: 'Preservar este rascunho' } } as never));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Enviar"]')?.disabled).toBe(true);
  act(() => Simulate.keyDown(input, { key: 'Enter' }));
  expect(useChatStore.getState().messages).toEqual([]);
  expect(input.value).toBe('Preservar este rascunho');
});

it('generates a plan with the effective server model without opening key settings', async () => {
  serverProviders({ openrouter: true }, 'openai');
  await act(async () => root.render(<ObjectiveScreen />));
  expect(host.textContent).toContain('GPT-6.1 Sol');
  const generate = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Gerar planos'))!;
  expect(generate).toBeTruthy();
  await act(async () => generate.click());
  expect(useGraphStore.getState().objectiveDraft.outlines?.[0]?.title).toBe('Investigar a primeira junta');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('keeps plan generation blocked when cloud has no provider despite an old browser key', async () => {
  serverProviders({});
  useConfigStore.setState({ activeProvider: 'openai', providers: { openai: { apiKey: 'old-browser-key', mainModel: 'old-model', kbModel: 'old-kb' } } });
  await act(async () => root.render(<ObjectiveScreen />));
  const generate = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Gerar planos'))!;
  await act(async () => generate.click());
  expect(useGraphStore.getState().objectiveDraft.outlines).toBeNull();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it('rewrites a note using the server provider without a local key', async () => {
  serverProviders({ openrouter: true });
  await act(async () => root.render(<NoteRewriteDialog target={{ noteId: 'note', blockId: 'block', original: 'Texto original.', start: 0, end: 15 }} onClose={() => {}} />));
  const instruction = document.querySelector<HTMLTextAreaElement>('[aria-label="Como a IA deve modificar o texto?"]')!;
  act(() => Simulate.change(instruction, { target: { value: 'Deixe mais claro' } } as never));
  expect(document.querySelector<HTMLButtonElement>('.ws-note-ai-form button.primary')?.disabled).toBe(false);
  await act(async () => Simulate.submit(instruction.closest('form')!));
  expect(document.querySelector<HTMLTextAreaElement>('.ws-note-ai-result')?.value).toBe('Texto revisado pelo servidor.');
});

it('keeps note rewriting blocked when no server provider is available', async () => {
  serverProviders({});
  useConfigStore.setState({ activeProvider: 'openai', providers: { openai: { apiKey: 'old-browser-key', mainModel: 'old-model', kbModel: 'old-kb' } } });
  await act(async () => root.render(<NoteRewriteDialog target={{ noteId: 'note', blockId: 'block', original: 'Texto original.', start: 0, end: 15 }} onClose={() => {}} />));
  const instruction = document.querySelector<HTMLTextAreaElement>('[aria-label="Como a IA deve modificar o texto?"]')!;
  act(() => Simulate.change(instruction, { target: { value: 'Deixe mais claro' } } as never));
  expect(document.querySelector<HTMLButtonElement>('.ws-note-ai-form button.primary')?.disabled).toBe(true);
  await act(async () => Simulate.submit(instruction.closest('form')!));
  expect(document.querySelector('.ws-note-ai-result')).toBeNull();
});

it('labels the plan toolbar with the effective cloud provider and follows model preferences', async () => {
  serverProviders({ openrouter: true }, 'openai');
  useGraphStore.getState().loadDemoProject();
  await act(async () => root.render(<TopBar />));
  expect(host.textContent).toContain('GPT-6.1 Sol');
  expect([...host.querySelectorAll('button')].some(button => button.title.includes('OpenRouter'))).toBe(true);
  await act(async () => { useConfigStore.getState().saveProviderConfig('openrouter', { apiKey: '', mainModel: 'custom/creator-model', kbModel: 'server-kb' }); await cloud?.flush(); });
  expect(host.textContent).toContain('creator-model');
  expect(host.textContent).not.toContain('unavailable-local-model');
});
