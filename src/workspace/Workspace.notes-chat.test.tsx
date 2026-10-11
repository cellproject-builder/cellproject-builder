import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { useChatStore } from '@/chat/store';
import { useChatReferenceHandoff } from '@/references/chatHandoff';
import { useChatPresentation } from '@/chat/presentation';
import { useWorkspaceStore } from './store';
import { useUIRequests } from './uiRequests';
import { Workspace } from './Workspace';

vi.mock('./planner', () => ({ initializeWorkspace: vi.fn(), connectPlanner: () => () => {}, openPlanner: vi.fn(), readPlanner: () => ({ project: null }) }));

let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  await useWorkspaceStore.persist.rehydrate();
  useWorkspaceStore.setState({ projects: {}, tasks: {}, sprints: {}, notes: {}, folders: {}, comments: {}, activeProjectId: null, surface: 'notes' });
  useChatStore.setState({ open: false, running: false, hydrated: true, loadFailed: false, archivedAt: null, deletedAt: null, messages: [] });
  useChatReferenceHandoff.setState({ pending: null });
  useChatPresentation.setState({ expanded: false });
  useUIRequests.setState({ request: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('opens the same contextual chat over a maximized note and closes it without restoring the note', async () => {
  useWorkspaceStore.getState().createNote({ title: 'Pesquisa pessoal' });
  await act(async () => { root.render(<Workspace planner={null} />); });
  act(() => Simulate.click(host.querySelector('[aria-label="Maximizar editor"]')!));
  expect(host.querySelector('.ws-notes.is-maximized')).not.toBeNull();
  expect(host.querySelector('[aria-label="Conversar com IA"]')).toBeNull();
  act(() => Simulate.click(host.querySelector('[aria-label="Mostrar controles"]')!));
  act(() => Simulate.click(host.querySelector('[aria-label="Pedir à IA sobre esta nota"]')!));
  expect(host.querySelector('.dd-chat')).not.toBeNull();
  expect(host.querySelector('[placeholder="Pesquise, crie um diagrama ou revise esta nota…"]')).not.toBeNull();
  expect(host.querySelector('.dd-chat')?.textContent).toContain('Pesquisa pessoal');
  expect(host.querySelector('.ws-notes.is-maximized')).not.toBeNull();
  act(() => Simulate.click(host.querySelector('[aria-label="Fechar chat"]')!));
  expect(host.querySelector('.dd-chat')).toBeNull();
  expect(host.querySelector('.ws-notes.is-maximized')).not.toBeNull();
});
