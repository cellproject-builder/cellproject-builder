import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { APICallError } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { torqueDiagram } from '../diagram/fixture';
import type { MentionTarget, VisualPromptInput, VisualWorkspace } from '../types';
import { VisualExplorer, type VisualExplorerProps } from './VisualExplorer';
import { useVisualPopupStore } from './uiStore';
import { useVisualStrings, visualError } from './strings';

const capacityMessage = 'The system is currently experiencing high demand and cannot process your request. Your request exceeds the maximum usage size allowed during peak load. For improved capacity reliability, consider switching to Provisioned Throughput.';
const configurationMessage = 'This AI provider is not configured on the server.';
const apiError = (statusCode: number, responseHeaders?: Record<string, string>, data?: unknown, message = 'Provider returned error') => new APICallError({
  message, url: 'https://provider.test/chat', requestBodyValues: {}, statusCode, responseHeaders, data,
});
const busyMessage = {
  'pt-BR': 'O provedor de IA está temporariamente ocupado. Seu pedido e suas referências foram mantidos. Tente novamente em instantes.',
  en: 'The AI provider is temporarily busy. Your request and references are preserved. Try again in a moment.',
};
const waitMessage = {
  'pt-BR': 'O provedor de IA está temporariamente ocupado. Seu pedido e suas referências foram mantidos. Aguarde 7 s antes de tentar novamente.',
  en: 'The AI provider is temporarily busy. Your request and references are preserved. Wait 7 s before trying again.',
};

let host: HTMLDivElement, root: Root, strings: ReturnType<typeof useVisualStrings>;
function StringsProbe() { strings = useVisualStrings(); return null; }
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await useLocaleStore.persist.rehydrate();
  useLocaleStore.setState({ locale: 'en' });
  useVisualPopupStore.setState({ searchOpen: false, modelOpen: true, modelMinimized: false, modelBase: null, inspectedArtifactId: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<StringsProbe />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe.each(['pt-BR', 'en'] as const)('visual provider capacity messages (%s)', locale => {
  beforeEach(() => act(() => useLocaleStore.setState({ locale })));

  it.each([
    new Error(capacityMessage),
    new Error('Provider returned error', { cause: new Error(capacityMessage) }),
    apiError(200, undefined, { error: { code: 'NoCapacity', message: capacityMessage } }),
    apiError(429),
    apiError(503),
  ])('explains temporary provider capacity without passing through provider purchasing advice (%#)', error => {
    expect(visualError(error, strings)).toBe(busyMessage[locale]);
  });

  it.each([
    apiError(429, { 'retry-after-ms': '6250' }),
    apiError(503, { 'Retry-After': '7' }),
    new Error('Provider returned error', { cause: apiError(200, { 'retry-after': '7' }, { error: { code: 'NoCapacity' } }) }),
  ])('uses the provider wait time before an explicit retry (%#)', error => {
    expect(visualError(error, strings)).toBe(waitMessage[locale]);
  });

  it.each([
    apiError(503, { 'retry-after': '7' }, { error: { code: 'provider_not_configured', message: configurationMessage } }, configurationMessage),
    apiError(503, undefined, { error: { code: 'provider_not_configured' } }, configurationMessage),
    new Error(configurationMessage, { cause: apiError(503) }),
  ])('preserves permanent provider configuration errors without inviting a capacity retry (%#)', error => {
    expect(visualError(error, strings)).toBe(configurationMessage);
  });

  it('preserves existing visual errors and does not relabel authentication, billing or malformed input as capacity', () => {
    expect(visualError(new Error('visualSourceMissing', { cause: apiError(503) }), strings)).toBe(locale === 'en'
      ? 'A selected reference is no longer available. Remove it or select it again with @.'
      : 'Uma referência selecionada não está mais disponível. Remova-a ou selecione-a novamente com @.');
    const auth = apiError(401, undefined, { error: { code: 'NoCapacity', message: capacityMessage } }, 'Authentication failed');
    expect(visualError(auth, strings)).toBe('Authentication failed');
    const quota = apiError(429, undefined, { error: { code: 'insufficient_quota' } }, 'Insufficient credits');
    expect(visualError(quota, strings)).toBe('Insufficient credits');
    expect(visualError(new Error('Your request exceeds the maximum context length.'), strings)).toBe('Your request exceeds the maximum context length.');
  });

  it('keeps an empty diagram prompt and its selected node for the existing explicit Generate action', async () => {
    const node: MentionTarget = { id: 'clearance-node', kind: 'node', label: 'Adaptar folgas e imprimir', detail: 'Passo', fingerprint: 'v1' };
    const input: VisualPromptInput = { text: '', mentions: [node], attachments: [], artifactKind: 'diagram' };
    const workspace: VisualWorkspace = { version: 1, mode: 'approval', artifacts: [], proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: input } };
    const onGenerate = vi.fn<VisualExplorerProps['onGenerate']>().mockRejectedValueOnce(new Error(capacityMessage)).mockResolvedValueOnce({
      id: 'diagram-retry', projectId: 'p1', label: 'Folgas ilustrativas', kind: 'diagram', diagram: torqueDiagram(), scene: null,
      status: 'ready', input, contextFingerprint: 'v1', createdAt: 1,
    });
    const props: VisualExplorerProps = { projectId: 'p1', workspace, listMentions: () => [node], onDraft: vi.fn(), onAttach: vi.fn(), onSearch: vi.fn(),
      onGenerate, onAdd: vi.fn(), onApply: vi.fn(), onReject: vi.fn(), onMode: vi.fn(), onMedia: vi.fn() };
    act(() => root.render(<VisualExplorer {...props} />));
    const generate = () => host.querySelector<HTMLButtonElement>(`button[aria-label="${locale === 'en' ? 'Generate diagram' : 'Gerar diagrama'}"]`)!;
    await act(async () => generate().click());
    const panel = host.querySelector('[data-visual-popup="model"]')!;
    expect(panel.querySelector('[role="alert"]')?.textContent).toBe(busyMessage[locale]);
    expect(panel.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
    expect(panel.querySelector('.visual-chip')?.textContent).toContain(node.label);
    expect(panel.querySelector('.visual-proposal')).toBeNull();
    expect(props.onDraft).not.toHaveBeenCalled(); expect(props.onApply).not.toHaveBeenCalled();
    expect(onGenerate).toHaveBeenCalledExactlyOnceWith(input, expect.any(AbortSignal));
    expect(generate().disabled).toBe(false);
    await act(async () => generate().click());
    expect(onGenerate).toHaveBeenCalledTimes(2);
    expect(onGenerate).toHaveBeenLastCalledWith(input, expect.any(AbortSignal));
    expect(panel.querySelector('[role="alert"]')).toBeNull();
    expect(panel.querySelector('.visual-proposal-text')?.textContent).toContain('Folgas ilustrativas');
  });
});
