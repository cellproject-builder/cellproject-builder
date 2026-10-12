import { afterEach, describe, expect, it } from 'vitest';
import { CloudRuntime, configureCloud } from '@/cloud/runtime';
import { getActiveConfig, KNOWN_MODELS, PROVIDER_DEFAULTS, researchModelId, useConfigStore } from './store';

const model = 'openai/gpt-6.1-sol';
const migrate = (state: unknown, version: number) => useConfigStore.persist.getOptions().migrate!(state, version);

afterEach(() => { configureCloud(null); useConfigStore.setState({ activeProvider: null, providers: {} }); });

describe('model defaults and preference migration', () => {
  it('offers GPT-6.1 Sol with low reasoning for both principal and PDF/research defaults', () => {
    expect(PROVIDER_DEFAULTS.openrouter).toEqual({ mainModel: model, kbModel: model });
    expect(KNOWN_MODELS.openrouter.find(item => item.id === model)).toMatchObject({ role: 'both', effort: 'low' });
    expect(researchModelId({ apiKey: '', ...PROVIDER_DEFAULTS.openrouter })).toBe(model);
  });

  it.each([[4, 'google/gemini-2.5-flash-lite'], [1, 'google/gemini-2.0-flash-001']] as const)('migrates legacy defaults from version %s', async (version, kbModel) => {
    const state = { activeProvider: 'openrouter', providers: { openrouter: { apiKey: 'fixture', mainModel: version === 1 ? 'google/gemini-3.5-flash' : model, kbModel } }, webResearchEnabled: true };
    expect(await migrate(state, version)).toMatchObject({ ...state, providers: { openrouter: { apiKey: 'fixture', mainModel: model, kbModel: model } } });
    expect(useConfigStore.persist.getOptions().version).toBe(5);
  });

  it('preserves custom legacy models, explicit research overrides, credentials and other providers', async () => {
    const state = { activeProvider: 'openrouter', providers: {
      openrouter: { apiKey: 'fixture', mainModel: 'custom/main', kbModel: 'custom/pdf', researchModel: 'custom/research' },
      openai: { apiKey: 'other-fixture', mainModel: 'other-main', kbModel: 'other-pdf' },
    }, webResearchEnabled: false };
    expect(await migrate(structuredClone(state), 4)).toEqual(state);
  });

  it('preserves a future explicit choice of the previous default after migration', async () => {
    const state = { activeProvider: 'openrouter', providers: { openrouter: { apiKey: 'fixture', mainModel: model, kbModel: 'google/gemini-2.5-flash-lite' } } };
    expect(await migrate(structuredClone(state), 5)).toEqual(state);
  });

  it('uses both new defaults through the server provider without browser credentials', () => {
    configureCloud(new CloudRuntime({ documents: [], media: [] }, async () => Response.json({ revision: 1 })), { openrouter: true });
    useConfigStore.setState({ activeProvider: null, providers: {} });
    expect(getActiveConfig()).toMatchObject({ provider: 'openrouter', config: { mainModel: model, kbModel: model, apiKey: 'cloud-session' } });
  });

  it.each([
    [4, model, 'google/gemini-2.5-flash-lite', model],
    [4, 'custom/main', 'custom/pdf', 'custom/pdf'],
    [5, model, 'google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash-lite'],
  ] as const)('hydrates the cloud preference envelope v%s and writes the migrated version without replacing custom choices', async (version, mainModel, kbModel, expectedKb) => {
    await useConfigStore.persist.rehydrate();
    const cloud = new CloudRuntime({ documents: [{ key: 'cellproject-config', revision: 1, value: JSON.stringify({ version, state: {
      activeProvider: 'openrouter', providers: { openrouter: { mainModel, kbModel, researchModel: 'custom/research' } }, webResearchEnabled: true,
    } }) }], media: [] }, async () => Response.json({ revision: 2 }));
    configureCloud(cloud, { openrouter: true });
    try {
      await useConfigStore.persist.rehydrate();
      await cloud.flush();
      expect(getActiveConfig()).toMatchObject({ provider: 'openrouter', config: { mainModel, kbModel: expectedKb, researchModel: 'custom/research', apiKey: 'cloud-session' } });
      const envelope = JSON.parse(cloud.get('cellproject-config')!);
      expect(envelope).toMatchObject({ version: 5, state: { providers: { openrouter: { mainModel, kbModel: expectedKb, researchModel: 'custom/research' } } } });
      expect(envelope.state.providers.openrouter.apiKey).toBeUndefined();
    } finally { configureCloud(null); cloud.dispose(); }
  });
});
