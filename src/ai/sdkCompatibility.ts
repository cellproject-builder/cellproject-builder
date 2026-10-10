import type { LanguageModel, ToolSet } from 'ai';

type LegacyModel = Extract<LanguageModel, { specificationVersion: 'v2' }>;
type LegacyOptions = Parameters<LegacyModel['doGenerate']>[0];

/** ai@6 renamed provider-defined tools; installed provider SDKs still use V2. */
export function providerToolForCurrentSDK(tool: object): ToolSet[string] {
  return { ...tool, type: 'provider' } as unknown as ToolSet[string];
}

function legacyOptions(options: LegacyOptions): LegacyOptions {
  return {
    ...options,
    tools: options.tools?.map(tool => (tool as { type: string }).type === 'provider'
      ? { ...tool, type: 'provider-defined' } as typeof tool
      : tool),
  };
}

/** Translate at both boundaries or V2 silently omits the search tool. */
export function researchModelForCurrentSDK(model: LegacyModel): LegacyModel {
  return new Proxy(model, {
    get(target, property) {
      if (property === 'doGenerate') return (options: LegacyOptions) => target.doGenerate(legacyOptions(options));
      if (property === 'doStream') return (options: LegacyOptions) => target.doStream(legacyOptions(options));
      return Reflect.get(target, property, target);
    },
  });
}
