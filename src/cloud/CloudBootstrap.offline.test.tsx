import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const offline = vi.hoisted(() => ({ open: vi.fn(), prepare: vi.fn() }));
vi.mock('./offline/session', () => ({ openOfflineWorkspace: offline.open, prepareOfflineWorkspace: offline.prepare, hasOfflineCheckpoints: async () => false }));
vi.mock('./CloudLiveSync', () => ({ CloudLiveSync: () => null }));
vi.mock('./CloudStatus', () => ({ CloudStatus: () => null }));
import { CloudBootstrap } from './CloudBootstrap';
import { CloudRuntime, configureCloud, getCloudRuntime } from './runtime';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); offline.open.mockReset(); offline.prepare.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); configureCloud(null); vi.restoreAllMocks(); });

it('imports the app with the restored runtime and its pending edits, rather than rebuilding it from a snapshot', async () => {
  const runtime = new CloudRuntime({ documents: [{ key: 'dynamic_diary-theme', value: 'dark', revision: 1 }], media: [] }, vi.fn().mockRejectedValue(new TypeError('offline')));
  await runtime.write('dynamic_diary-theme', 'light');
  const start = vi.fn(), fetcher = vi.fn<typeof fetch>();
  offline.open.mockResolvedValue({ runtime, vault: { snapshot: () => ({ documents: runtime.documents(), media: [] }), session: null }, config: { enabled: true, authenticated: false, user: { id: 'owner', email: 'wylgnerbossman@gmail.com' } }, start });
  const load = vi.fn(async () => ({ default: () => <p>{getCloudRuntime()?.get('dynamic_diary-theme')} — {getCloudRuntime()?.getSnapshot().pending} pendente</p> }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  expect(host.textContent).toContain('light — 1 pendente'); expect(getCloudRuntime()).toBe(runtime);
  expect(start).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
});
it('keeps first access offline closed without an authorized encrypted copy', async () => {
  offline.open.mockResolvedValue(null); const load = vi.fn(), fetcher = vi.fn<typeof fetch>();
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  expect(offline.open).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Sem conexão');
  expect(load).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
it('shows a damaged offline copy without importing stores or falling back to local plaintext', async () => {
  offline.open.mockRejectedValue(new Error('A cópia offline está incompleta. Nenhum rascunho foi substituído.'));
  const load = vi.fn();
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={vi.fn()}/>));
  expect(host.textContent).toContain('Nenhum rascunho foi substituído'); expect(load).not.toHaveBeenCalled();
});
