import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatHistory } from './ChatHistory';
import { useChatStore } from './store';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  useChatStore.setState({ sessionId: 'current', title: 'Atual', messages: [], hydrated: true, running: false, loadFailed: false, archivedAt: null,
    archivedSessions: [
      { id: 'recent', sessionId: 'recent', title: 'Servo do braço', messages: [], modelHistory: [], updatedAt: 20, archivedAt: null },
      { id: 'archive', sessionId: 'archive', title: 'Notas antigas', messages: [], modelHistory: [], updatedAt: 10, archivedAt: 10 },
      { id: 'deleted', sessionId: 'deleted', title: 'Não exibir', messages: [], modelHistory: [], deletedAt: 30 },
    ] });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it('searches recent and archived separately and never displays deleted conversations', () => {
  act(() => root.render(<ChatHistory english={false}/>));
  expect(host.textContent).toContain('Servo do braço');
  expect(host.textContent).not.toContain('Notas antigas');
  expect(host.textContent).not.toContain('Não exibir');
  act(() => Simulate.change(host.querySelector('input[type="search"]')!, { target: { value: 'Servo' } } as never));
  expect(host.textContent).not.toContain('Atual');
  act(() => Simulate.click(host.querySelector('[aria-label="Conversas arquivadas"]')!));
  act(() => Simulate.change(host.querySelector('input[type="search"]')!, { target: { value: '' } } as never));
  expect(host.textContent).toContain('Notas antigas');
});
it('requires explicit confirmation for deletion and can cancel it', () => {
  const remove = vi.spyOn(useChatStore.getState(), 'deleteConversation');
  act(() => root.render(<ChatHistory english={false}/>));
  act(() => Simulate.click(host.querySelector('[aria-label="Opções de Servo do braço"]')!));
  act(() => Simulate.click(host.querySelector('[aria-label="Excluir Servo do braço"]')!));
  expect(remove).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Excluir esta conversa?');
  act(() => Simulate.click(host.querySelector('[aria-label="Cancelar exclusão"]')!));
  expect(remove).not.toHaveBeenCalled();
  act(() => Simulate.click(host.querySelector('[aria-label="Excluir Servo do braço"]')!));
  act(() => Simulate.click(host.querySelector('[aria-label="Confirmar exclusão"]')!));
  expect(remove).toHaveBeenCalledWith('recent');
});
