import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const activity = vi.hoisted(() => ({ chatRunning: true }));
vi.mock('@/chat/store', () => ({ useChatStore: { getState: () => ({ running: activity.chatRunning }) } }));
vi.mock('@/workspace/planner', () => ({ plannerBusy: () => false }));
vi.mock('@/store', () => ({ hasPendingGraphPersistence: () => false }));
import { CloudStatus } from './CloudStatus';
import { CloudRuntime, configureCloud } from './runtime';
import { registerDataIngestion } from './activity';

it('keeps the saved indicator quiet while its button still opens synchronization details', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const cloud = new CloudRuntime({ documents: [], media: [] });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="original-user" email="wylgnerbossman@gmail.com" onLogout={() => {}}/>));
    const indicator = host.querySelector('button')!;
    expect(indicator.textContent).toBe('');
    expect(indicator.getAttribute('aria-label')).toBe('Salvo na nuvem');
    expect(indicator.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).not.toContain('wylgnerbossman@gmail.com');
    await act(async () => indicator.click());
    expect(indicator.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('wylgnerbossman@gmail.com');
    expect(host.textContent).toContain('Baixar cópia completa desta sessão');
    await act(async () => indicator.click());
    expect(host.textContent).not.toContain('wylgnerbossman@gmail.com');
  } finally { await act(async () => root.unmount()); host.remove(); cloud.dispose(); }
});

it('exposes an expired-session warning and its recovery actions without needing to open the indicator', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const cloud = new CloudRuntime({ documents: [], media: [] }); cloud.notifySessionExpired('api');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="original-user" email="wylgnerbossman@gmail.com" onLogout={() => {}}/>));
    const indicator = host.querySelector('button')!;
    expect(indicator.getAttribute('aria-label')).toBe('Alterações sem salvar');
    expect(indicator.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).toContain('Retomar salvamento nesta aba');
  } finally { await act(async () => root.unmount()); host.remove(); cloud.dispose(); }
});

it('blocks complete backup, rescue and logout while chat or a file ingestion is running', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const cloud = new CloudRuntime({ documents: [], media: [] }); configureCloud(cloud); cloud.notifySessionExpired('api');
  const logout = vi.fn(), fetcher = vi.spyOn(globalThis, 'fetch');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="original-user" email="wylgnerbossman@gmail.com" onLogout={logout}/>));
    expect(host.querySelector('a[target="_blank"]')?.getAttribute('rel')).toContain('noopener');
    for (const label of ['Baixar cópia completa desta sessão', 'Baixar rascunhos de resgate (.json)', 'Sair da conta']) {
      await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click(); });
      expect(host.textContent).toContain('Aguarde o chat');
    }
    activity.chatRunning = false; const finish = registerDataIngestion();
    try { await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Baixar rascunhos de resgate (.json)')!.click(); }); expect(host.textContent).toContain('leitura dos anexos'); }
    finally { finish(); }
    expect(logout).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); vi.restoreAllMocks(); }
});
