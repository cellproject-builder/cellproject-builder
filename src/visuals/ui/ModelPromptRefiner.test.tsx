import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { ModelPromptRefiner } from './ModelPromptRefiner';
import type { ModelRefinement } from '../refinement';
let host: HTMLDivElement, root: Root, mounted: boolean, props: ComponentProps<typeof ModelPromptRefiner>;
const result = (questions: string[] = []): ModelRefinement => ({ subject: 'Motor de passo', interpretation: 'Motor com flange de 42 mm. Comprimento ainda ilustrativo.', suggestedPrompt: 'Model a stepper with 42 mm flange and illustrative body length.', questions, assumptions: ['Not measured'], referenceSummary: [], contextFingerprint: 'v1', inputSignature: 'v1' });
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? [...host.querySelectorAll('button')].find(el => el.textContent?.trim() === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
const render = async () => { await act(async () => root.render(<ModelPromptRefiner {...props}/>)); };
const type = async (text: string) => { const field = host.querySelector('textarea')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text); field.dispatchEvent(new Event('input', { bubbles: true })); }); };
beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await useLocaleStore.persist.rehydrate(); useLocaleStore.setState({ locale: 'en' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = true;
  const input = { text: 'Model this motor', mentions: [], attachments: [] };
  props = { input, workspace: { version: 1, mode: 'approval', artifacts: [], proposals: [], drafts: { search: input, model: input } }, listMentions: () => [], onAttach: vi.fn(), onMedia: vi.fn(), onChange: vi.fn(), onRefine: vi.fn(async () => result()), isCurrent: vi.fn(() => true), onUse: vi.fn(), onFindReferences: vi.fn(), onClose: vi.fn() };
  await render();
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); host.remove(); });
it('uses one conversation field and one explicit update→generate action without a confirmation checkbox', async () => {
  expect(props.onRefine).not.toHaveBeenCalled(); await click('Update request');
  expect(host.querySelectorAll('textarea')).toHaveLength(1);
  expect(host.querySelector('[aria-label="This is the object I want to model"]')).toBeNull();
  expect(host.textContent).toContain(result().subject);
  expect(props.onUse).not.toHaveBeenCalled(); await click('Generate model');
  expect(props.onUse).toHaveBeenCalledWith({ ...props.input, text: result().suggestedPrompt });
});
it('keeps an essential question pending, incorporates an answer, then enables explicit generation', async () => {
  vi.mocked(props.onRefine).mockResolvedValueOnce(result(['Which variant?']));
  await click('Update request'); expect(host.textContent).toContain('Which variant?');
  expect(button('Update request').disabled).toBe(true);
  await type('Variant X, use approximate proportions.'); await click('Update request');
  expect(props.onRefine).toHaveBeenLastCalledWith(props.input, { kind: 'existing', feedback: 'Variant X, use approximate proportions.', previous: result(['Which variant?']) }, expect.any(AbortSignal));
  expect(props.onUse).not.toHaveBeenCalled(); await click('Generate model'); expect(props.onUse).toHaveBeenCalledOnce();
});
it('treats edits as feedback until the updated interpretation is returned', async () => {
  await click('Original concept'); await click('Update request');
  await type('Preserve the flange and add the rear connector.');
  expect(button('Generate model')).toBeUndefined(); await click('Update request');
  expect(props.onRefine).toHaveBeenLastCalledWith(props.input, expect.objectContaining({ kind: 'concept', feedback: 'Preserve the flange and add the rear connector.', previous: result() }), expect.any(AbortSignal));
  expect(props.onUse).not.toHaveBeenCalled();
});
it('uses current references and refuses to generate an outdated interpretation', async () => {
  await click('Update request'); props.isCurrent = vi.fn(() => false); await render();
  expect(button('Generate model')).toBeUndefined(); await click('Find a reference');
  expect(props.onFindReferences).toHaveBeenCalledWith(props.input); expect(props.onUse).not.toHaveBeenCalled();
});
it('aborts cancellation and ignores a response arriving afterwards', async () => {
  let resolve!: (value: ModelRefinement) => void;
  props.onRefine = vi.fn(() => new Promise<ModelRefinement>(done => { resolve = done; })); await render(); await click('Update request');
  const signal = vi.mocked(props.onRefine).mock.calls[0][2]; await click('Cancel'); expect(signal.aborted).toBe(true);
  await act(async () => resolve(result())); expect(host.textContent).not.toContain(result().subject);
});
it('aborts work when its original input changes or the refiner unmounts', async () => {
  props.onRefine = vi.fn(() => new Promise<ModelRefinement>(() => {})); await render(); await click('Update request');
  const first = vi.mocked(props.onRefine).mock.calls[0][2]; props.input = { text: 'Another motor', mentions: [], attachments: [] }; await render(); expect(first.aborted).toBe(true);
  await click('Update request'); const last = vi.mocked(props.onRefine).mock.calls[1][2];
  await act(async () => root.unmount()); mounted = false; expect(last.aborted).toBe(true);
});
