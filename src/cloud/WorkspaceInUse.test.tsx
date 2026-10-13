import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceInUse } from './WorkspaceInUse';
import { OfflineWorkspaceBusyError } from './offline/repository';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(ready => { resolve = ready; }); return { promise, resolve }; };
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('cancels automatic opening immediately when returning to login, even before logout finishes', async () => {
  const lease = deferred(), logout = deferred(); let signal!: AbortSignal;
  vi.stubGlobal('navigator', { locks: { request: (_name: string, options: LockOptions) => { signal = options.signal!; return lease.promise; } } });
  const retry = vi.fn(), restart = vi.fn(() => logout.promise);
  await act(async () => root.render(<WorkspaceInUse issue={new OfflineWorkspaceBusyError('owner', 'vault')} onRetry={retry} onRestart={restart}/>));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Voltar ao login')!.click());
  expect(signal.aborted).toBe(true);
  await act(async () => { lease.resolve(); await lease.promise; });
  expect(retry).not.toHaveBeenCalled(); logout.resolve();
});

it('cancels a queued automatic opening when the waiting screen unmounts', async () => {
  const lease = deferred(); let signal!: AbortSignal;
  vi.stubGlobal('navigator', { locks: { request: (_name: string, options: LockOptions) => { signal = options.signal!; return lease.promise; } } });
  const retry = vi.fn();
  await act(async () => root.render(<WorkspaceInUse issue={new OfflineWorkspaceBusyError('owner', 'vault')} onRetry={retry}/>));
  await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
  await act(async () => { lease.resolve(); await lease.promise; }); expect(retry).not.toHaveBeenCalled();
});

it('cancels the automatic waiter before a manual retry so one release cannot start two openings', async () => {
  const lease = deferred(); let signal!: AbortSignal;
  vi.stubGlobal('navigator', { locks: { request: (_name: string, options: LockOptions) => { signal = options.signal!; return lease.promise; } } });
  const retry = vi.fn();
  await act(async () => root.render(<WorkspaceInUse issue={new OfflineWorkspaceBusyError('owner', 'vault')} onRetry={retry}/>));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Tentar novamente')!.click());
  expect(signal.aborted).toBe(true);
  await act(async () => { lease.resolve(); await lease.promise; }); expect(retry).toHaveBeenCalledOnce();
});

it('resumes waiting when returning to login fails without opening during the logout request', async () => {
  const first = deferred(), second = deferred(); let reject!: (reason: Error) => void;
  const logout = new Promise<void>((_resolve, fail) => { reject = fail; }), signals: AbortSignal[] = [];
  vi.stubGlobal('navigator', { locks: { request: (_name: string, options: LockOptions) => { signals.push(options.signal!); return signals.length === 1 ? first.promise : second.promise; } } });
  const retry = vi.fn();
  await act(async () => root.render(<WorkspaceInUse issue={new OfflineWorkspaceBusyError('owner', 'vault')} onRetry={retry} onRestart={() => logout}/>));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Voltar ao login')!.click());
  await act(async () => { first.resolve(); await first.promise; }); expect(retry).not.toHaveBeenCalled();
  await act(async () => { reject(new Error('Falha temporária ao sair.')); });
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Falha temporária ao sair.');
  expect(signals).toHaveLength(2); expect(signals[1].aborted).toBe(false);
  await act(async () => { second.resolve(); await second.promise; }); expect(retry).toHaveBeenCalledOnce();
});
