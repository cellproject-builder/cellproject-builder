import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { expect, it, vi } from 'vitest';
import { InstallApp } from './InstallApp';
import { installController, registerPwa } from './install';
import { useLocaleStore } from '@/i18n';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
it('explains manual installation and connectivity limits, then offers the real browser prompt without auto-opening', async () => {
  useLocaleStore.setState({ locale: 'en' });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<InstallApp />));
  expect(host.textContent).toContain('AI and web research require a connection');
  act(() => Simulate.click(host.querySelector('button')!)); expect(host.textContent).toContain('browser menu');
  const prompt = vi.fn(async () => ({ outcome: 'dismissed' as const })); const event = new Event('beforeinstallprompt'); Object.assign(event, { prompt });
  act(() => window.dispatchEvent(event)); expect(host.textContent).toContain('Install app'); expect(prompt).not.toHaveBeenCalled();
  await act(async () => { Simulate.click(host.querySelector('button')!); }); expect(prompt).toHaveBeenCalledOnce(); expect(installController.getSnapshot().installed).toBe(false);
  await act(async () => root.unmount()); host.remove();
});
it('never registers a service worker for the development bundle', async () => {
  const register = vi.fn(); Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
  await registerPwa(false); expect(register).not.toHaveBeenCalled(); Reflect.deleteProperty(navigator, 'serviceWorker');
});
