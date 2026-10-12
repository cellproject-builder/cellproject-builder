import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { CloudRuntime, configureCloud } from '@/cloud/runtime';
import { useConfigStore } from '@/config/store';
import { useLocaleStore } from '@/i18n';
import { ApiKeyGate } from './ApiKeyGate';

it.each([
  ['pt-BR', 'GPT-6.1 Sol · raciocínio leve', 'Resume PDFs, escolhe o que é relevante e pesquisa na web.'],
  ['en', 'GPT-6.1 Sol · light reasoning', 'Summarizes PDFs, selects relevant content, and researches the web.'],
] as const)('shows both model selectors and accurate PDF/research help in %s', async (locale, label, hint) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await useConfigStore.persist.rehydrate();
  useLocaleStore.setState({ locale });
  useConfigStore.setState({ activeProvider: null, providers: {} });
  const cloud = new CloudRuntime({ documents: [], media: [] }, async () => Response.json({ revision: 1 }));
  configureCloud(cloud, { openrouter: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<ApiKeyGate />));
    const models = [...host.querySelectorAll('select')].slice(1);
    expect(models).toHaveLength(2);
    for (const select of models) {
      expect(select.value).toBe('openai/gpt-6.1-sol');
      expect(select.selectedOptions[0].textContent).toBe(label);
    }
    expect(host.textContent).toContain(hint);
    expect(host.querySelector('input[name="custom-model"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); await cloud.flush(); configureCloud(null); }
});
