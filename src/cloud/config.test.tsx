import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CloudRuntime, configureCloud } from './runtime';

it('uses server capabilities and allows model preferences without a browser API key form', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const cloud = new CloudRuntime({ documents: [], media: [] }, vi.fn(async () => Response.json({ revision: 1 })));
  configureCloud(cloud, { openrouter: true });
  const [{ ApiKeyGate }, { getActiveConfig, useConfigStore }] = await Promise.all([import('@/components/ApiKeyGate'), import('@/config/store')]);
  if (!useConfigStore.persist.hasHydrated()) await new Promise<void>(resolve => { const stop = useConfigStore.persist.onFinishHydration(() => { stop(); resolve(); }); });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ApiKeyGate/>));
    expect(getActiveConfig()).toMatchObject({ provider: 'openrouter', config: { apiKey: 'cloud-session' } });
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(host.textContent).toContain('Salvar modelos'); expect(host.textContent).toContain('protegidas no servidor');
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Salvar modelos')!.click(); await cloud.flush(); });
    expect(cloud.get('cellproject-config')).toContain('mainModel'); expect(cloud.get('cellproject-config')).not.toContain('apiKey');
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); }
});
